import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const DEFAULT_AI_SYSTEM_PROMPT = `Ты отвечаешь работодателям и рекрутерам на hh.ru от лица кандидата.

Пиши коротко, естественно и по-деловому на русском языке.
Пиши 1-2 предложения, без канцелярита.
Не пиши длинные простыни.
Не упоминай, что ты ИИ.
Если сообщение выглядит как приглашение заполнить анкету или пройти этап, такой диалог нужно пропустить без ответа.
Условия кандидата: зарплата от 200 000 рублей на руки; формат работы - готов к гибриду, но удаленка в приоритете.
Если работодатель спрашивает про ожидания/условия, обязательно кратко озвучивай эти условия.
Не используй шаблоны и плейсхолдеры: [Имя], [Ваше имя], [Название вакансии] и т.п.
Не добавляй подписи в конце (например, "С уважением"), не делай формат официального письма.
Не используй нумерованные списки.
Не пиши ничего токсичного, грубого или странного.
Верни только текст ответа, без кавычек и пояснений.`

const QUESTIONNAIRE_KEYWORDS = [
  'анкета',
  'анкету',
  'опрос',
  'опросник',
  'форма',
  'заполнить',
  'тестовое',
  'тест',
  'скрининг',
  'questionnaire',
  'google form',
  'typeform',
]

const DEFAULT_SKIP_KEYWORDS = [
  'отказ',
  'отклон',
  'не готовы предложить',
  'не готовы рассматривать',
  'не рассматриваем',
  'приняли решение в пользу другого',
  'в пользу другого кандидата',
  'закрыли вакансию',
  'вакансия закрыта',
  'резюме не подходит',
  'по вашему резюме не готовы',
  'сейчас не готовы',
  'не можем пригласить',
  'не сможем предложить',
]

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const DAY_MS = 24 * 60 * 60 * 1000

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

const toSameSite = value => {
  if (!value) return 'Lax'

  const normalized = String(value).toLowerCase()
  if (normalized === 'none' || normalized === 'no_restriction') return 'None'
  if (normalized === 'strict') return 'Strict'

  return 'Lax'
}

const normalizeCookies = rawCookies => {
  if (!Array.isArray(rawCookies)) {
    return []
  }

  return rawCookies
    .map(cookie => {
      const expiresRaw = cookie.expires ?? cookie.expirationDate
      const parsedExpires = Number(expiresRaw)
      const expires = Number.isFinite(parsedExpires) ? parsedExpires : -1

      if (!cookie.name || typeof cookie.value === 'undefined') {
        return null
      }

      const normalized = {
        name: String(cookie.name),
        value: String(cookie.value),
        domain: String(cookie.domain || '').trim(),
        path: String(cookie.path || '/'),
        httpOnly: Boolean(cookie.httpOnly),
        secure: Boolean(cookie.secure),
        sameSite: toSameSite(cookie.sameSite),
        expires,
      }

      if (!normalized.domain) {
        return null
      }

      return normalized
    })
    .filter(Boolean)
}

const readCookiesFromFile = async filePath => {
  const content = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(content)

  if (Array.isArray(parsed)) {
    return normalizeCookies(parsed)
  }

  if (parsed && Array.isArray(parsed.cookies)) {
    return normalizeCookies(parsed.cookies)
  }

  throw new Error(
    'Неподдерживаемый формат cookies JSON. Ожидается массив cookies или объект с полем cookies.',
  )
}

const normalizeText = value =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const splitKeywords = value =>
  String(value || '')
    .split(',')
    .map(item => normalizeText(item))
    .filter(Boolean)

const getEnvValue = keys => {
  for (const key of keys) {
    const value = process.env[key]
    if (value) {
      return value
    }
  }

  return ''
}

