import { Router } from 'express'
import { requireAuth, optionalAuth } from '../middleware/auth.middleware.js'
import {
  getUserEventPermissions,
  requireEventPermission,
  requireOrganizerOrAdmin,
  requireResourceEventAccess
} from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody, validateQuery } from '../middleware/validate.middleware.js'
import {
  ticketTypeSchema,
  ticketTypeUpdateSchema,
  orderCreateSchema,
  checkinSchema,
  qrDownloadQuerySchema
} from '../validators/schemas.js'
import * as db from '../repositories/db.js'
import * as ticketingService from '../services/ticketing.service.js'
import { getEmailPreviewById, getEmailPreviewByOrderId } from '../services/email.service.js'
import { uploadBufferToStorage, uploadSingleFile } from '../services/storage.service.js'
import { verifyEmailPreviewToken } from '../utils/qrcode.js'
import { sendSuccess, AppError, asyncHandler } from '../utils/response.js'

const router = Router()

// Ticket Types Management
router.get('/events/:id/ticket-types', requireAuth, requireOrganizerOrAdmin, requireEventModule('ticketing'), requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listTicketTypes(req.params.id))
}))

router.post('/events/:id/ticket-types', requireAuth, requireOrganizerOrAdmin, requireEventModule('ticketing'), requireEventPermission('Manage Tickets'), validateBody(ticketTypeSchema), asyncHandler(async (req, res) => {
  const item = await db.createTicketType(req.params.id, req.validatedBody)
  return sendSuccess(res, item, 'Jenis tiket dibuat.', 201)
}))

router.patch(
  '/ticket-types/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findTicketTypeEventId,
    moduleKey: 'ticketing',
    permission: 'Manage Tickets'
  }),
  validateBody(ticketTypeUpdateSchema),
  asyncHandler(async (req, res) => {
    const tkt = await db.updateTicketType(req.params.id, req.validatedBody)
    return sendSuccess(res, tkt, 'Jenis tiket diperbarui.')
  })
)

router.delete(
  '/ticket-types/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findTicketTypeEventId,
    moduleKey: 'ticketing',
    permission: 'Manage Tickets'
  }),
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await db.deleteTicketType(req.params.id), 'Jenis tiket dihapus.')
  })
)

// Orders
router.get('/events/:id/orders', requireAuth, requireOrganizerOrAdmin, requireEventModule('ticketing'), requireEventPermission('Manage Tickets'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listOrdersByEvent(req.params.id))
}))

router.post('/events/:id/orders/:orderId/verify-payment', requireAuth, requireOrganizerOrAdmin, requireEventModule('ticketing'), requireEventPermission('Manage Tickets'), asyncHandler(async (req, res) => {
  const result = await ticketingService.verifyOrderAndSendEmail(req.params.id, req.params.orderId, req.user)
  return sendSuccess(res, result, 'Pembayaran order diverifikasi dan e-tiket QR diaktifkan.')
}))

router.get('/orders/my', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listOrdersByCustomer(req.user.id))
}))

router.get('/orders/:id', requireAuth, asyncHandler(async (req, res) => {
  const order = await ticketingService.assertOrderAccessById(req.params.id, req.user)
  return sendSuccess(res, order)
}))

router.post('/orders', requireAuth, validateBody(orderCreateSchema), asyncHandler(async (req, res) => {
  const result = await ticketingService.createOrderWithQrAndEmail({
    ...req.validatedBody,
    user: req.user
  })
  const msg = result.order?.order_status === 'Confirmed'
    ? 'Pesanan berhasil dibuat dan email QR telah dikirim.'
    : 'Pesanan berhasil dibuat. Unggah bukti pembayaran atau tunggu verifikasi penyelenggara untuk mengaktifkan QR.'
  return sendSuccess(res, result, msg, 201)
}))

router.post(
  '/orders/:id/payment-proof',
  requireAuth,
  uploadSingleFile.single('file'),
  asyncHandler(async (req, res) => {
    let proofUrl = req.body?.payment_proof_url || ''
    if (req.file) {
      const uploaded = await uploadBufferToStorage({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        folder: `orders/${req.params.id}/proofs`,
        bucketType: 'documents',
        ownerId: req.user.id
      })
      proofUrl = uploaded.path
    }
    if (!proofUrl) {
      throw new AppError('Unggah gambar/dokumen bukti pembayaran terlebih dahulu.', 400, 'PROOF_REQUIRED')
    }
    const updated = await db.submitOrderPaymentProof(req.params.id, req.user, {
      payment_proof_url: proofUrl,
      payment_notes: req.body?.payment_notes || ''
    })
    return sendSuccess(res, updated, 'Bukti pembayaran berhasil dikirim ke penyelenggara.')
  })
)

