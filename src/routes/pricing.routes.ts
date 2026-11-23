import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireEventPermission, requireOrganizerOrAdmin } from '../middleware/role.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { billingCheckoutSchema, billingPreviewSchema } from '../validators/schemas.js'
import { uploadBufferToStorage, uploadSingleFile } from '../services/storage.service.js'
import * as db from '../repositories/db.js'
import * as pricingDb from '../repositories/pricing.db.js'
import { sendSuccess, AppError, asyncHandler } from '../utils/response.js'

const router = Router()

// Public catalog & live price preview (never hardcoded in frontend)
router.get('/pricing/catalog', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await pricingDb.listPublicPricingCatalog())
}))

router.post('/pricing/preview', validateBody(billingPreviewSchema), asyncHandler(async (req, res) => {
  const preview = await pricingDb.previewBillingCheckout(req.validatedBody)
  return sendSuccess(res, preview)
}))

// Per-event subscription entitlement, 14 Days Pro Access Trial, bundle credit & downgrade
router.get('/events/:id/subscription', requireAuth, requireOrganizerOrAdmin, requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  const entitlement = await pricingDb.ensureEventEntitlement(req.params.id)
  return sendSuccess(res, entitlement)
}))

router.post('/events/:id/subscription/trial', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), asyncHandler(async (req, res) => {
  const entitlement = await pricingDb.activateEventTrial(req.params.id, req.user)
  return sendSuccess(res, entitlement, '14 Days Pro Access berhasil diaktifkan untuk event ini!', 201)
}))

router.post('/events/:id/subscription/apply-bundle', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), asyncHandler(async (req, res) => {
  const creditId = req.body?.bundle_credit_id
  if (!creditId) throw new AppError('Pilih paket bundle credit terlebih dahulu.', 400, 'BUNDLE_CREDIT_REQUIRED')
  const entitlement = await pricingDb.applyBundleCreditToEvent(req.params.id, creditId, req.user)
  return sendSuccess(res, entitlement, 'Kuota bundle berhasil diterapkan ke event ini.')
}))

router.post('/events/:id/subscription/downgrade', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Edit Event'), asyncHandler(async (req, res) => {
  const targetPlan = req.body?.plan_code || 'free'
  const entitlement = await pricingDb.downgradeEventPlan(req.params.id, targetPlan, req.user)
  return sendSuccess(res, entitlement, `Paket event diturunkan ke ${entitlement.plan_name}. Semua data historis tetap tersimpan.`)
}))

// Organizer Billing Transactions, Checkout, Proof Upload (to Supabase bucket) & Audit Logs
router.get('/billing/transactions', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  const orgs = await db.listOrganizationsForUser(req.user)
  const history = await pricingDb.listOrganizerBillingHistory(
    req.user,
    orgs.map((o) => o.id)
  )
  return sendSuccess(res, history)
}))

router.post('/billing/checkout', requireAuth, requireOrganizerOrAdmin, validateBody(billingCheckoutSchema), asyncHandler(async (req, res) => {
  const { allowed } = await db.isOrgMember(req.validatedBody.organization_id, req.user)
  if (!allowed && req.user.role !== 'admin') {
    throw new AppError('Anda bukan anggota organisasi ini.', 403, 'ORG_FORBIDDEN')
  }
  const result = await pricingDb.createBillingCheckout(req.user, req.validatedBody)
  const isPaid = result.transaction?.status === 'Paid'
  return sendSuccess(
    res,
    result,
    isPaid
      ? 'Paket berhasil diaktifkan.'
      : 'Invoice dibuat. Selesaikan pembayaran & unggah bukti atau konfirmasi ke Admin WhatsApp untuk aktivasi.',
    201
  )
}))

router.post(
  '/billing/transactions/:txId/proof',
  requireAuth,
  requireOrganizerOrAdmin,
  uploadSingleFile.single('file'),
  asyncHandler(async (req, res) => {
    let proofUrl = req.body?.payment_proof_url || ''
    if (req.file) {
      const uploaded = await uploadBufferToStorage({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        folder: 'payment-proofs',
        bucketType: 'documents',
        ownerId: req.user.id
      })
      proofUrl = uploaded.public_url || uploaded.path
    }
    if (!proofUrl) {
      throw new AppError('Unggah gambar bukti pembayaran terlebih dahulu.', 400, 'PROOF_REQUIRED')
    }
    const tx = await pricingDb.submitTransactionProof(req.params.txId, req.user, {
      payment_proof_url: proofUrl,
      payment_notes: req.body?.payment_notes || ''
    })
    return sendSuccess(res, tx, 'Bukti pembayaran berhasil dikirim ke Admin untuk verifikasi.')
  })
)

export default router