const detectProviderDefaults = apiKey => {
  if (!apiKey) return { baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini' }

  // gsk_ prefix → Groq (groq.com)
  if (apiKey.startsWith('gsk_')) {
    return {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-120b',
    }
  }

  // xai- prefix → xAI Grok
  return { baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini' }
}

const getGrokConfig = args => {
  const apiKey =
    args.apiKey ||
    args.grokApiKey ||
    args.xaiApiKey ||
    getEnvValue([
      'AI_API_KEY',
      'XAI_API_KEY',
      'GROK_API_KEY',
      'GROQ_API_KEY',
    ]) ||
    ''

  const { baseUrl: defaultBaseUrl, model: defaultModel } =
    detectProviderDefaults(apiKey)

  return {
    apiKey,
    model:
      args.aiModel ||
      args.grokModel ||
      getEnvValue(['AI_MODEL', 'XAI_MODEL', 'GROK_MODEL']) ||
      defaultModel,
    baseUrl:
      args.aiBaseUrl ||
      args.grokBaseUrl ||
      getEnvValue(['AI_BASE_URL', 'XAI_BASE_URL', 'GROK_BASE_URL']) ||
      defaultBaseUrl,
    systemPrompt: args.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT,
  }
}

const containsSkipKeyword = (text, skipKeywords) => {
  const normalized = normalizeText(text)
  if (!normalized) {
    return false
  }

  return skipKeywords.some(keyword => normalized.includes(keyword))
}

const isQuestionnaireMessage = text => {
  const normalized = normalizeText(text)
  if (!normalized) {
    return false
  }

  return QUESTIONNAIRE_KEYWORDS.some(keyword => normalized.includes(keyword))
}

const buildConversationForAi = messages => {
  const recentMessages = messages.slice(-8)

  return recentMessages
    .map(item => {
      const role = item.outgoing ? 'Кандидат' : 'Работодатель'
      return `${role}: ${item.text}`
    })
    .join('\n')
}

const sanitizeForAi = value =>
  String(value || '')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/t\.me\/\S+/gi, '[link]')
    .replace(/@\w{3,}/g, '[handle]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/\s+/g, ' ')
    .trim()

const parseChatTimeText = value => {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/)
  if (!match) {
    return null
  }

  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null
  }

  return { hours, minutes }
}

const getMessageAgeMs = message => {
  if (!message?.timestampMs) {
    return null
  }

  return Date.now() - message.timestampMs
}

const isMessageInLastDay = message => {
  const ageMs = getMessageAgeMs(message)
  if (ageMs === null) {
    return false
  }

  return ageMs >= 0 && ageMs < DAY_MS
}

const runCurlJsonRequest = async ({ url, apiKey, payload }) => {
  const args = [
    '-sS',
    '-X',
    'POST',
    url,
    '-H',
    `Authorization: Bearer ${apiKey}`,
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify(payload),
    '-w',
    '\n__STATUS__:%{http_code}',
  ]

  return new Promise((resolve, reject) => {
    const child = spawn('curl', args)
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })

    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })

    child.on('error', error => {
      reject(error)
    })

    child.on('close', code => {
      if (code !== 0) {
        reject(
          new Error(
            `curl exited with code ${code}: ${stderr || 'unknown error'}`,
          ),
        )
        return
      }

      const rawOutput = String(stdout || '')
      const marker = '\n__STATUS__:'
      const markerIndex = rawOutput.lastIndexOf(marker)

      if (markerIndex < 0) {
        reject(new Error('curl не вернул статус ответа.'))
        return
      }

      const bodyText = rawOutput.slice(0, markerIndex).trim()
      const statusText = rawOutput.slice(markerIndex + marker.length).trim()
      const status = Number.parseInt(statusText, 10)

      if (!bodyText) {
        reject(new Error('curl вернул пустой ответ.'))
        return
      }

      try {
        resolve({ status, data: JSON.parse(bodyText) })
      } catch {
        reject(
          new Error(
            `Не удалось распарсить JSON от curl: ${bodyText.slice(0, 300)}`,
          ),
        )
      }
    })
  })
}

const extractAiContent = payload =>
  String(payload?.choices?.[0]?.message?.content || '').trim()

const extractApiError = payload =>
  String(payload?.error?.message || payload?.error || '').trim()

const isTemplateLikeReply = replyText => {
  const text = String(replyText || '').trim()
  if (!text) {
    return true
  }

  return (
    /\[[^\]]{2,40}\]/.test(text) ||
    /ваше имя|имя работодателя|название вакансии/i.test(text) ||
    /с уважением/i.test(text) ||
    /<\s*think\s*>|<\s*\/\s*think\s*>/i.test(text) ||
    /пользователь просит|сначала подумаю/i.test(text) ||
    /^\s*\d+\./m.test(text)
  )
}

