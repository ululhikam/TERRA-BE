import type { Request, Response, NextFunction, RequestHandler } from 'express'

export class AppError extends Error {
  statusCode: number
  code: string
  details: any[]
  isOperational: boolean

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST', details: any[] = []) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
    this.isOperational = true
    Error.captureStackTrace?.(this, this.constructor)
  }
}

export function sendSuccess(
  res: Response,
  data: any,
  message = 'Operation successful',
  statusCode = 200,
  meta: any = undefined
) {
  const body: Record<string, any> = {
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
  res: Response,
  {
    statusCode = 500,
    code = 'INTERNAL_SERVER_ERROR',
    message = 'Terjadi kesalahan pada server.',
    details = []
  }: {
    statusCode?: number
    code?: string
    message?: string
    details?: any[]
  }
) {
  const body: Record<string, any> = {
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

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any> | any
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next)
}
