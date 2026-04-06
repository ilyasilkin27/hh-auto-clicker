#!/usr/bin/env node
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const TEST_DIR = './chat-auto/.tmp'
const execFileAsync = promisify(execFile)

const baseEnv = {
  CHAT_ADAPTER: 'mock',
  AUTO_STATE_FILE: `${TEST_DIR}/state.json`,
  AUTO_LOG_FILE: `${TEST_DIR}/log.jsonl`,
  DRAFT_QUEUE_FILE: `${TEST_DIR}/drafts.json`,
  MOCK_INBOX_FILE: `${TEST_DIR}/inbox.json`,
  MOCK_OUTBOX_FILE: `${TEST_DIR}/outbox.json`,
  MIN_CONFIDENCE: '0.65',
  MAX_RETRIES: '3',
  MAX_REPLIES_PER_HOUR: '100',
  MIN_SECONDS_BETWEEN_REPLIES: '0',
  MOCK_RANDOM_FAIL_RATE: '0',
}

const setupEnv = async () => {
  await fs.mkdir(TEST_DIR, { recursive: true })

  await fs.writeFile(`${TEST_DIR}/state.json`, '{}\n', 'utf8')
  await fs.writeFile(`${TEST_DIR}/outbox.json`, '[]\n', 'utf8')
  await fs.writeFile(`${TEST_DIR}/log.jsonl`, '', 'utf8')
}

const writeInbox = async messages => {
  await fs.writeFile(`${TEST_DIR}/inbox.json`, `${JSON.stringify(messages, null, 2)}\n`, 'utf8')
}

const runCycle = async mode => {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['./chat-auto/cli/process-cycle.js'],
      {
        env: {
          ...process.env,
          ...baseEnv,
          AUTO_MODE: mode,
        },
        cwd: process.cwd(),
      },
    )

    return JSON.parse(stdout)
  } catch (error) {
    if (error?.stdout) {
      return JSON.parse(error.stdout)
    }

    throw error
  }
}

const run = async () => {
  await setupEnv()

  const happyMessages = Array.from({ length: 10 }).map((_, index) => ({
    chatId: 'chat-happy',
    messageId: `happy-${index + 1}`,
    senderType: 'candidate',
    vacancyTitle: 'Frontend Developer',
    messageText: `Здравствуйте, уточните, пожалуйста, стек и этапы интервью #${index + 1}`,
    receivedAt: new Date().toISOString(),
  }))

  await writeInbox(happyMessages)
  let result = await runCycle('safe')
  assert.equal(result.summary.drafts, 10, 'safe mode should create drafts for 10 messages')

  await writeInbox(
    happyMessages.map((msg, i) => ({ ...msg, messageId: `full-${i + 1}` })),
  )

  result = await runCycle('full')
  assert.equal(result.summary.sent, 10, 'full mode should send 10 of 10')

  await writeInbox([{ ...happyMessages[0], messageId: 'full-1' }])
  result = await runCycle('full')
  assert.equal(result.summary.polled, 0, 'duplicate should not be polled again')

  await writeInbox([
    {
      chatId: 'chat-risk',
      messageId: 'risk-1',
      senderType: 'candidate',
      vacancyTitle: 'Frontend Developer',
      messageText: 'Пришлите серию и номер паспорта и cvv карты',
      receivedAt: new Date().toISOString(),
    },
  ])

  result = await runCycle('full')
  assert.equal(
    result.summary.manual + result.summary.skipped,
    1,
    'stop-topic message should be blocked (manual or skipped)',
  )

  await writeInbox([
    {
      chatId: 'chat-empty',
      messageId: 'empty-1',
      senderType: 'candidate',
      vacancyTitle: 'Frontend Developer',
      messageText: '',
      receivedAt: new Date().toISOString(),
    },
  ])

  result = await runCycle('full')
  assert.equal(
    result.summary.manual + result.summary.failed + result.summary.skipped,
    1,
    'empty input should not auto-send',
  )

  console.log('E2E OK: happy path, duplicates, stop-topics, empty input')
}

run().catch(error => {
  console.error(`e2e-tests failed: ${error.message}`)
  process.exitCode = 1
})
