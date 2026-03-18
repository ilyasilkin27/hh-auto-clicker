# HH Auto Responder on Playwright

Скрипт автоматически отправляет отклики на HH.ru через Playwright.

Поддерживает:

1. Обычный запуск по одному резюме.
2. Batch-запуск по нескольким резюме (до 5 параллельно).
3. Headless и Headed режимы.
4. Обход типовых стопперов (вопросы, разные формы отклика, скрытие вакансий).

Скрипт работает в эмуляции iPhone 14 Pro Max.

## Что делает скрипт

1. Загружает cookies.
2. Переходит к выдаче вакансий по резюме.
3. Находит кнопку Откликнуться.
4. Заполняет сопроводительное письмо в доступное поле.
5. Отправляет отклик.
6. Если вакансия блокирует процесс (например, "Ответьте на вопросы") - пропускает и скрывает ее.

## Зависимости

Нужны:

1. Node.js 18+ (лучше LTS).
2. npm 9+.
3. Playwright (устанавливается через npm).
4. Chromium для Playwright.

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

Если Linux ругается на системные библиотеки:

```bash
npx playwright install-deps chromium
```

## Подготовка файлов

### 1) Cookies

Положите файл cookies в:

`./playwright/cookies.json`

Поддерживаются форматы:

1. Массив cookies.
2. Объект storageState с полем cookies.

Для экспорта можно использовать расширение Cookie-Editor.

### 2) Список резюме для batch

Создайте файл:

`./playwright/resumes.json`

Пример структуры:

```json
{
  "resumeIds": [
    "resume_id_1",
    "resume_id_2",
    "resume_id_3",
    "resume_id_4",
    "resume_id_5"
  ]
}
```

Можно взять шаблон из:

`./playwright/resumes.example.json`

## Как запускать

### Вариант A: один процесс, одно резюме

Мини-тест (1 отклик):

```bash
npm run start:pw -- --cookies ./playwright/cookies.json --resume YOUR_RESUME_ID --max 1 --maxAttempts 5
```

Рабочий запуск (headless):

```bash
npm run start:pw -- --cookies ./playwright/cookies.json --resume YOUR_RESUME_ID --max 10 --maxAttempts 40
```

Рабочий запуск (headed):

```bash
npm run start:pw:headed -- --cookies ./playwright/cookies.json --resume YOUR_RESUME_ID --max 10 --maxAttempts 40
```

### Вариант B: batch, несколько резюме

Headless batch:

```bash
npm run start:pw:batch -- --resumes ./playwright/resumes.json --cookies ./playwright/cookies.json --max 10 --maxAttempts 40 --concurrency 5
```

Headed batch:

```bash
npm run start:pw:batch:headed -- --resumes ./playwright/resumes.json --cookies ./playwright/cookies.json --max 10 --maxAttempts 40 --concurrency 5
```

Примечание: concurrency ограничен диапазоном 1-5.

## Все параметры CLI

### Параметры основного скрипта

1. --cookies
   - Путь к cookies JSON.
2. --resume
   - ID резюме. Если передан, используется именно это резюме.
3. --max
   - Целевое число успешных откликов.
   - По умолчанию: 50.
4. --maxAttempts
   - Максимум попыток, чтобы не зациклиться.
   - По умолчанию: max \* 5.
5. --cover
   - Текст сопроводительного письма.
6. --url
   - Прямой URL выдачи вакансий (альтернатива навигации по резюме).
7. --debug
   - Расширенные логи и debug-скриншоты на первой попытке.
8. --headed
   - Запуск с видимым окном браузера.

### Дополнительно для batch-скрипта

1. --resumes
   - Путь к JSON с resumeIds.
   - По умолчанию: ./playwright/resumes.json.
2. --concurrency
   - Количество параллельных процессов.
   - Диапазон: 1-5.
   - По умолчанию: 5.

## Рекомендуемый сценарий работы

1. Обновите cookies.
2. Запустите тест на 1 отклик в headed.
3. Убедитесь, что письмо подставляется корректно.
4. Запустите рабочий headless-прогон.
5. Для нескольких резюме переходите на batch.

## Что делать, если что-то не работает

### Скрипт не находит элементы

1. Запустите с --debug в headed режиме.
2. Проверьте логи и скриншоты.
3. Увеличьте --maxAttempts.

### Резюме открывается не то

1. Обязательно передавайте --resume.
2. В batch убедитесь, что resumeIds корректны в resumes.json.

### Похоже, что аккаунт разлогинен

1. Переэкспортируйте cookies.
2. Замените файл ./playwright/cookies.json.
3. Запустите короткий тест.

## Важные заметки

1. Скрипт отправляет реальные отклики с вашего аккаунта.
2. Перед массовым запуском всегда делайте короткий тест.
3. Высокий параллелизм может повышать шанс ограничений со стороны HH.
