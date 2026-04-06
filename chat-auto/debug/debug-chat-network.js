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

  const requests = []
  const responses = []

  page.on('request', request => {
    const url = request.url()
    if (/chat|chatik|dialog|message|thread|conversation/i.test(url)) {
      requests.push({
        method: request.method(),
        url,
        postData: request.postData() || '',
      })
    }
  })

  page.on('response', async response => {
    const url = response.url()
    if (!/chat|chatik|dialog|message|thread|conversation/i.test(url)) {
      return
    }

    const headers = response.headers()
    let bodyPreview = ''

    if ((headers['content-type'] || '').includes('application/json')) {
      try {
        const text = await response.text()
        bodyPreview = text.slice(0, 500)
      } catch {
        // ignore
      }
    }

    responses.push({
      status: response.status(),
      url,
      contentType: headers['content-type'] || '',
      bodyPreview,
    })
  })

  await page.goto(config.hhChatUrl, { waitUntil: 'domcontentloaded' })
  await delay(1500)

  for (let i = 0; i < 8; i += 1) {
    const s = await scrollChatListOnce(page)
    await delay(400)
    if (!s.moved || s.reachedEnd) {
      break
    }
  }

  const dedupRequests = Array.from(
    new Map(requests.map(item => [`${item.method} ${item.url}`, item])).values(),
  )

  const dedupResponses = Array.from(
    new Map(responses.map(item => [`${item.status} ${item.url}`, item])).values(),
  )

  console.log(
    JSON.stringify(
      {
        requests: dedupRequests,
        responses: dedupResponses,
      },
      null,
      2,
    ),
  )

  await context.close()
  await browser.close()
}

main().catch(error => {
  console.error(`debug-chat-network failed: ${error.message}`)
  process.exitCode = 1
})
