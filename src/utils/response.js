export class AppError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_REQUEST', details = []) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function sendSuccess(res, data, message = 'Operation successful', statusCode = 200, meta = undefined) {
  const body = {
    success: true,
    message,
    data
  }
  if (meta) {
    body.meta = meta
  }
  return res.status(statusCode).json(body)
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}
