import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { config } from '../core/config.js'
import { ERROR_CODES } from '../core/contract.js'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

let sessionPromise = null

const resetSession = () => {
  sessionPromise = null
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

  throw new Error('cookies_format_not_supported')
}

const clickFirstVisible = async (page, selectors, timeout = 2500) => {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if (!(await locator.count())) {
      continue
    }

    try {
      await locator.waitFor({ state: 'visible', timeout })
      await locator.click({ timeout })
      return true
    } catch {
      try {
        await locator.scrollIntoViewIfNeeded()
        await locator.click({ force: true, timeout })
        return true
      } catch {
        // continue
      }
    }
  }

  return false
}

const extractChatId = value => {
  if (!value) {
    return ''
  }

  const text = String(value)
  const qaMatch = text.match(/chatik-open-chat-(\d+)/)
  if (qaMatch?.[1]) {
    return qaMatch[1]
  }

  const cellIdMatch = text.match(/chat-cell-(\d+)/)
  if (cellIdMatch?.[1]) {
    return cellIdMatch[1]
  }

  const hrefMatch = text.match(/\/chat\/(\d+)/)
  if (hrefMatch?.[1]) {
    return hrefMatch[1]
  }

  const directId = text.match(/^(\d+)$/)
  if (directId?.[1]) {
    return directId[1]
  }

  return ''
}

const collectCandidateChats = async page =>
  page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll(
        'a[data-qa^="chatik-open-chat-"], a[id^="chat-cell-"], [data-qa="chat-list-item"], [data-chat-id], a[href*="/chat/"]',
      ),
    )

    return candidates
      .map(node => {
        const chatId =
          node.getAttribute('data-qa') ||
          node.getAttribute('id') ||
          node.getAttribute('data-chat-id') ||
          node.getAttribute('data-dialog-id') ||
          node.getAttribute('data-id') ||
          node.getAttribute('href') ||
          node.querySelector('a[href*="/chat/"]')?.getAttribute('href') ||
          ''

        const titleText =
          node.querySelector('[data-qa*="vacancy"], .title--jaEO2q2if2IOwiyO, [class*="vacancy"], [class*="title"]')
            ?.textContent ||
          node.textContent ||
          ''

        const lastMessageText =
          node.querySelector('[class*="last-message"], [data-qa*="last-message"]')
            ?.textContent || ''

        const creationTimeText =
          node.querySelector('[data-qa="chat-cell-creation-time"], [data-qa*="creation-time"], [class*="time--"]')
            ?.textContent || ''

        const hasRejectBadge = Boolean(
          node.querySelector(
            '.last-message-color_red--zo6vi8nTScLJGPgw, [class*="last-message-color_red"], [class*="last-message-color-red"]',
          ),
        )

        const isReject =
          hasRejectBadge || /(^|\s)отказ(\s|$)/iu.test(lastMessageText.trim())

        return {
          rawChatId: chatId,
          vacancyTitle: titleText.trim().slice(0, 140),
          lastMessageText: lastMessageText.trim().slice(0, 200),
          creationTimeText: creationTimeText.trim().slice(0, 30),
          isReject,
        }
      })
      .filter(item => item.rawChatId)
  })

const scrollChatListOnce = async page =>
  page.evaluate(() => {
    const chatLink = document.querySelector('a[data-qa^="chatik-open-chat-"], a[id^="chat-cell-"]')

    const getScrollableParent = node => {
      let current = node?.parentElement || null

      while (current) {
        const style = window.getComputedStyle(current)
        const hasOverflow = /(auto|scroll)/i.test(
          `${style.overflowY} ${style.overflow}`,
        )
        const scrollable = current.scrollHeight > current.clientHeight + 8

        if (hasOverflow && scrollable) {
          return current
        }

        current = current.parentElement
      }

      return null
    }

    const container = getScrollableParent(chatLink)

    if (!container) {
      window.scrollBy(0, 700)
      return {
        moved: true,
        reachedEnd: false,
      }
    }

    const before = container.scrollTop
    const step = Math.max(300, Math.floor(container.clientHeight * 0.9))
    container.scrollTop = before + step

    const after = container.scrollTop
    const maxTop = container.scrollHeight - container.clientHeight
    const reachedEnd = after >= maxTop - 4

    return {
      moved: after > before,
      reachedEnd,
    }
  })

