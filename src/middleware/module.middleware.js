import { store } from '../repositories/store.js'
import { AppError } from '../utils/response.js'

export function requireEventModule(moduleKey, resolveEventId = null) {
  return (req, _res, next) => {
    try {
      let eventId = req.params.id || req.params.eventId || req.body?.event_id
      if (!eventId && typeof resolveEventId === 'function') {
        eventId = resolveEventId(req)
      }
      if (!eventId) {
        return next(new AppError('ID event tidak ditemukan.', 400, 'EVENT_ID_REQUIRED'))
      }

      if (!store.isModuleEnabled(eventId, moduleKey)) {
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
