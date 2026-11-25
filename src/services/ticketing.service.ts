import * as db from '../repositories/db.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/response.js'
import {
  attachTicketQr,
  createQrDownloadToken,
  generateBrandedQrBuffer,
  generateBrandedQrDataUrl,
  generateTicketQrSvg,
  verifyQrDownloadToken
} from '../utils/qrcode.js'
import { generateTicketsQrPdfBuffer } from './pdf.service.js'
import { sendTicketOrderEmail } from './email.service.js'
import {
  createMidtransSnapTransaction,
  getPaymentConfigStatus,
  isMidtransConfigured
} from './payment.service.js'

export async function assertOrderOrEventAccess(user, { customer_id = null, event_id = null }) {
  if (!user) throw new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED')
  if (user.role === 'admin') return true
  if (customer_id && customer_id === user.id) return true
  if (event_id) {
    const perms = await db.getUserEventPermissions(user, event_id)
    if (perms.includes('Manage Tickets') || perms.includes('View Participants') || perms.includes('Manage Check-in')) {
      return true
    }
  }
  throw new AppError('Anda tidak memiliki izin mengakses resource tiket/order ini.', 403, 'FORBIDDEN')
}

export async function assertOrderAccessById(orderId, user) {
  const order = await db.findOrderById(orderId)
  await assertOrderOrEventAccess(user, order)
  return order
}

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
  const ticketsWithQr = await Promise.all((result.tickets || []).map((t) => attachTicketQr(t, evt)))

  let payment: any = {
    ...getPaymentConfigStatus(),
    required: Number(result.order?.total || 0) > 0 && result.order?.order_status === 'Pending',
    snap_token: null,
    redirect_url: null,
    midtrans_order_id: result.order?.order_number || null
  }

  if (payment.required && isMidtransConfigured()) {
    const snap = await createMidtransSnapTransaction({
      midtransOrderId: result.order.order_number,
      grossAmount: Number(result.order.total),
      itemDetails: [
        {
          id: String(ticket_type_id).slice(0, 50),
          price: Math.round(Number(result.order.total) / Math.max(1, Number(quantity || 1))),
          quantity: Math.max(1, Number(quantity || 1)),
          name: `${evt?.title || 'TERRA Event'} - ${result.participant?.ticket_type || 'Tiket'}`.slice(0, 50)
        }
      ],
      customerDetails: {
        first_name: attendee?.full_name || user.full_name,
        email: attendee?.email || user.email,
        phone: attendee?.phone || user.phone || undefined
      },
      finishRedirectUrl: `${env.frontendUrl}/checkout/${encodeURIComponent(evt?.slug || evt?.id || event_id)}?order_id=${encodeURIComponent(result.order.order_number)}`,
      expiryMinutes: 1440
    })

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await db.updateOrderPaymentSession(result.order.id, {
      payment_provider: 'midtrans',
      payment_method: 'midtrans_snap',
      payment_token: snap.token,
      payment_redirect_url: snap.redirect_url,
      payment_expires_at: expiresAt,
      payment_metadata: { midtrans_order_id: snap.midtrans_order_id }
    })

    result.order.payment_token = snap.token
    result.order.payment_redirect_url = snap.redirect_url
    payment = {
      ...payment,
      snap_token: snap.token,
      redirect_url: snap.redirect_url,
      midtrans_order_id: snap.midtrans_order_id,
      expires_at: expiresAt.toISOString()
    }
  }

  let emailStatus: any = {
    sent: false,
    delivered_by_provider: false,
    mode: 'deferred-pending-payment',
    reason: 'Menunggu penyelesaian pembayaran melalui Midtrans sebelum e-tiket QR diterbitkan.'
  }

  if (result.order?.order_status === 'Confirmed') {
    emailStatus = await sendTicketOrderEmail({
      to: attendee?.email || user.email,
      customerName: attendee?.full_name || user.full_name,
      eventTitle: evt?.title || 'TERRA Event',
      eventDate: evt?.start_at || evt?.start_date || '-',
      location: evt?.location_name || evt?.venue_name || '-',
      event: evt,
      orderId: result.order?.id,
      orderNumber: result.order?.order_number,
      tickets: ticketsWithQr
    })
  }

  return {
    ...result,
    tickets: ticketsWithQr,
    payment,
    email_status: emailStatus,
    email_notification: emailStatus
  }
}

export async function dispatchSettledOrderEmailAndQr(settledResult: any, fallbackUser: any = null) {
  const order = settledResult?.order
  if (!order) return { ...settledResult, email_status: null }
  const evt = await db.getEventOrThrow(order.event_id).catch(() => null)
  const ticketsWithQr = await Promise.all((settledResult.tickets || []).map((t) => attachTicketQr(t, evt)))

  const recipientEmail = settledResult.participant?.email || fallbackUser?.email
  const customerName = settledResult.participant?.full_name || fallbackUser?.full_name || 'Peserta TERRA'
  let emailStatus = null
  if (recipientEmail && !settledResult.alreadySettled) {
    emailStatus = await sendTicketOrderEmail({
      to: recipientEmail,
      customerName,
      eventTitle: evt?.title || 'TERRA Event',
      eventDate: evt?.start_at || evt?.start_date || '-',
      location: evt?.location_name || evt?.venue_name || '-',
      event: evt,
      orderId: order.id,
      orderNumber: order.order_number,
      tickets: ticketsWithQr
    })
  }

  return {
    ...settledResult,
    tickets: ticketsWithQr,
    email_status: emailStatus
  }
}

