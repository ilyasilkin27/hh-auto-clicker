# HH Auto Responder on Playwright

Набор Playwright-скриптов для hh.ru:

1. Автоотклики по одному резюме.
2. Batch-автоотклики по нескольким резюме.
3. Автоответы в hh-чате по последним активным диалогам.

Проект рассчитан на локальный запуск с вашими cookies и, при необходимости, AI API key.

## Что умеет

### Отклики на вакансии

1. Загружает cookies и открывает hh.ru под вашей сессией.
2. Переходит в поиск вакансий по резюме или по прямому URL.
3. Ищет доступные вакансии с кнопкой отклика.
4. Подставляет сопроводительное письмо.
5. Пропускает формы с вопросами и другие стопперы.
6. Может работать батчем по нескольким `resumeId` параллельно.

### Автоответы в чате

1. Открывает `https://hh.ru/chat/`.
2. Проверяет список диалогов без лишних полных переходов на каждую итерацию.
3. Отвечает только по диалогам с активностью за последние 24 часа.
4. Пропускает анкеты, этапы и сообщения с признаками отказа.
5. Может отправлять фиксированный `--reply` или генерировать ответ через AI.
6. Фильтрует шаблонные AI-ответы и не отправляет мусор вроде `[Имя]`, `<think>` и формальных шаблонов.

Сейчас чат-режим работает в desktop-контексте Playwright, без мобильной эмуляции.

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

### AI API key для чата

Если хотите генерировать ответы через AI, передайте ключ одним из способов:

```bash
AI_API_KEY=gsk_... npm run start:pw:chat -- --cookies ./playwright/cookies.json
```

или:

```bash
npm run start:pw:chat -- --cookies ./playwright/cookies.json --apiKey gsk_...
```

Поддерживаются переменные окружения:

1. `AI_API_KEY`
2. `GROQ_API_KEY`
3. `GROK_API_KEY`
4. `XAI_API_KEY`

Без ключа chat-скрипт все равно может работать, если передан обычный `--reply`.

## Команды

### npm scripts

```bash
npm run start:pw
npm run start:pw:headed
npm run start:pw:batch
npm run start:pw:batch:headed
npm run start:pw:chat
npm run start:pw:chat:headed
```

### Make targets

```bash
make apply-5x40
AI_API_KEY=gsk_... make chat-grok
```

Переменные `Makefile`:

1. `COOKIES` default `./playwright/cookies.json`
2. `RESUMES` default `./playwright/resumes.json`
3. `MAX` default `40`
4. `MAX_ATTEMPTS` default `160`
5. `MAX_FAIL_STREAK` default `5`
6. `CONCURRENCY` default `5`
7. `CHAT_MAX` default `50`
8. `CHAT_MAX_DIALOGS` default `100`
9. `CHAT_INTERVAL_MS` default `1200`

Примеры:

```bash
MAX=20 CONCURRENCY=2 make apply-5x40
AI_API_KEY=gsk_... CHAT_MAX=10 CHAT_MAX_DIALOGS=30 CHAT_INTERVAL_MS=3000 make chat-grok
```

## Запуск

### Один процесс, одно резюме

Тестовый запуск:

```bash
npm run start:pw -- --cookies ./playwright/cookies.json --resume YOUR_RESUME_ID --max 1 --maxAttempts 5
```

Обычный headless-запуск:

```bash
npm run start:pw -- --cookies ./playwright/cookies.json --resume YOUR_RESUME_ID --max 10 --maxAttempts 40 --maxFailStreak 5
```

С открытым браузером:

```bash
npm run start:pw:headed -- --cookies ./playwright/cookies.json --resume YOUR_RESUME_ID --max 10 --maxAttempts 40 --maxFailStreak 5
```

### Batch по нескольким резюме

```bash
npm run start:pw:batch -- --resumes ./playwright/resumes.json --cookies ./playwright/cookies.json --max 10 --maxAttempts 40 --maxFailStreak 5 --concurrency 2
```

С открытым браузером:

```bash
npm run start:pw:batch:headed -- --resumes ./playwright/resumes.json --cookies ./playwright/cookies.json --max 10 --maxAttempts 40 --maxFailStreak 5 --concurrency 2
```

### Чат с AI-ответами

Dry run:

```bash
AI_API_KEY=gsk_... npm run start:pw:chat:headed -- --cookies ./playwright/cookies.json --dryRun --max 5 --maxDialogs 20 --debug
```

Боевой запуск:

