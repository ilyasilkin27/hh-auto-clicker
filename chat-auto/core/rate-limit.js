import { config } from './config.js'

const hourBucket = date => date.toISOString().slice(0, 13)

export const canSendNow = state => {
  const now = new Date()
  const bucket = hourBucket(now)
  const hourCount = Number(state.metrics.byHour?.[bucket] || 0)

  if (hourCount >= config.maxRepliesPerHour) {
    return {
      allowed: false,
      reason: 'hour_limit_reached',
    }
  }

  const lastSentAt = state.metrics.lastSentAt
  if (lastSentAt) {
    const deltaMs = now.getTime() - new Date(lastSentAt).getTime()
    const minDelayMs = config.minSecondsBetweenReplies * 1000

    if (deltaMs < minDelayMs) {
      return {
        allowed: false,
        reason: 'cooldown_not_met',
      }
    }
  }

  return {
    allowed: true,
    reason: '',
  }
}

export const markSentInRateLimit = state => {
  const now = new Date()
  const bucket = hourBucket(now)

  if (!state.metrics.byHour[bucket]) {
    state.metrics.byHour[bucket] = 0
  }

  state.metrics.byHour[bucket] += 1
  state.metrics.lastSentAt = now.toISOString()
}
