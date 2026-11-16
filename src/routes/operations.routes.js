import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireOrganizerOrAdmin } from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { financeRecordSchema, vendorSchema, sponsorSchema } from '../validators/schemas.js'
import { store } from '../repositories/store.js'
import { sendSuccess, AppError } from '../utils/response.js'

const router = Router()

// ---------------- FINANCE (With Automated Paid Ticket Revenue) ----------------
router.get('/events/:id/finance/summary', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), (req, res) => {
  return sendSuccess(res, store.getFinanceSummary(req.params.id))
})

router.get('/events/:id/finance/budgets', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), (req, res) => {
  return sendSuccess(res, { event_id: req.params.id, amount: store.budgets[req.params.id] || 0, currency: 'IDR' })
})

router.post('/events/:id/finance/budgets', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), (req, res) => {
  const amount = Number(req.body?.amount || 0)
  if (amount < 0) throw new AppError('Budget tidak boleh negatif.', 422, 'INVALID_BUDGET')
  store.budgets[req.params.id] = amount
  return sendSuccess(res, { event_id: req.params.id, amount }, 'Anggaran event diperbarui.', 201)
})

router.get('/events/:id/finance/incomes', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), (req, res) => {
  return sendSuccess(res, store.incomes.filter((i) => i.event_id === req.params.id))
})

router.post('/events/:id/finance/incomes', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), validateBody(financeRecordSchema), (req, res) => {
  const item = {
    id: 'inc-' + Date.now(),
    event_id: req.params.id,
    ...req.validatedBody,
    date: req.validatedBody.date || new Date().toISOString().slice(0, 10)
  }
  store.incomes.unshift(item)
  return sendSuccess(res, item, 'Pemasukan dicatat.', 201)
})

router.get('/events/:id/finance/expenses', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), (req, res) => {
  return sendSuccess(res, store.expenses.filter((e) => e.event_id === req.params.id))
})

router.post('/events/:id/finance/expenses', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), validateBody(financeRecordSchema), (req, res) => {
  const item = {
    id: 'exp-' + Date.now(),
    event_id: req.params.id,
    ...req.validatedBody,
    date: req.validatedBody.date || new Date().toISOString().slice(0, 10)
  }
  store.expenses.unshift(item)
  return sendSuccess(res, item, 'Pengeluaran dicatat.', 201)
})

// ---------------- VENDORS ----------------
router.get('/events/:id/vendors', requireAuth, requireOrganizerOrAdmin, requireEventModule('vendors'), (req, res) => {
  return sendSuccess(res, store.vendors.filter((v) => v.event_id === req.params.id))
})

router.post('/events/:id/vendors', requireAuth, requireOrganizerOrAdmin, requireEventModule('vendors'), validateBody(vendorSchema), (req, res) => {
  const v = { id: 'v-' + Date.now(), event_id: req.params.id, ...req.validatedBody }
  store.vendors.unshift(v)
  return sendSuccess(res, v, 'Vendor ditambahkan.', 201)
})

router.patch('/vendors/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const v = store.vendors.find((item) => item.id === req.params.id)
  if (!v) throw new AppError('Vendor tidak ditemukan.', 404, 'VENDOR_NOT_FOUND')
  Object.assign(v, req.body)
  return sendSuccess(res, v, 'Vendor diperbarui.')
})

router.delete('/vendors/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  store.vendors = store.vendors.filter((v) => v.id !== req.params.id)
  return sendSuccess(res, { id: req.params.id }, 'Vendor dihapus.')
})

// ---------------- SPONSORS ----------------
router.get('/events/:id/sponsors', requireAuth, requireOrganizerOrAdmin, requireEventModule('sponsors'), (req, res) => {
  return sendSuccess(res, store.sponsors.filter((s) => s.event_id === req.params.id))
})

router.post('/events/:id/sponsors', requireAuth, requireOrganizerOrAdmin, requireEventModule('sponsors'), validateBody(sponsorSchema), (req, res) => {
  const s = { id: 's-' + Date.now(), event_id: req.params.id, ...req.validatedBody }
  store.sponsors.unshift(s)
  return sendSuccess(res, s, 'Sponsor ditambahkan.', 201)
})

