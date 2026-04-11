# HH Auto Responder on Playwright

Набор Playwright-скриптов для hh.ru:

1. Автоотклики по одному резюме.
2. Batch-автоотклики по нескольким резюме.

Проект рассчитан на локальный запуск с вашими cookies.

## Что умеет

### Отклики на вакансии

1. Загружает cookies и открывает hh.ru под вашей сессией.
2. Переходит в поиск вакансий по текстовому запросу (`--query`) и может дополнительно учитывать резюме (`--resume`).
3. Ищет доступные вакансии с кнопкой отклика.
4. Подставляет сопроводительное письмо.
5. Пропускает формы с вопросами и другие стопперы.
6. Может работать батчем по нескольким `resumeId` параллельно.

## Требования

1. Node.js 18+.
2. npm 9+.
3. Установленный Chromium для Playwright.

Проверка:

```bash
node -v
npm -v
npx playwright --version
```

Установка:

```bash
npm install
npx playwright install chromium
```

Если на Linux не хватает системных библиотек:

```bash
npx playwright install-deps chromium
```

## Подготовка

### Cookies

По умолчанию используется файл:

```text
./playwright/cookies.json
```

Поддерживаются форматы:

1. Массив cookies.
2. Объект `storageState` с полем `cookies`.

### Важно перед первым запуском

1. Зайдите на hh.ru вручную в том же аккаунте.
2. В выдаче вакансий откройте меню любой вакансии и нажмите "Скрыть".
3. В появившейся плашке поставьте галочку "Не показывать мне это больше".

Эта плашка может перекрывать элементы интерфейса и мешать автокликам, из-за чего отклики не отправляются.

### Список резюме для batch

По умолчанию используется:

```text
./playwright/resumes.json
```

Структура:

```json
{
  "resumeIds": ["resume_id_1", "resume_id_2", "resume_id_3"]
}
```

Шаблон лежит в `./playwright/resumes.example.json`.

## Команды

### npm scripts

```bash
npm run start:pw
npm run start:pw:headed
npm run start:pw:batch
npm run start:pw:batch:headed
```

### Make targets

```bash
make apply-5x40
```

Переменные `Makefile`:

1. `COOKIES` default `./playwright/cookies.json`
2. `RESUMES` default `./playwright/resumes.json`
3. `MAX` default `40`
4. `MAX_ATTEMPTS` default `160`
5. `MAX_FAIL_STREAK` default `5`
6. `CONCURRENCY` default `5`
7. `QUERY` default пусто (например, `middle frontend`)

Примеры:

```bash
MAX=20 CONCURRENCY=2 make apply-5x40
QUERY="middle frontend" MAX=50 make apply-5x40
```

## Запуск

### Один процесс, одно резюме

Тестовый запуск:

```bash
npm run start:pw -- --cookies ./playwright/cookies.json --resume YOUR_RESUME_ID --query "middle frontend" --max 1 --maxAttempts 5
```

Обычный headless-запуск:

```bash
npm run start:pw -- --cookies ./playwright/cookies.json --resume YOUR_RESUME_ID --query "middle frontend" --max 10 --maxAttempts 40 --maxFailStreak 5
```

С открытым браузером:

```bash
npm run start:pw:headed -- --cookies ./playwright/cookies.json --resume YOUR_RESUME_ID --query "middle frontend" --max 10 --maxAttempts 40 --maxFailStreak 5
```

### Batch по нескольким резюме

```bash
npm run start:pw:batch -- --resumes ./playwright/resumes.json --cookies ./playwright/cookies.json --query "middle frontend" --max 10 --maxAttempts 40 --maxFailStreak 5 --concurrency 2
```

С открытым браузером:

```bash
npm run start:pw:batch:headed -- --resumes ./playwright/resumes.json --cookies ./playwright/cookies.json --query "middle frontend" --max 10 --maxAttempts 40 --maxFailStreak 5 --concurrency 2
```

## CLI-параметры

### Основной скрипт откликов

1. `--cookies` путь к cookies JSON.
2. `--resume` ID резюме.
3. `--max` целевое число успешных откликов.
4. `--maxAttempts` максимум попыток.
5. `--maxFailStreak` число неудач подряд до перехода на следующую страницу.
6. `--cover` текст сопроводительного письма.
7. `--query` текстовый запрос поиска вакансий (например, `middle frontend`).
8. `--url` прямой URL выдачи вакансий.
9. `--debug` подробные логи и debug-скриншоты.
10. `--headed` запуск с видимым окном браузера.
11. `--desktop` запуск в обычном десктопном режиме вместо мобильной эмуляции.

### Batch-скрипт

1. `--resumes` путь к JSON с `resumeIds`.
2. `--concurrency` число параллельных процессов, диапазон `1-5`.
3. `--headed` запуск дочерних процессов с видимым окном.
4. `--desktop` запуск дочерних процессов в десктопном режиме вместо мобильной эмуляции.
5. `--query` текстовый запрос поиска вакансий.
6. `--max`, `--maxAttempts`, `--maxFailStreak`, `--cookies` пробрасываются в дочерние процессы.

## Рекомендуемый порядок использования

1. Обновить cookies.
2. Прогнать короткий тест в `headed` режиме.
3. Для откликов начинать с одного резюме.
4. Для batch лучше стартовать с `--concurrency 2`.

## Если что-то не работает

### Скрипт не находит элементы

