import { AppError } from '../utils/response.js'
import { store } from '../repositories/store.js'

export function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED'))
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('Anda tidak memiliki hak akses untuk resource ini.', 403, 'FORBIDDEN'))
    }
    next()
  }
}

export const requireAdmin = requireRole('admin')
export const requireOrganizerOrAdmin = requireRole('organizer', 'admin')

export function requireOrgMembership(req, _res, next) {
  if (!req.user) return next(new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED'))
  if (req.user.role === 'admin') return next()

  const orgId = req.params.orgId || req.params.id || req.body?.organization_id
  if (!orgId) return next()

  const org = store.organizations.find((o) => o.id === orgId)
  if (!org) return next(new AppError('Organisasi tidak ditemukan.', 404, 'ORG_NOT_FOUND'))

  const isMember = org.members.some((m) => m.user_id === req.user.id && m.status === 'active')
  if (!isMember && org.created_by !== req.user.id) {
    return next(new AppError('Akses ditolak: Anda bukan anggota organisasi ini.', 403, 'ORG_FORBIDDEN'))
  }
  next()
}
