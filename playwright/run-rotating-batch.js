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

const normalizeSentByResumeId = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([resumeId, sentCount]) => [
        String(resumeId || '').trim(),
        Number.parseInt(String(sentCount ?? '0'), 10) || 0,
      ])
      .filter(([resumeId, sentCount]) => Boolean(resumeId) && sentCount >= 0),
  )
}

const readState = async (filePath, resumeCount) => {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(content)
    const rawIndex = Number.parseInt(String(parsed.nextResumeIndex ?? '0'), 10)

    return {
      nextResumeIndex:
        Number.isNaN(rawIndex) || rawIndex < 0
          ? 0
          : rawIndex % Math.max(1, resumeCount),
      successfulRuns: Number.parseInt(String(parsed.successfulRuns ?? '0'), 10) || 0,
      failedRuns: Number.parseInt(String(parsed.failedRuns ?? '0'), 10) || 0,
      lastSuccessfulResumeId: String(parsed.lastSuccessfulResumeId || ''),
      lastFailedResumeId: String(parsed.lastFailedResumeId || ''),
      lastRunAt: String(parsed.lastRunAt || ''),
      lastSuccessAt: String(parsed.lastSuccessAt || ''),
      lastFailureAt: String(parsed.lastFailureAt || ''),
      lastSentCount: Number.parseInt(String(parsed.lastSentCount ?? '0'), 10) || 0,
      sentByResumeId: normalizeSentByResumeId(parsed.sentByResumeId),
    }
  } catch {
    return {
      nextResumeIndex: 0,
      successfulRuns: 0,
      failedRuns: 0,
      lastSuccessfulResumeId: '',
      lastFailedResumeId: '',
      lastRunAt: '',
      lastSuccessAt: '',
      lastFailureAt: '',
      lastSentCount: 0,
      sentByResumeId: {},
    }
  }
}

const migrateLegacyState = ({ state, resumeIds, maxPerResume }) => {
  const sentByResumeId = {
    ...(state.sentByResumeId || {}),
  }

  if (
    !Object.keys(sentByResumeId).length
    && state.lastSuccessfulResumeId
    && state.lastSentCount > 0
  ) {
    sentByResumeId[state.lastSuccessfulResumeId] = state.lastSentCount
  }

  let nextResumeIndex = state.nextResumeIndex % Math.max(1, resumeIds.length)
  const legacyResumeIndex = resumeIds.indexOf(state.lastSuccessfulResumeId)

  if (
    legacyResumeIndex >= 0
    && (sentByResumeId[state.lastSuccessfulResumeId] || 0) > 0
    && (sentByResumeId[state.lastSuccessfulResumeId] || 0) < maxPerResume
  ) {
    nextResumeIndex = legacyResumeIndex
  }

  return {
    ...state,
    nextResumeIndex,
    sentByResumeId,
  }
}

const writeState = async (filePath, state) => {
  const normalized = `${JSON.stringify(state, null, 2)}\n`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, normalized, 'utf8')
}

const runSingleResume = ({
  resumeId,
  cookiesPath,
  max,
  maxAttempts,
  maxFailStreak,
  headed,
  debug,
  cover,
  query,
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

  if (query) {
    args.push('--query', query)
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

  let stdout = ''
  let stderr = ''

  child.stdout.on('data', chunk => {
    const text = String(chunk)
    stdout += text
    process.stdout.write(text)
  })

  child.stderr.on('data', chunk => {
    const text = String(chunk)
    stderr += text
    process.stderr.write(text)
  })

  return new Promise(resolve => {
    child.on('close', code => {
      const sentMatch = stdout.match(/Готово\. Всего отправлено откликов:\s*(\d+)/)
      const sentCount = sentMatch ? Number.parseInt(sentMatch[1], 10) || 0 : 0

      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        sentCount,
      })
    })
  })
}