const generateReplyWithGrok = async ({
  apiKey,
  baseUrl,
  model,
  systemPrompt,
  latestIncoming,
  messages,
}) => {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`

  const fullContext = buildConversationForAi(messages)
  const safeIncoming = sanitizeForAi(latestIncoming).slice(0, 500)
  const safeContext = sanitizeForAi(fullContext).slice(0, 900)

  const attempts = [
    {
      model,
      temperature: 0.7,
      max_tokens: 140,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Последнее входящее сообщение:\n${latestIncoming}\n\nНедавний контекст переписки:\n${fullContext}\n\nСформируй краткий ответ кандидата.`,
        },
      ],
    },
    {
      model,
      temperature: 0.6,
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content:
            'Кратко и по-деловому ответь работодателю на русском языке. Без контактов, ссылок и персональных данных.',
        },
        {
          role: 'user',
          content: `Сообщение работодателя:\n${safeIncoming}\n\nКороткий контекст:\n${safeContext}`,
        },
      ],
    },
    {
      model: 'llama-3.1-8b-instant',
      temperature: 0.5,
      max_tokens: 110,
      messages: [
        {
          role: 'system',
          content:
            'Ответь коротко, вежливо и по-деловому на русском языке. Ровно 1-2 предложения. Без списков, без шаблонов, без плейсхолдеров вроде "[Имя]".',
        },
        {
          role: 'user',
          content: `Сообщение работодателя: ${safeIncoming}`,
        },
      ],
    },
    {
      model: 'qwen/qwen3-32b',
      temperature: 0.4,
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content:
            'Дай краткий деловой ответ на русском языке: 1-2 предложения. Нельзя использовать плейсхолдеры, обращения "Уважаемый [Имя]", подписи и формальный шаблон письма.',
        },
        {
          role: 'user',
          content: `Ответь работодателю: ${safeIncoming}`,
        },
      ],
    },
  ]

  let lastError = 'unknown error'

  for (const payload of attempts) {
    const { status, data } = await runCurlJsonRequest({
      url: endpoint,
      apiKey,
      payload,
    })

    const content = extractAiContent(data)
    if (
      status >= 200 &&
      status < 300 &&
      content &&
      !isTemplateLikeReply(content)
    ) {
      return content
    }

    if (
      status >= 200 &&
      status < 300 &&
      (!content || isTemplateLikeReply(content))
    ) {
      lastError = !content
        ? 'status 200: empty content'
        : 'status 200: template-like content'
      continue
    }

    const apiError = extractApiError(data)
    lastError = `status ${status}${apiError ? `: ${apiError}` : ''}`

    if (status !== 403) {
      break
    }
  }

  throw new Error(`Grok API ${lastError}`)
}

const resolveReplyText = async ({
  grokConfig,
  latestIncoming,
  messages,
  debug,
}) => {
  if (!grokConfig.apiKey) {
    return null
  }

  try {
    return await generateReplyWithGrok({
      apiKey: grokConfig.apiKey,
      baseUrl: grokConfig.baseUrl,
      model: grokConfig.model,
      systemPrompt: grokConfig.systemPrompt,
      latestIncoming,
      messages,
    })
  } catch (error) {
    console.log(`AI ошибка: ${error.message}, пропускаю диалог.`)
    return null
  }
}

const getDialogCandidates = async page => {
  const selectors = [
    '[data-qa*="chat-list-item"]',
    '[data-qa*="chatik-chat-list-item"]',
    '[data-qa*="chat-dialog-item"]',
    '[data-qa*="chat-item"]',
    'a[href*="/chat/"]',
    'a[href*="chatik"]',
  ]

  for (const selector of selectors) {
    const locator = page.locator(`${selector}:visible`)
    const count = await locator.count()

    if (count > 0) {
      return { locator, selector, count }
    }
  }

  return { locator: null, selector: '', count: 0 }
}

const waitForChatPage = async page => {
  await page.goto('https://hh.ru/chat/', { waitUntil: 'domcontentloaded' })
  await delay(1600)

  await page
    .locator(
      '[data-qa*="chat"], [class*="chat"], a[href*="/chat/"]:visible, textarea:visible, [contenteditable="true"]:visible',
    )
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => {})

  const { count } = await getDialogCandidates(page)
  if (!count) {
    throw new Error(
      'Не удалось найти список диалогов. Проверьте авторизацию в cookies и текущий интерфейс HH.',
    )
  }
}

