#!/usr/bin/env node
import { loadState } from '../core/state-store.js'

const main = async () => {
  const state = await loadState()
  const drafts = Object.values(state.draftsByMessageId || {})
  console.log(JSON.stringify({ count: drafts.length, drafts }, null, 2))
}

main().catch(error => {
  console.error(`list-drafts failed: ${error.message}`)
  process.exitCode = 1
})
