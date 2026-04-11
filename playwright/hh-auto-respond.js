import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium, devices } from 'playwright'

const LOG_FILE_PATH = path.resolve(process.cwd(), 'hh-responses-log.json')
let jsonEventLog = []

const DEFAULT_COVER_LETTER = `Добрый день!

Я фронтенд-разработчик на React и TypeScript.
Работал с образовательными платформами и сложными веб-системами. 
Улучшал производительность, архитектуру и процессы разработки.

Портфолио: ilya-silkin-portfolio.vercel.app

Контакты:

Email: ilyasilkin27@gmail.com
Telegram: https://t.me/ilyailyailya27
GitHub: https://github.com/ilyasilkin27`

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const DAILY_LIMIT_PATTERNS = [
  /24\s*час[ао]в[^\n\r]*200\s*отклик/iu,
  /исчерпал[аи]?\s+лимит\s+отклик/iu,
  /попробуйте\s+отправить\s+отклик\s+позднее/iu,
  /исчерпан[аи]?\s+лимит/iu,
  /200\s*отклик/iu,
]

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

const clickIfVisible = async (page, selector, timeout = 1000) => {
  const locator = page.locator(selector).first()
  if (!(await locator.count())) {
    return false
  }

  try {
    await locator.waitFor({ state: 'visible', timeout })
    await locator.click()
    return true
  } catch {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout })
      await locator.click({ force: true, timeout })
      return true
    } catch {
      return false
    }
  }
}

const safeClick = async (locator, timeout = 5000) => {
  if (!(await locator.count())) {
    return false
  }

  try {
    await locator.waitFor({ state: 'visible', timeout })
    await locator.click({ timeout })
    return true
  } catch {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout })
      await locator.click({ force: true, timeout })
      return true
    } catch {
      return false
    }
  }
}

const inspectSelectors = async (page, selectors) => {
  const results = {}
  for (const [label, selector] of Object.entries(selectors)) {
    results[label] = await page.locator(selector).count().catch(() => 0)
  }
  return results
}

const debugInspectSelectors = async (page, debug, selectors) => {
  if (!debug) {
    return
  }

  const results = await inspectSelectors(page, selectors)
  console.log(
    `DEBUG selector counts: ${Object.entries(results)
      .map(([label, count]) => `${label}=${count}`)
      .join(', ')}`,
  )
}

const writeJsonLog = async () => {
  await fs.writeFile(LOG_FILE_PATH, `${JSON.stringify(jsonEventLog, null, 2)}\n`, 'utf8')
}

const logEvent = async (eventType, payload = {}) => {
  jsonEventLog.push({
    timestamp: new Date().toISOString(),
    eventType,
    ...payload,
  })
  await writeJsonLog()
}

const fillCoverLetterInVisibleField = async (page, coverLetter) => {
  const textareaSelectors = [
    '[data-qa="vacancy-response-popup-form-letter-input"]:visible',
    'textarea[name="text"]:visible',
    'textarea[data-qa*="letter"]:visible',
    'textarea[name*="letter"]:visible',
    'textarea[name^="task_"][name$="_text"]:visible',
    'textarea:visible',
  ]

  for (const selector of textareaSelectors) {
    const textarea = page.locator(selector).first()
    if (!(await textarea.count())) {
      continue
    }

    try {
      await textarea.scrollIntoViewIfNeeded({ timeout: 3000 })
      await textarea.click({ timeout: 3000 })
      await textarea.fill(coverLetter, { timeout: 5000 })
      await textarea.evaluate((el, value) => {
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }, coverLetter)
      await delay(500)
      return true
    } catch {
      // continue to next selector
    }
  }

  const contentEditableSelectors = [
    'div[contenteditable="true"]:visible',
    '[contenteditable="true"]:visible',
    'div[contenteditable]:visible',
    '[contenteditable]:visible',
    '[role="textbox"]:visible',
  ]

  for (const selector of contentEditableSelectors) {
    const contentEditable = page.locator(selector).first()
    if (!(await contentEditable.count())) {
      continue
    }

    try {
      await contentEditable.scrollIntoViewIfNeeded({ timeout: 3000 })
      await contentEditable.click({ timeout: 3000 })
      await page.keyboard.type(coverLetter, { delay: 15 })
      await delay(500)
      return true
    } catch {
      // continue to next selector
    }
  }

  return false
}

