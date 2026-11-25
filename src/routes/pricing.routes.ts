import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireEventPermission, requireOrganizerOrAdmin } from '../middleware/role.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { billingCheckoutSchema, billingPreviewSchema, subscribeCheckoutSchema } from '../validators/schemas.js'
import { uploadBufferToStorage, uploadSingleFile } from '../services/storage.service.js'
import { createOrGetBillingSnapSession } from '../services/payment-orchestrator.service.js'
import { getPaymentConfigStatus, isMidtransConfigured } from '../services/payment.service.js'
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

router.post('/billing/subscribe', requireAuth, requireOrganizerOrAdmin, validateBody(subscribeCheckoutSchema), asyncHandler(async (req, res) => {
  const { organization_id, force_new } = req.validatedBody
  const result = await pricingDb.createOrReuseSubscriptionCheckout(req.user, {
    organization_id: organization_id || null,
    force_new: Boolean(force_new)
  })
  let payment: any = {
    ...getPaymentConfigStatus(),
    required: true,
    snap_token: result.transaction?.payment_token || null,
    redirect_url: result.transaction?.payment_redirect_url || null,
    midtrans_order_id:
      result.transaction?.payment_metadata?.midtrans_order_id || result.transaction?.invoice_number || null
  }

  if (isMidtransConfigured()) {
    const session = await createOrGetBillingSnapSession(result.transaction.id, req.user, {
      forceNew: Boolean(force_new)
    })
    payment = {
      ...payment,
      snap_token: session.snap_token,
      redirect_url: session.redirect_url,
      midtrans_order_id: session.midtrans_order_id
    }
  }

  return sendSuccess(
    res,
    {
      ...result,
      payment,
      subscription_price_idr: pricingDb.SUBSCRIPTION_PRICE_IDR
    },
    'Invoice langganan Rp 50.000/bulan siap dibayar melalui Midtrans.',
    201
  )
}))

router.post('/billing/checkout', requireAuth, requireOrganizerOrAdmin, validateBody(billingCheckoutSchema), asyncHandler(async (req, res) => {
  if (req.validatedBody.organization_id) {
    const { allowed } = await db.isOrgMember(req.validatedBody.organization_id, req.user)
    if (!allowed && req.user.role !== 'admin') {
      throw new AppError('Anda bukan anggota organisasi ini.', 403, 'ORG_FORBIDDEN')
    }
  }
  const result = await pricingDb.createBillingCheckout(req.user, req.validatedBody)
  const isPaid = result.transaction?.status === 'Paid'
  let payment: any = {
    ...getPaymentConfigStatus(),
    required: !isPaid && Number(result.transaction?.final_amount_idr || 0) > 0,
    snap_token: null,
    redirect_url: null,
    midtrans_order_id: result.transaction?.invoice_number || null
  }

  if (payment.required && isMidtransConfigured()) {
    const session = await createOrGetBillingSnapSession(result.transaction.id, req.user)
    payment = {
      ...payment,
      snap_token: session.snap_token,
      redirect_url: session.redirect_url,
      midtrans_order_id: session.midtrans_order_id
    }
  }

  return sendSuccess(
    res,
    {
      ...result,
      payment
    },
    isPaid
      ? 'Langganan berhasil diaktifkan.'
      : 'Invoice dibuat. Selesaikan pembayaran melalui Midtrans untuk aktivasi otomatis.',
    201
  )
}))

router.post(
  '/billing/transactions/:txId/proof',
  requireAuth,
  requireOrganizerOrAdmin,
  asyncHandler(async (_req, _res) => {
    throw new AppError(
      'Pembayaran manual & WhatsApp Admin dinonaktifkan. Gunakan pembayaran otomatis Midtrans.',
      410,
      'MANUAL_PAYMENT_DISABLED'
    )
  })
)

export default router
