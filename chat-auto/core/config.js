import 'dotenv/config'

const parseIntSafe = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const parseFloatSafe = (value, fallback) => {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  mode: process.env.AUTO_MODE || 'safe',
  stateFile: process.env.AUTO_STATE_FILE || './chat-auto/state.json',
  draftFile: process.env.DRAFT_QUEUE_FILE || './chat-auto/drafts.json',
  logFile: process.env.AUTO_LOG_FILE || './chat-auto/automation-log.jsonl',
  reportDir: process.env.REPORT_DIR || './chat-auto/reports',
  adapterType: process.env.CHAT_ADAPTER || 'mock',
  hhChatUrl: process.env.HH_CHAT_URL || 'https://hh.ru/chat',
  cookiesPath: process.env.COOKIES_PATH || './playwright/cookies.json',
  playwrightHeaded: String(process.env.PLAYWRIGHT_HEADED || 'false') === 'true',
  playwrightSlowMoMs: parseIntSafe(process.env.PLAYWRIGHT_SLOWMO_MS, 0),
  mockInboxFile: process.env.MOCK_INBOX_FILE || './chat-auto/mock-inbox.json',
  mockOutboxFile: process.env.MOCK_OUTBOX_FILE || './chat-auto/mock-outbox.json',
  mockRandomFailRate: parseFloatSafe(process.env.MOCK_RANDOM_FAIL_RATE, 0.02),
  pollUrl: process.env.CHAT_POLL_URL || '',
  sendUrl: process.env.CHAT_SEND_URL || '',
  chatToken: process.env.CHAT_API_TOKEN || '',
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  contactTelegram: process.env.CONTACT_TELEGRAM || '@ilyailyailya27',
  contactEmail: process.env.CONTACT_EMAIL || 'ilyasilkin27@gmail.com',
  contactGithub: process.env.CONTACT_GITHUB || 'https://github.com/ilyasilkin27',
  portfolioUrl: process.env.PORTFOLIO_URL || 'https://ilya-silkin-portfolio.vercel.app',
  candidateName: process.env.CANDIDATE_NAME || 'Илья',
  resumeFile: process.env.RESUME_FILE || './chat-auto/resume-profile.md',
  aiProvider: process.env.AI_PROVIDER || 'template',
  minConfidence: parseFloatSafe(process.env.MIN_CONFIDENCE, 0.65),
  maxRepliesPerHour: parseIntSafe(process.env.MAX_REPLIES_PER_HOUR, 30),
  minSecondsBetweenReplies: parseIntSafe(process.env.MIN_SECONDS_BETWEEN_REPLIES, 20),
  maxRetries: parseIntSafe(process.env.MAX_RETRIES, 3),
  baseBackoffMs: parseIntSafe(process.env.BASE_BACKOFF_MS, 800),
  pollLimit: parseIntSafe(process.env.POLL_LIMIT, 20),
  pollChatListOnly: String(process.env.POLL_CHAT_LIST_ONLY || 'false') === 'true',
  useChatsApiPagination: String(process.env.USE_CHATS_API_PAGINATION || 'true') === 'true',
  chatsApiMaxPages: parseIntSafe(process.env.CHATS_API_MAX_PAGES, 20),
  chatListMaxScrollPasses: parseIntSafe(process.env.CHAT_LIST_MAX_SCROLL_PASSES, 80),
  chatListEndStreakToStop: parseIntSafe(process.env.CHAT_LIST_END_STREAK_TO_STOP, 5),
  forceAllChatsTab: String(process.env.FORCE_ALL_CHATS_TAB || 'true') === 'true',
  skipYesterdayChats: String(process.env.SKIP_YESTERDAY_CHATS || 'true') === 'true',
  skipRejectChats: String(process.env.SKIP_REJECT_CHATS || 'true') === 'true',
  onlyJsStack: String(process.env.ONLY_JS_STACK || 'true') === 'true',
  skipManualReview: String(process.env.SKIP_MANUAL_REVIEW || 'true') === 'true',
  alertTelegramBotToken: process.env.ALERT_TELEGRAM_BOT_TOKEN || '',
  alertTelegramChatId: process.env.ALERT_TELEGRAM_CHAT_ID || '',
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || '',
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    'Ты пишешь в HR-чате строго от лица кандидата Ильи, только в мужском роде и в первом лице (я/мне/мой). Отвечай коротко (2-4 предложения), уверенно и по делу, с опорой на факты из резюме. Нельзя писать как работодатель или нейтральный ассистент. Если просят анкету/тестовое/опрос, вежливо откажись и предложи перейти в Telegram.',
  responseTemplate:
    process.env.RESPONSE_TEMPLATE ||
    'Здравствуйте! Спасибо за сообщение по вакансии "{{vacancyTitle}}". {{coreAnswer}}\n\nС уважением, Илья',
}

export const isFullAuto = () => config.mode === 'full'