const collectCandidateChatsWithScroll = async page => {
  const byChatId = new Map()
  const maxPasses = Math.max(20, config.chatListMaxScrollPasses)
  const endStreakToStop = Math.max(1, config.chatListEndStreakToStop)
  let sawYesterdayMarker = false
  let endStreak = 0

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const list = await collectCandidateChats(page)

    list.forEach(item => {
      const chatId = extractChatId(item.rawChatId)
      if (!chatId) {
        return
      }

      if (!byChatId.has(chatId)) {
        byChatId.set(chatId, item)
      }

      if (/^\s*вчера\s*$/iu.test(String(item.creationTimeText || ''))) {
        sawYesterdayMarker = true
      }
    })

    // Main strategy: keep scrolling until yesterday boundary is reached.
    if (sawYesterdayMarker) {
      break
    }

    const { moved, reachedEnd } = await scrollChatListOnce(page)

    if (!moved || reachedEnd) {
      endStreak += 1
    } else {
      endStreak = 0
    }

    if (endStreak >= endStreakToStop) {
      break
    }

    await delay(reachedEnd ? 380 : 220)
  }

  return Array.from(byChatId.values())
}

const fetchCandidateChatsViaApi = async page => {
  if (!config.useChatsApiPagination) {
    return []
  }

  const maxPages = Math.max(1, config.chatsApiMaxPages)

  return page.evaluate(async ({ maxPagesLimit }) => {
    const byChatId = new Map()

    const pickByPaths = (obj, paths) =>
      paths
        .map(path =>
          String(path)
            .split('.')
            .reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), obj),
        )
        .find(value => value !== undefined && value !== null)

    const extractItems = payload => {
      if (!payload || typeof payload !== 'object') {
        return []
      }

      const arrays = [
        payload.items,
        payload.chats,
        payload.data?.items,
        payload.data?.chats,
        payload.chatsData?.items,
        payload.result?.items,
      ]

      return arrays.find(Array.isArray) || []
    }

    for (let page = 1; page <= maxPagesLimit; page += 1) {
      const url = `https://chatik.hh.ru/chatik/api/chats?filterUnread=false&filterHasTextMessage=false&page=${page}&do_not_track_session_events=false`

      let response
      try {
        response = await fetch(url, { credentials: 'include' })
      } catch {
        break
      }

      if (!response.ok) {
        break
      }

      let payload = null
      try {
        payload = await response.json()
      } catch {
        break
      }

      const items = extractItems(payload)
      if (!items.length) {
        break
      }

      items.forEach(item => {
        const rawId = pickByPaths(item, [
          'id',
          'chatId',
          'dialogId',
          'chat.id',
          'chat.chatId',
        ])

        const chatId = String(rawId || '').match(/\d+/)?.[0] || ''
        if (!chatId || byChatId.has(chatId)) {
          return
        }

        const vacancyTitle = String(
          pickByPaths(item, [
            'vacancyTitle',
            'vacancy.title',
            'vacancy.name',
            'subject',
            'topic',
            'name',
            'title',
          ]) || '',
        )
          .trim()
          .slice(0, 140)

        const lastMessageText = String(
          pickByPaths(item, [
            'lastMessage.text',
            'lastMessage.body',
            'lastMessage.message',
            'preview',
            'snippet',
          ]) || '',
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200)

        const creationTimeText = String(
          pickByPaths(item, [
            'lastMessage.displayTime',
            'displayTime',
            'creationTime',
            'updatedAt',
          ]) || '',
        )
          .trim()
          .slice(0, 30)

        const isReject = /(^|\s)отказ(\s|$)/iu.test(lastMessageText)

        byChatId.set(chatId, {
          rawChatId: chatId,
          vacancyTitle,
          lastMessageText,
          creationTimeText,
          isReject,
        })
      })
    }

    return Array.from(byChatId.values())
  }, { maxPagesLimit: maxPages })
}

const collectCandidateChatsForPolling = async page => {
  const apiChats = await fetchCandidateChatsViaApi(page)
  if (apiChats.length > 0) {
    return apiChats
  }

  return collectCandidateChatsWithScroll(page)
}

const ensureChatPage = async page => {
  if (!page.url().includes('/chat')) {
    await page.goto(config.hhChatUrl, { waitUntil: 'domcontentloaded' })
    await delay(900)
  }

  if (page.url().includes('/account/login')) {
    throw new Error('auth_required')
  }
}

