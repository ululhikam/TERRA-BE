export class AppError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_REQUEST', details = []) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
    this.isOperational = true
    Error.captureStackTrace?.(this, this.constructor)
  }
}

export function sendSuccess(res, data, message = 'Operation successful', statusCode = 200, meta = undefined) {
  const body = {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  }
  if (res.locals?.requestId) {
    body.requestId = res.locals.requestId
  }
  if (meta) {
    body.meta = meta
  }
  return res.status(statusCode).json(body)
}

export function sendError(
  res,
  { statusCode = 500, code = 'INTERNAL_SERVER_ERROR', message = 'Terjadi kesalahan pada server.', details = [] }
) {
  const body = {
    success: false,
    error: {
      code,
      message,
      details
    },
    timestamp: new Date().toISOString()
  }
  if (res.locals?.requestId) {
    body.requestId = res.locals.requestId
  }
  return res.status(statusCode).json(body)
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}
