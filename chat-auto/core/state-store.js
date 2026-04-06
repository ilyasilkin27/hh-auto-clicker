import { config } from './config.js'
import { readJsonFile, writeJsonFileAtomic } from '../utils/fs-utils.js'

const defaultState = () => ({
  lastPollAt: null,
  processedMessageIds: {},
  draftsByMessageId: {},
  sentByMessageId: {},
  metrics: {
    byHour: {},
    lastSentAt: null,
  },
})

export const loadState = async () => {
  const state = await readJsonFile(config.stateFile, defaultState())

  return {
    ...defaultState(),
    ...state,
    metrics: {
      ...defaultState().metrics,
      ...(state.metrics || {}),
    },
  }
}

export const saveState = async state => {
  await writeJsonFileAtomic(config.stateFile, state)
}

export const markProcessed = (state, messageId, result) => {
  state.processedMessageIds[messageId] = {
    processedAt: new Date().toISOString(),
    status: result.status,
    errorReason: result.errorReason,
  }
}

export const addDraft = (state, result) => {
  state.draftsByMessageId[result.messageId] = {
    ...result,
    draftCreatedAt: new Date().toISOString(),
  }
}

export const markSent = (state, result, providerMeta = {}) => {
  state.sentByMessageId[result.messageId] = {
    ...result,
    ...providerMeta,
    sentAt: new Date().toISOString(),
  }
}
