import { AppError } from '../utils/response.js'

export function notFoundHandler(req, _res, next) {
  next(new AppError(`Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`, 404, 'ROUTE_NOT_FOUND'))
}

export function errorHandler(err, _req, res, _next) {
  const statusCode = err.statusCode || 500
  const code = err.code || 'INTERNAL_SERVER_ERROR'
  const message = err.message || 'Terjadi kesalahan pada server.'

  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details: err.details || []
    }
  })
}