const ensureVacancySearchPage = async (page, searchUrl) => {
  if (page.url().includes('/search/vacancy')) {
    await dismissOverlay(page)
    return
  }

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await delay(1200)
  await dismissOverlay(page)
}

const extractVacancyIdFromUrl = url => {
  if (!url || typeof url !== 'string') return ''

  try {
    const parsed = new URL(url, 'https://hh.ru')
    const pathMatch = parsed.pathname.match(/\/vacancy\/(\d+)/)
    if (pathMatch) {
      return pathMatch[1]
    }

    const queryKeys = ['vacancy', 'vacancy_id', 'vacancyId', 'id']
    for (const key of queryKeys) {
      const value = parsed.searchParams.get(key)
      if (value && /^\d+$/.test(value)) {
        return value
      }
    }
  } catch {
    return ''
  }

  return ''
}

const getVacancyIdFromPage = async page => {
  const idFromUrl = extractVacancyIdFromUrl(page.url())
  if (idFromUrl) return idFromUrl

  const firstLink = page
    .locator(
      '[data-qa="vacancy-serp__vacancy"]:visible a[href*="/vacancy/"]:visible, a[href*="/vacancy/"]:visible',
    )
    .first()

  if (!(await firstLink.count())) {
    return ''
  }

  const href = await firstLink.getAttribute('href')
  return extractVacancyIdFromUrl(href)
}

const goToNextSearchPage = async page => {
  const nextButton = page
    .locator('[data-qa="pager-next"]:visible, a[rel="next"]:visible')
    .first()

  if (!(await nextButton.count())) {
    return false
  }

  try {
    await nextButton.click({ timeout: 3000 })
  } catch {
    try {
      await nextButton.scrollIntoViewIfNeeded()
      await nextButton.click({ force: true, timeout: 3000 })
    } catch {
      return false
    }
  }

  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await delay(1200)
  return true
}

// --- Обработка мобильного bottom sheet ---
const handleMobileBottomSheet = async (page, coverLetter) => {
  const submitBtn = page
    .locator('[data-qa="vacancy-response-submit-popup"]:visible')
    .first()
  if (!(await submitBtn.count())) return false

  const addLetterBtn = page.locator('[data-qa="add-cover-letter"]').first()
  if (await addLetterBtn.count()) {
    await addLetterBtn.click()
    await delay(800)
  }

  await fillCoverLetterInVisibleField(page, coverLetter)

  if (!(await submitBtn.isEnabled())) return false
  const clicked = await safeClick(submitBtn, 5000)
  if (!clicked) {
    return false
  }

  await delay(1500)
  return true
}

// --- Обработка десктопного попапа (поле письма уже открыто) ---
const typeCoverLetterAndSubmitPopup = async (page, coverLetter) => {
  const filled = await fillCoverLetterInVisibleField(page, coverLetter)
  if (!filled) {
    return false
  }

  const submit = page
    .locator(
      '[data-qa="vacancy-response-submit-popup"]:visible, button:has-text("Отправить"):visible, button:has-text("Отправить отклик"):visible',
    )
    .first()
  if (!(await submit.count())) {
    return false
  }

  if (!(await submit.isEnabled())) {
    return false
  }

  const clicked = await safeClick(submit, 5000)
  if (!clicked) {
    return false
  }

  await delay(1500)
  return true
}

