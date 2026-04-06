# Автоответы HH: Подробный гайд с нуля

Этот документ написан для человека, который впервые открывает проект.
Цель: чтобы можно было запустить автоответы без угадываний и понимать, что происходит на каждом шаге.

## 1) Что это за модуль и как он работает

Модуль в папке `chat-auto/` обрабатывает входящие сообщения в HH чате по циклу:

1. Забирает новые сообщения работодателей.
2. Применяет фильтры безопасности и релевантности.
3. Генерирует текст ответа.
4. В зависимости от режима отправляет ответ или пропускает сообщение.
5. Записывает результат в state и логи.

Простая схема:

1. `poll` -> 2. `risk` -> 3. `reply` -> 4. `send|skip` -> 5. `log`

## 2) Что нужно для старта

### 2.1 Софт

1. Node.js 18+
2. npm 9+
3. Playwright + Chromium
4. Cookies вашего HH-аккаунта

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

Для Linux при проблемах с зависимостями Chromium:

```bash
npx playwright install-deps chromium
```

## 3) Подготовка перед первым запуском

### 3.1 Cookies

По умолчанию используется файл:

1. `playwright/cookies.json`

Если cookies устарели, система не сможет открыть чат корректно.

### 3.2 Файл окружения

Создайте локальный env из примера:

```bash
cp chat-auto/.env.example chat-auto/.env
```

Заполните минимум:

1. `CHAT_ADAPTER=playwright`
2. `AI_PROVIDER=groq` или `template`
3. `GROQ_API_KEY=...` (если `AI_PROVIDER=groq`)
4. `COOKIES_PATH=./playwright/cookies.json`

Для настройки под себя:

1. Скопируйте шаблон профиля: `cp chat-auto/resume-profile.example.md chat-auto/resume-profile.md`
2. Заполните в `chat-auto/resume-profile.md` свои опыт/стек/контакты
3. В `chat-auto/.env` установите `RESUME_FILE=./chat-auto/resume-profile.md`
4. При необходимости поменяйте `SYSTEM_PROMPT` и `RESPONSE_TEMPLATE` в `chat-auto/.env`

