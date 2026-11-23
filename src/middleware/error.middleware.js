import multer from 'multer'
import { Prisma } from '@prisma/client'
import { AppError } from '../utils/response.js'

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

export function errorHandler(err, _req, res, _next) {
  if (err instanceof multer.MulterError) {
    const isTooLarge = err.code === 'LIMIT_FILE_SIZE'
    return res.status(isTooLarge ? 413 : 400).json({
      success: false,
      error: {
        code: isTooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
        message: isTooLarge ? 'Ukuran file maksimal 4MB.' : err.message,
        details: []
      }
    })
  }
  const mapped = mapPrismaError(err)
  const statusCode = mapped?.statusCode || err.statusCode || 500
  const code = mapped?.code || err.code || 'INTERNAL_SERVER_ERROR'
  const message = mapped?.message || err.message || 'Terjadi kesalahan pada server.'

  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details: err.details || []
    }
  })
}
