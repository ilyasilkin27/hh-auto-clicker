# n8n Detailed Guide for HH Automation

Этот документ описывает полную эксплуатацию n8n-оркестрации в проекте hh-auto-clicker:

1. как устроена архитектура;
2. как поднять и проверить стек;
3. как работают daily-отклики и daily-автоответы;
4. где смотреть логи и состояние;
5. как безопасно разруливать типовые сбои.

Документ написан так, чтобы новый человек мог разобраться без дополнительного контекста.

## 1. Что управляется через n8n

Через n8n в этом проекте запускаются два ежедневных контура:

1. Контур откликов на вакансии.
2. Контур автоответов в чатах.

n8n здесь не выполняет shell-команды напрямую. Он вызывает внутренний HTTP runner, который уже запускает нужные Node.js-скрипты в проекте.

## 2. Архитектура

Текущая локальная архитектура состоит из трех контейнеров:

1. postgres
2. n8n
3. runner

Поток выполнения:

1. Cron или manual trigger в n8n запускает workflow.
2. HTTP Request node отправляет POST в runner, например /run/apply-daily.
3. runner запускает нужный скрипт в директории проекта.
4. runner возвращает JSON в n8n с кодом, stdout, stderr и служебными полями.

Почему так сделано:

1. это работает в n8n 2.x, где нет executeCommand в базовом наборе;
2. легче контролировать timeouts, retries и изоляцию запуска;
3. можно централизованно добавлять защиту от дублей, hanging и т.д.

## 3. Файлы, которые нужно знать

Основные файлы оркестрации:

1. n8n/docker-compose.yml
2. n8n/.env
3. n8n/.env.example
4. n8n/runner/server.mjs
5. n8n/workflows/chat-auto-orchestration.json
6. n8n/workflows/apply-daily-orchestration.json
7. n8n/workflows/smoke-test-orchestration.json

Скрипты, которые реально выполняются runner:

1. chat-auto/cli/process-cycle.js
2. chat-auto/cli/daily-report.js
3. playwright/run-rotating-batch.js
4. playwright/hh-auto-respond.js

Состояние ротации откликов:

1. playwright/apply-rotation-state.json

## 4. Быстрый старт

### 4.1 Подготовить env

1. Скопировать шаблон:

cp n8n/.env.example n8n/.env

2. Заполнить минимум:

- POSTGRES_USER
- POSTGRES_PASSWORD
- POSTGRES_DB
- N8N_BASIC_AUTH_USER
- N8N_BASIC_AUTH_PASSWORD
- N8N_ENCRYPTION_KEY
- RUNNER_AUTH_TOKEN
- AI_PROVIDER и ключ провайдера (если чат-контур не в mock)
- COOKIES_PATH

### 4.2 Поднять стек

Из корня проекта:

docker compose -f n8n/docker-compose.yml up -d

Проверить статусы:

docker compose -f n8n/docker-compose.yml ps

Ожидаемое состояние:

1. n8n Up
2. n8n-postgres Up (healthy)
3. n8n-runner Up

### 4.3 Открыть UI

1. Открыть http://localhost:5678
2. Войти по basic auth из n8n/.env

### 4.4 Импорт workflow

Если workflows еще не импортированы:

docker exec n8n n8n import:workflow --input=/files/hh-auto-clicker/n8n/workflows/chat-auto-orchestration.json
docker exec n8n n8n import:workflow --input=/files/hh-auto-clicker/n8n/workflows/apply-daily-orchestration.json
docker exec n8n n8n import:workflow --input=/files/hh-auto-clicker/n8n/workflows/smoke-test-orchestration.json

Проверить список:

docker exec n8n n8n list:workflow

## 5. Workflows и их назначение

### 5.1 HH Smoke Test Cycle

Назначение: быстрый smoke на инфраструктуру.

Запускает:

1. Smoke Apply x1
2. Smoke Chat Reply x1

Когда использовать:

1. после изменений в docker-compose;
2. после правок runner;
3. после обновления cookies;
4. перед включением daily cron.

