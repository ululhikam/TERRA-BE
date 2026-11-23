import type { Request, Response, NextFunction, RequestHandler } from 'express'
import * as db from '../repositories/db.js'
import * as pricingDb from '../repositories/pricing.db.js'
import { AppError } from '../utils/response.js'

export function requireEventModule(
  moduleKey: string,
  resolveEventId: ((req: Request) => string | undefined | null) | null = null
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      let eventId = req.params.id || req.params.eventId || req.body?.event_id
      if (!eventId && typeof resolveEventId === 'function') {
        eventId = resolveEventId(req) || undefined
      }
      if (!eventId) {
        return next(new AppError('ID event tidak ditemukan.', 400, 'EVENT_ID_REQUIRED'))
      }

      if (req.user?.role !== 'admin') {
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
      next()
    } catch (err) {
      next(err)
    }
  }
}
