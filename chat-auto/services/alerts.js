import { config } from '../core/config.js'

const sendTelegramAlert = async text => {
  if (!config.alertTelegramBotToken || !config.alertTelegramChatId) {
    return
  }

  const url = `https://api.telegram.org/bot${config.alertTelegramBotToken}/sendMessage`

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: config.alertTelegramChatId,
      text,
      disable_web_page_preview: true,
    }),
  }).catch(() => {})
}

const sendWebhookAlert = async payload => {
  if (!config.alertWebhookUrl) {
    return
  }

  await fetch(config.alertWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }).catch(() => {})
}

export const sendAlert = async ({ level, message, details }) => {
  const payload = {
    level,
    message,
    details,
    at: new Date().toISOString(),
  }

  const text = `[${level}] ${message}\n${JSON.stringify(details || {})}`

  await Promise.all([sendTelegramAlert(text), sendWebhookAlert(payload)])
}
