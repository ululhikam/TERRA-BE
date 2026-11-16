import { supabaseAdmin, isSupabaseEnabled } from '../config/supabase.js'
import { store } from '../repositories/store.js'
import { AppError } from '../utils/response.js'

export async function requireAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || ''
    if (!authHeader.startsWith('Bearer ')) {
      throw new AppError('Token autentikasi tidak ditemukan.', 401, 'UNAUTHORIZED')
    }
    const token = authHeader.slice(7).trim()

    // Support Supabase JWT verification when configured
    if (isSupabaseEnabled && supabaseAdmin && !token.startsWith('demo-token-')) {
      const { data, error } = await supabaseAdmin.auth.getUser(token)
      if (error || !data?.user) {
        throw new AppError('Sesi tidak valid atau telah kedaluwarsa.', 401, 'INVALID_TOKEN')
      }
      req.user = {
        id: data.user.id,
        email: data.user.email,
        full_name: data.user.user_metadata?.full_name || data.user.email,
        role: data.user.user_metadata?.role || 'customer'
      }
      return next()
    }

    // Demo / integration-test token mapping
    if (token === 'demo-token-admin') {
      req.user = store.users.find((u) => u.role === 'admin')
      return next()
    }
    if (token === 'demo-token-organizer') {
      req.user = store.users.find((u) => u.role === 'organizer')
      return next()
    }
    if (token === 'demo-token-customer') {
      req.user = store.users.find((u) => u.role === 'customer')
      return next()
    }

    throw new AppError('Token tidak valid.', 401, 'INVALID_TOKEN')
  } catch (err) {
    next(err)
  }
}

export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) return next()
  return requireAuth(req, res, next)
}