router.post('/orders/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  const existing = await db.findOrderById(req.params.id)
  let authorized = req.user.role === 'admin' || existing.customer_id === req.user.id
  if (!authorized && existing.event_id) {
    const perms = await getUserEventPermissions(req.user, existing.event_id)
    authorized = perms.includes('Manage Tickets')
  }
  const order = await db.cancelOrder(req.params.id, req.user.id, authorized)
  return sendSuccess(res, order, 'Pesanan dibatalkan dan kuota tiket dikembalikan.')
}))

// Email Preview & PDF QR Downloads (Accessible via Auth or Signed Email Token)
router.get('/orders/:id/email-preview', requireAuth, asyncHandler(async (req, res) => {
  await ticketingService.assertOrderAccessById(req.params.id, req.user)
  return sendSuccess(res, getEmailPreviewByOrderId(req.params.id))
}))

router.get('/emails/:id/preview', optionalAuth, asyncHandler(async (req, res) => {
  const email = getEmailPreviewById(req.params.id)
  const tokenValid = verifyEmailPreviewToken(req.query?.token, req.params.id)
  if (!tokenValid) {
    if (!req.user) {
      throw new AppError('Akses pratinjau email membutuhkan token atau autentikasi valid.', 401, 'UNAUTHORIZED')
    }
    if (email.order_id) {
      await ticketingService.assertOrderAccessById(email.order_id, req.user)
    } else if (req.user.role !== 'admin') {
      throw new AppError('Anda tidak memiliki izin mengakses pratinjau email ini.', 403, 'FORBIDDEN')
    }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.status(200).send(email.html)
}))

router.get(
  '/orders/:id/qr-pdf',
  optionalAuth,
  validateQuery(qrDownloadQuerySchema),
  asyncHandler(async (req, res) => {
    const { buffer, filename } = await ticketingService.buildOrderQrPdfDownload({
      orderId: req.params.id,
      token: req.validatedQuery.token,
      user: req.user
    })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(buffer)
  })
)

router.get(
  '/tickets/:id/qr-pdf',
  optionalAuth,
  validateQuery(qrDownloadQuerySchema),
  asyncHandler(async (req, res) => {
    const { buffer, filename } = await ticketingService.buildTicketQrPdfDownload({
      ticketId: req.params.id,
      token: req.validatedQuery.token,
      user: req.user
    })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(buffer)
  })
)

// Digital Tickets & Check-in Scanner
router.get('/orders/:id/tickets', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await ticketingService.listOrderTicketsWithQr(req.params.id, req.user))
}))

router.get('/tickets/my', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await ticketingService.listMyTicketsWithQr(req.user.id))
}))

router.get('/tickets/:id', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await ticketingService.findTicketWithQr(req.params.id, req.user))
}))

router.get('/tickets/:id/qr', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await ticketingService.getTicketQrAssets(req.params.id, req.user))
}))

async function assertTicketCheckinPermission(user, code, explicitEventId = null) {
  const eventId = explicitEventId || (await db.findTicketEventIdByCode(code))
  if (eventId) {
    const active = await db.isModuleEnabled(eventId, 'check_in')
    if (!active) {
      throw new AppError('Modul check_in sedang tidak aktif pada event ini.', 403, 'MODULE_DISABLED')
    }
    if (user && user.role !== 'admin') {
      const perms = await getUserEventPermissions(user, eventId)
      if (!perms.includes('Manage Check-in')) {
        throw new AppError(
          'Akses ditolak: Anda tidak memiliki izin "Manage Check-in" untuk event ini.',
          403,
          'FORBIDDEN_PERMISSION'
        )
      }
    }
  }
}

router.post('/tickets/validate', requireAuth, requireOrganizerOrAdmin, validateBody(checkinSchema), asyncHandler(async (req, res) => {
  await assertTicketCheckinPermission(req.user, req.validatedBody.code, req.validatedBody.event_id || null)
  const result = await db.validateOrCheckIn(
    req.validatedBody.code,
    req.validatedBody.station,
    req.user.id,
    false,
    req.validatedBody.event_id || null
  )
  return sendSuccess(res, result, 'Tiket valid dan siap untuk check-in.')
}))

router.get('/events/:id/check-ins', requireAuth, requireOrganizerOrAdmin, requireEventModule('check_in'), requireEventPermission('Manage Check-in'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listCheckins(req.params.id))
}))

router.post('/tickets/check-in', requireAuth, requireOrganizerOrAdmin, validateBody(checkinSchema), asyncHandler(async (req, res) => {
  await assertTicketCheckinPermission(req.user, req.validatedBody.code, req.validatedBody.event_id || null)
  const result = await db.validateOrCheckIn(
    req.validatedBody.code,
    req.validatedBody.station,
    req.user.id,
    true,
    req.validatedBody.event_id || null
  )
  return sendSuccess(res, result, 'Check-in berhasil.')
}))

export default router
