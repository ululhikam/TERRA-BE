import { Router } from 'express'
import { env } from '../config/env.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import {
  requireActiveSubscription,
  requireDirectOrganizerSubscription,
  requireEventPermission,
  requireOrganizerOrAdmin
} from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  eventCreateSchema,
  eventUpdateSchema,
  moduleConfigSchema,
  bulkModulesSchema,
  teamMemberSchema
} from '../validators/schemas.js'
import * as db from '../repositories/db.js'
import * as pricingDb from '../repositories/pricing.db.js'
import { MODULE_CATALOG } from '../repositories/store.js'
import { sendTeamInviteEmail } from '../services/email.service.js'
import { sendSuccess, AppError, asyncHandler } from '../utils/response.js'

const router = Router()

router.use('/events', requireAuth, requireOrganizerOrAdmin, requireActiveSubscription)

router.get('/events', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  const { organization_id, status } = req.query
  const list = await db.listEventsForUser(req.user, { organization_id, status })
  return sendSuccess(res, list)
}))

router.post('/events', requireAuth, requireOrganizerOrAdmin, requireDirectOrganizerSubscription, validateBody(eventCreateSchema), asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    const { allowed } = await db.isOrgMember(req.validatedBody.organization_id, req.user)
    if (!allowed) {
      throw new AppError('Anda tidak terdaftar sebagai anggota organisasi ini.', 403, 'FORBIDDEN_ORG')
    }
  }
  const evt = await db.createEvent(req.validatedBody, req.user)
  return sendSuccess(res, evt, 'Event berhasil dibuat.', 201)
}))

router.get('/events/:id', requireAuth, requireOrganizerOrAdmin, requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  const evt = await db.getEnrichedEvent(req.params.id, req.user)
  return sendSuccess(res, evt)
}))

router.get('/events/:id/activity-logs', requireAuth, requireOrganizerOrAdmin, requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listEventActivityLogs(req.params.id))
}))

router.patch('/events/:id', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), validateBody(eventUpdateSchema), asyncHandler(async (req, res) => {
  const { schedules, ...rest } = req.validatedBody
  const evt = await db.updateEvent(req.params.id, rest, schedules, req.user.id)
  return sendSuccess(res, evt, 'Data event diperbarui.')
}))

router.delete('/events/:id', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), asyncHandler(async (req, res) => {
  const result = await db.softDeleteEvent(req.params.id)
  return sendSuccess(res, result, 'Event berhasil dihapus.')
}))

router.post('/events/:id/duplicate', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), asyncHandler(async (req, res) => {
  const copy = await db.duplicateEvent(req.params.id, req.user)
  return sendSuccess(res, copy, 'Event berhasil diduplikasi.', 201)
}))

router.post('/events/:id/submit-review', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), asyncHandler(async (req, res) => {
  const evt = await db.updateEvent(req.params.id, { publication_status: 'Pending Review' }, undefined, req.user.id)
  return sendSuccess(res, evt, 'Event diajukan untuk moderasi Admin.')
}))

router.post('/events/:id/publish', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), asyncHandler(async (req, res) => {
  const current = await db.getEventOrThrow(req.params.id)
  if (!['Approved', 'Published'].includes(current.publication_status)) {
    throw new AppError('Event belum disetujui Admin untuk dipublikasikan.', 403, 'EVENT_NOT_APPROVED')
  }
  const evt = await db.updateEvent(
    req.params.id,
    {
      publication_status: 'Published',
      status: 'Published',
      published_at: current.published_at || new Date()
    },
    undefined,
    req.user.id
  )
  return sendSuccess(res, evt, 'Event dipublikasikan ke marketplace.')
}))

router.post('/events/:id/unpublish', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), asyncHandler(async (req, res) => {
  const evt = await db.updateEvent(req.params.id, { publication_status: 'Unpublished' }, undefined, req.user.id)
  return sendSuccess(res, evt, 'Publikasi event ditarik dari marketplace.')
}))

