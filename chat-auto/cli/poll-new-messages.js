#!/usr/bin/env node
import { pollOnly } from '../core/pipeline.js'
import { shutdownAdapter } from '../adapters/index.js'

const main = async () => {
  try {
    const messages = await pollOnly()
    console.log(JSON.stringify({ messages }, null, 2))
  } finally {
    await shutdownAdapter()
  }
}

main().catch(error => {
  console.error(`poll-new-messages failed: ${error.message}`)
  process.exitCode = 1
})
