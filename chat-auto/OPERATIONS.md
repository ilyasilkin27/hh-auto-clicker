# Эксплуатация Chat Auto Cycle

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
