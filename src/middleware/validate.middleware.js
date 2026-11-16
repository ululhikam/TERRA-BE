import { AppError } from '../utils/response.js'

export function validateBody(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return next(
        new AppError(
          'Data input tidak valid.',
          422,
          'VALIDATION_ERROR',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        )
      )
    }
    req.validatedBody = parsed.data
    next()
  }
}