const trySwitchToAllChatsTab = async page => {
  if (!config.forceAllChatsTab) {
    return
  }

  const selectors = [
    '[role="tab"]:has-text("Все")',
    '[role="tab"]:has-text("Все чаты")',
    'button:has-text("Все")',
    'button:has-text("Все чаты")',
    'a:has-text("Все")',
    'a:has-text("Все чаты")',
    '[data-qa*="all"][data-qa*="tab"]',
    '[data-qa*="chat"][data-qa*="all"]',
  ]

  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if (!(await locator.count())) {
      continue
    }

    try {
      await locator.scrollIntoViewIfNeeded().catch(() => {})
      await locator.click({ timeout: 1200 })
      await delay(450)
      return
    } catch {
      // continue
    }
  }
}

const getSession = async () => {
  if (sessionPromise) {
    return sessionPromise
  }

  sessionPromise = (async () => {
    const browser = await chromium.launch({
      headless: !config.playwrightHeaded,
      slowMo: config.playwrightSlowMoMs,
    })

    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
    })

    const cookies = await readCookiesFromFile(config.cookiesPath)
    if (cookies.length) {
      await context.addCookies(cookies)
    }

    const page = await context.newPage()
    await page.goto(config.hhChatUrl, { waitUntil: 'domcontentloaded' })
    await delay(1200)

    return { browser, context, page }
  })()

  return sessionPromise
}

export const closeAdapter = async () => {
  if (!sessionPromise) {
    return
  }

  try {
    const session = await sessionPromise
    await session.page?.close().catch(() => {})
    await session.context?.close().catch(() => {})
    await session.browser?.close().catch(() => {})
  } catch {
    // ignore shutdown errors
  } finally {
    resetSession()
  }
}

const openChatById = async (page, chatId) => {
  const selectors = [
    `[data-qa="chat-list-item"][data-chat-id="${chatId}"]`,
    `[data-chat-id="${chatId}"]`,
    `a[href*="/chat/${chatId}"]`,
    `a[href*="dialog=${chatId}"]`,
  ]

  const clicked = await clickFirstVisible(page, selectors)
  if (!clicked) {
    const directUrls = [
      `${config.hhChatUrl}/${chatId}`,
      `${config.hhChatUrl}?chatId=${chatId}`,
      `${config.hhChatUrl}?dialog=${chatId}`,
    ]

    for (const url of directUrls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 6000 })
        await delay(800)
        if (page.url().includes('/chat')) {
          return true
        }
      } catch {
        // continue
      }
    }

    return false
  }

  await delay(800)
  return true
}

const isChatMessagingDisabled = async page => {
  const warning = page
    .locator(
      '.not-allowed-warning--NbfXlvyYL8lTX5fY, [class*="not-allowed-warning"], .container--uibSLh9btq4sc2yH:has-text("Работодатель отключил переписку"), :text("Работодатель отключил переписку по данной вакансии")',
    )
    .first()

  if (!(await warning.count())) {
    return false
  }

  try {
    await warning.waitFor({ state: 'visible', timeout: 1200 })
    return true
  } catch {
    return false
  }
}

const isLikelyOutgoingOrSystemText = text => {
  const normalized = String(text || '').trim()
  if (!normalized) {
    return true
  }

  const patterns = [
    /приветствую!\s*я\s*фронтенд-разработчик/iu,
    /портфолио:\s*\S+/iu,
    /telegram:\s*https:\/\/t\.me\//iu,
    /github:\s*https:\/\/github\.com\//iu,
    /^без\s+сопроводительного\s+письма$/iu,
    /ваши\s+ответы\s+отправлены\s+работодателю/iu,
    /^отклик\s+на\s+вакансию$/iu,
    /\b(был|сейчас)\s+онлайн\b/iu,
    /\bonline\b/iu,
  ]

  return patterns.some(pattern => pattern.test(normalized))
}

