import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import {
  requireActiveSubscription,
  requireEventPermission,
  requireOrganizerOrAdmin,
  requireResourceEventAccess
} from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { participantCreateSchema } from '../validators/schemas.js'
import * as db from '../repositories/db.js'
import { AppError, sendSuccess, asyncHandler } from '../utils/response.js'

const router = Router()

router.use('/events', requireAuth, requireOrganizerOrAdmin, requireActiveSubscription)
router.use('/participants', requireAuth, requireOrganizerOrAdmin, requireActiveSubscription)

function csvCell(val) {
  let str = String(val ?? '')
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`
  }
  return `"${str.replace(/"/g, '""')}"`
}

async function assertCanMutateParticipants(user, eventId) {
  if (user.role === 'admin') return
  const perms = await db.getUserEventPermissions(user, eventId)
  const canMutate = perms.some((p) => ['Edit Event', 'Manage Tickets', 'Manage Check-in'].includes(p))
  if (!canMutate) {
    throw new AppError('Role Anda hanya memiliki akses lihat peserta.', 403, 'FORBIDDEN_PERMISSION')
  }
}

router.get('/events/:id/participants', requireAuth, requireOrganizerOrAdmin, requireEventModule('participants'), requireEventPermission('View Participants'), asyncHandler(async (req, res) => {
  const list = await db.listParticipants(req.params.id, req.query)
  return sendSuccess(res, list)
}))

router.get('/events/:id/participants/export', requireAuth, requireOrganizerOrAdmin, requireEventModule('participants'), requireEventPermission('View Participants'), asyncHandler(async (req, res) => {
  const list = await db.listParticipants(req.params.id)
  const header = 'Nama,Email,Telepon,Jenis Tiket,Kode Tiket,Status,Check-in\n'
  const rows = list
    .map((p) =>
      [
        csvCell(p.full_name),
        csvCell(p.email),
        csvCell(p.phone || ''),
        csvCell(p.ticket_type),
        csvCell(p.ticket_code || ''),
        csvCell(p.registration_status),
        csvCell(p.checked_in ? 'Ya' : 'Belum')
      ].join(',')
    )
    .join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="participants-${req.params.id}.csv"`)
  return res.status(200).send(header + rows)
}))

router.post('/events/:id/participants', requireAuth, requireOrganizerOrAdmin, requireEventModule('participants'), requireEventPermission('View Participants'), validateBody(participantCreateSchema), asyncHandler(async (req, res) => {
  await assertCanMutateParticipants(req.user, req.params.id)
  const p = await db.createManualParticipant(req.params.id, req.validatedBody)
  return sendSuccess(res, p, 'Peserta manual berhasil didaftarkan.', 201)
}))

router.get(
  '/participants/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findParticipantEventId,
    moduleKey: 'participants',
    permission: 'View Participants'
  }),
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await db.findParticipantById(req.params.id))
  })
)

router.patch(
  '/participants/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findParticipantEventId,
    moduleKey: 'participants',
    permission: 'View Participants'
  }),
  validateBody(participantCreateSchema.partial()),
  asyncHandler(async (req, res) => {
    await assertCanMutateParticipants(req.user, req.resolvedEventId)
    const p = await db.updateParticipant(req.params.id, req.validatedBody)
    return sendSuccess(res, p, 'Data peserta diperbarui.')
  })
)

router.delete(
  '/participants/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findParticipantEventId,
    moduleKey: 'participants',
    permission: 'View Participants'
  }),
  asyncHandler(async (req, res) => {
    await assertCanMutateParticipants(req.user, req.resolvedEventId)
    return sendSuccess(res, await db.deleteParticipant(req.params.id), 'Peserta dihapus.')
  })
)

export default router
