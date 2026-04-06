import { config } from '../core/config.js'
import { ERROR_CODES } from '../core/contract.js'

const authHeaders = () => {
  if (!config.chatToken) {
    return {}
  }

  return {
    Authorization: `Bearer ${config.chatToken}`,
  }
}

const normalizeHttpError = status => {
  if (status === 401 || status === 403) return ERROR_CODES.AUTH
  if (status === 429) return ERROR_CODES.RATE_LIMIT
  if (status >= 400 && status < 500) return ERROR_CODES.VALIDATION
  if (status >= 500) return ERROR_CODES.NETWORK
  return ERROR_CODES.UNKNOWN
}

export const pollNewMessages = async ({ processedMessageIds = {}, limit = 20 }) => {
  if (!config.pollUrl) {
    throw new Error('CHAT_POLL_URL is not configured')
  }

  const response = await fetch(config.pollUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ limit }),
  })

  if (!response.ok) {
    const code = normalizeHttpError(response.status)
    throw new Error(`poll_failed:${code}:${response.status}`)
  }

  const body = await response.json()
  const messages = Array.isArray(body?.messages) ? body.messages : []

  return messages
    .filter(item => item?.senderType === 'candidate')
    .filter(item => !processedMessageIds[String(item.messageId || '')])
    .map(item => ({
      chatId: String(item.chatId || ''),
      messageId: String(item.messageId || ''),
      senderType: String(item.senderType || 'candidate'),
      vacancyTitle: String(item.vacancyTitle || ''),
      messageText: String(item.messageText || ''),
      receivedAt: item.receivedAt || new Date().toISOString(),
    }))
}

export const sendReply = async ({ chatId, messageId, replyText }) => {
  if (!config.sendUrl) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION,
      errorReason: 'CHAT_SEND_URL is not configured',
    }
  }

  const response = await fetch(config.sendUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ chatId, messageId, replyText }),
  })

  if (!response.ok) {
    return {
      ok: false,
      code: normalizeHttpError(response.status),
      errorReason: `send_failed:${response.status}`,
    }
  }

  const body = await response.json().catch(() => ({}))

  return {
    ok: true,
    code: 'OK',
    providerMessageId: body?.providerMessageId || '',
  }
}