```bash
AI_API_KEY=gsk_... npm run start:pw:chat -- --cookies ./playwright/cookies.json --max 10 --maxDialogs 50 --intervalMs 1200
```

Через CLI-параметр:

```bash
npm run start:pw:chat -- --cookies ./playwright/cookies.json --apiKey gsk_... --max 10 --maxDialogs 50
```

### Чат с фиксированным ответом

```bash
npm run start:pw:chat:headed -- --cookies ./playwright/cookies.json --max 5 --reply "Здравствуйте! Спасибо за сообщение. Готов обсудить детали."
```

### Свои skip-слова для чата

```bash
npm run start:pw:chat -- --cookies ./playwright/cookies.json --skipKeywords "отказ,не готовы рассматривать,вакансия закрыта"
```

## CLI-параметры

### Основной скрипт откликов

1. `--cookies` путь к cookies JSON.
2. `--resume` ID резюме.
3. `--max` целевое число успешных откликов.
4. `--maxAttempts` максимум попыток.
5. `--maxFailStreak` число неудач подряд до перехода на следующую страницу.
6. `--cover` текст сопроводительного письма.
7. `--url` прямой URL выдачи вакансий.
8. `--debug` подробные логи и debug-скриншоты.
9. `--headed` запуск с видимым окном браузера.

### Batch-скрипт

1. `--resumes` путь к JSON с `resumeIds`.
2. `--concurrency` число параллельных процессов, диапазон `1-5`.
3. `--headed` запуск дочерних процессов с видимым окном.
4. `--max`, `--maxAttempts`, `--maxFailStreak`, `--cookies` пробрасываются в дочерние процессы.

### Chat-скрипт

1. `--cookies` путь к cookies JSON.
2. `--max` максимум отправленных ответов за запуск.
3. `--maxDialogs` сколько диалогов проверить за запуск.
4. `--reply` фиксированный текст ответа.
5. `--skipKeywords` список skip-слов через запятую.
6. `--intervalMs` пауза между ответами в миллисекундах.
7. `--dryRun` ничего не отправлять, только логировать.
8. `--debug` подробные логи.
9. `--headed` запуск с видимым окном.
10. `--apiKey` AI API key.
11. `--grokApiKey` альтернативное имя параметра API key.
12. `--xaiApiKey` альтернативное имя параметра API key.
13. `--aiModel` модель AI.
14. `--grokModel` альтернативное имя параметра модели.
15. `--aiBaseUrl` кастомный base URL AI-провайдера.
16. `--systemPrompt` свой system prompt для AI.

## Текущее поведение чат-режима

1. Отвечает только по диалогам, где последнее сообщение имеет таймстамп не старше 24 часов.
2. Не отвечает на анкеты и этапы.
3. Не отвечает на сообщения с ключевыми словами отказа.
4. Не дублирует свой недавний исходящий ответ.
5. При AI-режиме использует `curl` к API и несколько fallback-попыток по моделям.
6. Если AI вернул шаблонный или пустой текст, диалог пропускается.

## Рекомендуемый порядок использования

1. Обновить cookies.
2. Прогнать короткий тест в `headed` режиме.
3. Для откликов начинать с одного резюме.
4. Для batch лучше стартовать с `--concurrency 2`.
5. Для чата сначала запускать `--dryRun`.
6. Если ловите rate limit AI, увеличивать `--intervalMs` до `3000-5000`.

## Если что-то не работает

### Скрипт не находит элементы

1. Запустите с `--debug --headed`.
2. Проверьте, актуальны ли cookies.
3. Увеличьте `--maxAttempts`.

### Аккаунт разлогинен

1. Переэкспортируйте cookies.
2. Замените `./playwright/cookies.json`.
3. Повторите короткий тест.

### Много пропусков в чате

1. Проверьте, что в диалогах есть активность за последние 24 часа.
2. Посмотрите, не сработал ли фильтр анкет или skip-слов.
3. Для диагностики используйте `--debug --headed --dryRun`.

### AI не отвечает

1. Передайте `AI_API_KEY` или `--apiKey`.
2. Проверьте лимиты провайдера.
3. Попробуйте увеличить `--intervalMs`.

## Важные замечания

1. Скрипты отправляют реальные отклики и реальные сообщения с вашего аккаунта.
2. Перед массовым запуском делайте короткий тест.
3. Высокий параллелизм и частые запросы повышают шанс ограничений со стороны hh.ru и AI-провайдера.
