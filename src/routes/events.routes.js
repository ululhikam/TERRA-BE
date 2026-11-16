import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireOrganizerOrAdmin } from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  eventCreateSchema,
  eventUpdateSchema,
  moduleConfigSchema,
  bulkModulesSchema,
  teamMemberSchema
} from '../validators/schemas.js'
import { store, MODULE_CATALOG, slugify } from '../repositories/store.js'
import { sendSuccess, AppError } from '../utils/response.js'

const router = Router()

function enrichEvent(evt) {
  return {
    ...evt,
    organization: store.organizations.find((o) => o.id === evt.organization_id) || null,
    ticket_types: store.ticketTypes.filter((t) => t.event_id === evt.id),
    schedules: store.schedules.filter((s) => s.event_id === evt.id),
    speakers: evt.speakers || []
  }
}

router.get('/events', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const { organization_id, status } = req.query
  let list = store.events.filter((e) => !e.deleted_at)
  if (organization_id) list = list.filter((e) => e.organization_id === organization_id)
  if (status) list = list.filter((e) => e.status === status)
  return sendSuccess(res, list.map(enrichEvent))
})

router.post('/events', requireAuth, requireOrganizerOrAdmin, validateBody(eventCreateSchema), (req, res) => {
  const data = req.validatedBody
  const slug = data.slug || `${slugify(data.title)}-${Date.now().toString().slice(-4)}`
  if (store.events.some((e) => e.slug === slug && !e.deleted_at)) {
    throw new AppError('Slug event sudah terdaftar.', 409, 'DUPLICATE_SLUG')
  }

  const evt = {
    id: 'evt-' + Date.now(),
    ...data,
    slug,
    poster_url: data.poster_url || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=900&q=80',
    banner_url: data.banner_url || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1400&q=80',
    gallery: data.gallery || [],
    speakers: [],
    status: 'Draft',
    publication_status: 'Published',
    is_featured: false,
    enabled_modules: ['event_profile', 'timeline', 'tasks', 'team', 'ticketing', 'participants', 'check_in', 'finance', 'vendors', 'sponsors', 'documents', 'reports', 'feedback'],
    created_by: req.user.id,
    deleted_at: null
  }
  store.events.unshift(evt)
  return sendSuccess(res, enrichEvent(evt), 'Event berhasil dibuat.', 201)
})

router.get('/events/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const evt = store.getEvent(req.params.id)
  return sendSuccess(res, enrichEvent(evt))
})

router.patch('/events/:id', requireAuth, requireOrganizerOrAdmin, validateBody(eventUpdateSchema), (req, res) => {
  const evt = store.getEvent(req.params.id)
  const { schedules, ...rest } = req.validatedBody
  Object.assign(evt, rest)

  if (Array.isArray(schedules)) {
    store.schedules = store.schedules.filter((s) => s.event_id !== evt.id)
    const mapped = schedules.map((s, idx) => ({
      id: s.id || `sch-${Date.now()}-${idx}`,
      event_id: evt.id,
      date: s.date || (evt.start_at ? evt.start_at.slice(0, 10) : '2026-12-12'),
      ...s
    }))
    store.schedules.push(...mapped)
  }

  return sendSuccess(res, enrichEvent(evt), 'Data event diperbarui.')
})

router.delete('/events/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const evt = store.getEvent(req.params.id)
  evt.deleted_at = new Date().toISOString()
  return sendSuccess(res, { id: evt.id }, 'Event berhasil dihapus.')
})

router.post('/events/:id/duplicate', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const source = store.getEvent(req.params.id)
  const newId = 'evt-' + Date.now()
  const copy = {
    ...structuredClone(source),
    id: newId,
    title: `${source.title} (Copy)`,
    slug: `${source.slug}-copy-${Math.floor(100 + Math.random() * 900)}`,
    status: 'Draft',
    publication_status: 'Unpublished'
  }
  store.events.unshift(copy)
  return sendSuccess(res, enrichEvent(copy), 'Event berhasil diduplikasi.', 201)
})

router.post('/events/:id/submit-review', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const evt = store.getEvent(req.params.id)
  evt.publication_status = 'Pending Review'
  return sendSuccess(res, enrichEvent(evt), 'Event diajukan untuk moderasi Admin.')
})

