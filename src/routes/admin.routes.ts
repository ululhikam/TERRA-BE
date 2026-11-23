import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireAdmin } from '../middleware/role.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  adminCreateOrganizerSchema,
  adminPlanUpdateSchema,
  adminUpdateSubscriptionSchema,
  adminUserStatusSchema,
  billingVerifySchema,
  bundleUpsertSchema,
  categorySchema,
  moderationNoteSchema,
  promoUpsertSchema,
  reportStatusSchema,
  verificationReviewSchema
} from '../validators/schemas.js'
import { isSupabaseEnabled, supabaseAdmin } from '../config/supabase.js'
import { hashPassword } from '../utils/crypto.js'
import * as db from '../repositories/db.js'
import * as pricingDb from '../repositories/pricing.db.js'
import { sendSuccess, AppError, asyncHandler } from '../utils/response.js'

const router = Router()

router.use('/admin', requireAuth, requireAdmin)

router.get('/admin/dashboard', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.getAdminDashboard())
}))

router.get('/admin/users', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listAdminUsers())
}))

router.patch('/admin/users/:id/status', validateBody(adminUserStatusSchema), asyncHandler(async (req, res) => {
  const user = await db.updateAdminUserStatus(req.params.id, req.validatedBody.is_suspended)
  return sendSuccess(res, user, 'Status user diperbarui.')
}))

router.post('/admin/organizers', validateBody(adminCreateOrganizerSchema), asyncHandler(async (req, res) => {
  const { full_name, organization_name, email, phone, password, plan, duration_days } = req.validatedBody

  let authUserId = `orgu-${Date.now()}`
  if (isSupabaseEnabled && supabaseAdmin) {
    const { data: createdData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: 'organizer', organization_name }
    })
    if (createError && !(createError.message || '').toLowerCase().includes('already')) {
      throw new AppError(createError.message || 'Gagal membuat akun auth organizer di Supabase.', 400, 'AUTH_CREATE_FAILED')
    }
    if (createdData?.user?.id) {
      authUserId = createdData.user.id
    }
  }

  const result = await db.createAdminOrganizer({
    id: authUserId,
    full_name,
    organization_name,
    email,
    phone,
    password_hash: hashPassword(password),
    plan,
    duration_days
  })

  return sendSuccess(
    res,
    result,
    `Akun Organizer "${full_name}" berhasil ditambahkan dan aktif selama ${duration_days} hari.`,
    201
  )
}))

router.patch('/admin/organizers/:id/subscription', validateBody(adminUpdateSubscriptionSchema), asyncHandler(async (req, res) => {
  const updated = await db.updateOrganizerSubscription(req.params.id, req.validatedBody)
  return sendSuccess(res, updated, 'Status langganan Organizer berhasil diperbarui.')
}))

router.get('/admin/organizations', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listAllOrganizations())
}))

router.get('/admin/verifications', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listVerifications())
}))

router.post('/admin/verifications/:id/review', validateBody(verificationReviewSchema), asyncHandler(async (req, res) => {
  const result = await db.reviewVerification(
    req.params.id,
    req.validatedBody.status,
    req.validatedBody.notes,
    req.user.id
  )
  const label = result.verification?.verification_status || 'reviewed'
  return sendSuccess(res, result, `Organisasi berhasil di-${label}.`)
}))

router.get('/admin/events', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listAdminEvents())
}))

router.post('/admin/events/:id/approve', validateBody(moderationNoteSchema), asyncHandler(async (req, res) => {
  const result = await db.moderateEvent(req.params.id, 'approve', req.user.id, req.validatedBody?.notes)
  return sendSuccess(res, result, 'Event disetujui (Approved) dan siap dipublikasikan oleh Organizer.')
}))

router.post('/admin/events/:id/request-revision', validateBody(moderationNoteSchema), asyncHandler(async (req, res) => {
  const result = await db.moderateEvent(req.params.id, 'request_revision', req.user.id, req.validatedBody?.notes)
  return sendSuccess(res, result, 'Permintaan revisi dikirim ke Organizer.')
}))

router.post('/admin/events/:id/reject', validateBody(moderationNoteSchema), asyncHandler(async (req, res) => {
  const result = await db.moderateEvent(req.params.id, 'reject', req.user.id, req.validatedBody?.notes)
  return sendSuccess(res, result, 'Event berhasil di-reject.')
}))

router.post('/admin/events/:id/suspend', validateBody(moderationNoteSchema), asyncHandler(async (req, res) => {
  const result = await db.moderateEvent(req.params.id, 'suspend', req.user.id, req.validatedBody?.notes)
  return sendSuccess(res, result, 'Event berhasil di-suspend.')
}))

router.get('/admin/moderation', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listModerationLogs())
}))

router.get('/admin/categories', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listAllCategories())
}))

router.post('/admin/categories', validateBody(categorySchema), asyncHandler(async (req, res) => {
  const cat = await db.createCategory(req.validatedBody)
  return sendSuccess(res, cat, 'Kategori dibuat.', 201)
}))

router.patch('/admin/categories/:id', validateBody(categorySchema.partial()), asyncHandler(async (req, res) => {
  const cat = await db.updateCategory(req.params.id, req.validatedBody)
  return sendSuccess(res, cat, 'Kategori diperbarui.')
}))

router.delete('/admin/categories/:id', asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.deleteCategory(req.params.id), 'Kategori dihapus.')
}))

router.get('/admin/reports', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listReports())
}))

router.patch('/admin/reports/:id', validateBody(reportStatusSchema), asyncHandler(async (req, res) => {
  const rep = await db.updateReportStatus(req.params.id, req.validatedBody.status, req.user.id)
  return sendSuccess(res, rep, 'Laporan diperbarui.')
}))

router.get('/admin/orders', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listAdminOrders())
}))

router.get('/admin/activity-logs', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listAdminActivityLogs())
}))

// ---------------- PLATFORM ADMIN PRICING & BILLING ----------------
router.get('/admin/pricing/overview', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await pricingDb.getAdminPricingOverview())
}))

router.patch('/admin/pricing/plans/:code', validateBody(adminPlanUpdateSchema), asyncHandler(async (req, res) => {
  const plan = await pricingDb.adminUpdatePricingPlan(req.params.code, req.validatedBody, req.user)
  return sendSuccess(res, plan, `Paket ${plan.name} berhasil diperbarui tanpa mengubah transaksi sebelumnya.`)
}))

router.post('/admin/pricing/bundles', validateBody(bundleUpsertSchema), asyncHandler(async (req, res) => {
  const bundle = await pricingDb.adminUpsertBundle(req.validatedBody)
  return sendSuccess(res, bundle, `Bundle ${bundle.name} disimpan.`, 201)
}))

router.post('/admin/pricing/promos', validateBody(promoUpsertSchema), asyncHandler(async (req, res) => {
  const promo = await pricingDb.adminCreatePromo(req.validatedBody)
  return sendSuccess(res, promo, `Kode promo ${promo.code} disimpan.`, 201)
}))

router.post('/admin/billing/transactions/:txId/verify', validateBody(billingVerifySchema), asyncHandler(async (req, res) => {
  const tx = await pricingDb.adminVerifyBillingTransaction(req.params.txId, req.user, req.validatedBody)
  return sendSuccess(res, tx, `Transaksi ${tx.invoice_number} diperbarui ke status ${tx.status}.`)
}))

export default router
