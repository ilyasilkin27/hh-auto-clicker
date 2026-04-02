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

### Batch-скрипт

1. `--resumes` путь к JSON с `resumeIds`.
2. `--concurrency` число параллельных процессов, диапазон `1-5`.
3. `--headed` запуск дочерних процессов с видимым окном.
4. `--query` текстовый запрос поиска вакансий.
5. `--max`, `--maxAttempts`, `--maxFailStreak`, `--cookies` пробрасываются в дочерние процессы.

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
