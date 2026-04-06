# Эксплуатация Chat Auto Cycle

Подробная документация по n8n-оркестрации и daily-циклам:

- [n8n/N8N_DETAILED_GUIDE.md](../n8n/N8N_DETAILED_GUIDE.md)

## 1) Запуск

```bash
npm run chat:process
```

Для n8n импортируйте workflow из `n8n/workflows/chat-auto-orchestration.json`.

## 2) Остановка

- Для локального cron/systemd: остановить сервис/таймер.
- Для n8n: перевести workflow в `Inactive`.

## 3) Обновление

1. Сделать бэкап файлов состояния.
2. Обновить код.
3. Запустить `npm run chat:test:e2e`.
4. Перезапустить оркестратор.

## 4) Бэкап

Минимальный набор:

- `chat-auto/state.json`
- `chat-auto/automation-log.jsonl`
- `chat-auto/reports/*.json`
- `chat-auto/mock-outbox.json` (если используется mock)

Пример:

```bash
tar -czf backup-chat-auto-$(date +%F).tar.gz chat-auto/state.json chat-auto/automation-log.jsonl chat-auto/reports chat-auto/mock-outbox.json
```

## 5) Восстановление

1. Остановить workflow.
2. Восстановить `state.json` и лог-файлы из архива.
3. Запустить `npm run chat:poll` и убедиться, что дубликаты не появляются.
4. Включить workflow.

## 6) Режимы

- `AUTO_MODE=safe`: только draft, отправка вручную через approve.
- `AUTO_MODE=full`: автоотправка + fallback в manual при рисках/лимитах/ошибках.

Переключение режима одной переменной:

```bash
AUTO_MODE=full npm run chat:process
```

## 7) Pilot и переход в full-auto

- Pilot: 2-3 дня в `safe` режиме.
- Цель: доля ручных правок < 20%.
- После достижения цели переключить в `full`.
- Первые 7 дней full-auto мониторить алерты и ежедневные отчеты.

## 8) Ручной approve

```bash
npm run chat:approve -- --messageId <MESSAGE_ID>
```

## 9) Отчет эффективности

```bash
npm run chat:report
```

Отчет содержит:

- newChats
- autoReplies
- escalations
- errors

## 10) n8n локально (daily orchestration)

1. Подготовить env:

```bash
cp n8n/.env.example n8n/.env
```

2. Проверить ключевые поля в `n8n/.env`:

- `AUTO_MODE=safe` на этапе пилота
- `CHAT_ADAPTER=playwright`
- `COOKIES_PATH=./playwright/cookies.json`
- `AI_PROVIDER` и ключи (`GROQ_API_KEY` или `OPENAI_API_KEY`)

3. Запустить n8n + postgres:

```bash
cd n8n
docker compose up -d
```

4. Открыть UI: `http://localhost:5678`.
5. Импортировать workflow: `n8n/workflows/chat-auto-orchestration.json`.
6. Нажать `Execute workflow` для ручной проверки через узел `Manual Run Trigger`.
7. После успешного прогона перевести workflow в `Active`.

Примечание: контейнер n8n запускает команды внутри смонтированного проекта `/files/hh-auto-clicker`, поэтому изменения кода и env подхватываются без пересборки образа.

## 11) n8n локально (daily отклики)

Импортируйте второй workflow:

- `n8n/workflows/apply-daily-orchestration.json`

Он запускает команду:

```bash
npm run -s start:pw:batch:daily
```

Параметры daily-пакета:

1. источник резюме: `./playwright/resumes.json`
2. `--concurrency 2` (два резюме параллельно)
3. `--max 100` (до 100 откликов на каждое резюме)
4. `--maxAttempts 400`
5. `--maxFailStreak 10`

Рекомендация:

1. Сначала сделать ручной запуск через `Manual Apply Trigger`
2. Проверить логи выполнения
3. Только после этого включать workflow в `Active`
