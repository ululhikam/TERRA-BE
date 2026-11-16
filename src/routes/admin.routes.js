import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireAdmin } from '../middleware/role.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { moderationNoteSchema, categorySchema } from '../validators/schemas.js'
import { store, slugify } from '../repositories/store.js'
import { sendSuccess, AppError } from '../utils/response.js'

const router = Router()

router.use('/admin', requireAuth, requireAdmin)

router.get('/admin/dashboard', (_req, res) => {
  return sendSuccess(res, {
    total_users: store.users.length,
    total_organizations: store.organizations.length,
    total_events: store.events.filter((e) => !e.deleted_at).length,
    published_events: store.events.filter((e) => e.publication_status === 'Published').length,
    pending_events: store.events.filter((e) => e.publication_status === 'Pending Review').length,
    total_orders: store.orders.length,
    total_issued_tickets: store.tickets.length,
    total_checkins: store.checkinLogs.length
  })
})

router.get('/admin/users', (_req, res) => {
  return sendSuccess(res, store.users)
})

router.patch('/admin/users/:id/status', (req, res) => {
  const user = store.users.find((u) => u.id === req.params.id)
  if (!user) throw new AppError('User tidak ditemukan.', 404, 'USER_NOT_FOUND')
  user.is_suspended = Boolean(req.body?.is_suspended)
  return sendSuccess(res, user, 'Status user diperbarui.')
})

router.get('/admin/organizations', (_req, res) => {
  return sendSuccess(res, store.organizations)
})

router.get('/admin/verifications', (_req, res) => {
  return sendSuccess(res, store.verifications)
})

router.post('/admin/verifications/:id/review', (req, res) => {
  const ver = store.verifications.find((v) => v.id === req.params.id)
  if (!ver) throw new AppError('Data verifikasi tidak ditemukan.', 404, 'VERIFICATION_NOT_FOUND')
  const status = req.body?.status === 'verified' ? 'verified' : 'rejected'
  ver.verification_status = status
  ver.review_notes = req.body?.notes || ''
  ver.reviewed_by = req.user.id
  ver.reviewed_at = new Date().toISOString()

  const org = store.organizations.find((o) => o.id === ver.organization_id)
  if (org) org.verification_status = status

  return sendSuccess(res, ver, `Organisasi berhasil di-${status}.`)
})

router.get('/admin/events', (_req, res) => {
  return sendSuccess(res, store.events.filter((e) => !e.deleted_at))
})

function handleModeration(req, res, action) {
  const evt = store.getEvent(req.params.id)
  const map = {
    approve: { pub: 'Published', op: 'Published' },
    reject: { pub: 'Rejected', op: evt.status },
    suspend: { pub: 'Suspended', op: evt.status }
  }
  evt.publication_status = map[action].pub
  evt.status = map[action].op

  const log = {
    id: 'mod-' + Date.now(),
    event_id: evt.id,
    admin_id: req.user.id,
    action,
    notes: req.validatedBody?.notes || '',
    created_at: new Date().toISOString()
  }
  store.moderationLogs.unshift(log)
  return sendSuccess(res, { event: evt, log }, `Event berhasil di-${action}.`)
}

router.post('/admin/events/:id/approve', validateBody(moderationNoteSchema), (req, res) => handleModeration(req, res, 'approve'))
router.post('/admin/events/:id/reject', validateBody(moderationNoteSchema), (req, res) => handleModeration(req, res, 'reject'))
router.post('/admin/events/:id/suspend', validateBody(moderationNoteSchema), (req, res) => handleModeration(req, res, 'suspend'))

router.get('/admin/moderation', (_req, res) => {
  return sendSuccess(res, store.moderationLogs)
})

router.get('/admin/categories', (_req, res) => {
  return sendSuccess(res, store.categories)
})

router.post('/admin/categories', validateBody(categorySchema), (req, res) => {
  const cat = {
    id: 'cat-' + Date.now(),
    slug: slugify(req.validatedBody.name),
    is_active: true,
    ...req.validatedBody
  }
  store.categories.push(cat)
  return sendSuccess(res, cat, 'Kategori dibuat.', 201)
})

router.patch('/admin/categories/:id', (req, res) => {
  const cat = store.categories.find((c) => c.id === req.params.id)
  if (!cat) throw new AppError('Kategori tidak ditemukan.', 404, 'CATEGORY_NOT_FOUND')
  Object.assign(cat, req.body)
  return sendSuccess(res, cat, 'Kategori diperbarui.')
})

router.delete('/admin/categories/:id', (req, res) => {
  store.categories = store.categories.filter((c) => c.id !== req.params.id)
  return sendSuccess(res, { id: req.params.id }, 'Kategori dihapus.')
})

router.get('/admin/reports', (_req, res) => {
  return sendSuccess(res, store.reports)
})

router.patch('/admin/reports/:id', (req, res) => {
  const rep = store.reports.find((r) => r.id === req.params.id)
  if (!rep) throw new AppError('Laporan tidak ditemukan.', 404, 'REPORT_NOT_FOUND')
  rep.status = req.body?.status || 'resolved'
  rep.reviewed_by = req.user.id
  return sendSuccess(res, rep, 'Laporan diperbarui.')
})

export default router
