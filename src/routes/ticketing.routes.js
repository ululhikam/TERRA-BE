import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireOrganizerOrAdmin } from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { ticketTypeSchema, orderCreateSchema, checkinSchema } from '../validators/schemas.js'
import { store } from '../repositories/store.js'
import { sendSuccess, AppError } from '../utils/response.js'

const router = Router()

// Ticket Types Management
router.get('/events/:id/ticket-types', requireAuth, requireEventModule('ticketing'), (req, res) => {
  return sendSuccess(res, store.ticketTypes.filter((t) => t.event_id === req.params.id))
})

router.post('/events/:id/ticket-types', requireAuth, requireOrganizerOrAdmin, requireEventModule('ticketing'), validateBody(ticketTypeSchema), (req, res) => {
  const item = {
    id: 'tkt-' + Date.now(),
    event_id: req.params.id,
    sold_quantity: 0,
    ...req.validatedBody
  }
  store.ticketTypes.push(item)
  return sendSuccess(res, item, 'Jenis tiket dibuat.', 201)
})

router.patch('/ticket-types/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const tkt = store.ticketTypes.find((t) => t.id === req.params.id)
  if (!tkt) throw new AppError('Jenis tiket tidak ditemukan.', 404, 'TICKET_TYPE_NOT_FOUND')
  if (req.body.quantity !== undefined && Number(req.body.quantity) < tkt.sold_quantity) {
    throw new AppError('Kuota tidak boleh lebih kecil dari jumlah tiket yang sudah terjual.', 400, 'INVALID_QUOTA')
  }
  Object.assign(tkt, req.body)
  return sendSuccess(res, tkt, 'Jenis tiket diperbarui.')
})

router.delete('/ticket-types/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  store.ticketTypes = store.ticketTypes.filter((t) => t.id !== req.params.id)
  return sendSuccess(res, { id: req.params.id }, 'Jenis tiket dihapus.')
})

// Orders
router.get('/events/:id/orders', requireAuth, requireOrganizerOrAdmin, requireEventModule('ticketing'), (req, res) => {
  return sendSuccess(res, store.orders.filter((o) => o.event_id === req.params.id))
})

router.get('/orders/my', requireAuth, (req, res) => {
  return sendSuccess(res, store.orders.filter((o) => o.customer_id === req.user.id))
})

router.get('/orders/:id', requireAuth, (req, res) => {
  const order = store.orders.find((o) => o.id === req.params.id)
  if (!order) throw new AppError('Order tidak ditemukan.', 404, 'ORDER_NOT_FOUND')
  return sendSuccess(res, order)
})

router.post('/orders', requireAuth, validateBody(orderCreateSchema), (req, res) => {
  if (!store.isModuleEnabled(req.validatedBody.event_id, 'ticketing')) {
    throw new AppError('Modul ticketing sedang tidak aktif pada event ini.', 403, 'MODULE_DISABLED')
  }
  const result = store.createOrder({
    ...req.validatedBody,
    customer_id: req.user.id
  })
  return sendSuccess(res, result, 'Pesanan berhasil dibuat.', 201)
})

router.post('/orders/:id/cancel', requireAuth, (req, res) => {
  const order = store.cancelOrder(req.params.id, req.user.id, req.user.role === 'admin')
  return sendSuccess(res, order, 'Order dibatalkan dan kuota tiket dikembalikan.')
})

// Digital Tickets & Check-in Scanner
router.get('/orders/:id/tickets', requireAuth, (req, res) => {
  return sendSuccess(res, store.tickets.filter((t) => t.order_id === req.params.id))
})

router.get('/tickets/my', requireAuth, (req, res) => {
  const myOrderIds = new Set(store.orders.filter((o) => o.customer_id === req.user.id).map((o) => o.id))
  return sendSuccess(res, store.tickets.filter((t) => myOrderIds.has(t.order_id)))
})

router.get('/tickets/:id', requireAuth, (req, res) => {
  const tk = store.tickets.find((t) => t.id === req.params.id)
  if (!tk) throw new AppError('Tiket tidak ditemukan.', 404, 'TICKET_NOT_FOUND')
  return sendSuccess(res, tk)
})

router.get('/tickets/:id/qr', requireAuth, (req, res) => {
  const tk = store.tickets.find((t) => t.id === req.params.id)
  if (!tk) throw new AppError('Tiket tidak ditemukan.', 404, 'TICKET_NOT_FOUND')
  return sendSuccess(res, { ticket_code: tk.ticket_code, qr_payload: tk.qr_payload, status: tk.status })
})

router.post('/tickets/validate', requireAuth, requireOrganizerOrAdmin, validateBody(checkinSchema), (req, res) => {
  const result = store.validateOrCheckIn(req.validatedBody.code, req.validatedBody.station, req.user.id, false)
  return sendSuccess(res, result, 'Tiket valid dan siap untuk check-in.')
})

router.get('/events/:id/check-ins', requireAuth, requireOrganizerOrAdmin, requireEventModule('check_in'), (req, res) => {
  return sendSuccess(res, store.checkinLogs.filter((c) => c.event_id === req.params.id))
})

router.post('/tickets/check-in', requireAuth, requireOrganizerOrAdmin, validateBody(checkinSchema), (req, res) => {
  const result = store.validateOrCheckIn(req.validatedBody.code, req.validatedBody.station, req.user.id, true)
  return sendSuccess(res, result, 'Check-in berhasil.')
})

export default router