const clickAttachLetterAndSubmit = async (page, coverLetter) => {
  const attachButton = page
    .locator(
      '[data-qa="vacancy-response-letter-toggle"], [data-qa*="letter-toggle"], button:has-text("Добавить сопроводительное письмо"), button:has-text("Прикрепить сопроводительное письмо"), button:has-text("Добавить письмо"), button:has-text("Добавить сопроводительное")',
    )
    .first()

  if (!(await attachButton.count())) {
    return false
  }

  try {
    await attachButton.scrollIntoViewIfNeeded({ timeout: 3000 })
  } catch {
    // continue even if scroll fails
  }

  try {
    await attachButton.click({ timeout: 5000 })
  } catch {
    try {
      await attachButton.click({ force: true, timeout: 5000 })
    } catch {
      return false
    }
  }

  const coverLetterFieldSelector =
    '[data-qa="vacancy-response-popup-form-letter-input"]:visible, textarea[name="text"]:visible, textarea[data-qa*="letter"]:visible, textarea[name*="letter"]:visible, textarea[name^="task_"][name$="_text"]:visible, textarea:visible, div[contenteditable]:visible, [contenteditable]:visible, [role="textbox"]:visible'

  await page
    .locator(coverLetterFieldSelector)
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .catch(() => {})

  await delay(1200)

  const filled = await fillCoverLetterInVisibleField(page, coverLetter)
  if (!filled) {
    return false
  }

  const sendButton = page
    .locator(
      '[data-qa="vacancy-response-letter-submit"]:visible, button:has-text("Отправить"):visible, button:has-text("Отправить отклик"):visible',
    )
    .first()
  if (!(await sendButton.count())) {
    return false
  }

  const clicked = await safeClick(sendButton, 5000)
  if (!clicked) {
    return false
  }

  await delay(1500)
  return true
}

const hideFirstVacancy = async (page, vacancyId = '') => {
  let card = page.locator('[data-qa="vacancy-serp__vacancy"]:visible').first()

  if (vacancyId) {
    const targetedCard = page
      .locator(
        `[data-qa="vacancy-serp__vacancy"]:has(a[href*="/vacancy/${vacancyId}"]):visible`,
      )
      .first()
    if (await targetedCard.count()) {
      card = targetedCard
    }
  }

  if (!(await card.count())) {
    return false
  }

  const hideSelectors = [
    '[data-qa="vacancy__blacklist-show-add_narrow-card"]',
    '[data-qa="vacancy__blacklist-show-add"]',
    '[data-qa*="blacklist-show-add"]',
    '[data-qa*="hide"]',
    '[data-qa*="blacklist"]',
    'button[aria-label*="скрыть" i]',
    'button[aria-label*="hide" i]',
    'button:has-text("Скрыть")',
    'button:has-text("Не подходит")',
    'button:has-text("Не интересна")',
    'button:has-text("Не нравится")',
    'button:has-text("Отклонить")',
    'button:has-text("Исключить")',
  ]

  let openedMenu = false

  for (const selector of hideSelectors) {
    const target = card.locator(`${selector}`).first()
    if (!(await target.count())) {
      continue
    }

    try {
      await target.click({ timeout: 3000 })
      openedMenu = true
      break
    } catch {
      try {
        await target.scrollIntoViewIfNeeded({ timeout: 3000 })
        await target.click({ force: true, timeout: 3000 })
        openedMenu = true
        break
      } catch {
        // continue
      }
    }
  }

  if (!openedMenu) {
    for (const selector of hideSelectors) {
      const target = page.locator(selector).first()
      if (!(await target.count())) {
        continue
      }

      try {
        await target.click({ timeout: 3000 })
        openedMenu = true
        break
      } catch {
        try {
          await target.scrollIntoViewIfNeeded({ timeout: 3000 })
          await target.click({ force: true, timeout: 3000 })
          openedMenu = true
          break
        } catch {
          // continue
        }
      }
    }
  }

  if (!openedMenu) {
    return false
  }

  await delay(800)

  const confirm = page
    .locator(
      '[data-qa="vacancy__blacklist-menu-add-vacancy"]:visible, [data-qa*="blacklist-menu-add"]:visible, button:has-text("Скрыть эту вакансию"), button:has-text("Скрыть вакансию"), button:has-text("Удалить из списка"), button:has-text("Исключить из поиска")',
    )
    .first()
  if (!(await confirm.count())) {
    return true
  }

  await confirm.click().catch(async () => {
    await confirm.click({ force: true })
  })
  await delay(1000)
  return true
}

