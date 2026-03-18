# HH Auto Responder on Playwright

Скрипт автоматически отправляет отклики на HH.ru через Playwright.

Текущий flow:

1. Загружает cookies.
2. Открывает страницу резюме.
3. Переходит к вакансиям по резюме.
4. Запускает цикл откликов.

Скрипт работает в эмуляции iPhone 14 Pro Max (и в headless, и в headed).

## Быстрый старт

### 1) Установка

```bash
npm install
npx playwright install chromium
```

### 2) Подготовка cookies

Поддерживаются 2 формата JSON:

- массив cookies;
- объект формата storageState с полем cookies.

Пример пути: ./playwright/cookies.json

Можно использовать расширение: [Cookie-Editor](https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search) для экспорта куки.

### 3) Первый тест (1 отклик)

```bash
npm run start:pw -- --cookies ./playwright/cookies.json --max 1 --maxAttempts 5
```

## Команды запуска

### Headless (быстро, без окна браузера)

```bash
npm run start:pw -- --cookies ./playwright/cookies.json --max 10 --maxAttempts 10
```

### Headed (с открытым окном браузера)

```bash
npm run start:pw:headed -- --cookies ./playwright/cookies.json --max 10 --maxAttempts 10
```

### Debug-режим (скриншоты и расширенные логи на первой попытке)

```bash
npm run start:pw:headed -- --cookies ./playwright/cookies.json --max 3 --maxAttempts 5 --debug
```

## Все параметры

- --cookies
  - Путь до JSON с cookies.
  - Пример: --cookies ./playwright/cookies.json

- --max
  - Целевое количество успешных откликов.
  - По умолчанию: 50.

- --maxAttempts
  - Максимум попыток (чтобы цикл не зависал бесконечно).
  - По умолчанию: max \* 5.

- --resume
  - ID резюме для fallback-перехода на выдачу вакансий.
  - Пример: --resume 9ff5012dff0fea5cb20039ed1f6d7a70344956

- --url
  - Прямой URL выдачи вакансий. Если указан, навигация через страницу резюме пропускается.
  - Пример: --url "https://hh.ru/search/vacancy?resume=..."

- --cover
  - Текст сопроводительного письма.
  - Если не указан, используется дефолт из скрипта.

- --debug
  - Включает debug-диагностику (скриншоты и подробные data-qa логи на первой попытке).

- --headed
  - Запуск с видимым окном браузера.
  - Уже включен в npm-скрипте start:pw:headed.

## Что обрабатывает скрипт

- Несколько форм отклика (popup, bottom sheet, attach letter).
- Поля письма разных типов, включая dynamic name вида task\_\*\_text.
- Вакансии с блоком Ответьте на вопросы: такие вакансии пропускаются и скрываются.
- Сценарий, когда кнопка Откликнуться недоступна: попытка скрыть первую вакансию и идти дальше.

## Рекомендуемый рабочий цикл

1. Прогон на 1-2 отклика в headed режиме.
2. Проверка, что письма вставляются корректно.
3. Массовый прогон в headless режиме.

## Типичные проблемы

### Отклики не идут, но ошибок нет

- Увеличьте maxAttempts.
- Проверьте, что cookies актуальны.
- Запустите с --debug и посмотрите логи/скриншоты.

### Не удается перейти к вакансиям из резюме

- Передайте --resume с ID резюме.
- Либо передайте --url напрямую.

### Похоже, что сессия разлогинилась

- Переэкспортируйте cookies из браузера и перезапустите.

## Важно

- Скрипт взаимодействует с реальным аккаунтом и отправляет реальные отклики.
- Перед массовым запуском используйте короткий тест на 1-2 отклика.
