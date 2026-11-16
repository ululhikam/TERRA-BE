import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireOrganizerOrAdmin } from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { participantCreateSchema } from '../validators/schemas.js'
import { store } from '../repositories/store.js'
import { generateTicketCode, hashQrToken } from '../utils/crypto.js'
import { sendSuccess, AppError } from '../utils/response.js'

const router = Router()

router.get('/events/:id/participants', requireAuth, requireOrganizerOrAdmin, requireEventModule('participants'), (req, res) => {
  const { search, checked_in } = req.query
  let list = store.participants.filter((p) => p.event_id === req.params.id)
  if (checked_in === 'true') list = list.filter((p) => p.checked_in)
  if (checked_in === 'false') list = list.filter((p) => !p.checked_in)
  if (search) {
    const q = String(search).toLowerCase()
    list = list.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.ticket_code || '').toLowerCase().includes(q)
    )
  }
  return sendSuccess(res, list)
})

router.get('/events/:id/participants/export', requireAuth, requireOrganizerOrAdmin, requireEventModule('participants'), (req, res) => {
  const list = store.participants.filter((p) => p.event_id === req.params.id)
  const header = 'Nama,Email,Telepon,Jenis Tiket,Kode Tiket,Status,Check-in\n'
  const rows = list
    .map((p) => `"${p.full_name}","${p.email}","${p.phone || ''}","${p.ticket_type}","${p.ticket_code || ''}","${p.registration_status}","${p.checked_in ? 'Ya' : 'Belum'}"`)
    .join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="participants-${req.params.id}.csv"`)
  return res.status(200).send(header + rows)
})

router.post('/events/:id/participants', requireAuth, requireOrganizerOrAdmin, requireEventModule('participants'), validateBody(participantCreateSchema), (req, res) => {
  const code = generateTicketCode()
  const rawPayload = `TERRA:${code}:${req.params.id}`
  const p = {
    id: 'pt-' + Date.now(),
    event_id: req.params.id,
    order_id: null,
    user_id: null,
    ...req.validatedBody,
    ticket_type: req.validatedBody.ticket_type || 'Manual Registration',
    ticket_code: code,
    order_number: 'MAN-' + Math.floor(10000 + Math.random() * 90000),
    checked_in: false
  }
  store.participants.unshift(p)
  store.tickets.unshift({
    id: 'tc-' + Date.now(),
    event_id: req.params.id,
    order_id: null,
    attendee_id: p.id,
    ticket_type: p.ticket_type,
    ticket_code: code,
    qr_payload: rawPayload,
    qr_token_hash: hashQrToken(rawPayload),
    participant_name: p.full_name,
    status: 'Active',
    issued_at: new Date().toISOString(),
    used_at: null
  })
  return sendSuccess(res, p, 'Peserta manual berhasil didaftarkan.', 201)
})

router.get('/participants/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const p = store.participants.find((item) => item.id === req.params.id)
  if (!p) throw new AppError('Peserta tidak ditemukan.', 404, 'PARTICIPANT_NOT_FOUND')
  return sendSuccess(res, p)
})

router.patch('/participants/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const p = store.participants.find((item) => item.id === req.params.id)
  if (!p) throw new AppError('Peserta tidak ditemukan.', 404, 'PARTICIPANT_NOT_FOUND')
  Object.assign(p, req.body)
  return sendSuccess(res, p, 'Data peserta diperbarui.')
})

router.delete('/participants/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  store.participants = store.participants.filter((item) => item.id !== req.params.id)
  return sendSuccess(res, { id: req.params.id }, 'Peserta dihapus.')
})

export default router
