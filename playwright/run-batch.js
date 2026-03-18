import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const parseArgs = () => {
  const args = process.argv.slice(2)
  const parsed = {}

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]

    if (!arg.startsWith('--')) {
      continue
    }

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

const readResumeIds = async filePath => {
  const content = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(content)

  const ids = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.resumeIds)
      ? parsed.resumeIds
      : []

  return ids.map(id => String(id || '').trim()).filter(Boolean)
}

const runWorker = ({
  resumeId,
  cookiesPath,
  max,
  maxAttempts,
  maxFailStreak,
  headed,
  debug,
  cover,
}) => {
  const scriptPath = path.resolve('playwright/hh-auto-respond.js')
  const args = [scriptPath, '--cookies', cookiesPath, '--resume', resumeId]

  if (max) {
    args.push('--max', String(max))
  }

  if (maxAttempts) {
    args.push('--maxAttempts', String(maxAttempts))
  }

  if (maxFailStreak) {
    args.push('--maxFailStreak', String(maxFailStreak))
  }

  if (cover) {
    args.push('--cover', cover)
  }

  if (headed) {
    args.push('--headed')
  }

  if (debug) {
    args.push('--debug')
  }

  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  const prefix = `[resume:${resumeId.slice(0, 8)}]`

  child.stdout.on('data', chunk => {
    const text = String(chunk)
      .split('\n')
      .filter(Boolean)
      .map(line => `${prefix} ${line}`)
      .join('\n')

    if (text) {
      process.stdout.write(`${text}\n`)
    }
  })

  child.stderr.on('data', chunk => {
    const text = String(chunk)
      .split('\n')
      .filter(Boolean)
      .map(line => `${prefix} ${line}`)
      .join('\n')

    if (text) {
      process.stderr.write(`${text}\n`)
    }
  })

  return new Promise(resolve => {
    child.on('close', code => {
      resolve({ resumeId, code: code ?? 1 })
    })
  })
}

const runPool = async ({ items, limit, worker }) => {
  const results = []
  let nextIndex = 0
  let active = 0

  return new Promise(resolve => {
    const launchNext = () => {
      while (active < limit && nextIndex < items.length) {
        const item = items[nextIndex]
        nextIndex += 1
        active += 1

        worker(item)
          .then(result => {
            results.push(result)
          })
          .catch(() => {
            results.push({ resumeId: item, code: 1 })
          })
          .finally(() => {
            active -= 1

            if (results.length === items.length) {
              resolve(results)
              return
            }

            launchNext()
          })
      }
    }

    launchNext()
  })
}

const main = async () => {
  const args = parseArgs()

  const resumesFile = args.resumes || './playwright/resumes.json'
  const cookiesPath = args.cookies || './playwright/cookies.json'
  const max = Number.parseInt(args.max ?? '10', 10)
  const maxAttempts = Number.parseInt(args.maxAttempts ?? '40', 10)
  const maxFailStreak = Number.parseInt(args.maxFailStreak ?? '5', 10)
  const concurrencyRaw = Number.parseInt(args.concurrency ?? '5', 10)
  const concurrency = Math.min(5, Math.max(1, concurrencyRaw))
  const headed = Boolean(args.headed)
  const debug = Boolean(args.debug)
  const cover = args.cover

  if (Number.isNaN(max) || max <= 0) {
    throw new Error('Параметр --max должен быть положительным числом.')
  }

  if (Number.isNaN(maxAttempts) || maxAttempts <= 0) {
    throw new Error('Параметр --maxAttempts должен быть положительным числом.')
  }

  if (Number.isNaN(maxFailStreak) || maxFailStreak <= 0) {
    throw new Error(
      'Параметр --maxFailStreak должен быть положительным числом.',
    )
  }

  const resumeIds = await readResumeIds(resumesFile)

  if (!resumeIds.length) {
    throw new Error(
      'Файл с резюме пустой. Ожидается массив resumeIds или поле resumeIds.',
    )
  }

  console.log(`Найдено резюме: ${resumeIds.length}`)
  console.log(
    `Параллельно запустим: ${Math.min(concurrency, resumeIds.length)}`,
  )

  const results = await runPool({
    items: resumeIds,
    limit: concurrency,
    worker: resumeId =>
      runWorker({
        resumeId,
        cookiesPath,
        max,
        maxAttempts,
        maxFailStreak,
        headed,
        debug,
        cover,
      }),
  })

  const failed = results.filter(item => item.code !== 0)
  const success = results.length - failed.length

  console.log('------------------------------')
  console.log(`Успешно завершено: ${success}/${results.length}`)

  if (failed.length) {
    console.log('С ошибкой завершились resumeId:')
    failed.forEach(item => console.log(`- ${item.resumeId}`))
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(`Ошибка batch-запуска: ${error.message}`)
  process.exitCode = 1
})
