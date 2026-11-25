import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { AppError } from '../utils/response.js'
import * as db from '../repositories/db.js'
import * as pricingDb from '../repositories/pricing.db.js'
import type { AuthUser, UserRole } from '../types/domain.js'

export const ALL_EVENT_PERMISSIONS = db.ALL_EVENT_PERMISSIONS

export async function getUserEventPermissions(user: AuthUser | null | undefined, eventId: string): Promise<string[]> {
  return db.getUserEventPermissions(user, eventId)
}

export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
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

export async function requireActiveSubscription(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) return next(new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED'))
    if (req.user.role !== 'organizer') return next()

    const allowed = await db.hasActiveOrganizerOrTeamAccess(req.user)
    if (!allowed) {
      return next(
        new AppError(
          'Akun Organizer belum berlangganan. Silakan aktifkan paket Rp 50.000/bulan melalui Midtrans di tab Pricing & Langganan.',
          403,
          'SUBSCRIPTION_REQUIRED'
        )
      )
    }
    next()
  } catch (err) {
    next(err)
  }
}

export async function requireDirectOrganizerSubscription(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) return next(new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED'))
    if (req.user.role !== 'organizer') return next()

    const fresh = (await db.findUserById(req.user.id, 'organizer')) || req.user
    const sub = db.evaluateOrganizerSubscription(fresh)
    if (!sub.is_active) {
      return next(
        new AppError(
          'Langganan Organizer (Rp 50.000/bulan) diperlukan untuk menggunakan fitur ini.',
          403,
          'SUBSCRIPTION_REQUIRED'
        )
      )
    }
    next()
  } catch (err) {
    next(err)
  }
}

export function requireEventPermission(permissionKey: string): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED'))
      if (req.user.role === 'admin') return next()

      const eventId = req.resolvedEventId || req.params.eventId || req.params.id || req.body?.event_id
      if (!eventId) {
        return next(new AppError('ID event tidak ditemukan.', 400, 'EVENT_ID_REQUIRED'))
      }

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

export function requireOrgMembership(req: Request, _res: Response, next: NextFunction) {
  ;(async () => {
    if (!req.user) return next(new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED'))
    if (req.user.role === 'admin') return next()

    const orgId = req.params.orgId || req.params.id || req.body?.organization_id
    if (!orgId) {
      return next(new AppError('ID organisasi tidak ditemukan.', 400, 'ORG_ID_REQUIRED'))
    }

    const { allowed, member }: any = await db.isOrgMember(orgId, req.user)
    if (!allowed) {
      return next(new AppError('Akses ditolak: Anda bukan anggota organisasi ini.', 403, 'ORG_FORBIDDEN'))
    }
    req.orgMember = member || null
    next()
  })().catch(next)
}

export function requireOrgRole(...allowedOrgRoles: string[]): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED'))
      if (req.user.role === 'admin') return next()

      const orgId = req.params.orgId || req.params.id || req.body?.organization_id
      if (!orgId) {
        return next(new AppError('ID organisasi tidak ditemukan.', 400, 'ORG_ID_REQUIRED'))
      }

      const { allowed, member }: any = await db.isOrgMember(orgId, req.user)
      if (!allowed) {
        return next(new AppError('Akses ditolak: Anda bukan anggota organisasi ini.', 403, 'ORG_FORBIDDEN'))
      }
      if (allowedOrgRoles.length && !allowedOrgRoles.includes(member?.role)) {
        return next(
          new AppError(
            `Akses ditolak: Operasi ini hanya diizinkan untuk peran ${allowedOrgRoles.join(' / ')}.`,
            403,
            'ORG_ROLE_FORBIDDEN'
          )
        )
      }
      req.orgMember = member || null
      next()
    } catch (err) {
      next(err)
    }
  }
}

export function requireResourceEventAccess({
  resolveEventId,
  moduleKey = null,
  permission = null
}: {
  resolveEventId: (id: string, req: Request) => Promise<string | null | undefined> | string | null | undefined
  moduleKey?: string | null
  permission?: string | null
}): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED'))
      const eventId = await resolveEventId(req.params.id, req)
      if (!eventId) {
        return next(new AppError('Resource atau event terkait tidak ditemukan.', 404, 'RESOURCE_NOT_FOUND'))
      }
      req.resolvedEventId = eventId

      if (moduleKey) {
        if (req.user.role !== 'admin') {
          await pricingDb.assertEventModuleAllowedByPlan(eventId, moduleKey)
        }
        if (!(await db.isModuleEnabled(eventId, moduleKey))) {
          return next(
            new AppError(
              `Modul "${moduleKey}" sedang nonaktif pada event ini. Aktifkan di Module Configuration terlebih dahulu.`,
              403,
              'MODULE_DISABLED'
            )
          )
        }
      }

      if (permission && req.user.role !== 'admin') {
        const perms = await db.getUserEventPermissions(req.user, eventId)
        if (!perms.includes(permission)) {
          return next(
            new AppError(
              `Akses ditolak: Anda tidak memiliki izin "${permission}" untuk event ini.`,
              403,
              'FORBIDDEN_PERMISSION'
            )
          )
        }
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
