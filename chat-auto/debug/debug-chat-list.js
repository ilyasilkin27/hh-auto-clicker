#!/usr/bin/env node
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { config } from '../core/config.js'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

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

  return []
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

        const creationTimeText =
          node.querySelector('[data-qa="chat-cell-creation-time"], [data-qa*="creation-time"], [class*="time--"]')
            ?.textContent || ''

        return {
          rawChatId: chatId,
          vacancyTitle: titleText.trim().slice(0, 140),
          creationTimeText: creationTimeText.trim().slice(0, 30),
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
        const hasOverflow = /(auto|scroll)/i.test(`${style.overflowY} ${style.overflow}`)
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
        top: window.scrollY,
        maxTop: -1,
      }
    }

    const before = container.scrollTop
    const step = Math.max(300, Math.floor(container.clientHeight * 0.9))
    container.scrollTop = before + step

    const after = container.scrollTop
    const maxTop = container.scrollHeight - container.clientHeight

    return {
      moved: after > before,
      reachedEnd: after >= maxTop - 4,
      top: after,
      maxTop,
    }
  })

const main = async () => {
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

  const seen = new Map()
  const maxPasses = Number.parseInt(process.env.DEBUG_SCROLL_PASSES || '220', 10)

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const list = await collectCandidateChats(page)

    list.forEach(item => {
      const chatId = extractChatId(item.rawChatId)
      if (!chatId) {
        return
      }

      if (!seen.has(chatId)) {
        seen.set(chatId, {
          chatId,
          creationTimeText: item.creationTimeText || '',
          vacancyTitle: item.vacancyTitle || '',
        })
      }
    })

    const values = Array.from(seen.values())
    const hasYesterday = values.some(item => /^\s*вчера\s*$/iu.test(item.creationTimeText))
    const tail = values
      .slice(-6)
      .map(item => `${item.chatId}:${item.creationTimeText || '-'}`)
      .join(' | ')

    console.log(`pass=${pass} uniq=${values.length} hasYesterday=${hasYesterday} tail=${tail}`)

    if (hasYesterday) {
      break
    }

    const scrollResult = await scrollChatListOnce(page)
    if (!scrollResult.moved || scrollResult.reachedEnd) {
      console.log(
        `stop pass=${pass} moved=${scrollResult.moved} reachedEnd=${scrollResult.reachedEnd} top=${scrollResult.top} maxTop=${scrollResult.maxTop}`,
      )
      break
    }

    await delay(260)
  }

  const all = Array.from(seen.values())
  console.log('---SUMMARY---')
  console.log(`totalUnique=${all.length}`)
  console.log(JSON.stringify(all.slice(-40), null, 2))

  await context.close()
  await browser.close()
}

main().catch(error => {
  console.error(`debug-chat-list failed: ${error.message}`)
  process.exitCode = 1
})