const hasOpenResponseModal = async page => {
  const modalSelectors = [
    '[data-qa="vacancy-response-popup-form-letter-input"]:visible',
    '[data-qa="vacancy-response-submit-popup"]:visible',
    '[data-qa="vacancy-response-letter-toggle"]:visible',
    '[data-qa="vacancy-response-letter-submit"]:visible',
  ]

  return Boolean(await page.locator(modalSelectors.join(',')).count())
}

const isQuestionnaireBlocker = async page => {
  const pageUrl = page.url()
  if (
    pageUrl.includes('/questionnaire') ||
    pageUrl.includes('/анкета') ||
    pageUrl.includes('/questions') ||
    pageUrl.includes('/vacancy-questionnaire') ||
    pageUrl.includes('/resume_questionnaire')
  ) {
    return true
  }

  const questionnaireSelectors = [
    'text=/Ответьте на|Заполните анкету|Обязательные вопросы|Вопросы для соискателя|Анкета|Вопросы для кандидата|Ответьте на вопросы|Какие у вас зарплатные ожидания|Готовы ли вы к работе из офиса/i',
    'text=/Ваши пожелания|Ваш совокупный опыт|Ваши пожелания к развитию|Опыт в качестве фулстек-разработчика|Опыт работы|Укажите ваш опыт/i',
    '[data-qa*="questionnaire"]:visible',
    '[data-qa*="vacancy-response-questionnaire"]:visible',
    'form[action*="questionnaire"]',
    'form[action*="resume_questionnaire"]',
    'form[action*="vacancy_response"]',
  ]

  for (const selector of questionnaireSelectors) {
    if (await page.locator(selector).count()) {
      return true
    }
  }

  return false
}

const handleQuestionnaireBlocker = async (page, searchUrl = 'https://hh.ru/search/vacancy', vacancyId = '') => {
  if (!(await isQuestionnaireBlocker(page))) {
    return false
  }

  console.log(
    'Обнаружен блок "Ответьте на вопросы". Пропускаем и скрываем вакансию.',
  )

  if (!page.url().includes('/search/vacancy')) {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await delay(1200)
  }

  if (!page.url().includes('/search/vacancy')) {
    console.log('Возвращаемся на страницу поиска вакансий напрямую.')
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await delay(1200)
  }

  await page
    .locator('[data-qa="vacancy-serp__vacancy"]:visible')
    .first()
    .waitFor({ timeout: 6000 })
    .catch(() => {})

  if (!page.url().includes('/search/vacancy')) {
    console.log(
      'Не удалось вернуться в выдачу для скрытия вакансии с вопросами.',
    )
    return true
  }

  const hidden = await hideFirstVacancy(page, vacancyId)
  if (!hidden) {
    console.log('Не удалось скрыть вакансию с обязательными вопросами.')
  }

  return true
}

const dismissOverlay = async page => {
  const overlay = page
    .locator(
      '[data-qa="modal-overlay"], [role="dialog"]:visible, div[class*="popup"]:visible',
    )
    .first()
  if (!(await overlay.count())) return

  await page.keyboard.press('Escape')
  await delay(500)

  if (!(await overlay.count())) {
    return
  }

  const closeBtn = overlay
    .locator(
      'button[data-qa*="close"]:not([data-qa="snackbar-close-action"]), button[aria-label*="Закрыть" i]:not([data-qa="snackbar-close-action"]), button[aria-label*="close" i]:not([data-qa="snackbar-close-action"]), button:has-text("Закрыть"), button:has-text("Отмена"), button:has-text("Понятно")',
    )
    .first()

  if (!(await closeBtn.count())) {
    return
  }

  try {
    await closeBtn.click({ timeout: 5000 })
  } catch {
    try {
      await closeBtn.click({ force: true, timeout: 5000 })
    } catch {
      return
    }
  }

  await delay(400)
}