const parseThreadMessages = async ({ page, chatId, vacancyTitle }) => {
  const rows = await page.evaluate(() => {
    const bubbleNodes = Array.from(document.querySelectorAll('[data-qa="chat-bubble-text"]'))

    const fromBubbles = bubbleNodes.map(node => {
      const bubbleRoot =
        node.closest('[id="chatBubbleText"]') ||
        node.closest('[class*="chat-bubble"]') ||
        node.parentElement ||
        null

      const id =
        bubbleRoot?.getAttribute('data-message-id') ||
        bubbleRoot?.getAttribute('data-id') ||
        bubbleRoot?.id ||
        ''

      const text = node.textContent || ''
      const timeText =
        bubbleRoot
          ?.querySelector('[data-qa="chat-buble-display-time"], [data-qa*="display-time"], time')
          ?.textContent || ''

      const className = `${String(bubbleRoot?.className || '')} ${String(node.className || '')}`
      const hasDeliveredIcon = Boolean(
        bubbleRoot?.querySelector('[data-qa="chat-bubble-icon-delivered"]'),
      )
      const hasContrastOwnStyle = /chat-bubble-text_contrast|style-contrast|contrast/i.test(
        className,
      )

      const looksOutgoing =
        hasDeliveredIcon ||
        hasContrastOwnStyle ||
        /outgoing|own|mine|self|my-message|right/i.test(className)
      const looksIncoming =
        !looksOutgoing ||
        /incoming|inbound|left|interlocutor|candidate|opponent|companion/i.test(className)

      return {
        id,
        text: text.trim(),
        timeText: timeText.trim(),
        looksIncoming,
        looksOutgoing,
      }
    })

    if (fromBubbles.length > 0) {
      return fromBubbles.filter(item => item.text)
    }

    const messageNodes = Array.from(
      document.querySelectorAll(
        '[data-qa="chatik-message"], [data-qa*="message"], [data-message-id], [class*="message"]',
      ),
    )

    return messageNodes
      .map(node => {
        const id =
          node.getAttribute('data-message-id') ||
          node.getAttribute('data-id') ||
          node.id ||
          ''

        const className = String(node.className || '')
        const text =
          node.querySelector('[data-qa*="text"], [class*="text"], .bloko-text')?.textContent ||
          node.textContent ||
          ''

        const timeText =
          node.querySelector('time')?.getAttribute('datetime') ||
          node.querySelector('[data-qa*="time"], [class*="time"]')?.textContent ||
          ''

        const senderText =
          node.querySelector('[data-qa*="author"], [class*="author"], [class*="sender"]')
            ?.textContent || ''

        const looksOutgoing = /outgoing|own|mine|self|my-message|right/i.test(className)
        const looksIncoming =
          !looksOutgoing ||
          /incoming|inbound|left|interlocutor|candidate|opponent|companion/i.test(className) ||
          /соискател|кандидат/i.test(senderText)

        return {
          id,
          text: text.trim(),
          timeText: timeText.trim(),
          looksIncoming,
          looksOutgoing,
        }
      })
      .filter(item => item.text)
  })

  const latest = rows.at(-1)
  if (latest?.looksOutgoing && !latest?.looksIncoming) {
    return []
  }

  const incomingOnly = rows.filter(item => item.looksIncoming && !item.looksOutgoing)

  const selected = (incomingOnly.length ? incomingOnly : rows)
    .filter(item => !isLikelyOutgoingOrSystemText(item.text))
    .slice(-3)
    .map((item, index) => {
      const hasStableId = item.id && item.id !== 'chatBubbleText'
      const fallbackId = `${chatId}-${item.timeText}-${item.text.slice(0, 40)}-${index}`
      return {
        chatId,
        messageId: String(hasStableId ? item.id : fallbackId),
        senderType: 'recruiter',
        vacancyTitle,
        messageText: item.text,
        receivedAt: item.timeText || new Date().toISOString(),
      }
    })

  return selected
}

export const pollNewMessages = async ({ processedMessageIds = {}, limit = 20 }) => {
  const { page } = await getSession()
  await ensureChatPage(page)
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await delay(900)
  await trySwitchToAllChatsTab(page)

  const candidateChats = await collectCandidateChatsForPolling(page)

  if (config.pollChatListOnly) {
    return candidateChats
      .map(chat => {
        const chatId = extractChatId(chat.rawChatId)
        if (!chatId) {
          return null
        }

        return {
          chatId,
          messageId: `${chatId}-list-${chat.creationTimeText || 'no-time'}`,
          senderType: 'recruiter',
          vacancyTitle: chat.vacancyTitle || 'Без названия',
          messageText: chat.lastMessageText || '[chat-list-only]',
          receivedAt: chat.creationTimeText || new Date().toISOString(),
        }
      })
      .filter(Boolean)
      .filter(message => !processedMessageIds[message.messageId])
      .slice(0, limit)
  }

  const result = []

  for (const chat of candidateChats) {
    if (result.length >= limit) {
      break
    }

    if (
      config.skipYesterdayChats &&
      /^\s*вчера\s*$/iu.test(String(chat.creationTimeText || ''))
    ) {
      continue
    }

    if (config.skipRejectChats && chat.isReject) {
      continue
    }

    const chatId = extractChatId(chat.rawChatId)
    if (!chatId) {
      continue
    }

    const opened = await openChatById(page, chatId)
    if (!opened) {
      continue
    }

    if (await isChatMessagingDisabled(page)) {
      continue
    }

    const messages = await parseThreadMessages({
      page,
      chatId,
      vacancyTitle: chat.vacancyTitle || 'Без названия',
    })

    messages.forEach(message => {
      if (!processedMessageIds[message.messageId] && result.length < limit) {
        result.push(message)
      }
    })
  }

  return result
}

