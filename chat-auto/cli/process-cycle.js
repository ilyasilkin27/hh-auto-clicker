#!/usr/bin/env node
import { runCycle } from '../core/pipeline.js'
import { ensureLogFiles } from '../core/logger.js'
import { shutdownAdapter } from '../adapters/index.js'

const main = async () => {
  try {
    await ensureLogFiles()
    const { summary, results } = await runCycle()

    console.log(JSON.stringify({ summary, results }, null, 2))

    if (summary.failed > 0) {
      process.exitCode = 1
    }
  } finally {
    await shutdownAdapter()
  }
}

main().catch(error => {
  console.error(`process-cycle failed: ${error.message}`)
  process.exitCode = 1
})
