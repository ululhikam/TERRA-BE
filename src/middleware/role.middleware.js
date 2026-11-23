import { AppError } from '../utils/response.js'
import * as db from '../repositories/db.js'

export const ALL_EVENT_PERMISSIONS = db.ALL_EVENT_PERMISSIONS

export async function getUserEventPermissions(user, eventId) {
  return db.getUserEventPermissions(user, eventId)
}

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

export function requireEventPermission(permissionKey) {
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED'))
      if (req.user.role === 'admin') return next()

      const eventId = req.params.eventId || req.params.id || req.body?.event_id
      if (!eventId) return next()

      const perms = await db.getUserEventPermissions(req.user, eventId)
      if (!perms.includes(permissionKey)) {
        return next(
          new AppError(
            `Akses ditolak: Anda tidak memiliki izin "${permissionKey}" untuk event ini.`,
            403,
            'FORBIDDEN_PERMISSION'
          )
        )
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

export function requireOrgMembership(req, _res, next) {
  ;(async () => {
    if (!req.user) return next(new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED'))
    if (req.user.role === 'admin') return next()

    const orgId = req.params.orgId || req.params.id || req.body?.organization_id
    if (!orgId) return next()

    const { allowed } = await db.isOrgMember(orgId, req.user)
    if (!allowed) {
      return next(new AppError('Akses ditolak: Anda bukan anggota organisasi ini.', 403, 'ORG_FORBIDDEN'))
    }
    next()
  })().catch(next)
}
