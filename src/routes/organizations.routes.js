import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireOrganizerOrAdmin, requireOrgMembership } from '../middleware/role.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { organizationCreateSchema, organizationMemberSchema } from '../validators/schemas.js'
import { store, slugify } from '../repositories/store.js'
import { sendSuccess, AppError } from '../utils/response.js'

const router = Router()

router.get('/organizations', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const list =
    req.user.role === 'admin'
      ? store.organizations
      : store.organizations.filter(
          (o) => o.created_by === req.user.id || o.members.some((m) => m.user_id === req.user.id)
        )
  return sendSuccess(res, list)
})

router.post('/organizations', requireAuth, requireOrganizerOrAdmin, validateBody(organizationCreateSchema), (req, res) => {
  const data = req.validatedBody
  const slug = data.slug || slugify(data.name)
  if (store.organizations.some((o) => o.slug === slug)) {
    throw new AppError('Slug organisasi sudah digunakan.', 409, 'DUPLICATE_SLUG')
  }

  const org = {
    id: 'org-' + Date.now(),
    ...data,
    slug,
    logo_url: '',
    cover_url: '',
    verification_status: 'pending',
    created_by: req.user.id,
    members: [
      { id: 'om-' + Date.now(), user_id: req.user.id, name: req.user.full_name, email: req.user.email, role: 'Owner', status: 'active' }
    ]
  }
  store.organizations.unshift(org)
  return sendSuccess(res, org, 'Organisasi berhasil dibuat.', 201)
})

router.get('/organizations/:id', requireAuth, requireOrgMembership, (req, res) => {
  const org = store.organizations.find((o) => o.id === req.params.id)
  if (!org) throw new AppError('Organisasi tidak ditemukan.', 404, 'ORG_NOT_FOUND')
  return sendSuccess(res, org)
})

router.patch('/organizations/:id', requireAuth, requireOrgMembership, (req, res) => {
  const org = store.organizations.find((o) => o.id === req.params.id)
  if (!org) throw new AppError('Organisasi tidak ditemukan.', 404, 'ORG_NOT_FOUND')
  Object.assign(org, req.body)
  return sendSuccess(res, org, 'Organisasi diperbarui.')
})

router.delete('/organizations/:id', requireAuth, requireOrgMembership, (req, res) => {
  const idx = store.organizations.findIndex((o) => o.id === req.params.id)
  if (idx === -1) throw new AppError('Organisasi tidak ditemukan.', 404, 'ORG_NOT_FOUND')
  store.organizations.splice(idx, 1)
  return sendSuccess(res, { id: req.params.id }, 'Organisasi dihapus.')
})

router.post('/organizations/:id/verification', requireAuth, requireOrgMembership, (req, res) => {
  const ver = {
    id: 'ver-' + Date.now(),
    organization_id: req.params.id,
    submitted_by: req.user.id,
    verification_status: 'pending',
    documents: req.body?.documents || [],
    review_notes: ''
  }
  store.verifications.unshift(ver)
  return sendSuccess(res, ver, 'Pengajuan verifikasi dikirim ke Admin.', 201)
})

router.get('/organizations/:id/members', requireAuth, requireOrgMembership, (req, res) => {
  const org = store.organizations.find((o) => o.id === req.params.id)
  return sendSuccess(res, org.members)
})

router.post('/organizations/:id/members', requireAuth, requireOrgMembership, validateBody(organizationMemberSchema), (req, res) => {
  const org = store.organizations.find((o) => o.id === req.params.id)
  const member = {
    id: 'om-' + Date.now(),
    user_id: 'usr-' + Date.now(),
    name: req.validatedBody.email.split('@')[0],
    email: req.validatedBody.email,
    role: req.validatedBody.role,
    status: 'active'
  }
  org.members.push(member)
  return sendSuccess(res, member, 'Anggota organisasi ditambahkan.', 201)
})

router.patch('/organizations/:id/members/:memberId', requireAuth, requireOrgMembership, (req, res) => {
  const org = store.organizations.find((o) => o.id === req.params.id)
  const member = org.members.find((m) => m.id === req.params.memberId)
  if (!member) throw new AppError('Anggota tidak ditemukan.', 404, 'MEMBER_NOT_FOUND')
  if (req.body.role) member.role = req.body.role
  return sendSuccess(res, member, 'Role anggota diperbarui.')
})

router.delete('/organizations/:id/members/:memberId', requireAuth, requireOrgMembership, (req, res) => {
  const org = store.organizations.find((o) => o.id === req.params.id)
  org.members = org.members.filter((m) => m.id !== req.params.memberId)
  return sendSuccess(res, { id: req.params.memberId }, 'Anggota dihapus dari organisasi.')
})

export default router
