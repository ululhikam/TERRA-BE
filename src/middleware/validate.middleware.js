import { AppError } from '../utils/response.js'

function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code
  }))
}

export function validateBody(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return next(
        new AppError('Data input body tidak valid.', 422, 'VALIDATION_ERROR', formatZodIssues(parsed.error))
      )
    }
    req.validatedBody = parsed.data
    next()
  }
}

export function validateQuery(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return next(
        new AppError('Parameter query tidak valid.', 422, 'VALIDATION_ERROR', formatZodIssues(parsed.error))
      )
    }
    req.validatedQuery = parsed.data
    next()
  }
}

export function validateParams(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.params)
    if (!parsed.success) {
      return next(
        new AppError('Parameter URL tidak valid.', 422, 'VALIDATION_ERROR', formatZodIssues(parsed.error))
      )
    }
    req.validatedParams = parsed.data
    next()
  }
}
