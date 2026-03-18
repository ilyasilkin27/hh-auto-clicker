import fs from 'node:fs/promises'
import { chromium, devices } from 'playwright'

const DEFAULT_COVER_LETTER = `Здравствуйте!

Меня заинтересовала ваша вакансия. Я считаю, что мой опыт и навыки соответствуют требованиям, и я хотел бы предложить свою кандидатуру на рассмотрение.

Буду рад обсудить, как могу быть полезен вашей команде.

Спасибо за внимание к моему отклику!`

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

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
  const count = await locator.count()

  if (!count) {
    return false
  }

  try {
    await locator.waitFor({ state: 'visible', timeout })
    await locator.click()
    return true
  } catch {
    return false
  }
}

const ensureVacancySearchPage = async (page, searchUrl) => {
  if (page.url().includes('/search/vacancy')) {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await delay(1200)
    await dismissOverlay(page)
    return
  }

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await delay(1200)
  await dismissOverlay(page)
}

const fillCoverLetterInVisibleField = async (page, coverLetter) => {
  const textarea = page
    .locator(
      '[data-qa="vacancy-response-popup-form-letter-input"]:visible, textarea[name="text"]:visible, textarea[name^="task_"][name$="_text"]:visible',
    )
    .first()

  if (!(await textarea.count())) {
    return false
  }

  try {
    await textarea.fill(coverLetter, { timeout: 5000 })
    await delay(500)
    return true
  } catch {
    return false
  }
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
  await submitBtn.click()
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
    .locator('[data-qa="vacancy-response-submit-popup"]:visible')
    .first()
  if (!(await submit.count())) {
    return false
  }

  if (!(await submit.isEnabled())) {
    return false
  }

  await submit.click()
  await delay(1500)
  return true
}

const clickAttachLetterAndSubmit = async (page, coverLetter) => {
  const attachButton = page
    .locator('[data-qa="vacancy-response-letter-toggle"]')
    .first()

  if (!(await attachButton.count())) {
    return false
  }

  await attachButton.click()
  await delay(1200)

  const filled = await fillCoverLetterInVisibleField(page, coverLetter)
  if (!filled) {
    return false
  }

  const sendButton = page
    .locator('[data-qa="vacancy-response-letter-submit"]:visible')
    .first()
  if (!(await sendButton.count())) {
    return false
  }

  await sendButton.click()
  await delay(1500)
  return true
}

const hideFirstVacancy = async page => {
  const card = page.locator('[data-qa="vacancy-serp__vacancy"]:visible').first()

  if (!(await card.count())) {
    return false
  }

  const hideSelectors = [
    '[data-qa="vacancy__blacklist-show-add_narrow-card"]',
    '[data-qa*="hide"]',
    '[data-qa*="blacklist"]',
    'button[aria-label*="скрыть" i]',
    'button[aria-label*="hide" i]',
  ]

  let openedMenu = false

  for (const selector of hideSelectors) {
    const target = card.locator(`${selector}:visible`).first()
    if (!(await target.count())) {
      continue
    }

    try {
      await target.click()
      openedMenu = true
      break
    } catch {
      try {
        await target.scrollIntoViewIfNeeded()
        await target.click({ force: true })
        openedMenu = true
        break
      } catch {
        // continue
      }
    }
  }

  if (!openedMenu) {
    return false
  }

  await delay(800)

  const confirm = page
    .locator(
      '[data-qa="vacancy__blacklist-menu-add-vacancy"]:visible, [data-qa*="blacklist-menu-add"]:visible, button:has-text("Скрыть эту вакансию"), button:has-text("Скрыть вакансию")',
    )
    .first()
  if (!(await confirm.count())) {
    return false
  }

  await confirm.click().catch(async () => {
    await confirm.click({ force: true })
  })
  await delay(1000)
  return true
}

const handleQuestionnaireBlocker = async page => {
  const questionTitle = page
    .locator('h2[data-qa="title"]:visible')
    .filter({ hasText: 'Ответьте на' })
    .first()

  if (!(await questionTitle.count())) {
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
    console.log(
      'Не удалось вернуться в выдачу для скрытия вакансии с вопросами.',
    )
    return true
  }

  const hidden = await hideFirstVacancy(page)
  if (!hidden) {
    console.log('Не удалось скрыть вакансию с обязательными вопросами.')
  }

  return true
}

