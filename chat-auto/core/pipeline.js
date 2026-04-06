import { config, isFullAuto } from './config.js'
import { ERROR_CODES, STATUS, makeResult, normalizeIncomingMessage, validateIncomingMessage } from './contract.js'
import { getChatAdapter } from '../adapters/index.js'
import { loadState, saveState, markProcessed, addDraft, markSent } from './state-store.js'
import { logEvent } from './logger.js'
import { detectRisk } from './risk.js'
import { withRetry } from './retry.js'
import { generateReply } from '../services/reply-generator.js'
import { canSendNow, markSentInRateLimit } from './rate-limit.js'
import { sendAlert } from '../services/alerts.js'

const normalizeError = error => String(error?.message || 'unknown_error')

const makeManualOrSkippedResult = ({ baseResult, errorReason }) => {
  if (config.skipManualReview) {
    return {
      ...baseResult,
      status: STATUS.SKIPPED,
      errorReason,
    }
  }

  return {
    ...baseResult,
    status: STATUS.MANUAL_REVIEW,
    errorReason,
  }
}

const processOneMessage = async ({ adapter, state, rawMessage }) => {
  const message = normalizeIncomingMessage(rawMessage)
  const validation = validateIncomingMessage(message)

  if (!validation.isValid) {
    const result = makeResult({
      ...message,
      status: STATUS.FAIL,
      errorReason: `missing:${validation.missing.join(',')}`,
    })

    markProcessed(state, message.messageId || `invalid-${Date.now()}`, result)
    await logEvent('invalid_message', result)
    return result
  }

  if (state.processedMessageIds[message.messageId]) {
    const result = makeResult({
      ...message,
      status: STATUS.SKIPPED_DUPLICATE,
      errorReason: 'already_processed',
    })
    await logEvent('dedupe_skip', result)
    return result
  }

  const reply = await generateReply(message)
  const baseResult = makeResult({
    ...message,
    confidence: reply.confidence,
    replyText: reply.replyText,
    status: STATUS.NEW,
  })

  const risk = detectRisk({
    vacancyTitle: message.vacancyTitle,
    messageText: message.messageText,
    confidence: reply.confidence,
  })

  if (risk.blocked) {
    const result = makeManualOrSkippedResult({
      baseResult,
      errorReason: `${ERROR_CODES.RISK_BLOCKED}:${risk.reason}`,
    })

    if (result.status === STATUS.MANUAL_REVIEW) {
      addDraft(state, result)
    }

    markProcessed(state, message.messageId, result)
    await logEvent(result.status === STATUS.SKIPPED ? 'risk_skipped' : 'risk_blocked', result)

    if (result.status === STATUS.MANUAL_REVIEW) {
      await sendAlert({
        level: 'WARN',
        message: 'Message blocked by risk rule',
        details: { messageId: message.messageId, reason: risk.reason },
      })
    }

    return result
  }

  if (!reply.replyText?.trim()) {
    const result = {
      ...baseResult,
      status: STATUS.FAIL,
      errorReason: ERROR_CODES.EMPTY_REPLY,
    }
    markProcessed(state, message.messageId, result)
    await logEvent('empty_reply', result)
    await sendAlert({
      level: 'ERROR',
      message: 'Empty reply generated',
      details: { messageId: message.messageId },
    })
    return result
  }

  if (reply.confidence < config.minConfidence) {
    const result = makeManualOrSkippedResult({
      baseResult,
      errorReason: 'low_confidence_manual',
    })

    if (result.status === STATUS.MANUAL_REVIEW) {
      addDraft(state, result)
    }

    markProcessed(state, message.messageId, result)
    await logEvent(
      result.status === STATUS.SKIPPED ? 'low_confidence_skipped' : 'low_confidence',
      result,
    )

    if (result.status === STATUS.MANUAL_REVIEW) {
      await sendAlert({
        level: 'WARN',
        message: 'Low confidence draft queued',
        details: { messageId: message.messageId, confidence: reply.confidence },
      })
    }

    return result
  }

  if (!isFullAuto()) {
    const result = {
      ...baseResult,
      status: STATUS.DRAFT_ONLY,
      errorReason: '',
    }
    addDraft(state, result)
    markProcessed(state, message.messageId, result)
    await logEvent('draft_created', result)
    return result
  }

  const rateLimit = canSendNow(state)
  if (!rateLimit.allowed) {
    const result = makeManualOrSkippedResult({
      baseResult,
      errorReason: `rate_limited:${rateLimit.reason}`,
    })

    if (result.status === STATUS.MANUAL_REVIEW) {
      addDraft(state, result)
    }

    markProcessed(state, message.messageId, result)
    await logEvent(result.status === STATUS.SKIPPED ? 'rate_limited_skipped' : 'rate_limited', result)
    return result
  }

  const sendAttempt = await withRetry(
    () =>
      adapter.sendReply({
        chatId: message.chatId,
        messageId: message.messageId,
        replyText: reply.replyText,
      }),
    {
      retries: config.maxRetries,
      baseDelay: config.baseBackoffMs,
    },
  )

  if (!sendAttempt.ok || !sendAttempt.value?.ok) {
    const code = sendAttempt.value?.code || ERROR_CODES.NETWORK
    const errorReason = sendAttempt.value?.errorReason || normalizeError(sendAttempt.error)

    const result = {
      ...baseResult,
      status: STATUS.FAIL,
      errorReason: `${code}:${errorReason}`,
    }

    markProcessed(state, message.messageId, result)
    await logEvent('send_fail', {
      ...result,
      retryAttempts: sendAttempt.attempt,
    })
    await sendAlert({
      level: 'ERROR',
      message: 'Failed to send reply',
      details: { messageId: message.messageId, code, errorReason },
    })
    return result
  }

  markSentInRateLimit(state)

  const sentResult = {
    ...baseResult,
    status: STATUS.SENT,
    errorReason: '',
  }

  markProcessed(state, message.messageId, sentResult)
  markSent(state, sentResult, {
    providerMessageId: sendAttempt.value.providerMessageId || '',
    retryAttempts: sendAttempt.attempt,
  })

  await logEvent('sent', {
    ...sentResult,
    providerMessageId: sendAttempt.value.providerMessageId || '',
    retryAttempts: sendAttempt.attempt,
  })

  return sentResult
}

