import { Router } from 'express'
import { optionalAuth } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { reportCreateSchema } from '../validators/schemas.js'
import { store } from '../repositories/store.js'
import { sendSuccess, AppError } from '../utils/response.js'

const router = Router()

function getPublicEvents() {
  return store.events.filter((e) => !e.deleted_at && e.publication_status === 'Published' && e.visibility === 'public')
}

router.get('/marketplace/events', (req, res) => {
  const { q, category, format, sort = 'upcoming', page = 1, limit = 12 } = req.query
  let list = getPublicEvents()

  if (q) {
    const term = String(q).toLowerCase()
    list = list.filter(
      (e) =>
        e.title.toLowerCase().includes(term) ||
        (e.location_name || '').toLowerCase().includes(term)
    )
  }
  if (category) list = list.filter((e) => e.category === category)
  if (format) list = list.filter((e) => e.location_type === format)
  if (sort === 'upcoming') {
    list = [...list].sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
  }

  const p = Number(page)
  const l = Number(limit)
  const paginated = list.slice((p - 1) * l, p * l).map((evt) => ({
    ...evt,
    organization: store.organizations.find((o) => o.id === evt.organization_id),
    ticket_types: store.ticketTypes.filter((t) => t.event_id === evt.id)
  }))

  return sendSuccess(res, paginated, 'Daftar event marketplace.', 200, {
    page: p,
    limit: l,
    total: list.length
  })
})

router.get('/marketplace/featured', (_req, res) => {
  const featured = getPublicEvents()
    .filter((e) => e.is_featured)
    .map((evt) => ({
      ...evt,
      organization: store.organizations.find((o) => o.id === evt.organization_id),
      ticket_types: store.ticketTypes.filter((t) => t.event_id === evt.id)
    }))
  return sendSuccess(res, featured)
})

router.get('/marketplace/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase()
  const list = getPublicEvents().filter((e) => e.title.toLowerCase().includes(q))
  return sendSuccess(res, list)
})

router.get('/marketplace/categories', (_req, res) => {
  return sendSuccess(res, store.categories.filter((c) => c.is_active))
})

router.get('/marketplace/organizers', (_req, res) => {
  const orgs = store.organizations.map((org) => ({
    ...org,
    event_count: getPublicEvents().filter((e) => e.organization_id === org.id).length
  }))
  return sendSuccess(res, orgs)
})

router.get('/marketplace/events/:slug', (req, res) => {
  const evt = getPublicEvents().find((e) => e.slug === req.params.slug || e.id === req.params.slug)
  if (!evt) throw new AppError('Event tidak ditemukan di marketplace.', 404, 'EVENT_NOT_FOUND')

  const organization = store.organizations.find((o) => o.id === evt.organization_id)
  const ticket_types = store.ticketTypes.filter((t) => t.event_id === evt.id && t.status !== 'Disabled')
  const schedules = store.schedules.filter((s) => s.event_id === evt.id && s.visibility === 'public')

  return sendSuccess(res, { ...evt, organization, ticket_types, schedules })
})

router.get('/marketplace/organizers/:slug', (req, res) => {
  const org = store.organizations.find((o) => o.slug === req.params.slug)
  if (!org) throw new AppError('Organizer tidak ditemukan.', 404, 'ORG_NOT_FOUND')

  const events = getPublicEvents().filter((e) => e.organization_id === org.id)
  return sendSuccess(res, { ...org, events })
})

router.post('/marketplace/events/:id/report', optionalAuth, validateBody(reportCreateSchema), (req, res) => {
  const evt = store.getEvent(req.params.id)
  const report = {
    id: 'rep-' + Date.now(),
    event_id: evt.id,
    reporter_id: req.user?.id || null,
    ...req.validatedBody,
    status: 'open',
    created_at: new Date().toISOString()
  }
  store.reports.unshift(report)
  return sendSuccess(res, report, 'Laporan telah diterima dan akan ditinjau oleh Admin.', 201)
})

export default router
