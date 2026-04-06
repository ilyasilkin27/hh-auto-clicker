import { config } from './config.js'

const STOP_TOPIC_PATTERNS = [
  /паспортн|серия\s+и\s+номер\s+паспорта|инн|снилс/i,
  /card|cvv|cvc|банковск\w*\s+карт|криптокошел|seed\s*phrase|private\s*key/i,
  /(ваш|твой)\s+парол|парол[ья]\s+от\s+(почт|банка|аккаунт|телеграм|госуслуг)/i,
  /политик|религ|экстрем|hate|насили/i,
  /18\+|эрот|sex|интим/i,
]

const JS_STACK_PATTERNS = [
  /javascript|java\s*script|typescript|node\.?js|nodejs|react|vue|nuxt|next\.?js|nestjs|express|frontend|front-end|fullstack|full-stack|ecmascript|graphql/i,
]

const NON_JS_STACK_PATTERNS = [
  /\bios\b|\bswift\b|objective-?c|\bc\+\+\b|\bc#\b|\bkotlin\b|\bjava\b(?!\s*script)|\bandroid\b|\b1c\b|\.net|dotnet|asp\.?net|\bphp\b|\blaravel\b|\bruby\b|\brails\b|\bpython\b|\bdjango\b|\bflask\b|\bgolang\b|\bgo\s+developer\b/i,
]

export const detectRisk = ({ vacancyTitle, messageText, confidence }) => {
  if (!messageText?.trim()) {
    return { blocked: true, reason: 'empty_message' }
  }

  const matchedPattern = STOP_TOPIC_PATTERNS.find(pattern =>
    pattern.test(messageText),
  )

  if (matchedPattern) {
    return { blocked: true, reason: 'stop_topic' }
  }

  if (config.onlyJsStack) {
    const stackText = `${vacancyTitle || ''} ${messageText || ''}`
    const hasNonJsStackSignal = NON_JS_STACK_PATTERNS.some(pattern =>
      pattern.test(stackText),
    )
    const hasJsStackSignal = JS_STACK_PATTERNS.some(pattern => pattern.test(stackText))

    if (hasNonJsStackSignal) {
      return { blocked: true, reason: 'stack_mismatch_non_js' }
    }

    if (!hasJsStackSignal) {
      return { blocked: true, reason: 'stack_unknown_not_js' }
    }
  }

  if (typeof confidence === 'number' && confidence < 0.5) {
    return { blocked: true, reason: 'low_confidence_hard_block' }
  }

  return { blocked: false, reason: '' }
}