const dismissOverlay = async page => {
  const overlay = page.locator('[data-qa="modal-overlay"]').first()
  if (!(await overlay.count())) return

  await page.keyboard.press('Escape')
  await delay(500)

  if (await overlay.count()) {
    const closeBtn = page
      .locator(
        'button[data-qa*="close"], button[aria-label*="Закрыть" i], button[aria-label*="close" i]',
      )
      .first()
    if (await closeBtn.count()) {
      await closeBtn.click()
      await delay(400)
    }
  }
}

const navigateToVacancySearch = async (page, resumeId = '') => {
  console.log('Шаг 1: открываем страницу резюме...')
  await page.goto('https://hh.ru/applicant/my_resumes', {
    waitUntil: 'domcontentloaded',
  })
  await delay(1500)
  await dismissOverlay(page)

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

  if (resumeId) {
    const fallbackUrl = `https://hh.ru/search/vacancy?resume=${resumeId}&from=resumelist`
    await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded' })
    await delay(1500)
    console.log(`Страница вакансий: ${page.url()}`)
    return
  }

  throw new Error(
    'Не удалось перейти к вакансиям по резюме: кнопка и ссылки недоступны.',
  )
}

const tryRespondToFirstVacancy = async (page, coverLetter, debug = false) => {
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

  const respondButton = page
    .locator('[data-qa="vacancy-serp__vacancy_response"]')
    .first()

  if (!(await respondButton.count())) {
    console.log(
      'Кнопка Откликнуться не найдена. Пробую скрыть первую вакансию.',
    )
    return hideFirstVacancy(page)
  }

  await respondButton.click()
  await delay(1200)

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
  }

  await clickIfVisible(page, '[data-qa="relocation-warning-confirm"]', 1200)

  if (await handleQuestionnaireBlocker(page)) {
    return false
  }

  if (await handleMobileBottomSheet(page, coverLetter)) {
    return true
  }

  if (await typeCoverLetterAndSubmitPopup(page, coverLetter)) {
    return true
  }

  if (await clickAttachLetterAndSubmit(page, coverLetter)) {
    return true
  }

  await page.keyboard.press('Escape').catch(() => {})
  return false
}

const main = async () => {
  const args = parseArgs()
  const maxResponses = Number.parseInt(
    args.max ?? args.maxResponses ?? '50',
    10,
  )
  const maxAttempts = Number.parseInt(
    args.maxAttempts ?? String(Math.max(maxResponses * 5, maxResponses)),
    10,
  )
  const overrideUrl = args.url
  const resumeId = args.resume || ''
  const coverLetter = args.cover || args.coverLetter || DEFAULT_COVER_LETTER
  const cookiesPath = args.cookies
  const headless = !args.headed
  const debug = Boolean(args.debug)

  if (Number.isNaN(maxResponses) || maxResponses <= 0) {
    throw new Error('Параметр --max должен быть положительным числом.')
  }

  if (Number.isNaN(maxAttempts) || maxAttempts <= 0) {
    throw new Error('Параметр --maxAttempts должен быть положительным числом.')
  }

  const browser = await chromium.launch({ headless })
  const iPhone = devices['iPhone 14 Pro Max']
  const context = await browser.newContext({ ...iPhone, locale: 'ru-RU' })

  try {
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
    } else {
      await navigateToVacancySearch(page, resumeId)
      targetSearchUrl = page.url()
    }

    let sent = 0
    let attempts = 0

    while (sent < maxResponses && attempts < maxAttempts) {
      await ensureVacancySearchPage(page, targetSearchUrl)

      attempts += 1
      console.log(
        `Попытка ${attempts}/${maxAttempts} (успешно: ${sent}/${maxResponses})`,
      )

      const success = await tryRespondToFirstVacancy(
        page,
        coverLetter,
        debug && attempts === 1,
      )

      if (success) {
        sent += 1
        console.log(`Успех. Отправлено: ${sent}/${maxResponses}`)

        if (sent >= maxResponses) {
          break
        }
      } else {
        console.log('Отклик не отправлен в этой попытке.')
      }
    }

    if (sent < maxResponses && attempts >= maxAttempts) {
      console.log(
        `Остановлено по лимиту попыток: ${attempts}. Успешно отправлено: ${sent}/${maxResponses}`,
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
