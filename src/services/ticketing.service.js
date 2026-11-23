import * as db from '../repositories/db.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/response.js'
import {
  attachTicketQr,
  createQrDownloadToken,
  generateTicketQrDataUrl,
  generateTicketQrSvg,
  verifyQrDownloadToken
} from '../utils/qrcode.js'
import { generateTicketsQrPdfBuffer } from './pdf.service.js'
import { sendTicketOrderEmail } from './email.service.js'

export async function createOrderWithQrAndEmail({ event_id, ticket_type_id, quantity, attendee, user }) {
  if (!(await db.isModuleEnabled(event_id, 'ticketing'))) {
    throw new AppError('Modul ticketing sedang tidak aktif pada event ini.', 403, 'MODULE_DISABLED')
  }

  const result = await db.createOrder({
    event_id,
    ticket_type_id,
    quantity,
    attendee,
    customer_id: user.id
  })

  const evt = await db.getEventOrThrow(event_id)
  const ticketsWithQr = await Promise.all((result.tickets || []).map((t) => attachTicketQr(t)))

  const emailStatus = await sendTicketOrderEmail({
    to: attendee?.email || user.email,
    customerName: attendee?.full_name || user.full_name,
    eventTitle: evt?.title || 'TERRA Event',
    eventDate: evt?.start_at || evt?.start_date || '-',
    location: evt?.location_name || evt?.venue_name || '-',
    orderId: result.order?.id,
    orderNumber: result.order?.order_number,
    tickets: ticketsWithQr
  })

  return {
    ...result,
    tickets: ticketsWithQr,
    email_status: emailStatus,
    email_notification: emailStatus
  }
}

export async function listOrderTicketsWithQr(orderId) {
  const tickets = await db.listTicketsByOrder(orderId)
  return Promise.all(tickets.map((t) => attachTicketQr(t)))
}

export async function listMyTicketsWithQr(userId) {
  const tickets = await db.listTicketsByCustomer(userId)
  return Promise.all(tickets.map((t) => attachTicketQr(t)))
}

export async function findTicketWithQr(ticketId) {
  const tk = await db.findTicketById(ticketId)
  return attachTicketQr(tk)
}

export async function getTicketQrAssets(ticketId) {
  const tk = await db.findTicketById(ticketId)
  const [qr_data_url, qr_svg] = await Promise.all([
    generateTicketQrDataUrl(tk.qr_payload),
    generateTicketQrSvg(tk.qr_payload)
  ])
  const token = createQrDownloadToken(tk.id)
  return {
    ticket_code: tk.ticket_code,
    qr_payload: tk.qr_payload,
    qr_data_url,
    qr_svg,
    pdf_download_url: `${env.appBaseUrl}/api/v1/tickets/${encodeURIComponent(tk.id)}/qr-pdf?token=${token}`,
    status: tk.status
  }
}

export async function buildTicketQrPdfDownload({ ticketId, token, user }) {
  const tk = await db.findTicketById(ticketId)
  const tokenValid = verifyQrDownloadToken(token, tk.id)
  if (!user && !tokenValid) {
    throw new AppError('Akses unduhan PDF QR tidak valid atau kedaluwarsa.', 401, 'UNAUTHORIZED')
  }

  let event = null
  try {
    event = await db.getEventOrThrow(tk.event_id)
  } catch {
    event = null
  }
  const order = tk.order_id
    ? await db.findOrderById(tk.order_id).catch(() => null)
    : null

  const buffer = await generateTicketsQrPdfBuffer({ tickets: [tk], order, event })
  return { buffer, filename: `tiket-qr-${tk.ticket_code}.pdf` }
}

export async function buildOrderQrPdfDownload({ orderId, token, user }) {
  const order = await db.findOrderById(orderId)
  const tokenValid = verifyQrDownloadToken(token, order.id)
  if (!user && !tokenValid) {
    throw new AppError('Akses unduhan PDF QR tidak valid atau kedaluwarsa.', 401, 'UNAUTHORIZED')
  }

  const tickets = await db.listTicketsByOrder(order.id)
  if (!tickets.length) {
    throw new AppError('Tiket pada order ini tidak ditemukan.', 404, 'TICKET_NOT_FOUND')
  }

  let event = null
  try {
    event = await db.getEventOrThrow(order.event_id)
  } catch {
    event = null
  }

  const buffer = await generateTicketsQrPdfBuffer({ tickets, order, event })
  return { buffer, filename: `tiket-qr-${order.order_number}.pdf` }
}