export async function verifyOrderAndSendEmail(eventId, orderId, operatorUser) {
  const result = await db.verifyOrderPayment(eventId, orderId, operatorUser)
  return dispatchSettledOrderEmailAndQr(result, operatorUser)
}

async function loadEventMapForTickets(tickets: any[] = []) {
  const eventIds = [...new Set(tickets.map((t) => t?.event_id).filter(Boolean))]
  const entries = await Promise.all(
    eventIds.map(async (id): Promise<[string, any]> => [id, await db.getEventOrThrow(id).catch(() => null)])
  )
  return new Map<string, any>(entries)
}

export async function listOrderTicketsWithQr(orderId, user = null) {
  if (user) await assertOrderAccessById(orderId, user)
  const tickets = await db.listTicketsByOrder(orderId)
  const eventMap = await loadEventMapForTickets(tickets)
  return Promise.all(tickets.map((t) => attachTicketQr(t, eventMap.get(t.event_id) || null)))
}

export async function listMyTicketsWithQr(userId) {
  const tickets = await db.listTicketsByCustomer(userId)
  const eventMap = await loadEventMapForTickets(tickets)
  return Promise.all(tickets.map((t) => attachTicketQr(t, eventMap.get(t.event_id) || null)))
}

async function resolveTicketWithOwnerAccess(ticketId, user) {
  const tk = await db.findTicketById(ticketId)
  if (user) {
    const order = tk.order_id ? await db.findOrderById(tk.order_id).catch(() => null) : null
    await assertOrderOrEventAccess(user, {
      customer_id: order?.customer_id || null,
      event_id: tk.event_id
    })
  }
  return tk
}

export async function findTicketWithQr(ticketId, user = null) {
  const tk = await resolveTicketWithOwnerAccess(ticketId, user)
  const evt = tk.event_id ? await db.getEventOrThrow(tk.event_id).catch(() => null) : null
  return attachTicketQr(tk, evt)
}

export async function getTicketQrAssets(ticketId, user = null) {
  const tk = await resolveTicketWithOwnerAccess(ticketId, user)
  const evt = tk.event_id ? await db.getEventOrThrow(tk.event_id).catch(() => null) : null
  const [qr_data_url, qr_svg] = await Promise.all([
    generateBrandedQrDataUrl(tk.qr_payload, { width: 320, margin: 2, event: evt }),
    generateTicketQrSvg(tk.qr_payload)
  ])
  const token = createQrDownloadToken(tk.id)
  return {
    ticket_code: tk.ticket_code,
    qr_payload: tk.qr_payload,
    qr_data_url,
    qr_svg,
    qr_image_url: `${env.appBaseUrl}/api/v1/tickets/${encodeURIComponent(tk.id)}/qr-image?token=${token}`,
    pdf_download_url: `${env.appBaseUrl}/api/v1/tickets/${encodeURIComponent(tk.id)}/qr-pdf?token=${token}`,
    status: tk.status
  }
}

export async function buildTicketQrImageDownload({ ticketId, token, user }) {
  const tk = await db.findTicketById(ticketId)
  const tokenValid = verifyQrDownloadToken(token, tk.id)
  if (!tokenValid) {
    if (!user) {
      throw new AppError('Akses gambar QR tidak valid atau kedaluwarsa.', 401, 'UNAUTHORIZED')
    }
    const order = tk.order_id ? await db.findOrderById(tk.order_id).catch(() => null) : null
    await assertOrderOrEventAccess(user, {
      customer_id: order?.customer_id || null,
      event_id: tk.event_id
    })
  }

  const evt = tk.event_id ? await db.getEventOrThrow(tk.event_id).catch(() => null) : null
  const buffer = await generateBrandedQrBuffer(tk.qr_payload, { width: 360, margin: 2, event: evt })
  return { buffer, filename: `qr-${tk.ticket_code}.png` }
}

export async function buildTicketQrPdfDownload({ ticketId, token, user }) {
  const tk = await db.findTicketById(ticketId)
  const tokenValid = verifyQrDownloadToken(token, tk.id)
  if (!tokenValid) {
    if (!user) {
      throw new AppError('Akses unduhan PDF QR tidak valid atau kedaluwarsa.', 401, 'UNAUTHORIZED')
    }
    const order = tk.order_id ? await db.findOrderById(tk.order_id).catch(() => null) : null
    await assertOrderOrEventAccess(user, {
      customer_id: order?.customer_id || null,
      event_id: tk.event_id
    })
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
  if (!tokenValid) {
    if (!user) {
      throw new AppError('Akses unduhan PDF QR tidak valid atau kedaluwarsa.', 401, 'UNAUTHORIZED')
    }
    await assertOrderOrEventAccess(user, order)
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