const navigateToVacancySearch = async (page, resumeId = '') => {
  console.log('Шаг 1: открываем страницу резюме...')
  await page.goto('https://hh.ru/applicant/my_resumes', {
    waitUntil: 'domcontentloaded',
  })
  await delay(1500)
  await dismissOverlay(page)

  if (resumeId) {
    console.log('Шаг 2: открываем рекомендации для переданного resumeId...')
    const directUrl = `https://hh.ru/search/vacancy?resume=${resumeId}&from=resumelist`
    await page.goto(directUrl, { waitUntil: 'domcontentloaded' })
    await delay(1500)
    console.log(`Страница вакансий: ${page.url()}`)
    return
  }

  console.log('Шаг 2: кликаем на поиск вакансий по резюме...')
  const vacanciesBtn = page
    .locator('[data-qa="resume-recommendations__button_promoteResume"]')
    .first()

  const hasPromoteButton = await vacanciesBtn
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)

  if (hasPromoteButton) {
    await vacanciesBtn.click()
    await page.waitForLoadState('domcontentloaded')
    await delay(1500)
    console.log(`Страница вакансий: ${page.url()}`)
    return
  }

  const linkFromPage = page
    .locator('a[href*="/search/vacancy?resume="]:visible')
    .first()
  const hasLinkFromPage = await linkFromPage.count()
  if (hasLinkFromPage) {
    const href = await linkFromPage.getAttribute('href')
    if (href) {
      const url = href.startsWith('http') ? href : `https://hh.ru${href}`
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await delay(1500)
      console.log(`Страница вакансий: ${page.url()}`)
      return
    }
  }

  throw new Error(
    'Не удалось перейти к вакансиям по резюме: кнопка и ссылки недоступны.',
  )
}

const buildSearchUrlByQuery = (query, resumeId = '') => {
  const normalizedQuery = String(query || '').trim()
  const params = new URLSearchParams()

  if (normalizedQuery) {
    params.set('text', normalizedQuery)
  }

  if (resumeId) {
    params.set('resume', resumeId)
    params.set('from', 'resumelist')
  }

  return `https://hh.ru/search/vacancy?${params.toString()}`
}

const hasDailyResponseLimitMessage = async page => {
  const bodyText = await page
    .locator('body')
    .innerText({ timeout: 2000 })
    .catch(() => '')

  if (!bodyText) {
    return false
  }

  return DAILY_LIMIT_PATTERNS.some(pattern => pattern.test(bodyText))
}

