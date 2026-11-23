import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env.js'
import { supabaseAdmin, isSupabaseEnabled } from '../config/supabase.js'
import { verifyOAuthToken } from '../config/passport.js'
import * as db from '../repositories/db.js'
import { store } from '../repositories/store.js'
import { AppError } from '../utils/response.js'
import type { AuthUser } from '../types/domain.js'

function isDemoTokenAllowed(): boolean {
  const nodeEnv = process.env.NODE_ENV || env.nodeEnv
  if (nodeEnv === 'production') return false
  return nodeEnv === 'test' || !isSupabaseEnabled || process.env.ALLOW_DEMO_TOKENS === 'true'
}

function assertNotSuspended(user?: AuthUser | null) {
  if (user?.is_suspended) {
    throw new AppError('Akun Anda sedang ditangguhkan oleh Administrator.', 403, 'ACCOUNT_SUSPENDED')
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || ''
    if (!authHeader.startsWith('Bearer ')) {
      throw new AppError('Token autentikasi tidak ditemukan.', 401, 'UNAUTHORIZED')
    }
    const token = authHeader.slice(7).trim()

    // Support Passport.js Google OAuth / invite stateless signed tokens
    if (token.startsWith('oauth-jwt.')) {
      const oauthUser = verifyOAuthToken(token)
      if (!oauthUser) {
        throw new AppError('Sesi Google OAuth tidak valid atau kedaluwarsa.', 401, 'INVALID_TOKEN')
      }
      const stored = await db.findUserByIdOrEmail(oauthUser.id, oauthUser.email, oauthUser.role)
      const resolvedUser = (stored || oauthUser) as AuthUser
      assertNotSuspended(resolvedUser)
      req.user = resolvedUser
      return next()
    }

    // Support Supabase JWT verification when configured
    if (isSupabaseEnabled && supabaseAdmin && !token.startsWith('demo-token-')) {
      const { data, error } = await supabaseAdmin.auth.getUser(token)
      if (error || !data?.user) {
        throw new AppError('Sesi tidak valid atau telah kedaluwarsa.', 401, 'INVALID_TOKEN')
      }
      const roleHint = data.user.user_metadata?.role || null
      const stored = await db.findUserByIdOrEmail(data.user.id, data.user.email, roleHint)
      const resolvedUser = (stored || {
        id: data.user.id,
        email: data.user.email || '',
        full_name: data.user.user_metadata?.full_name || data.user.email || 'User',
        role: data.user.user_metadata?.role || 'customer'
      }) as AuthUser
      assertNotSuspended(resolvedUser)
      req.user = resolvedUser
      return next()
    }

    // Demo / integration-test token mapping (strictly disabled in production)
    if (isDemoTokenAllowed()) {
      if (token === 'demo-token-admin') {
        req.user = ((await db.findUserById('usr-admin')) || store.users.find((u) => u.role === 'admin')) as AuthUser
        assertNotSuspended(req.user)
        return next()
      }
      if (token === 'demo-token-organizer') {
        req.user = ((await db.findUserById('usr-organizer')) || store.users.find((u) => u.role === 'organizer')) as AuthUser
        assertNotSuspended(req.user)
        return next()
      }
      if (token === 'demo-token-customer') {
        req.user = ((await db.findUserById('usr-customer')) || store.users.find((u) => u.role === 'customer')) as AuthUser
        assertNotSuspended(req.user)
        return next()
      }
    }

    throw new AppError('Token tidak valid.', 401, 'INVALID_TOKEN')
  } catch (err) {
    next(err)
  }
}

export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) return next()
  return requireAuth(req, res, next)
}
