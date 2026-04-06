#!/usr/bin/env node
import { approveDraft } from '../core/pipeline.js'
import { shutdownAdapter } from '../adapters/index.js'

const parseArgs = () => {
  const args = process.argv.slice(2)
  const parsed = {}

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue

    const key = arg.slice(2)
    const next = args[i + 1]

    if (!next || next.startsWith('--')) {
      parsed[key] = true
      continue
    }

    parsed[key] = next
    i += 1
  }

  return parsed
}

const main = async () => {
  try {
    const args = parseArgs()
    const messageId = String(args.messageId || '').trim()

    if (!messageId) {
      throw new Error('Use --messageId <id>')
    }

    const result = await approveDraft(messageId)

    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) {
      process.exitCode = 1
    }
  } finally {
    await shutdownAdapter()
  }
}

main().catch(error => {
  console.error(`send-reply failed: ${error.message}`)
  process.exitCode = 1
})
