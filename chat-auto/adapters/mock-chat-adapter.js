import { readJsonFile, writeJsonFileAtomic } from '../utils/fs-utils.js'
import { config } from '../core/config.js'
import { ERROR_CODES } from '../core/contract.js'

const nowIso = () => new Date().toISOString()

const normalizeInbox = list =>
  (Array.isArray(list) ? list : [])
    .map(item => ({
      chatId: String(item.chatId || ''),
      messageId: String(item.messageId || ''),
      senderType: String(item.senderType || 'candidate'),
      vacancyTitle: String(item.vacancyTitle || ''),
      messageText: String(item.messageText || ''),
      receivedAt: item.receivedAt || nowIso(),
    }))
    .filter(item => item.chatId && item.messageId)

export const pollNewMessages = async ({ processedMessageIds = {}, limit = 20 }) => {
  const inbox = normalizeInbox(await readJsonFile(config.mockInboxFile, []))

  return inbox
    .filter(item => item.senderType === 'candidate')
    .filter(item => !processedMessageIds[item.messageId])
    .slice(0, limit)
}

export const sendReply = async ({ chatId, messageId, replyText }) => {
  if (!chatId || !messageId) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION,
      errorReason: 'chatId_or_messageId_missing',
    }
  }

  if (!replyText?.trim()) {
    return {
      ok: false,
      code: ERROR_CODES.EMPTY_REPLY,
      errorReason: 'reply_text_empty',
    }
  }

  const randomNetworkFailure = Math.random() < config.mockRandomFailRate
  if (randomNetworkFailure) {
    return {
      ok: false,
      code: ERROR_CODES.NETWORK,
      errorReason: 'mock_random_network_failure',
    }
  }

  const outbox = await readJsonFile(config.mockOutboxFile, [])
  const next = Array.isArray(outbox) ? outbox : []

  next.push({
    chatId,
    messageId,
    replyText,
    sentAt: nowIso(),
  })

  await writeJsonFileAtomic(config.mockOutboxFile, next)

  return {
    ok: true,
    code: 'OK',
    providerMessageId: `mock-${Date.now()}`,
  }
}
