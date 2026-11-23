import multer from 'multer'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'
import { AppError, sendError } from '../utils/response.js'

export function notFoundHandler(req, _res, next) {
  next(new AppError(`Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`, 404, 'ROUTE_NOT_FOUND'))
}

function mapPrismaError(err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : 'field'
      return {
        statusCode: 409,
        code: 'DUPLICATE_RECORD',
        message: `Data duplikat pada ${target}. Silakan gunakan nilai yang berbeda.`
      }
    }
    if (err.code === 'P2025') {
      return {
        statusCode: 404,
        code: 'RECORD_NOT_FOUND',
        message: 'Data yang diminta tidak ditemukan di database.'
      }
    }
    if (err.code === 'P2003') {
      return {
        statusCode: 400,
        code: 'INVALID_REFERENCE',
        message: 'Referensi data relasional tidak valid.'
      }
    }
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return {
      statusCode: 400,
      code: 'DATABASE_VALIDATION_ERROR',
      message: 'Format payload database tidak valid.'
    }
  }
  return null
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof multer.MulterError) {
    const isTooLarge = err.code === 'LIMIT_FILE_SIZE'
    return sendError(res, {
      statusCode: isTooLarge ? 413 : 400,
      code: isTooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
      message: isTooLarge ? 'Ukuran file maksimal 4MB.' : err.message,
      details: []
    })
  }

  const mapped = mapPrismaError(err)
  let statusCode = mapped?.statusCode || err.statusCode || 500
  let code = mapped?.code || err.code || 'INTERNAL_SERVER_ERROR'
  let message = mapped?.message || err.message || 'Terjadi kesalahan pada server.'
  let details = err.details || []

  if (err instanceof ZodError) {
    statusCode = 422
    code = 'VALIDATION_ERROR'
    message = 'Data input tidak valid.'
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  } else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400
    code = 'INVALID_JSON'
    message = 'Payload JSON tidak valid atau rusak.'
  } else if (typeof message === 'string' && message.includes('CORS policy')) {
    statusCode = 403
    code = 'CORS_FORBIDDEN'
  }

  if (statusCode >= 500) {
    logger.error('Unhandled server error', {
      requestId: res.locals?.requestId,
      method: req.method,
      path: req.originalUrl,
      code,
      errorMessage: message,
      stack: env.nodeEnv === 'production' ? undefined : err.stack
    })
    if (env.nodeEnv === 'production') {
      message = 'Terjadi kesalahan internal pada server.'
    }
  } else {
    logger.warn('Operational request error', {
      requestId: res.locals?.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode,
      code,
      errorMessage: message
    })
  }

  return sendError(res, { statusCode, code, message, details })
}