const ensureDialogListVisible = async page => {
  const { count } = await getDialogCandidates(page)
  if (count > 0) {
    return true
  }

  await page.goto('https://hh.ru/chat/', { waitUntil: 'domcontentloaded' })
  await delay(1500)

  const refreshed = await getDialogCandidates(page)
  return refreshed.count > 0
}

const hasRefusalTagInDialog = async dialogItem => {
  const refusalBadge = dialogItem
    .locator(
      '.last-message-color_red--zo6vi8nTScLJGPgw:has-text("Отказ"), [class*="last-message-color_red"]:has-text("Отказ"), [class*="last-message"]:has-text("Отказ")',
    )
    .first()

  if (await refusalBadge.count()) {
    return true
  }

  const fullItemText = normalizeText(
    await dialogItem.innerText().catch(() => ''),
  )
  return fullItemText === 'отказ' || fullItemText.endsWith(' отказ')
}

const openDialogByIndex = async (page, index) => {
  const { locator, count } = await getDialogCandidates(page)

  if (!locator || index >= count) {
    return { opened: false, skippedByRefusalTag: false }
  }

  const item = locator.nth(index)

  const skippedByRefusalTag = await hasRefusalTagInDialog(item)
  if (skippedByRefusalTag) {
    return { opened: false, skippedByRefusalTag: true }
  }

  await item.scrollIntoViewIfNeeded().catch(() => {})
  await item.click({ timeout: 3000 }).catch(async () => {
    await item.click({ force: true, timeout: 3000 })
  })

  await delay(1200)
  return { opened: true, skippedByRefusalTag: false }
}

