import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HOST = process.env.RUNNER_HOST || '0.0.0.0'
const PORT = Number.parseInt(process.env.RUNNER_PORT || '3001', 10)
const AUTH_TOKEN = process.env.RUNNER_AUTH_TOKEN || ''
const PROJECT_ROOT = process.env.PROJECT_ROOT || '/files/hh-auto-clicker'
const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.RUNNER_COMMAND_TIMEOUT_MS || '3600000',
  10,
)
const inFlightRoutes = new Set()

const commands = {
  '/run/chat-process': {
    file: process.execPath,
    args: ['chat-auto/cli/process-cycle.js'],
    env: {},
    timeoutMs: 20 * 60 * 1000,
  },
  '/run/chat-report': {
    file: process.execPath,
    args: ['chat-auto/cli/daily-report.js'],
    env: {},
    timeoutMs: 2 * 60 * 1000,
  },
  '/run/apply-daily': {
    file: process.execPath,
    args: [
      'playwright/run-rotating-batch.js',
      '--resumes', 'playwright/resumes.json',
      '--cookies', 'playwright/cookies.json',
      '--state', 'playwright/apply-rotation-state.json',
      '--max', '100',
      '--maxAttempts', '240',
      '--maxFailStreak', '7',
    ],
    env: {},
    timeoutMs: 90 * 60 * 1000,
  },
  '/run/smoke-apply': {
    file: process.execPath,
    args: ['-e', "const p=require('./playwright/resumes.json');const ids=Array.isArray(p)?p:(p.resumeIds||[]);if(!ids[0]){console.error('No resume IDs in resumes.json');process.exit(1);}const {spawn}=require('node:child_process');const child=spawn(process.execPath,['playwright/hh-auto-respond.js','--cookies','playwright/cookies.json','--resume',String(ids[0]),'--max','1','--maxAttempts','10','--maxFailStreak','3'],{stdio:'inherit'});child.on('exit',code=>process.exit(code??1));"],
    env: {},
    timeoutMs: 12 * 60 * 1000,
  },
  '/run/smoke-chat': {
    file: process.execPath,
    args: ['-e', "const fs=require('node:fs');const p='chat-auto/.tmp';fs.mkdirSync(p,{recursive:true});fs.writeFileSync(`${p}/smoke-inbox.json`,JSON.stringify([{chatId:'smoke-chat',messageId:'smoke-msg-1',senderType:'candidate',vacancyTitle:'Frontend Developer',messageText:'Здравствуйте, подскажите стек и этапы интервью?',receivedAt:new Date().toISOString()}],null,2)+'\\n');fs.writeFileSync(`${p}/smoke-outbox.json`,'[]\\n');fs.writeFileSync(`${p}/smoke-state.json`,'{}\\n');fs.writeFileSync(`${p}/smoke-log.jsonl`,'');const {spawn}=require('node:child_process');const env={...process.env,CHAT_ADAPTER:'mock',AUTO_MODE:'safe',AUTO_STATE_FILE:`${p}/smoke-state.json`,AUTO_LOG_FILE:`${p}/smoke-log.jsonl`,DRAFT_QUEUE_FILE:`${p}/smoke-drafts.json`,MOCK_INBOX_FILE:`${p}/smoke-inbox.json`,MOCK_OUTBOX_FILE:`${p}/smoke-outbox.json`};const child=spawn(process.execPath,['chat-auto/cli/process-cycle.js'],{stdio:'inherit',env});child.on('exit',code=>process.exit(code??1));"],
    env: {},
    timeoutMs: 5 * 60 * 1000,
  },
}

const writeJson = (res, statusCode, body) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify(body, null, 2)}\n`)
}

const isAuthorized = req => {
  if (!AUTH_TOKEN) return true

  const header = String(req.headers.authorization || '')
  return header === `Bearer ${AUTH_TOKEN}`
}

const runCommand = async route => {
  const cmd = commands[route]
  if (!cmd) {
    return { ok: false, code: 404, body: { error: 'route_not_found' } }
  }

  const startedAt = new Date().toISOString()
  const timeoutMs = Number.isFinite(cmd.timeoutMs)
    ? cmd.timeoutMs
    : DEFAULT_TIMEOUT_MS
  console.log(`[runner] start ${route} timeoutMs=${timeoutMs} at=${startedAt}`)

  try {
    const { stdout, stderr } = await execFileAsync(cmd.file, cmd.args, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...(cmd.env || {}),
      },
      maxBuffer: 1024 * 1024 * 10,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    })

    let parsed = null
    try {
      parsed = stdout ? JSON.parse(stdout) : null
    } catch {
      parsed = null
    }

    return {
      ok: true,
      code: 200,
      body: {
        ok: true,
        route,
        exitCode: 0,
        stdout,
        stderr,
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
      },
    }
  } catch (error) {
    const stdout = String(error?.stdout || '')
    const stderr = String(error?.stderr || error?.message || '')
    const timedOut = Boolean(error?.killed) || String(error?.signal || '') === 'SIGTERM'

    let parsed = null
    try {
      parsed = stdout ? JSON.parse(stdout) : null
    } catch {
      parsed = null
    }

    return {
      ok: false,
      code: timedOut ? 504 : 500,
      body: {
        ok: false,
        route,
        timedOut,
        timeoutMs,
        exitCode: Number.isFinite(error?.code) ? error.code : 1,
        stdout,
        stderr,
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
      },
    }
  } finally {
    const endedAt = new Date().toISOString()
    console.log(`[runner] finish ${route} at=${endedAt}`)
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    writeJson(res, 200, { ok: true })
    return
  }

  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  if (!isAuthorized(req)) {
    writeJson(res, 401, { error: 'unauthorized' })
    return
  }

  const route = String(req.url || '')

  if (inFlightRoutes.has(route)) {
    writeJson(res, 409, {
      ok: false,
      route,
      error: 'already_running',
      message: `Route ${route} is already running`,
    })
    return
  }

  inFlightRoutes.add(route)
  try {
    const result = await runCommand(route)
    writeJson(res, result.code, result.body)
  } finally {
    inFlightRoutes.delete(route)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`runner listening on http://${HOST}:${PORT}`)
})