### 5.2 HH Apply Daily Cycle

Назначение: ежедневные отклики.

Триггеры:

1. Daily Apply Cron
2. Manual Apply Trigger

Основная node:

1. Run Daily Apply Batch (HTTP POST на /run/apply-daily)

Особенности текущей логики:

1. используется stateful ротация резюме;
2. резюме переключается только после фактического достижения цели по отправкам;
3. если в запуске отправлено 0, это считается ошибкой;
4. параллельный второй запуск apply-daily блокируется с ответом 409 already_running;
5. long run имеет увеличенный timeout на уровне n8n и runner.

### 5.3 HH Chat Daily Cycle

Назначение: ежедневный цикл обработки чатов.

Запускает:

1. chat process;
2. daily report;
3. ветвление по ошибкам.

## 6. Как работает ротация резюме в daily apply

Ротация реализована в playwright/run-rotating-batch.js и сохраняется в playwright/apply-rotation-state.json.

Смысл:

1. каждый запуск берет текущее резюме по nextResumeIndex;
2. учитывает накопленное количество отправок по resumeId;
3. рассчитывает, сколько еще нужно добрать до цели;
4. если цель по резюме достигнута, переключает nextResumeIndex на следующее резюме;
5. если запуск частичный, оставляет тот же индекс;
6. если запуск дал 0 отправок, фиксирует ошибку и не переключает индекс.

Пример состояния:

1. sentByResumeId: сколько уже отправлено по каждому resumeId;
2. nextResumeIndex: какое резюме будет следующим;
3. lastSentCount: сколько отправлено в последнем запуске;
4. failedRuns и successfulRuns: служебная статистика.

Это защищает от сценария, когда после рестарта контейнера снова гоняется первое резюме с нуля.

## 7. Что считается успехом, а что ошибкой

Для /run/apply-daily:

Успех:

1. процесс отработал без runtime error;
2. по текущему резюме фактически достигнута цель по отправкам.

Частичный успех:

1. процесс отработал без runtime error;
2. отправки были, но цель не достигнута;
3. следующее выполнение продолжит то же резюме.

Ошибка:

1. runtime error в playwright или node;
2. отправлено 0 за запуск;
3. timeout;
4. duplicate start, когда route уже выполняется (409).

## 8. Где смотреть логи

### 8.1 В n8n UI

1. Executions
2. выбрать нужный запуск
3. открыть node
4. смотреть Output, Error и JSON

### 8.2 В Docker

Логи всех сервисов:

docker compose -f n8n/docker-compose.yml logs -f --tail=200

Только n8n:

docker logs -f n8n

Только runner:

docker logs -f n8n-runner

### 8.3 Локальные файлы состояния

1. playwright/apply-rotation-state.json
2. chat-auto/state.json
3. chat-auto/automation-log.jsonl
4. chat-auto/reports/

## 9. Диагностика типовых ошибок

### 9.1 Authorization failed

Симптом:

1. HTTP node получает 401/authorization failed.

Проверка:

1. RUNNER_AUTH_TOKEN должен быть и в runner, и в n8n environment.
2. Header в HTTP node должен быть Bearer {{$env.RUNNER_AUTH_TOKEN}}.

### 9.2 ECONNABORTED timeout 300000ms

Симптом:

1. нода HTTP Request падает через 5 минут.

Причина:

1. дефолтный timeout n8n слишком короткий для долгого apply-run.

Решение:

1. увеличить timeout в options ноды Run Daily Apply Batch.

### 9.3 ECONNRESET socket hang up

Симптом:

1. обрыв соединения между n8n и runner.

Причины:

1. перезапуск runner во время активного запроса;
2. сетевой флап;
3. параллельные запуски.

Решение:

1. не перезапускать runner во время активного daily-run;
2. использовать retryOnFail на HTTP node;
3. использовать route lock (already_running).

### 9.4 Быстрый success без отправок

Симптом:

1. run завершился очень быстро, отправок нет.

Причины:

