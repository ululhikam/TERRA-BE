import crypto from 'node:crypto'
import { logger } from '../utils/logger.js'

export function requestLogger(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID()
  const startedAt = process.hrtime.bigint()

  req.id = String(requestId)
  res.locals.requestId = req.id
  res.setHeader('X-Request-Id', req.id)

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    const meta = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      userId: req.user?.id || null,
      ip: req.ip
    }

    if (res.statusCode >= 500) {
      logger.error('HTTP request failed', meta)
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP request warning', meta)
    } else {
      logger.info('HTTP request completed', meta)
    }
  })

  next()
}
