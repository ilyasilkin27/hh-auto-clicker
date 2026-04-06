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
  await delay(1800)

  const dump = await page.evaluate(() => {
    const listNode = document.querySelector('a[data-qa^="chatik-open-chat-"], a[id^="chat-cell-"]')

    const allControls = Array.from(document.querySelectorAll('[role="tab"], [data-qa], button, a'))
      .map(node => {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
        const rect = node.getBoundingClientRect()

        return {
          tag: node.tagName.toLowerCase(),
          text,
          dataQa: node.getAttribute('data-qa') || '',
          role: node.getAttribute('role') || '',
          ariaSelected: node.getAttribute('aria-selected') || '',
          ariaControls: node.getAttribute('aria-controls') || '',
          id: node.getAttribute('id') || '',
          className: String(node.className || '').slice(0, 180),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        }
      })
      .filter(item => item.w > 0 && item.h > 0)

    const controls = allControls.filter(item => {
      const text = item.text.toLowerCase()
      const dataQa = item.dataQa.toLowerCase()
      const className = item.className.toLowerCase()
      return /(чат|сообщ|диалог|все|архив|непроч|входящ|исходящ|отклик|приглаш)/i.test(text)
        || /(chat|dialog|message|tab|filter|folder|inbox)/i.test(dataQa)
        || /(chat|dialog|message|tab|filter|folder|inbox)/i.test(className)
    })

    const topLeftControls = allControls
      .filter(item => item.x < 520 && item.y < 260)
      .slice(0, 250)

    const parentChain = []
    let current = listNode?.parentElement || null
    let hops = 0

    while (current && hops < 14) {
      const style = window.getComputedStyle(current)
      const rect = current.getBoundingClientRect()

      parentChain.push({
        tag: current.tagName.toLowerCase(),
        id: current.id || '',
        dataQa: current.getAttribute('data-qa') || '',
        className: String(current.className || '').slice(0, 180),
        overflowY: style.overflowY,
        overflow: style.overflow,
        scrollTop: Math.round(current.scrollTop),
        scrollHeight: Math.round(current.scrollHeight),
        clientHeight: Math.round(current.clientHeight),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      })

      current = current.parentElement
      hops += 1
    }

    return {
      url: location.href,
      controls: controls.slice(0, 300),
      topLeftControls,
      parentChain,
    }
  })

  console.log(JSON.stringify(dump, null, 2))

  await context.close()
  await browser.close()
}

main().catch(error => {
  console.error(`debug-chat-controls failed: ${error.message}`)
  process.exitCode = 1
})