1. Запустите с `--debug --headed`.
2. Проверьте, актуальны ли cookies.
3. Увеличьте `--maxAttempts`.

### Аккаунт разлогинен

1. Переэкспортируйте cookies.
2. Замените `./playwright/cookies.json`.
3. Повторите короткий тест.

## Важные замечания

1. Скрипты отправляют реальные отклики с вашего аккаунта.
2. Перед массовым запуском делайте короткий тест.
3. Высокий параллелизм и частые запросы повышают шанс ограничений со стороны hh.ru.

## Полностью автоматический чат-цикл

Подробный гайд с нуля (установка, настройка, режимы, команды, безопасность):

- [CHAT_AUTO_GUIDE.md](CHAT_AUTO_GUIDE.md)
- [n8n/N8N_DETAILED_GUIDE.md](n8n/N8N_DETAILED_GUIDE.md)

Добавлен модуль `chat-auto/` для цикла:

1. poll новых сообщений,
2. фильтрация рисков,
3. генерация ответа,
4. отправка (или draft-only),
5. логирование и алерты.

### Контракт данных между шагами

Единый JSON-формат описан в `chat-auto/contract.md`.

Обязательные поля результата каждого шага:

1. `chatId`
2. `messageId`
3. `senderType`
4. `vacancyTitle`
5. `messageText`
6. `receivedAt`
7. `confidence`
8. `replyText`
9. `status`
10. `errorReason`

### Команды

```bash
npm run chat:poll
npm run chat:process
npm run chat:drafts
npm run chat:approve -- --messageId <MESSAGE_ID>
npm run chat:report
npm run chat:test:e2e
```

### Режимы safe/full

Переключение одной переменной окружения:

```bash
AUTO_MODE=safe npm run chat:process
AUTO_MODE=full npm run chat:process
```

1. `safe` - автоответы не отправляются, создаются draft.
2. `full` - автоотправка включена, но рисковые кейсы уходят в manual review.

### Дедупликация и состояние

Состояние хранится в `chat-auto/state.json`:

1. `processedMessageIds` предотвращает повторную обработку.
2. `draftsByMessageId` хранит ответы для ручного approve.
3. `sentByMessageId` хранит историю отправок.
4. `metrics` хранит антиспам-счетчики и последний момент отправки.

### AI-шаблон и system prompt

Настраивается в `.env`:

1. `SYSTEM_PROMPT`
2. `RESPONSE_TEMPLATE`
3. `AI_PROVIDER=template|openai`
4. `OPENAI_API_KEY`, `OPENAI_MODEL`
5. `MIN_CONFIDENCE`

Можно использовать Groq вместо OpenAI:

1. `AI_PROVIDER=groq`
2. `GROQ_API_KEY`
3. `GROQ_MODEL` (например, `openai/gpt-oss-120b`)
4. `CONTACT_TELEGRAM` для шаблона перехода в Telegram
5. `RESUME_FILE` путь к резюме (pdf/txt/md), чтобы ответы опирались на ваши факты
6. `CANDIDATE_NAME` имя кандидата для ответов от первого лица

### Правила безопасности

Реализовано:

1. стоп-темы (персональные/платежные данные, токсичные и 18+ запросы),
2. блок при низкой уверенности,
3. перевод в `manual_review` без автоотправки,
4. алерты при `fail` и low confidence.

### Ретраи, backoff и антиспам

1. До 3 попыток отправки (`MAX_RETRIES`),
2. экспоненциальный backoff (`BASE_BACKOFF_MS`),
3. лимит ответов в час (`MAX_REPLIES_PER_HOUR`),
4. пауза между ответами (`MIN_SECONDS_BETWEEN_REPLIES`).

### Логирование и отчеты

1. JSONL-лог: `chat-auto/automation-log.jsonl`.
2. Отчеты: `chat-auto/reports/report-YYYY-MM-DD.json`.
3. По любому `messageId` можно восстановить путь обработки.

### Ошибки и алерты

Поддержаны коды ошибок:

1. `NETWORK_ERROR`
2. `AUTH_ERROR`
3. `VALIDATION_ERROR`
4. `RATE_LIMIT_ERROR`
5. `RISK_BLOCKED`
6. `EMPTY_REPLY`
7. `UNKNOWN_ERROR`

Алерты:

1. Telegram (`ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`),
2. Webhook (`ALERT_WEBHOOK_URL`) - можно направить в почту через n8n.

### n8n orchestration

Импортируемый workflow:

1. `n8n/workflows/chat-auto-orchestration.json`

### Режим без API (через HTML HH Chat)

Если API-токенов нет, используйте Playwright-режим:

1. `CHAT_ADAPTER=playwright`
2. `HH_CHAT_URL=https://hh.ru/chat`
3. `COOKIES_PATH=./playwright/cookies.json`

Poll и send в этом режиме идут через DOM-селекторы страницы чатов, аналогично скриптам автооткликов.

Цепочка:

1. Cron -> Poll New Messages -> Filter Incoming -> AI Generate + Send + Log -> Log/Alert
2. Отдельная ветка `Manual Approve Trigger -> Approve Draft And Send`.

### E2E сценарии

Скрипт `npm run chat:test:e2e` проверяет:

1. happy path,
2. дедупликацию,
3. стоп-темы,
4. пустой ввод,
5. режимы safe/full.

### Эксплуатация

Полный runbook: `chat-auto/OPERATIONS.md`.
