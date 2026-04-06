# Data Contract

Единый формат сообщения/результата (JSON):

```json
{
  "chatId": "string",
  "messageId": "string",
  "senderType": "candidate|recruiter|unknown",
  "vacancyTitle": "string",
  "messageText": "string",
  "receivedAt": "ISO-8601",
  "confidence": 0.0,
  "replyText": "string",
  "status": "new|draft_only|sent|manual_review|skipped_duplicate|fail",
  "errorReason": "string"
}
```

Поля обязательны на выходе каждого шага. На входе poll обязательны:

- `chatId`
- `messageId`
- `senderType`
- `vacancyTitle`
- `messageText`
- `receivedAt`
