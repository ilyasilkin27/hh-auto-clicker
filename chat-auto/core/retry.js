import { config } from './config.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export const withRetry = async (fn, options = {}) => {
  const retries = options.retries ?? config.maxRetries
  const baseDelay = options.baseDelay ?? config.baseBackoffMs

  let lastError

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const value = await fn(attempt)
      return { ok: true, attempt, value }
    } catch (error) {
      lastError = error

      if (attempt === retries) {
        break
      }

      const jitter = Math.floor(Math.random() * 200)
      const timeout = baseDelay * 2 ** (attempt - 1) + jitter
      await sleep(timeout)
    }
  }

  return {
    ok: false,
    attempt: retries,
    error: lastError,
  }
}