const main = async () => {
  const args = parseArgs()

  const resumesFile = args.resumes || './playwright/resumes.json'
  const cookiesPath = args.cookies || './playwright/cookies.json'
  const stateFile = args.state || './playwright/apply-rotation-state.json'
  const max = Number.parseInt(args.max ?? '100', 10)
  const maxAttempts = Number.parseInt(args.maxAttempts ?? '240', 10)
  const maxFailStreak = Number.parseInt(args.maxFailStreak ?? '7', 10)
  const headed = Boolean(args.headed)
  const debug = Boolean(args.debug)
  const cover = args.cover
  const query = args.query

  if (Number.isNaN(max) || max <= 0) {
    throw new Error('Параметр --max должен быть положительным числом.')
  }

  if (Number.isNaN(maxAttempts) || maxAttempts <= 0) {
    throw new Error('Параметр --maxAttempts должен быть положительным числом.')
  }

  if (Number.isNaN(maxFailStreak) || maxFailStreak <= 0) {
    throw new Error('Параметр --maxFailStreak должен быть положительным числом.')
  }

  const resumeIds = await readResumeIds(resumesFile)

  if (!resumeIds.length) {
    throw new Error(
      'Файл с резюме пустой. Ожидается массив resumeIds или поле resumeIds.',
    )
  }

  const rawState = await readState(stateFile, resumeIds.length)
  const state = migrateLegacyState({
    state: rawState,
    resumeIds,
    maxPerResume: max,
  })
  const currentIndex = state.nextResumeIndex % resumeIds.length
  const resumeId = resumeIds[currentIndex]
  const currentSentTotal = state.sentByResumeId?.[resumeId] || 0
  const remainingTarget = Math.max(0, max - currentSentTotal)

  if (remainingTarget === 0) {
    const nextResumeIndex = (currentIndex + 1) % resumeIds.length
    const nextState = {
      ...state,
      nextResumeIndex,
      sentByResumeId: {
        ...(state.sentByResumeId || {}),
        [resumeId]: 0,
      },
    }
    await writeState(stateFile, nextState)
    console.log(
      `Резюме ${resumeId} уже добило лимит ${max}. Переключаемся на следующее и запускай прогон повторно.`,
    )
    return
  }

  console.log(`Rotation state file: ${stateFile}`)
  console.log(`Текущий индекс резюме: ${currentIndex + 1}/${resumeIds.length}`)
  console.log(`Запускаем отклики для resumeId: ${resumeId}`)
  console.log(`Уже отправлено по этому резюме: ${currentSentTotal}/${max}`)
  console.log(`В текущем запуске целимся добрать: ${remainingTarget}`)

  const runAt = new Date().toISOString()
  const result = await runSingleResume({
    resumeId,
    cookiesPath,
    max: remainingTarget,
    maxAttempts,
    maxFailStreak,
    headed,
    debug,
    cover,
    query,
  })

  const updatedSentTotal = currentSentTotal + result.sentCount

  const nextState = {
    ...state,
    lastRunAt: runAt,
    lastSentCount: result.sentCount,
    sentByResumeId: {
      ...(state.sentByResumeId || {}),
      [resumeId]: updatedSentTotal,
    },
  }

  if (result.code === 0 && updatedSentTotal >= max) {
    nextState.successfulRuns = (state.successfulRuns || 0) + 1
    nextState.lastSuccessfulResumeId = resumeId
    nextState.lastSuccessAt = new Date().toISOString()
    nextState.nextResumeIndex = (currentIndex + 1) % resumeIds.length
    nextState.sentByResumeId[resumeId] = 0

    await writeState(stateFile, nextState)
    console.log(
      `Успех: в следующий запуск перейдем к резюме #${nextState.nextResumeIndex + 1}/${resumeIds.length}`,
    )
    return
  }

  if (result.code === 0 && result.sentCount === 0) {
    nextState.failedRuns = (state.failedRuns || 0) + 1
    nextState.lastFailedResumeId = resumeId
    nextState.lastFailureAt = new Date().toISOString()
    nextState.nextResumeIndex = currentIndex

    await writeState(stateFile, nextState)
    console.error(
      `За запуск не отправлено ни одного отклика по resumeId ${resumeId}. Индекс резюме не переключен.`,
    )
    process.exitCode = 2
    return
  }

  if (result.code === 0) {
    nextState.nextResumeIndex = currentIndex

    await writeState(stateFile, nextState)
    console.log(
      `Частичный успех: по resumeId ${resumeId} накоплено ${updatedSentTotal}/${max}. Следующий запуск продолжит это же резюме.`,
    )
    return
  }

  nextState.failedRuns = (state.failedRuns || 0) + 1
  nextState.lastFailedResumeId = resumeId
  nextState.lastFailureAt = new Date().toISOString()
  nextState.nextResumeIndex = currentIndex

  await writeState(stateFile, nextState)
  console.error('Отклики завершились с ошибкой. Индекс резюме не переключен.')
  process.exitCode = result.code
}

main().catch(error => {
  console.error(`Ошибка batch-запуска с ротацией: ${error.message}`)
  process.exitCode = 1
})