export const pollOnly = async () => {
  const adapter = getChatAdapter()
  const state = await loadState()
  const messages = await adapter.pollNewMessages({
    processedMessageIds: state.processedMessageIds,
    limit: config.pollLimit,
  })

  state.lastPollAt = new Date().toISOString()
  await saveState(state)

  return messages
}

export const runCycle = async () => {
  const adapter = getChatAdapter()
  const state = await loadState()

  const newMessages = await adapter.pollNewMessages({
    processedMessageIds: state.processedMessageIds,
    limit: config.pollLimit,
  })

  await logEvent('poll', {
    count: newMessages.length,
    mode: config.mode,
    adapter: config.adapterType,
  })

  const results = []

  for (const message of newMessages) {
    const result = await processOneMessage({
      adapter,
      state,
      rawMessage: message,
    })
    results.push(result)
  }

  state.lastPollAt = new Date().toISOString()
  await saveState(state)

  const summary = {
    polled: newMessages.length,
    sent: results.filter(item => item.status === STATUS.SENT).length,
    drafts: results.filter(item => item.status === STATUS.DRAFT_ONLY).length,
    manual: results.filter(item => item.status === STATUS.MANUAL_REVIEW).length,
    failed: results.filter(item => item.status === STATUS.FAIL).length,
    skipped: results.filter(item => [STATUS.SKIPPED, STATUS.SKIPPED_DUPLICATE].includes(item.status)).length,
    mode: config.mode,
  }

  await logEvent('cycle_summary', summary)
  return { summary, results }
}

export const approveDraft = async messageId => {
  const adapter = getChatAdapter()
  const state = await loadState()
  const draft = state.draftsByMessageId[messageId]

  if (!draft) {
    return {
      ok: false,
      reason: 'draft_not_found',
    }
  }

  const sendAttempt = await withRetry(
    () =>
      adapter.sendReply({
        chatId: draft.chatId,
        messageId: draft.messageId,
        replyText: draft.replyText,
      }),
    {
      retries: config.maxRetries,
      baseDelay: config.baseBackoffMs,
    },
  )

  if (!sendAttempt.ok || !sendAttempt.value?.ok) {
    const code = sendAttempt.value?.code || ERROR_CODES.NETWORK
    const reason = sendAttempt.value?.errorReason || normalizeError(sendAttempt.error)

    await logEvent('approve_fail', {
      messageId,
      code,
      reason,
    })

    return {
      ok: false,
      reason: `${code}:${reason}`,
    }
  }

  const sentResult = {
    ...draft,
    status: STATUS.SENT,
    errorReason: '',
  }

  markSentInRateLimit(state)
  markSent(state, sentResult, {
    providerMessageId: sendAttempt.value.providerMessageId || '',
    retryAttempts: sendAttempt.attempt,
  })

  delete state.draftsByMessageId[messageId]
  state.processedMessageIds[messageId] = {
    processedAt: new Date().toISOString(),
    status: STATUS.SENT,
    errorReason: '',
  }

  await saveState(state)
  await logEvent('approve_sent', {
    messageId,
    retryAttempts: sendAttempt.attempt,
  })

  return { ok: true }
}
