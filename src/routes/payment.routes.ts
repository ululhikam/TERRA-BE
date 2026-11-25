import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireOrganizerOrAdmin } from '../middleware/role.middleware.js'
import { getPaymentConfigStatus } from '../services/payment.service.js'
import * as paymentOrchestrator from '../services/payment-orchestrator.service.js'
import { sendSuccess, asyncHandler } from '../utils/response.js'

const router = Router()

// Public Midtrans client config (client_key & snap.js URL only — NEVER exposes server_key)
router.get('/payments/config', (_req, res) => {
  return sendSuccess(res, getPaymentConfigStatus())
})

// Customer / Organizer Order Snap Token & Live Sync
router.post(
  '/payments/orders/:orderId/snap-token',
  requireAuth,
  asyncHandler(async (req, res) => {
    const forceNew = Boolean(req.body?.force_new)
    const session = await paymentOrchestrator.createOrGetOrderSnapSession(req.params.orderId, req.user, { forceNew })
    return sendSuccess(res, session, 'Token pembayaran Midtrans Snap siap digunakan.')
  })
)

router.post(
  '/payments/orders/:orderId/sync',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await paymentOrchestrator.syncOrderWithMidtrans(req.params.orderId, req.user)
    return sendSuccess(res, result, 'Status pembayaran order berhasil disinkronkan.')
  })
)

// Organizer Billing Snap Token & Live Sync
router.post(
  '/payments/billing/:txId/snap-token',
  requireAuth,
  requireOrganizerOrAdmin,
  asyncHandler(async (req, res) => {
    const forceNew = Boolean(req.body?.force_new)
    const session = await paymentOrchestrator.createOrGetBillingSnapSession(req.params.txId, req.user, { forceNew })
    return sendSuccess(res, session, 'Token pembayaran billing Midtrans Snap siap digunakan.')
  })
)

router.post(
  '/payments/billing/:txId/sync',
  requireAuth,
  requireOrganizerOrAdmin,
  asyncHandler(async (req, res) => {
    const result = await paymentOrchestrator.syncBillingWithMidtrans(req.params.txId, req.user)
    return sendSuccess(res, result, 'Status transaksi billing berhasil disinkronkan.')
  })
)

// Midtrans Server-to-Server Webhook (Verified via SHA-512 signature_key)
router.post(
  '/payments/midtrans/webhook',
  asyncHandler(async (req, res) => {
    const result = await paymentOrchestrator.processMidtransWebhook(req.body || {})
    return sendSuccess(res, result, 'Webhook Midtrans diproses.')
  })
)

export default router