const tryRespondToFirstVacancy = async (page, coverLetter, debug = false, searchUrl = 'https://hh.ru/search/vacancy') => {
  const vacancyId = await getVacancyIdFromPage(page)
  await logEvent('attempt_start', {
    pageUrl: page.url(),
    vacancyId,
    reason: 'starting_attempt',
  })

  if (await hasDailyResponseLimitMessage(page)) {
    await logEvent('attempt_end', {
      result: 'limit',
      reason: 'daily_limit_detected',
      pageUrl: page.url(),
    })
    return 'limit'
  }

  // Ждём появления хотя бы одной карточки вакансии
  await page
    .locator('[data-qa="vacancy-serp__vacancy"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {})

  if (debug) {
    await page.screenshot({
      path: 'playwright/debug-serp.png',
      fullPage: false,
    })
    const qaAttrs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-qa]')]
        .map(el => el.getAttribute('data-qa'))
        .filter(Boolean),
    )
    console.log('DEBUG data-qa на странице:', [...new Set(qaAttrs)].join(', '))
  }

  const respondButtonSelector =
    '[data-qa="vacancy-serp__vacancy_response"], button:has-text("Откликнуться на вакансию"), button:has-text("Откликнуться"), button:has-text("Отклик"), button:has-text("Откликнуться сейчас"), button:has-text("Откликнуться сейчас")'

  if (debug) {
    await debugInspectSelectors(page, true, {
      respondButton: respondButtonSelector,
      vacancyCard: '[data-qa="vacancy-serp__vacancy"]:visible',
      hiddenVacancyButton:
        '[data-qa="vacancy__blacklist-show-add_narrow-card"], button:has-text("Скрыть"), button:has-text("Не подходит")',
    })
  }

  const respondButton = page.locator(respondButtonSelector).first()

  if (!(await respondButton.count())) {
    console.log(
      'Кнопка Откликнуться не найдена. Пробую скрыть первую вакансию.',
    )
    const selectorDiagnostics = await inspectSelectors(page, {
      respondButton: respondButtonSelector,
      vacancyCard: '[data-qa="vacancy-serp__vacancy"]:visible',
      hideButton: '[data-qa="vacancy__blacklist-show-add_narrow-card"], button:has-text("Скрыть")',
    })
    await logEvent('respond_button_missing', {
      pageUrl: page.url(),
      vacancyId,
      selectorDiagnostics,
      bodySnippet: (await page.locator('body').innerText().catch(() => '')).slice(0, 1200),
    })

    const hidden = await hideFirstVacancy(page, vacancyId)
    if (debug && !hidden) {
      await page.screenshot({
        path: 'playwright/debug-no-respond-button.png',
        fullPage: false,
      })
    }
    const status = hidden ? 'hidden' : 'failed'
    await logEvent('attempt_end', {
      result: status,
      reason: 'respond_button_missing',
      pageUrl: page.url(),
    })
    return status
  }

  console.log('Нажимаем кнопку откликнуться на вакансию')
  await respondButton.click()
  await delay(1200)

  await clickIfVisible(page, 'button:has-text("Все равно откликнуться")', 2000)

  if (await isQuestionnaireBlocker(page)) {
    const bodySnippet = (await page.locator('body').innerText().catch(() => '')).slice(0, 1200)
    await logEvent('questionnaire_blocker', {
      pageUrl: page.url(),
      vacancyId,
      reason: 'questionnaire_required_after_click',
      bodySnippet,
    })
    await handleQuestionnaireBlocker(page, searchUrl, vacancyId)
    return 'questionnaire_blocker'
  }

  if (await hasDailyResponseLimitMessage(page)) {
    return 'limit'
  }

  if (debug) {
    await page.screenshot({
      path: 'playwright/debug-after-click.png',
      fullPage: false,
    })
    const qaAfterClick = await page.evaluate(() =>
      [...document.querySelectorAll('[data-qa]')]
        .map(el => el.getAttribute('data-qa'))
        .filter(Boolean),
    )
    console.log(
      'DEBUG after click data-qa:',
      [...new Set(qaAfterClick)].join(', '),
    )
    console.log('DEBUG current URL:', page.url())
    await debugInspectSelectors(page, true, {
      responseButton:
        '[data-qa="vacancy-serp__vacancy_response"], button:has-text("Откликнуться"), button:has-text("Отклик")',
      coverLetterToggle:
        '[data-qa="vacancy-response-letter-toggle"], [data-qa*="letter-toggle"], button:has-text("Добавить сопроводительное")',
      coverLetterTextarea:
        '[data-qa="vacancy-response-popup-form-letter-input"], textarea[name="text"], textarea[name*="letter"], textarea[name^="task_"][name$="_text"]',
      submitButton:
        '[data-qa="vacancy-response-submit-popup"], button:has-text("Отправить"), button:has-text("Отправить отклик")',
      popupOverlay:
        '[data-qa="modal-overlay"], [role="dialog"], div[class*="overlay"], div[class*="popup"]',
    })
  }

  await clickIfVisible(page, '[data-qa="relocation-warning-confirm"]', 1200)

  if (await handleMobileBottomSheet(page, coverLetter)) {
    return 'success'
  }

  if (await clickAttachLetterAndSubmit(page, coverLetter)) {
    return 'success'
  }

  if (await typeCoverLetterAndSubmitPopup(page, coverLetter)) {
    return 'success'
  }

  if (await handleQuestionnaireBlocker(page, searchUrl, vacancyId)) {
    const bodySnippet = (await page.locator('body').innerText().catch(() => '')).slice(0, 1200)
    await logEvent('questionnaire_blocker', {
      pageUrl: page.url(),
      vacancyId,
      reason: 'questionnaire_required',
      bodySnippet,
    })
    return 'questionnaire_blocker'
  }

  if (debug) {
    console.log('DEBUG: не удалось отправить отклик, вывожу состояние страницы...')
    await debugInspectSelectors(page, true, {
      coverLetterTextarea:
        '[data-qa="vacancy-response-popup-form-letter-input"], textarea[name="text"], textarea[name*="letter"], textarea[name^="task_"][name$="_text"]',
      mobileSheetSubmit:
        '[data-qa="vacancy-response-submit-popup"], button:has-text("Отправить")',
      letterToggle:
        '[data-qa="vacancy-response-letter-toggle"], [data-qa*="letter-toggle"], button:has-text("Добавить сопроводительное")',
      submitAction:
        '[data-qa="vacancy-response-letter-submit"], button:has-text("Отправить"):visible',
    })
    await page.screenshot({
      path: 'playwright/debug-final-failure.png',
      fullPage: false,
    })
  }

  await page.keyboard.press('Escape').catch(() => {})
  return 'failed'
}

