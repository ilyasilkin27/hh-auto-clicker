import { appendLine, ensureDir } from '../utils/fs-utils.js'
import { config } from './config.js'

export const logEvent = async (eventType, payload) => {
  const row = {
    eventType,
    timestamp: new Date().toISOString(),
    ...payload,
  }

  await appendLine(config.logFile, JSON.stringify(row))
}

export const ensureLogFiles = async () => {
  await ensureDir(config.logFile)
}