1. скрипт не нашел пригодные карточки;
2. серия неудач и нет следующей страницы;
3. лимиты и ограничения интерфейса.

Что проверять:

1. stdout в ответе runner;
2. sentByResumeId и lastSentCount в apply-rotation-state.json;
3. актуальность cookies.

### 9.5 Playwright executable missing

Симптом:

1. browserType.launch executable does not exist.

Причина:

1. несоответствие версии Playwright в проекте и образа runner.

Решение:

1. использовать образ mcr.microsoft.com/playwright той же major/minor версии, что и в проекте.

## 10. Операционный чеклист перед ежедневным режимом

1. Smoke workflow прошел успешно.
2. runner health отвечает ok.
3. cookies валидны.
4. apply-rotation-state.json существует и выглядит адекватно.
5. workflows, которые должны работать по cron, переведены в Active.
6. нет параллельных ручных запусков apply во время активного cron-run.

## 11. Чеклист при подозрении на зависание

1. Проверить процессы внутри runner:

docker exec n8n-runner sh -lc "ps -eo pid,ppid,etime,pcpu,pmem,cmd | grep -E 'run-rotating-batch|hh-auto-respond|chrome-headless' | grep -v grep"

2. Если route уже бежит, второй запуск не делать.
3. Проверить, растет ли лог попыток в stdout ответа/логах runner.
4. Если это явный deadlock и нужно остановить:

docker exec n8n-runner sh -lc "pkill -f run-rotating-batch.js || true; pkill -f hh-auto-respond.js || true"

5. Запустить один чистый run после остановки.

## 12. Как переносить на другую машину (например Orange Pi)

Минимальная схема:

1. скопировать проект;
2. перенести n8n/.env;
3. перенести playwright/cookies.json;
4. перенести playwright/resumes.json;
5. перенести playwright/apply-rotation-state.json, если нужен continuity;
6. поднять docker compose up -d;
7. открыть n8n по IP новой машины.

Важно:

1. на слабом железе не повышать нагрузку;
2. не запускать много параллельных процессов;
3. периодически проверять память и доступность контейнеров.

## 13. Безопасные практики

1. Не коммитить n8n/.env.
2. Не коммитить cookies и runtime state.
3. Регулярно ротировать чувствительные токены.
4. Перед массовым прогоном всегда делать короткий smoke.
5. Не запускать apply и heavy-debug параллельно.

## 14. FAQ

### Нужно ли перезапускать n8n после изменения логики в runner?

Обычно нет. Достаточно пересоздать runner, если URL и контракт ответа не изменились.

### Можно ли запускать вручную без n8n?

Да. Скрипты можно запускать напрямую из терминала. n8n только оркестратор.

### Что делать, если apply cycle идет, но долго без успеха?

1. смотреть stdout в runner;
2. убедиться, что не заблокированы элементы в UI HH;
3. обновить cookies;
4. снизить maxAttempts или усилить stop-условия.

### Почему n8n показывает успех, хотя отправок мало?

Нужно смотреть не только статус ноды, но и lastSentCount/sentByResumeId. Статус отражает технический исход запуска, а бизнес-прогресс хранится в state.

## 15. Команды быстрого доступа

Проверка контейнеров:

docker compose -f n8n/docker-compose.yml ps

Рестарт только runner:

docker compose -f n8n/docker-compose.yml up -d --force-recreate runner

Проверка health runner из n8n:

docker exec n8n node -e "fetch('http://runner:3001/health').then(async r=>{console.log(r.status);console.log(await r.text())})"

Проверка состояния ротации:

docker exec n8n-runner cat /files/hh-auto-clicker/playwright/apply-rotation-state.json

Список workflow:

docker exec n8n n8n list:workflow

---

Если этот документ передается другому человеку, рекомендуемый порядок чтения:

1. Разделы 1-5 для понимания архитектуры и запуска.
2. Раздел 6 для логики ротации резюме.
3. Разделы 8-11 для эксплуатации и аварийных кейсов.
4. Раздел 15 как ежедневная шпаргалка.
