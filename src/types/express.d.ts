import 'express'
import type { AuthUser } from './domain.js'

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      id?: string
      user?: AuthUser
      requestId?: string
      resolvedEventId?: string
      orgMember?: any
      validatedBody?: any
      validatedQuery?: any
      validatedParams?: any
      file?: any
      files?: any
    }
  }
}

export {}