Советую использовать [Groq API](https://console.groq.com). Он бесплатный и имеет много лимитов.

### 3.3 Рекомендованные флаги для этого проекта

1. `ONLY_JS_STACK=true` -> отвечаем только по JS/TS-профилю
2. `SKIP_MANUAL_REVIEW=true` -> ничего не уходит в ручной разбор, неподходящее сразу `skipped`
3. `AUTO_MODE=safe` -> сначала тестовый прогон без отправки

## 4) Быстрый старт: 3 сценария

### Сценарий A: Проверить, что все вообще работает

```bash
AUTO_MODE=safe npm run chat:process
```

Ожидаемый результат:

1. Команда завершилась без crash
2. В summary есть `polled`, `skipped`, возможно `manual`/`failed`
3. Отправок нет, потому что `safe`

### Сценарий B: Боевой запуск с отправкой

```bash
AUTO_MODE=full npm run chat:process
```

Ожидаемый результат:

1. Часть сообщений уйдет в `sent`
2. Нерелевантные/опасные уйдут в `skipped`
3. Ошибки интерфейса HH попадут в `failed`

### Сценарий C: Только посмотреть новые сообщения

```bash
npm run chat:poll
```

## 5) Полный список полезных команд

1. `npm run chat:poll` - только чтение новых сообщений
2. `npm run chat:process` - один цикл обработки
3. `npm run chat:drafts` - список черновиков
4. `npm run chat:approve -- --messageId <MESSAGE_ID>` - ручная отправка черновика
5. `npm run chat:report` - отчет
6. `npm run chat:test:e2e` - e2e-проверка пайплайна

## 6) Режимы: safe и full

### Safe

```bash
AUTO_MODE=safe npm run chat:process
```

1. Реальная отправка выключена
2. Удобно для проверки логики
3. Рекомендуется после любого изменения правил

### Full

```bash
AUTO_MODE=full npm run chat:process
```

1. Реальная отправка включена
2. Используйте только после успешной проверки в safe

## 7) Какие файлы за что отвечают

Ключевые файлы:

1. `chat-auto/core/config.js` - читает env и формирует настройки
2. `chat-auto/core/pipeline.js` - основной цикл обработки
3. `chat-auto/core/risk.js` - правила блокировки/пропуска
4. `chat-auto/services/reply-generator.js` - генератор текста ответа
5. `chat-auto/adapters/playwright-hh-adapter.js` - работа с HH UI через Playwright
6. `chat-auto/core/rate-limit.js` - лимиты и задержки отправки
7. `chat-auto/core/state-store.js` - запись/чтение состояния

## 8) Где смотреть результат запуска

Во время работы смотрите:

1. консольный summary
2. `chat-auto/automation-log.jsonl`
3. `chat-auto/.tmp/` (временные логи прогонов)

Статусы сообщений:

1. `sent` - отправлено в HH
2. `skipped` - пропущено по правилам
3. `draft_only` - черновик (обычно в safe)
4. `manual_review` - вручную проверить (если не отключено)
5. `fail` - ошибка отправки/валидации

## 9) Текущая бизнес-логика проекта

Сейчас в проекте:

1. Отвечаем в основном по JS/TS и связанному стеку
2. Не-JS вакансии (C#/.NET/iOS/Java/Python/PHP/Ruby и т.д.) пропускаются
3. Ручной режим можно выключить (`SKIP_MANUAL_REVIEW=true`)
4. Ожидания по зарплате: 200000 руб. на руки
5. На тестовые/анкеты: вежливый отказ + контакты

## 10) Подробно про важные env-переменные

Базовые:

1. `AUTO_MODE` - `safe` или `full`
2. `CHAT_ADAPTER` - `playwright` (для HH UI)
3. `COOKIES_PATH` - путь к cookies
4. `AI_PROVIDER` - `groq` или `template`

AI:

1. `GROQ_API_KEY` - ключ Groq
2. `GROQ_MODEL` - модель Groq
3. `MIN_CONFIDENCE` - порог уверенности

Политика:

1. `ONLY_JS_STACK=true` - не-JS кейсы отсекаем
2. `SKIP_MANUAL_REVIEW=true` - не используем manual очередь
3. `SKIP_REJECT_CHATS=true` - пропуск чатов с отказом

Антиспам и лимиты:

1. `MAX_REPLIES_PER_HOUR`
2. `MIN_SECONDS_BETWEEN_REPLIES`
3. `MAX_RETRIES`
4. `BASE_BACKOFF_MS`

## 11) Пошаговый чеклист перед боевым запуском

1. Обновили cookies
2. Проверили `chat-auto/.env`
3. Сделали `AUTO_MODE=safe npm run chat:process`
4. Убедились, что ответы и фильтры корректны
5. Запустили `AUTO_MODE=full npm run chat:process`

## 12) Частые проблемы и что делать

### Проблема: `chat_input_not_found`

Почему:

1. HH поменял DOM
2. Поле ввода недоступно в конкретном чате

Что делать:

1. Проверить в headed-режиме
2. Обновить селекторы в адаптере

### Проблема: `chat_messaging_disabled`

Почему:

1. Работодатель отключил переписку по вакансии

Что делать:

1. Ничего критичного, это ожидаемый fail

### Проблема: много `skipped` из-за `low_confidence_manual`

Почему:

1. Слишком строгий `MIN_CONFIDENCE`

Что делать:

1. Понизить `MIN_CONFIDENCE`
2. Или оставить строгий фильтр ради качества

### Проблема: много `stack_unknown_not_js`

Почему:

1. Вакансия не содержит явных JS-маркеров

Что делать:

1. Расширить паттерны в `chat-auto/core/risk.js`
2. Протестировать изменения в safe

## 13) Безопасность: что обязательно соблюдать

Перед коммитом:

1. Убедитесь, что `chat-auto/.env` не отслеживается
2. Убедитесь, что ключи не попали в tracked-файлы
3. Убедитесь, что `.tmp` и логи не отслеживаются
4. Если ключ засветился, перевыпустите его сразу

Команды проверки:

```bash
git status --short --ignored

git ls-files -z | xargs -0 rg -n "GROQ_API_KEY|OPENAI_API_KEY|gsk_|sk-"
```

## 14) Краткая памятка для нового человека

```bash
npm install
npx playwright install chromium
cp chat-auto/.env.example chat-auto/.env
# заполнить GROQ_API_KEY и проверить cookies
AUTO_MODE=safe npm run chat:process
AUTO_MODE=full npm run chat:process
```
