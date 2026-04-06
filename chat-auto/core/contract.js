export const STATUS = {
  NEW: 'new',
  DRAFT_ONLY: 'draft_only',
  SENT: 'sent',
  MANUAL_REVIEW: 'manual_review',
  SKIPPED: 'skipped',
  SKIPPED_DUPLICATE: 'skipped_duplicate',
  FAIL: 'fail',
}

export const ERROR_CODES = {
  NETWORK: 'NETWORK_ERROR',
  AUTH: 'AUTH_ERROR',
  VALIDATION: 'VALIDATION_ERROR',
  RATE_LIMIT: 'RATE_LIMIT_ERROR',
  RISK_BLOCKED: 'RISK_BLOCKED',
  EMPTY_REPLY: 'EMPTY_REPLY',
  UNKNOWN: 'UNKNOWN_ERROR',
}

export const normalizeIncomingMessage = message => ({
  chatId: String(message?.chatId || ''),
  messageId: String(message?.messageId || ''),
  senderType: String(message?.senderType || 'unknown'),
  vacancyTitle: String(message?.vacancyTitle || ''),
  messageText: String(message?.messageText || ''),
  receivedAt: message?.receivedAt || new Date().toISOString(),
})

export const validateIncomingMessage = message => {
  const required = [
    'chatId',
    'messageId',
    'senderType',
    'vacancyTitle',
    'messageText',
    'receivedAt',
  ]

  const missing = required.filter(key => !message?.[key])

  return {
    isValid: missing.length === 0,
    missing,
  }
}

export const makeResult = ({
  chatId,
  messageId,
  senderType,
  vacancyTitle,
  messageText,
  receivedAt,
  confidence = 0,
  replyText = '',
  status = STATUS.NEW,
  errorReason = '',
}) => ({
  chatId,
  messageId,
  senderType,
  vacancyTitle,
  messageText,
  receivedAt,
  confidence,
  replyText,
  status,
  errorReason,
})