router.patch('/sponsors/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const s = store.sponsors.find((item) => item.id === req.params.id)
  if (!s) throw new AppError('Sponsor tidak ditemukan.', 404, 'SPONSOR_NOT_FOUND')
  Object.assign(s, req.body)
  return sendSuccess(res, s, 'Sponsor diperbarui.')
})

router.delete('/sponsors/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  store.sponsors = store.sponsors.filter((s) => s.id !== req.params.id)
  return sendSuccess(res, { id: req.params.id }, 'Sponsor dihapus.')
})

// ---------------- DOCUMENTS ----------------
router.get('/events/:id/documents', requireAuth, requireOrganizerOrAdmin, requireEventModule('documents'), (req, res) => {
  return sendSuccess(res, store.documents.filter((d) => d.event_id === req.params.id))
})

router.post('/events/:id/documents', requireAuth, requireOrganizerOrAdmin, requireEventModule('documents'), (req, res) => {
  const doc = {
    id: 'doc-' + Date.now(),
    event_id: req.params.id,
    file_name: req.body?.file_name || 'Document.pdf',
    category: req.body?.category || 'Operasional',
    visibility: req.body?.visibility || 'internal',
    file_path: `events/${req.params.id}/${Date.now()}.pdf`,
    created_at: new Date().toISOString()
  }
  store.documents.unshift(doc)
  return sendSuccess(res, doc, 'Dokumen diunggah.', 201)
})

router.get('/documents/:id/download', requireAuth, (req, res) => {
  const doc = store.documents.find((d) => d.id === req.params.id)
  if (!doc) throw new AppError('Dokumen tidak ditemukan.', 404, 'DOC_NOT_FOUND')
  return sendSuccess(res, { signed_url: `https://storage.supabase.co/signed/${doc.file_path}?token=demo` })
})

router.delete('/documents/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  store.documents = store.documents.filter((d) => d.id !== req.params.id)
  return sendSuccess(res, { id: req.params.id }, 'Dokumen dihapus.')
})

// ---------------- SURVEYS & FEEDBACK ----------------
router.get('/events/:id/surveys', requireAuth, requireEventModule('feedback'), (req, res) => {
  return sendSuccess(res, store.surveys.filter((s) => s.event_id === req.params.id))
})

router.post('/events/:id/surveys', requireAuth, requireOrganizerOrAdmin, requireEventModule('feedback'), (req, res) => {
  const srv = {
    id: 'srv-' + Date.now(),
    event_id: req.params.id,
    title: req.body?.title || 'Survey Event',
    description: req.body?.description || '',
    is_active: true,
    responses: []
  }
  store.surveys.unshift(srv)
  return sendSuccess(res, srv, 'Survey dibuat.', 201)
})

router.post('/surveys/:id/responses', requireAuth, (req, res) => {
  const srv = store.surveys.find((s) => s.id === req.params.id)
  if (!srv) throw new AppError('Survey tidak ditemukan.', 404, 'SURVEY_NOT_FOUND')
  const resp = { id: 'res-' + Date.now(), user_id: req.user.id, answers: req.body?.answers || {}, submitted_at: new Date().toISOString() }
  srv.responses.push(resp)
  return sendSuccess(res, resp, 'Terima kasih atas feedback Anda.', 201)
})

// ---------------- DEEP ANALYTICS & REPORTS ----------------
router.get('/events/:id/reports', requireAuth, requireOrganizerOrAdmin, requireEventModule('reports'), (req, res) => {
  const evt = store.getEvent(req.params.id)
  const tickets = store.ticketTypes.filter((t) => t.event_id === evt.id)
  const totalQuota = tickets.reduce((s, t) => s + t.quantity, 0)
  const totalSold = tickets.reduce((s, t) => s + t.sold_quantity, 0)
  const evtParticipants = store.participants.filter((p) => p.event_id === evt.id)
  const checkedIn = evtParticipants.filter((p) => p.checked_in).length
  const finance = store.getFinanceSummary(evt.id)

  return sendSuccess(res, {
    event_id: evt.id,
    title: evt.title,
    sell_through_rate_pct: totalQuota ? Math.round((totalSold / totalQuota) * 100) : 0,
    total_quota: totalQuota,
    total_sold: totalSold,
    registered_participants: evtParticipants.length,
    checked_in_count: checkedIn,
    attendance_rate_pct: evtParticipants.length ? Math.round((checkedIn / evtParticipants.length) * 100) : 0,
    finance
  })
})

export default router