// Event Modules Configuration
router.get('/events/:id/modules', requireAuth, requireOrganizerOrAdmin, requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  const [evt, entitlement] = await Promise.all([
    db.getEventOrThrow(req.params.id),
    pricingDb.ensureEventEntitlement(req.params.id)
  ])
  const allowedSet = new Set(entitlement.allowed_modules || [])
  const modules = MODULE_CATALOG.map((m) => ({
    ...m,
    is_enabled: evt.enabled_modules.includes(m.key),
    allowed_by_plan: m.key === 'event_profile' || allowedSet.has(m.key),
    requires_upgrade: m.key !== 'event_profile' && !allowedSet.has(m.key)
  }))
  return sendSuccess(res, { event_id: evt.id, enabled_modules: evt.enabled_modules, entitlement, modules })
}))

router.put('/events/:id/modules', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), validateBody(bulkModulesSchema), asyncHandler(async (req, res) => {
  const enabled = await db.setEventModules(req.params.id, req.validatedBody.enabled_modules, req.user)
  return sendSuccess(res, { enabled_modules: enabled }, 'Konfigurasi modul disimpan.')
}))

router.get('/events/:id/modules/:moduleKey', requireAuth, requireOrganizerOrAdmin, requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  const evt = await db.getEventOrThrow(req.params.id)
  const mod = MODULE_CATALOG.find((m) => m.key === req.params.moduleKey)
  if (!mod) throw new AppError('Modul tidak ditemukan.', 404, 'INVALID_MODULE')
  return sendSuccess(res, { ...mod, is_enabled: evt.enabled_modules.includes(mod.key) })
}))

router.patch('/events/:id/modules/:moduleKey', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), validateBody(moduleConfigSchema), asyncHandler(async (req, res) => {
  const enabledModules = await db.toggleEventModule(
    req.params.id,
    req.params.moduleKey,
    req.validatedBody.is_enabled,
    req.user.id
  )
  return sendSuccess(res, { enabled_modules: enabledModules }, 'Status modul diperbarui.')
}))

// Team & Access Management per Event
router.get('/events/:id/team', requireAuth, requireOrganizerOrAdmin, requireEventModule('team'), requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listTeamMembers(req.params.id))
}))

router.post('/events/:id/team', requireAuth, requireOrganizerOrAdmin, requireEventModule('team'), requireEventPermission('Manage Team'), validateBody(teamMemberSchema), asyncHandler(async (req, res) => {
  const { evt, member, inviteToken, permissions } = await db.createTeamInvite(req.params.id, req.validatedBody, req.user)
  const inviteUrl = `${env.frontendUrl}/accept-invite?token=${inviteToken}`
  const emailStatus = await sendTeamInviteEmail({
    to: member.email,
    inviteeName: member.name,
    inviterName: req.user?.full_name || 'Organizer',
    eventTitle: evt.title,
    role: member.role,
    department: member.department,
    permissions,
    inviteUrl
  })

  return sendSuccess(
    res,
    {
      member,
      invite_url: inviteUrl,
      email_status: emailStatus
    },
    emailStatus.sent
      ? 'Undangan panitia dikirim via email (Resend).'
      : 'Anggota panitia ditambahkan. Bagikan tautan undangan secara manual atau lengkapi RESEND_API_KEY.',
    201
  )
}))

router.patch('/events/:id/team/:memberId', requireAuth, requireOrganizerOrAdmin, requireEventModule('team'), requireEventPermission('Manage Team'), validateBody(teamMemberSchema.partial()), asyncHandler(async (req, res) => {
  const member = await db.updateTeamMember(req.params.id, req.params.memberId, req.validatedBody)
  return sendSuccess(res, member, 'Hak akses anggota diperbarui.')
}))

router.delete('/events/:id/team/:memberId', requireAuth, requireOrganizerOrAdmin, requireEventModule('team'), requireEventPermission('Manage Team'), asyncHandler(async (req, res) => {
  const result = await db.deleteTeamMember(req.params.id, req.params.memberId)
  return sendSuccess(res, result, 'Anggota panitia dihapus.')
}))

export default router
