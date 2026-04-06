import * as mockAdapter from './mock-chat-adapter.js'
import * as httpAdapter from './http-chat-adapter.js'
import * as playwrightAdapter from './playwright-hh-adapter.js'
import { config } from '../core/config.js'

export const getChatAdapter = () => {
  if (config.adapterType === 'playwright') {
    return playwrightAdapter
  }

  if (config.adapterType === 'http') {
    return httpAdapter
  }

  return mockAdapter
}

export const shutdownAdapter = async () => {
  const adapter = getChatAdapter()

  if (typeof adapter.closeAdapter === 'function') {
    await adapter.closeAdapter()
  }
}