const getMessagesSnapshot = async page => {
  return page.evaluate(() => {
    const parseTimeValue = value => {
      const match = String(value || '').match(/(\d{1,2}):(\d{2})/)
      if (!match) {
        return null
      }

      const hours = Number.parseInt(match[1], 10)
      const minutes = Number.parseInt(match[2], 10)
      if (Number.isNaN(hours) || Number.isNaN(minutes)) {
        return null
      }

      return { hours, minutes }
    }

    const normalizeInlineText = value =>
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim()

    const parseSeparatorOffset = value => {
      const normalized = normalizeInlineText(value).toLowerCase()

      if (normalized === 'сегодня') {
        return 0
      }

      if (normalized === 'вчера') {
        return 1
      }

      return null
    }

    const resolveDayOffset = wrapper => {
      let current = wrapper?.previousElementSibling || null

      for (let i = 0; i < 12 && current; i += 1) {
        const text = normalizeInlineText(current.textContent)
        const offset = parseSeparatorOffset(text)
        if (offset !== null) {
          return offset
        }

        current = current.previousElementSibling
      }

      return 0
    }

    const resolveTimestampMs = node => {
      const wrapper =
        node.closest('[data-qa="chat-bubble-wrapper"]') ||
        node.closest('[class*="chat-bubble-container"]') ||
        node.parentElement

      const timeNode =
        wrapper?.querySelector('[data-qa*="display-time"]') ||
        wrapper?.querySelector('[class*="display-time"]') ||
        wrapper?.querySelector('time')

      const parsedTime = parseTimeValue(timeNode?.textContent || '')
      if (!parsedTime) {
        return null
      }

      const timestamp = new Date()
      timestamp.setSeconds(0, 0)
      timestamp.setHours(parsedTime.hours, parsedTime.minutes, 0, 0)

      const dayOffset = resolveDayOffset(wrapper)
      timestamp.setDate(timestamp.getDate() - dayOffset)

      return timestamp.getTime()
    }

    const textOf = node =>
      String(node?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()

    const nodes = [
      ...document.querySelectorAll('[data-qa*="message"]'),
      ...document.querySelectorAll('[class*="message"]'),
      ...document.querySelectorAll('[class*="chatik-message"]'),
    ]

    const uniqueNodes = [...new Set(nodes)]
    const raw = uniqueNodes
      .map(node => {
        const text = textOf(node)
        if (!text) {
          return null
        }

        // Собираем классы самого узла + до 6 предков, чтобы поймать
        // chat-bubble_outgoing / message_direction_out на обёртке
        let classStr =
          (node.getAttribute('class') || '') + (node.outerHTML || '')
        let ancestor = node.parentElement
        for (let i = 0; i < 6; i++) {
          if (!ancestor) break
          classStr += ' ' + (ancestor.getAttribute('class') || '')
          ancestor = ancestor.parentElement
        }
        const lowered = classStr.toLowerCase()

        const outgoing =
          lowered.includes('outgoing') ||
          lowered.includes('from-me') ||
          lowered.includes('my-message') ||
          lowered.includes('sent-by-me') ||
          lowered.includes('mine') ||
          lowered.includes('message_direction_out')

        const incoming =
          lowered.includes('incoming') ||
          lowered.includes('from-opponent') ||
          lowered.includes('from-employer') ||
          lowered.includes('message_direction_in')

        return {
          text,
          outgoing,
          incoming,
          timestampMs: resolveTimestampMs(node),
        }
      })
      .filter(Boolean)

    const deduped = raw.filter(
      (item, idx, arr) =>
        arr.findIndex(other => other.text === item.text) === idx,
    )

    return deduped.slice(-30)
  })
}

const pickLatestIncomingText = messages => {
  const byIncomingFlag = [...messages]
    .reverse()
    .find(item => item.incoming && item.text)

  if (byIncomingFlag) {
    return byIncomingFlag.text
  }

  const anyMessage = [...messages].reverse().find(item => item.text)
  return anyMessage ? anyMessage.text : ''
}

const getLastMessage = messages =>
  [...messages].reverse().find(item => item.text)

const hasRecentSameOutgoingReply = (messages, replyText) => {
  const normalizedReply = normalizeText(replyText)
  if (!normalizedReply) {
    return false
  }

  const recentOutgoing = messages
    .filter(item => item.outgoing)
    .slice(-5)
    .map(item => normalizeText(item.text))

  return recentOutgoing.some(text => text === normalizedReply)
}

const fillAndSend = async (page, replyText, dryRun) => {
  const textarea = page
    .locator(
      'textarea:visible, [data-qa*="chat-input"] textarea:visible, [data-qa*="message-input"] textarea:visible',
    )
    .first()

  const editable = page
    .locator(
      '[contenteditable="true"]:visible, [data-qa*="chat-input"] [contenteditable="true"]:visible',
    )
    .first()

  if (await textarea.count()) {
    await textarea.fill(replyText)
  } else if (await editable.count()) {
    await editable.click()
    await page.keyboard.press('ControlOrMeta+A').catch(() => {})
    await page.keyboard.type(replyText, { delay: 8 })
  } else {
    return false
  }

  if (dryRun) {
    return true
  }

  const sendBtn = page
    .locator(
      '[data-qa*="send"]:visible, button:has-text("Отправить"), button[aria-label*="Отправить" i], button[type="submit"]:visible',
    )
    .first()

  if (await sendBtn.count()) {
    const enabled = await sendBtn.isEnabled().catch(() => true)
    if (enabled) {
      await sendBtn.click()
      await delay(900)
      return true
    }
  }

  await page.keyboard.press('Enter').catch(() => {})
  await delay(900)
  return true
}

const processDialogs = async ({
  page,
  maxReplies,
  maxDialogs,
  grokConfig,
  skipKeywords,
  dryRun,
  debug,
  intervalMs,
}) => {
  const { count: initialCount, selector } = await getDialogCandidates(page)
  const dialogsToProcess = Math.min(maxDialogs, initialCount)

  console.log(
    `Найдено диалогов: ${initialCount}. Обработаем: ${dialogsToProcess}. Селектор: ${selector}`,
  )

  let replied = 0
  let scanned = 0

  for (let index = 0; index < dialogsToProcess; index += 1) {
    if (replied >= maxReplies) {
      break
    }

    const listVisible = await ensureDialogListVisible(page)
    if (!listVisible) {
      console.log(`#${index + 1}: не удалось показать список чатов, пропуск.`)
      continue
    }

    const { opened, skippedByRefusalTag } = await openDialogByIndex(page, index)
    if (skippedByRefusalTag) {
      console.log(`#${index + 1}: статус "Отказ" в списке чатов, пропуск.`)
      continue
    }

    if (!opened) {
      if (debug) {
        console.log(`#${index + 1}: не удалось открыть диалог по индексу.`)
      }
      continue
    }

    scanned += 1

    const messages = await getMessagesSnapshot(page)
    const latestIncoming = pickLatestIncomingText(messages)

    if (!latestIncoming) {
      console.log(`#${index + 1}: не удалось извлечь сообщения, пропускаю.`)
      continue
    }

    const lastMessage = getLastMessage(messages)
    if (!isMessageInLastDay(lastMessage)) {
      console.log(
        `#${index + 1}: последний диалог старше 24 часов или без времени, пропуск.`,
      )
      continue
    }

    if (containsSkipKeyword(latestIncoming, skipKeywords)) {
      console.log(`#${index + 1}: обнаружен отказ/негатив, пропуск.`)
      if (debug) {
        console.log(`Текст: ${latestIncoming}`)
      }
      continue
    }

    if (isQuestionnaireMessage(latestIncoming)) {
      console.log(`#${index + 1}: анкета/этап, пропуск.`)
      continue
    }

    const resolvedReplyText = await resolveReplyText({
      grokConfig,
      latestIncoming,
      messages,
      debug,
    })

    if (!resolvedReplyText) {
      continue
    }

    if (hasRecentSameOutgoingReply(messages, resolvedReplyText)) {
      console.log(
        `#${index + 1}: похожий ответ уже отправлялся недавно, пропуск.`,
      )
      continue
    }

    if (debug) {
      console.log(`#${index + 1}: ответ -> ${resolvedReplyText}`)
    }

    const sent = await fillAndSend(page, resolvedReplyText, dryRun)
    if (!sent) {
      console.log(`#${index + 1}: не нашел поле ввода или отправку, пропуск.`)
      continue
    }

    replied += 1
    console.log(
      dryRun
        ? `#${index + 1}: dry-run, диалог подходит под ответ.`
        : `#${index + 1}: ответ отправлен (${replied}/${maxReplies}).`,
    )

    if (intervalMs > 0) {
      await delay(intervalMs)
    }
  }

  return { replied, scanned }
}

const main = async () => {
  const args = parseArgs()

  const cookiesPath = args.cookies || './playwright/cookies.json'
  const headless = !args.headed
  const dryRun = Boolean(args.dryRun)
  const debug = Boolean(args.debug)
  const maxReplies = Number.parseInt(args.max ?? args.maxReplies ?? '10', 10)
  const maxDialogs = Number.parseInt(args.maxDialogs ?? '50', 10)
  const intervalMs = Number.parseInt(args.intervalMs ?? '1200', 10)
  const grokConfig = getGrokConfig(args)
  const customSkipKeywords = splitKeywords(args.skipKeywords)
  const skipKeywords = customSkipKeywords.length
    ? customSkipKeywords
    : DEFAULT_SKIP_KEYWORDS

  if (Number.isNaN(maxReplies) || maxReplies <= 0) {
    throw new Error('Параметр --max должен быть положительным числом.')
  }

  if (Number.isNaN(maxDialogs) || maxDialogs <= 0) {
    throw new Error('Параметр --maxDialogs должен быть положительным числом.')
  }

  if (Number.isNaN(intervalMs) || intervalMs < 0) {
    throw new Error('Параметр --intervalMs должен быть неотрицательным числом.')
  }

  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  })

  try {
    if (grokConfig.apiKey) {
      console.log(
        `AI-режим включен. Модель: ${grokConfig.model}. Base URL: ${grokConfig.baseUrl}`,
      )
    } else {
      console.log('AI-режим выключен. Используется шаблонный ответ.')
    }

    if (cookiesPath) {
      const cookies = await readCookiesFromFile(cookiesPath)

      if (!cookies.length) {
        throw new Error('В файле cookies нет валидных записей.')
      }

      await context.addCookies(cookies)
      console.log(`Загружено cookies: ${cookies.length}`)
    }

    const page = await context.newPage()
    await waitForChatPage(page)

    const { replied, scanned } = await processDialogs({
      page,
      maxReplies,
      maxDialogs,
      grokConfig,
      skipKeywords,
      dryRun,
      debug,
      intervalMs,
    })

    console.log('------------------------------')
    console.log(`Проверено диалогов: ${scanned}`)
    console.log(
      dryRun
        ? `Подходящих диалогов (dry-run): ${replied}`
        : `Отправлено ответов: ${replied}`,
    )
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch(error => {
  console.error(`Ошибка запуска: ${error.message}`)
  process.exitCode = 1
})
