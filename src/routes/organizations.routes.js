import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireOrganizerOrAdmin, requireOrgMembership } from '../middleware/role.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { organizationCreateSchema, organizationMemberSchema } from '../validators/schemas.js'
import * as db from '../repositories/db.js'
import { sendSuccess, asyncHandler } from '../utils/response.js'

const router = Router()

router.get('/organizations', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  const list = await db.listOrganizationsForUser(req.user)
  return sendSuccess(res, list)
}))

router.post('/organizations', requireAuth, requireOrganizerOrAdmin, validateBody(organizationCreateSchema), asyncHandler(async (req, res) => {
  const org = await db.createOrganization(req.validatedBody, req.user)
  return sendSuccess(res, org, 'Organisasi berhasil dibuat.', 201)
}))

router.get('/organizations/:id', requireAuth, requireOrgMembership, asyncHandler(async (req, res) => {
  const org = await db.findOrganizationById(req.params.id)
  return sendSuccess(res, org)
}))

router.patch('/organizations/:id', requireAuth, requireOrgMembership, asyncHandler(async (req, res) => {
  const org = await db.updateOrganization(req.params.id, req.body)
  return sendSuccess(res, org, 'Organisasi diperbarui.')
}))

router.delete('/organizations/:id', requireAuth, requireOrgMembership, asyncHandler(async (req, res) => {
  const result = await db.deleteOrganization(req.params.id)
  return sendSuccess(res, result, 'Organisasi dihapus.')
}))

router.post('/organizations/:id/verification', requireAuth, requireOrgMembership, asyncHandler(async (req, res) => {
  const ver = await db.createOrgVerification(req.params.id, req.user.id, req.body?.documents || [])
  return sendSuccess(res, ver, 'Pengajuan verifikasi dikirim ke Admin.', 201)
}))

router.get('/organizations/:id/members', requireAuth, requireOrgMembership, asyncHandler(async (req, res) => {
  const org = await db.findOrganizationById(req.params.id)
  return sendSuccess(res, org.members || [])
}))

router.post('/organizations/:id/members', requireAuth, requireOrgMembership, validateBody(organizationMemberSchema), asyncHandler(async (req, res) => {
  const member = await db.addOrganizationMember(req.params.id, req.validatedBody)
  return sendSuccess(res, member, 'Anggota organisasi ditambahkan.', 201)
}))

router.patch('/organizations/:id/members/:memberId', requireAuth, requireOrgMembership, asyncHandler(async (req, res) => {
  const member = await db.updateOrganizationMember(req.params.id, req.params.memberId, req.body)
  return sendSuccess(res, member, 'Role anggota diperbarui.')
}))

router.delete('/organizations/:id/members/:memberId', requireAuth, requireOrgMembership, asyncHandler(async (req, res) => {
  const result = await db.removeOrganizationMember(req.params.id, req.params.memberId)
  return sendSuccess(res, result, 'Anggota dihapus dari organisasi.')
}))

export default router
