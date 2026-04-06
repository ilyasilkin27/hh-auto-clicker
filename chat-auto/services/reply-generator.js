import { config } from '../core/config.js'
import { loadResumeContext } from './resume-context.js'

const normalizeText = value =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const enforceMaleVoice = text =>
  String(text || '')
    .replaceAll('готов(а)', 'готов')
    .replaceAll('готова', 'готов')
    .replaceAll('смогла', 'смог')
    .replaceAll('работала', 'работал')
    .replaceAll('делала', 'делал')

const makeConcise = text => {
  const normalized = normalizeText(text)
  if (!normalized) {
    return ''
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map(item => item.trim())
    .filter(Boolean)

  const shortBySentences = sentences.slice(0, 4).join(' ')
  return shortBySentences.slice(0, 520).trim()
}

const isQuestionnaireOrTestRequest = text => {
  const normalized = normalizeText(text).toLowerCase()

  const strongPatterns = [
    /тестовое\s+задани/,
    /выполн(ить|ите)\s+тест/,
    /сдела(ть|йте)\s+тест/,
    /заполн(ить|ите)\s+анкет/,
    /пройд(ите|и)\s+опрос/,
    /дедлайн.*тестов/,
    /пришл(ите|ите)\s+решени/,
    /questionnaire|assessment|take[-\s]?home\s+task/i,
  ]

  return strongPatterns.some(pattern => pattern.test(normalized))
}

const buildContactBundle = () => {
  const telegram = config.contactTelegram || ''
  const email = config.contactEmail || ''
  const github = config.contactGithub || ''
  const portfolio = config.portfolioUrl || ''

  return [
    telegram ? `Telegram: ${telegram}` : '',
    email ? `Email: ${email}` : '',
    github ? `GitHub: ${github}` : '',
    portfolio ? `Портфолио: ${portfolio}` : '',
  ]
    .filter(Boolean)
    .join('; ')
}

const ensureContactsForTestFlow = ({ messageText, replyText }) => {
  const text = String(replyText || '').trim()
  if (!isQuestionnaireOrTestRequest(messageText)) {
    return text
  }

  const contacts = buildContactBundle()
  const hasTelegram = /t\.me|telegram/iu.test(text)
  const hasEmail = /@[^\s]+\.[^\s]+/.test(text)
  const hasGithub = /github\.com/iu.test(text)
  const hasPortfolio = /portfolio|vercel\.app/iu.test(text)

  if (hasTelegram && hasEmail && hasGithub && hasPortfolio) {
    return text
  }

  const base = text || 'Готов обсудить опыт и следующий этап.'
  return `${base} Контакты: ${contacts}.`
}

const buildCoreAnswer = messageText => {
  const text = normalizeText(messageText)

  if (/рассмотрим\s+ваше\s+резюме|если\s+навыки\s+и\s+опыт\s+подойдут.*свяжемся/iu.test(text)) {
    return `Спасибо! Если будет актуально, буду на связи в Telegram: ${config.contactTelegram}.`
  }

  if (/зарплат|вилка|salary|compensation|ожидани[яй]\s+по\s+зарплат|зарплатн[ыео]\s+ожид/i.test(text)) {
    return 'По компенсации ориентируюсь на 200000 руб. на руки, финально зависит от зоны ответственности и формата работы.'
  }

  if (isQuestionnaireOrTestRequest(text)) {
    return `Спасибо за предложение. Анкеты и тестовые на этом этапе не выполняю, но готов обсудить релевантный опыт и сразу перейти к интервью. Контакты: ${buildContactBundle()}.`
  }

  if (/стек|технолог|react|typescript|node|vue/i.test(text)) {
    return 'По стеку есть практический опыт с React/TypeScript, архитектурой SPA и интеграциями с API; готов(а) быстро влиться в текущий стек команды.'
  }

  if (/какие\s+пример|пример\s+проект|как\s+работал.*react|опыт\s+react|опыт\s+typescript/i.test(text)) {
    return 'В Альфа-Банке я делал визуальный редактор сценариев на React/TypeScript/Next.js с drag-and-drop, где релизы сценариев ускорились с 4-5 дней до 1 дня. Также реализовал real-time дашборды на WebSocket и покрыл критические части Jest/RTL.'
  }

  if (/когда|доступ|start|выход/i.test(text)) {
    return 'По срокам старта могу согласовать выход в ближайшее время после финальных этапов.'
  }

  return `Спасибо за подробности, вакансия интересная. По стеку и задачам у меня релевантный опыт 5+ лет, готов обсудить детали и ожидания по роли. Если удобно, продолжим в Telegram: ${config.contactTelegram}.`
}

const buildFollowup = messageText => {
  const text = normalizeText(messageText)

  if (/собесед|интервью|звонок/i.test(text)) {
    return 'какой формат и длительность следующего этапа интервью'
  }

  if (/тестов|задани/i.test(text)) {
    return 'какой ожидаемый срок выполнения тестового задания'
  }

  return 'когда вам удобно продолжить общение и назначить следующий шаг'
}

const applyTemplate = ({ vacancyTitle, coreAnswer, followupQuestion }) =>
  config.responseTemplate
    .replaceAll('{{vacancyTitle}}', vacancyTitle || 'без названия')
    .replaceAll('{{coreAnswer}}', coreAnswer)
    .replaceAll('{{followupQuestion}}', followupQuestion)

const buildUserPrompt = ({ message, resumeContext }) => {
  const resumeBlock = resumeContext
    ? `\n\nФакты из резюме кандидата (используй как источник правды):\n${resumeContext}`
    : ''

  return `Кандидат: ${config.candidateName}\nВакансия: ${message.vacancyTitle}\nСообщение работодателя: ${message.messageText}${resumeBlock}`
}

const looksLikeEmployerVoice = text => {
  const normalized = normalizeText(text)

  const patterns = [
    /рассмотрим\s+ваше\s+резюме/iu,
    /мы\s+не\s+готовы\s+пригласить/iu,
    /благодарим\s+за\s+отклик/iu,
    /с\s+уважением,\s*(команда|hr|менеджер|рекрутер)/iu,
    /ваш\s+отклик\s+заинтересует/iu,
  ]

  return patterns.some(pattern => pattern.test(normalized))
}

const enforceCandidateVoice = ({ message, generated, fallback }) => {
  const text = String(generated?.replyText || '').trim()

  if (!text || looksLikeEmployerVoice(text)) {
    return {
      ...fallback,
      confidence: Math.min(fallback.confidence, 0.74),
      meta: {
        ...(generated?.meta || {}),
        provider: fallback.meta.provider,
        voiceGuard: 'fallback_template',
      },
    }
  }

  const withContacts = ensureContactsForTestFlow({
    messageText: message.messageText,
    replyText: text,
  })
  const normalizedReplyText = isQuestionnaireOrTestRequest(message.messageText)
    ? normalizeText(enforceMaleVoice(withContacts))
    : makeConcise(enforceMaleVoice(withContacts))

  return {
    ...generated,
    replyText: normalizedReplyText,
  }
}

const templateReply = message => {
  const coreAnswer = buildCoreAnswer(message.messageText)
  const followupQuestion = buildFollowup(message.messageText)
  const signature = `С уважением, ${config.candidateName}`
  const replyText = applyTemplate({
    vacancyTitle: message.vacancyTitle,
    coreAnswer,
    followupQuestion,
  })
    .replace(/С уважением,\s*Илья/g, signature)
    .replace(/Если удобно, подскажите, пожалуйста:[^\n]+/g, '')

  const withContacts = ensureContactsForTestFlow({
    messageText: message.messageText,
    replyText,
  })
  const normalizedReplyText = isQuestionnaireOrTestRequest(message.messageText)
    ? normalizeText(enforceMaleVoice(withContacts))
    : makeConcise(enforceMaleVoice(withContacts))

  const confidence = message.messageText.trim().length > 20 ? 0.78 : 0.62

  return {
    replyText: normalizedReplyText,
    confidence,
    meta: {
      provider: 'template',
      systemPrompt: config.systemPrompt,
    },
  }
}

const openAiReply = async message => {
  const resumeContext = await loadResumeContext()

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openAiModel,
      input: [
        {
          role: 'system',
          content: config.systemPrompt,
        },
        {
          role: 'user',
          content: buildUserPrompt({ message, resumeContext }),
        },
      ],
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    throw new Error(`openai_failed:${response.status}`)
  }

  const body = await response.json()
  const outputText = String(body?.output_text || '').trim()

  return {
    replyText: outputText,
    confidence: outputText.length > 30 ? 0.82 : 0.58,
    meta: {
      provider: 'openai',
      model: config.openAiModel,
    },
  }
}

const groqReply = async message => {
  const resumeContext = await loadResumeContext()

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model: config.groqModel,
      messages: [
        {
          role: 'system',
          content: config.systemPrompt,
        },
        {
          role: 'user',
          content: buildUserPrompt({ message, resumeContext }),
        },
      ],
      temperature: 0.2,
    }),
  })

  if (!response.ok) {
    throw new Error(`groq_failed:${response.status}`)
  }

  const body = await response.json()
  const outputText = String(body?.choices?.[0]?.message?.content || '').trim()

  return {
    replyText: outputText,
    confidence: outputText.length > 30 ? 0.84 : 0.6,
    meta: {
      provider: 'groq',
      model: config.groqModel,
    },
  }
}

export const generateReply = async message => {
  const fallback = templateReply(message)

  if (config.aiProvider === 'groq' && config.groqApiKey) {
    const generated = await groqReply(message)
    return enforceCandidateVoice({ message, generated, fallback })
  }

  if (config.aiProvider === 'openai' && config.openAiApiKey) {
    const generated = await openAiReply(message)
    return enforceCandidateVoice({ message, generated, fallback })
  }

  return fallback
}
