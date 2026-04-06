#!/usr/bin/env node
import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const toSameSite = value => {
  if (!value) return 'Lax'
  const normalized = String(value).toLowerCase()
  if (normalized === 'none' || normalized === 'no_restriction') return 'None'
  if (normalized === 'strict') return 'Strict'
  return 'Lax'
}

const normalizeCookies = rawCookies => {
  if (!Array.isArray(rawCookies)) return []
  return rawCookies
    .map(cookie => {
      const expiresRaw = cookie.expires ?? cookie.expirationDate
      const parsedExpires = Number(expiresRaw)
      const expires = Number.isFinite(parsedExpires) ? parsedExpires : -1
      if (!cookie.name || typeof cookie.value === 'undefined') return null
      const domain = String(cookie.domain || '').trim()
      if (!domain) return null
      return {
        name: String(cookie.name),
        value: String(cookie.value),
        domain,
        path: String(cookie.path || '/'),
        httpOnly: Boolean(cookie.httpOnly),
        secure: Boolean(cookie.secure),
        sameSite: toSameSite(cookie.sameSite),
        expires,
      }
    })
    .filter(Boolean)
}

const readCookiesFromFile = async filePath => {
  const content = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(content)
  if (Array.isArray(parsed)) return normalizeCookies(parsed)
  if (parsed && Array.isArray(parsed.cookies)) return normalizeCookies(parsed.cookies)
  return []
}

const main = async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 })
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  })

  const cookies = await readCookiesFromFile('./playwright/cookies.json')
  if (cookies.length) {
    await context.addCookies(cookies)
  }

  const page = await context.newPage()
  await page.goto('https://hh.ru/chat', { waitUntil: 'domcontentloaded' })
  await delay(1200)

  await page.evaluate(() => {
    const chatLink = document.querySelector('a[data-qa^="chatik-open-chat-"], a[id^="chat-cell-"]')
    const findScrollable = node => {
      let current = node?.parentElement || null
      while (current) {
        const style = window.getComputedStyle(current)
        const hasOverflow = /(auto|scroll)/i.test(`${style.overflowY} ${style.overflow}`)
        const scrollable = current.scrollHeight > current.clientHeight + 8
        if (hasOverflow && scrollable) return current
        current = current.parentElement
      }
      return null
    }

    const container = findScrollable(chatLink)
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  })

  console.log('HH chat opened in headed mode. Scroll manually now; window will stay open for 10 minutes.')
  await delay(10 * 60 * 1000)

  await context.close()
  await browser.close()
}

main().catch(error => {
  console.error(`show-chat-headed failed: ${error.message}`)
  process.exitCode = 1
})
