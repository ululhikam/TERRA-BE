import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import {
  getUserEventPermissions,
  requireEventPermission,
  requireOrganizerOrAdmin
} from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { ticketTypeSchema, orderCreateSchema, checkinSchema } from '../validators/schemas.js'
import * as db from '../repositories/db.js'
import { sendTicketOrderEmail } from '../services/email.service.js'
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

router.patch('/ticket-types/:id', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  const tkt = await db.updateTicketType(req.params.id, req.body)
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
  if (!(await db.isModuleEnabled(req.validatedBody.event_id, 'ticketing'))) {
    throw new AppError('Modul ticketing sedang tidak aktif pada event ini.', 403, 'MODULE_DISABLED')
  }
  const result = await db.createOrder({
    ...req.validatedBody,
    customer_id: req.user.id
  })
  const evt = await db.getEventOrThrow(req.validatedBody.event_id)
  const emailStatus = await sendTicketOrderEmail({
    to: req.validatedBody.email || req.validatedBody.attendee?.email || req.user.email,
    customerName:
      req.validatedBody.full_name || req.validatedBody.attendee?.full_name || req.user.full_name,
    eventTitle: evt?.title || 'TERRA Event',
    eventDate: evt?.start_at || evt?.start_date || '-',
    location: evt?.location_name || evt?.venue_name || '-',
    orderNumber: result.order.order_number,
    tickets: result.tickets || []
  })
  return sendSuccess(res, { ...result, email_status: emailStatus }, 'Pesanan berhasil dibuat.', 201)
}))

router.post('/orders/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  const order = await db.cancelOrder(req.params.id, req.user.id, req.user.role === 'admin')
  return sendSuccess(res, order, 'Pesanan dibatalkan dan kuota tiket dikembalikan.')
}))

// Digital Tickets & Check-in Scanner
router.get('/orders/:id/tickets', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listTicketsByOrder(req.params.id))
}))

router.get('/tickets/my', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listTicketsByCustomer(req.user.id))
}))

router.get('/tickets/:id', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.findTicketById(req.params.id))
}))

router.get('/tickets/:id/qr', requireAuth, asyncHandler(async (req, res) => {
  const tk = await db.findTicketById(req.params.id)
  return sendSuccess(res, { ticket_code: tk.ticket_code, qr_payload: tk.qr_payload, status: tk.status })
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
  const result = await db.validateOrCheckIn(req.validatedBody.code, req.validatedBody.station, req.user.id, false)
  return sendSuccess(res, result, 'Tiket valid dan siap untuk check-in.')
}))

router.get('/events/:id/check-ins', requireAuth, requireOrganizerOrAdmin, requireEventModule('check_in'), requireEventPermission('Manage Check-in'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listCheckins(req.params.id))
}))

router.post('/tickets/check-in', requireAuth, requireOrganizerOrAdmin, validateBody(checkinSchema), asyncHandler(async (req, res) => {
  await assertTicketCheckinPermission(req.user, req.validatedBody.code)
  const result = await db.validateOrCheckIn(req.validatedBody.code, req.validatedBody.station, req.user.id, true)
  return sendSuccess(res, result, 'Check-in berhasil.')
}))

export default router
