import { Router } from 'express'
import { requireAuth, optionalAuth } from '../middleware/auth.middleware.js'
import {
  getUserEventPermissions,
  requireEventPermission,
  requireOrganizerOrAdmin
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
import { sendSuccess, AppError, asyncHandler } from '../utils/response.js'

const router = Router()

// Ticket Types Management
router.get('/events/:id/ticket-types', requireAuth, requireEventModule('ticketing'), requireEventPermission('Manage Tickets'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listTicketTypes(req.params.id))
}))

router.post('/events/:id/ticket-types', requireAuth, requireOrganizerOrAdmin, requireEventModule('ticketing'), requireEventPermission('Manage Tickets'), validateBody(ticketTypeSchema), asyncHandler(async (req, res) => {
  const item = await db.createTicketType(req.params.id, req.validatedBody)
  return sendSuccess(res, item, 'Jenis tiket dibuat.', 201)
}))

router.patch('/ticket-types/:id', requireAuth, requireOrganizerOrAdmin, validateBody(ticketTypeUpdateSchema), asyncHandler(async (req, res) => {
  const tkt = await db.updateTicketType(req.params.id, req.validatedBody)
  return sendSuccess(res, tkt, 'Jenis tiket diperbarui.')
}))

router.delete('/ticket-types/:id', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.deleteTicketType(req.params.id), 'Jenis tiket dihapus.')
}))

// Orders
router.get('/events/:id/orders', requireAuth, requireOrganizerOrAdmin, requireEventModule('ticketing'), requireEventPermission('Manage Tickets'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listOrdersByEvent(req.params.id))
}))

router.get('/orders/my', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listOrdersByCustomer(req.user.id))
}))

router.get('/orders/:id', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.findOrderById(req.params.id))
}))

router.post('/orders', requireAuth, validateBody(orderCreateSchema), asyncHandler(async (req, res) => {
  const result = await ticketingService.createOrderWithQrAndEmail({
    ...req.validatedBody,
    user: req.user
  })
  return sendSuccess(res, result, 'Pesanan berhasil dibuat dan email QR telah dikirim.', 201)
}))

router.post('/orders/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  const order = await db.cancelOrder(req.params.id, req.user.id, req.user.role === 'admin')
  return sendSuccess(res, order, 'Pesanan dibatalkan dan kuota tiket dikembalikan.')
}))

// Email Preview & PDF QR Downloads (Accessible via Auth or Signed Email Token)
router.get('/orders/:id/email-preview', requireAuth, (req, res) => {
  return sendSuccess(res, getEmailPreviewByOrderId(req.params.id))
})

router.get('/emails/:id/preview', (req, res) => {
  const email = getEmailPreviewById(req.params.id)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.status(200).send(email.html)
})

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
  return sendSuccess(res, await ticketingService.listOrderTicketsWithQr(req.params.id))
}))

router.get('/tickets/my', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await ticketingService.listMyTicketsWithQr(req.user.id))
}))

router.get('/tickets/:id', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await ticketingService.findTicketWithQr(req.params.id))
}))

router.get('/tickets/:id/qr', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await ticketingService.getTicketQrAssets(req.params.id))
}))

async function assertTicketCheckinPermission(user, code) {
  if (!user || user.role === 'admin') return
  const eventId = await db.findTicketEventIdByCode(code)
  if (eventId) {
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

router.post('/tickets/validate', requireAuth, requireOrganizerOrAdmin, validateBody(checkinSchema), asyncHandler(async (req, res) => {
  await assertTicketCheckinPermission(req.user, req.validatedBody.code)
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
  await assertTicketCheckinPermission(req.user, req.validatedBody.code)
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
