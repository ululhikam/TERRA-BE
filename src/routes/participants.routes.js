import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireEventPermission, requireOrganizerOrAdmin } from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { participantCreateSchema } from '../validators/schemas.js'
import * as db from '../repositories/db.js'
import { sendSuccess, asyncHandler } from '../utils/response.js'

const router = Router()

router.get('/events/:id/participants', requireAuth, requireOrganizerOrAdmin, requireEventModule('participants'), requireEventPermission('View Participants'), asyncHandler(async (req, res) => {
  const list = await db.listParticipants(req.params.id, req.query)
  return sendSuccess(res, list)
}))

router.get('/events/:id/participants/export', requireAuth, requireOrganizerOrAdmin, requireEventModule('participants'), requireEventPermission('View Participants'), asyncHandler(async (req, res) => {
  const list = await db.listParticipants(req.params.id)
  const header = 'Nama,Email,Telepon,Jenis Tiket,Kode Tiket,Status,Check-in\n'
  const rows = list
    .map((p) => `"${p.full_name}","${p.email}","${p.phone || ''}","${p.ticket_type}","${p.ticket_code || ''}","${p.registration_status}","${p.checked_in ? 'Ya' : 'Belum'}"`)
    .join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="participants-${req.params.id}.csv"`)
  return res.status(200).send(header + rows)
}))

router.post('/events/:id/participants', requireAuth, requireOrganizerOrAdmin, requireEventModule('participants'), requireEventPermission('View Participants'), validateBody(participantCreateSchema), asyncHandler(async (req, res) => {
  const p = await db.createManualParticipant(req.params.id, req.validatedBody)
  return sendSuccess(res, p, 'Peserta manual berhasil didaftarkan.', 201)
}))

router.get('/participants/:id', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.findParticipantById(req.params.id))
}))

router.patch('/participants/:id', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  const p = await db.updateParticipant(req.params.id, req.body)
  return sendSuccess(res, p, 'Data peserta diperbarui.')
}))

router.delete('/participants/:id', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.deleteParticipant(req.params.id), 'Peserta dihapus.')
}))

export default router