router.post('/events/:id/publish', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const evt = store.getEvent(req.params.id)
  if (!['Approved', 'Published'].includes(evt.publication_status)) {
    throw new AppError('Event belum disetujui Admin untuk dipublikasikan.', 403, 'EVENT_NOT_APPROVED')
  }
  evt.publication_status = 'Published'
  evt.status = 'Published'
  return sendSuccess(res, enrichEvent(evt), 'Event dipublikasikan ke marketplace.')
})

router.post('/events/:id/unpublish', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const evt = store.getEvent(req.params.id)
  evt.publication_status = 'Unpublished'
  return sendSuccess(res, enrichEvent(evt), 'Publikasi event ditarik dari marketplace.')
})

// Event Modules Configuration
router.get('/events/:id/modules', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const evt = store.getEvent(req.params.id)
  const modules = MODULE_CATALOG.map((m) => ({
    ...m,
    is_enabled: evt.enabled_modules.includes(m.key)
  }))
  return sendSuccess(res, { event_id: evt.id, enabled_modules: evt.enabled_modules, modules })
})

router.put('/events/:id/modules', requireAuth, requireOrganizerOrAdmin, validateBody(bulkModulesSchema), (req, res) => {
  const evt = store.getEvent(req.params.id)
  const requested = new Set(req.validatedBody.enabled_modules)
  requested.add('event_profile')
  if ((requested.has('participants') || requested.has('check_in')) && !requested.has('ticketing')) {
    throw new AppError('Modul participants dan check_in membutuhkan modul ticketing aktif.', 400, 'MODULE_DEPENDENCY_UNMET')
  }
  evt.enabled_modules = [...requested]
  return sendSuccess(res, { enabled_modules: evt.enabled_modules }, 'Konfigurasi modul disimpan.')
})

router.get('/events/:id/modules/:moduleKey', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const evt = store.getEvent(req.params.id)
  const mod = MODULE_CATALOG.find((m) => m.key === req.params.moduleKey)
  if (!mod) throw new AppError('Modul tidak ditemukan.', 404, 'INVALID_MODULE')
  return sendSuccess(res, { ...mod, is_enabled: evt.enabled_modules.includes(mod.key) })
})

router.patch('/events/:id/modules/:moduleKey', requireAuth, requireOrganizerOrAdmin, validateBody(moduleConfigSchema), (req, res) => {
  const enabledModules = store.toggleModule(
    req.params.id,
    req.params.moduleKey,
    req.validatedBody.is_enabled,
    req.user.id
  )
  return sendSuccess(res, { enabled_modules: enabledModules }, 'Status modul diperbarui.')
})

// Team & Access Management per Event
router.get('/events/:id/team', requireAuth, requireOrganizerOrAdmin, requireEventModule('team'), (req, res) => {
  return sendSuccess(res, store.teamMembers.filter((m) => m.event_id === req.params.id))
})

router.post('/events/:id/team', requireAuth, requireOrganizerOrAdmin, requireEventModule('team'), validateBody(teamMemberSchema), (req, res) => {
  const data = req.validatedBody
  const defaultPerms = data.role === 'Staff'
    ? ['View Event', 'Manage Check-in']
    : ['View Event', 'Edit Event', 'Manage Timeline']
  const member = {
    id: 'tm-' + Date.now(),
    event_id: req.params.id,
    name: data.name || data.email.split('@')[0],
    email: data.email,
    role: data.role,
    department: data.department,
    permissions: data.permissions || defaultPerms
  }
  store.teamMembers.push(member)
  return sendSuccess(res, member, 'Anggota panitia berhasil diundang.', 201)
})

router.patch('/events/:id/team/:memberId', requireAuth, requireOrganizerOrAdmin, requireEventModule('team'), (req, res) => {
  const member = store.teamMembers.find((m) => m.id === req.params.memberId && m.event_id === req.params.id)
  if (!member) throw new AppError('Anggota panitia tidak ditemukan.', 404, 'TEAM_MEMBER_NOT_FOUND')
  Object.assign(member, req.body)
  return sendSuccess(res, member, 'Hak akses anggota diperbarui.')
})

router.delete('/events/:id/team/:memberId', requireAuth, requireOrganizerOrAdmin, requireEventModule('team'), (req, res) => {
  store.teamMembers = store.teamMembers.filter((m) => !(m.id === req.params.memberId && m.event_id === req.params.id))
  return sendSuccess(res, { id: req.params.memberId }, 'Anggota panitia dihapus.')
})

export default router
