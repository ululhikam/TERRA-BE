import { env } from '../config/env.js'

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'secret',
  'smtppass',
  'resendapikey'
])

function redactMeta(value: any, depth = 0): any {
  if (value == null || depth > 4) return value
  if (Array.isArray(value)) return value.map((item) => redactMeta(item, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redactMeta(v, depth + 1)
    }
    return out
  }
  return value
}

function formatEntry(level: string, message: string, meta: Record<string, any> = {}): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    env: env.nodeEnv,
    message,
    ...redactMeta(meta)
  })
}

export const logger = {
  info(message: string, meta: Record<string, any> = {}) {
    if (env.nodeEnv === 'test') return
    console.info(formatEntry('info', message, meta))
  },
  warn(message: string, meta: Record<string, any> = {}) {
    if (env.nodeEnv === 'test') return
    console.warn(formatEntry('warn', message, meta))
  },
  error(message: string, meta: Record<string, any> = {}) {
    if (env.nodeEnv === 'test' && !process.env.DEBUG_TESTS) return
    console.error(formatEntry('error', message, meta))
  },
  debug(message: string, meta: Record<string, any> = {}) {
    if (env.nodeEnv !== 'development') return
    console.debug(formatEntry('debug', message, meta))
  }
}