const main = async () => {
  const args = parseArgs()
  const maxResponses = Number.parseInt(
    args.max ?? args.maxResponses ?? '50',
    10,
  )

  jsonEventLog = []
  await writeJsonLog()
  await logEvent('run_start', {
    maxResponses,
    maxAttempts: Number.parseInt(args.maxAttempts ?? String(Math.max(maxResponses * 5, maxResponses)), 10),
    maxFailStreak: Number.parseInt(args.maxFailStreak ?? '5', 10),
    debug: Boolean(args.debug),
    desktop: Boolean(args.desktop || args.device === 'desktop'),
    searchQuery: String(args.query || '').trim(),
    resumeId: args.resume || '',
  })
  const maxAttempts = Number.parseInt(
    args.maxAttempts ?? String(Math.max(maxResponses * 5, maxResponses)),
    10,
  )
  const maxFailStreak = Number.parseInt(args.maxFailStreak ?? '5', 10)
  const overrideUrl = args.url
  const resumeId = args.resume || ''
  const searchQuery = String(args.query || '').trim()
  const coverLetter = args.cover || args.coverLetter || DEFAULT_COVER_LETTER
  const cookiesPath = args.cookies
  const headless = !args.headed
  const useDesktop = Boolean(args.desktop || args.device === 'desktop')
  const debug = Boolean(args.debug)

  if (Number.isNaN(maxResponses) || maxResponses <= 0) {
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

  const browser = await chromium.launch({ headless })
  const iPhone = devices['iPhone 14 Pro Max']
  const context = await browser.newContext(
    useDesktop
      ? { locale: 'ru-RU', viewport: { width: 1280, height: 800 } }
      : { ...iPhone, locale: 'ru-RU' },
  )

  try {
    if (useDesktop) {
      console.log('Запуск в десктопном режиме.');
    }
    if (cookiesPath) {
      const cookies = await readCookiesFromFile(cookiesPath)
      if (!cookies.length) {
        throw new Error('В файле cookies нет валидных записей.')
      }

      await context.addCookies(cookies)
      console.log(`Загружено cookies: ${cookies.length}`)
    } else {
      console.log(
        'Файл cookies не указан. Продолжаю без предзагруженной сессии.',
      )
    }

    const page = await context.newPage()
    let targetSearchUrl = ''

    if (overrideUrl) {
      console.log(`Переходим напрямую: ${overrideUrl}`)
      await page.goto(overrideUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      targetSearchUrl = overrideUrl
    } else if (searchQuery) {
      targetSearchUrl = buildSearchUrlByQuery(searchQuery, resumeId)
      console.log(`Переходим в поиск по запросу: "${searchQuery}"`)
      await page.goto(targetSearchUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
      console.log(`Страница вакансий: ${page.url()}`)
    } else {
      await navigateToVacancySearch(page, resumeId)
      targetSearchUrl = resumeId
        ? `https://hh.ru/search/vacancy?resume=${resumeId}&from=resumelist`
        : page.url()
    }

    let sent = 0
    let attempts = 0
    let failStreak = 0
    let stoppedByDailyLimit = false

    while (sent < maxResponses && attempts < maxAttempts) {
      await ensureVacancySearchPage(page, targetSearchUrl)

      attempts += 1
      console.log(
        `Попытка ${attempts}/${maxAttempts} (успешно: ${sent}/${maxResponses})`,
      )

      const respondResult = await tryRespondToFirstVacancy(
        page,
        coverLetter,
        debug && attempts === 1,
        targetSearchUrl,
      )

      if (respondResult === 'limit') {
        console.warn(
          'Предупреждение: у вас исчерпан лимит откликов (не более 200 за 24 часа). Попробуйте позже.',
        )
        await logEvent('attempt_end', {
          attempt: attempts,
          sent,
          result: 'limit',
          reason: 'daily_limit',
          pageUrl: page.url(),
        })
        stoppedByDailyLimit = true
        break
      }

      if (respondResult === 'success') {
        await logEvent('attempt_end', {
          attempt: attempts,
          sent,
          result: 'success',
          pageUrl: page.url(),
        })
        await delay(1200)

        if (await hasDailyResponseLimitMessage(page)) {
          console.warn(
            'Предупреждение: обнаружен текст о суточном лимите откликов (200 за 24 часа). Останавливаю отправку.',
          )
          stoppedByDailyLimit = true
          break
        }

        sent += 1
        failStreak = 0
        console.log(`Успех. Отправлено: ${sent}/${maxResponses}`)

        if (sent >= maxResponses) {
          break
        }
      } else {
        await logEvent('attempt_end', {
          attempt: attempts,
          sent,
          result: 'failed',
          pageUrl: page.url(),
          reason: respondResult,
        })
        failStreak += 1
        console.log('Отклик не отправлен в этой попытке.')

        if (failStreak >= maxFailStreak) {
          console.log(
            `Подряд неудач: ${failStreak}. Переходим на следующую страницу выдачи...`,
          )
          const moved = await goToNextSearchPage(page)
          if (moved) {
            failStreak = 0
            targetSearchUrl = page.url()
          } else {
            console.log('Следующая страница не найдена, продолжаем на текущей.')
            failStreak = 0
          }
        }
      }
    }

    if (sent < maxResponses && attempts >= maxAttempts) {
      console.log(
        `Остановлено по лимиту попыток: ${attempts}. Успешно отправлено: ${sent}/${maxResponses}`,
      )
    }

    if (stoppedByDailyLimit) {
      console.log(
        `Остановлено из-за суточного лимита откликов. Успешно отправлено: ${sent}/${maxResponses}`,
      )
    }

    console.log(`Готово. Всего отправлено откликов: ${sent}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch(error => {
  console.error(`Ошибка запуска: ${error.message}`)
  process.exitCode = 1
})