const fillMessageInput = async (page, text) => {
  const textareaSelectors = [
    'textarea[data-qa="chatik-new-message-text"]',
    'textarea[data-qa*="input"]',
    'textarea[placeholder*="Сообщение"]',
    'textarea[placeholder*="Написать"]',
  ]

  for (const selector of textareaSelectors) {
    const locator = page.locator(selector).first()
    if (!(await locator.count())) {
      continue
    }

    try {
      await locator.click({ timeout: 2000 })
      await locator.fill('')
      await locator.fill(text)

      // Some HH builds require native input/change events to enable send button.
      await locator.evaluate((el, value) => {
        const target = el
        target.value = value
        target.dispatchEvent(new Event('input', { bubbles: true }))
        target.dispatchEvent(new Event('change', { bubbles: true }))
      }, text)

      return true
    } catch {
      // continue
    }
  }

  const editableSelectors = [
    '[contenteditable="true"][data-qa*="input"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
  ]

  for (const selector of editableSelectors) {
    const locator = page.locator(selector).first()
    if (!(await locator.count())) {
      continue
    }

    try {
      await locator.click({ timeout: 2000 })
      await page.keyboard.type(text, { delay: 1 })
      return true
    } catch {
      // continue
    }
  }

  return false
}

const clickSendButton = async page => {
  const exactSendButton = page
    .locator('button[data-qa="chatik-do-send-message"]:not([disabled])')
    .first()

  if (await exactSendButton.count()) {
    try {
      await exactSendButton.waitFor({ state: 'visible', timeout: 2000 })
      await exactSendButton.click({ timeout: 2000 })
      return true
    } catch {
      // continue with fallbacks
    }
  }

  return clickFirstVisible(page, [
    'button[data-qa="chatik-do-send-message"]:not([disabled])',
    '[data-qa="chatik-do-send-message"] button:not([disabled])',
    '[data-qa*="send"]:not([disabled])',
    'button[type="submit"]:not([disabled])',
    'button[aria-label*="отправить" i]:not([disabled])',
  ])
}

export const sendReply = async ({ chatId, messageId, replyText }) => {
  try {
    if (!chatId || !messageId) {
      return {
        ok: false,
        code: ERROR_CODES.VALIDATION,
        errorReason: 'chatId_or_messageId_missing',
      }
    }

    if (!replyText?.trim()) {
      return {
        ok: false,
        code: ERROR_CODES.EMPTY_REPLY,
        errorReason: 'reply_text_empty',
      }
    }

    const { page } = await getSession()
    await ensureChatPage(page)

    const opened = await openChatById(page, chatId)
    if (!opened) {
      return {
        ok: false,
        code: ERROR_CODES.VALIDATION,
        errorReason: 'chat_not_found_in_ui',
      }
    }

    if (await isChatMessagingDisabled(page)) {
      return {
        ok: false,
        code: ERROR_CODES.VALIDATION,
        errorReason: 'chat_messaging_disabled',
      }
    }

    const filled = await fillMessageInput(page, replyText)
    if (!filled) {
      return {
        ok: false,
        code: ERROR_CODES.VALIDATION,
        errorReason: 'chat_input_not_found',
      }
    }

    // HH chat button is disabled until input value is propagated in UI state.
    await delay(250)

    const sent = await clickSendButton(page)

    if (!sent) {
      await page.keyboard.press('Enter').catch(() => {})
    }

    await delay(500)

    return {
      ok: true,
      code: 'OK',
      providerMessageId: `hh-ui-${chatId}-${Date.now()}`,
    }
  } catch (error) {
    const raw = String(error?.message || 'unknown')

    if (raw.includes('auth_required')) {
      return {
        ok: false,
        code: ERROR_CODES.AUTH,
        errorReason: 'auth_required_refresh_cookies',
      }
    }

    return {
      ok: false,
      code: ERROR_CODES.NETWORK,
      errorReason: `playwright_send_failed:${raw}`,
    }
  }
}