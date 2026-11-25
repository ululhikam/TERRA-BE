import { env } from '../config/env.js'
import * as db from '../repositories/db.js'
import * as pricingDb from '../repositories/pricing.db.js'
import * as ticketingService from './ticketing.service.js'
import {
  buildRetryMidtransOrderId,
  cancelMidtransTransaction,
  createMidtransSnapTransaction,
  extractBaseOrderReference,
  fetchMidtransTransactionStatus,
  getPaymentConfigStatus,
  isMidtransConfigured,
  mapMidtransTransactionState,
  verifyMidtransSignature
} from './payment.service.js'
import { AppError } from '../utils/response.js'

export async function ensureBillingAccess(txRecord: any, user: any) {
  if (!user) throw new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED')
  if (user.role === 'admin' || txRecord.organizer_id === user.id) return true
  const { allowed } = await db.isOrgMember(txRecord.organization_id, user)
  if (!allowed) {
    throw new AppError('Anda tidak memiliki izin mengakses transaksi billing ini.', 403, 'FORBIDDEN')
  }
  return true
}

export async function createOrGetOrderSnapSession(orderId: string, user: any, { forceNew = false } = {}) {
  const order = await ticketingService.assertOrderAccessById(orderId, user)

  if (order.order_status === 'Cancelled') {
    throw new AppError('Order telah dibatalkan.', 409, 'ORDER_ALREADY_CANCELLED')
  }
  if (['Paid', 'Verified', 'Not Required'].includes(order.payment_status) || order.order_status === 'Confirmed') {
    throw new AppError('Order ini sudah lunas atau tidak memerlukan pembayaran.', 409, 'PAYMENT_ALREADY_SETTLED')
  }
  if (Number(order.total || 0) <= 0) {
    throw new AppError('Order gratis tidak memerlukan payment gateway.', 400, 'ZERO_AMOUNT_ORDER')
  }

  const cachedToken = order.payment_token
  const notExpired = !order.payment_expires_at || new Date(order.payment_expires_at).getTime() > Date.now()
  if (!forceNew && cachedToken && notExpired) {
    return {
      ...getPaymentConfigStatus(),
      order_id: order.id,
      order_number: order.order_number,
      snap_token: cachedToken,
      redirect_url: order.payment_redirect_url || '',
      midtrans_order_id: order.payment_metadata?.midtrans_order_id || order.order_number,
      gross_amount: Math.round(Number(order.total))
    }
  }

  if (forceNew) {
    const prevMidtransOrderId =
      order.payment_metadata?.midtrans_order_id || (cachedToken ? order.order_number : null)
    if (prevMidtransOrderId && isMidtransConfigured()) {
      await cancelMidtransTransaction(prevMidtransOrderId)
    }
  }

  const evt = await db.getEventOrThrow(order.event_id).catch(() => null)
  const tickets = await db.listTicketsByOrder(order.id).catch(() => [])
  const attendee = order.customer_id ? await db.findUserById(order.customer_id, 'customer').catch(() => null) : null
  const midtransOrderId = cachedToken || forceNew ? buildRetryMidtransOrderId(order.order_number) : order.order_number
  const qty = Math.max(1, Number(order.quantity || 1))
  const ticketName = tickets[0]?.ticket_type || 'Tiket Event'

  const snap = await createMidtransSnapTransaction({
    midtransOrderId,
    grossAmount: Number(order.total),
    itemDetails: [
      {
        id: String(order.ticket_type_id || order.id).slice(0, 50),
        price: Math.round(Number(order.total) / qty),
        quantity: qty,
        name: `${evt?.title || 'TERRA Event'} - ${ticketName}`.slice(0, 50)
      }
    ],
    customerDetails: {
      first_name: tickets[0]?.participant_name || attendee?.full_name || user?.full_name,
      email: attendee?.email || user?.email,
      phone: attendee?.phone || user?.phone || undefined
    },
    finishRedirectUrl: `${env.frontendUrl}/checkout/${encodeURIComponent(evt?.slug || order.event_id)}?order_id=${encodeURIComponent(order.order_number)}`,
    expiryMinutes: 1440
  })

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await db.updateOrderPaymentSession(order.id, {
    payment_provider: 'midtrans',
    payment_method: 'midtrans_snap',
    payment_token: snap.token,
    payment_redirect_url: snap.redirect_url,
    payment_expires_at: expiresAt,
    payment_metadata: { midtrans_order_id: snap.midtrans_order_id }
  })

  return {
    ...getPaymentConfigStatus(),
    order_id: order.id,
    order_number: order.order_number,
    snap_token: snap.token,
    redirect_url: snap.redirect_url,
    midtrans_order_id: snap.midtrans_order_id,
    gross_amount: Math.round(Number(order.total))
  }
}

export async function createOrGetBillingSnapSession(txId: string, user: any, { forceNew = false } = {}) {
  const txRecord = await pricingDb.findBillingTransactionByIdOrInvoice(txId)
  await ensureBillingAccess(txRecord, user)

  if (txRecord.status === 'Paid') {
    throw new AppError('Invoice billing ini sudah lunas.', 409, 'TX_ALREADY_PAID')
  }
  if (Number(txRecord.final_amount_idr || 0) <= 0) {
    throw new AppError('Nominal invoice Rp 0 tidak memerlukan payment gateway.', 400, 'ZERO_AMOUNT_TX')
  }

  const cachedToken = txRecord.payment_token
  const notExpired = !txRecord.expires_at || new Date(txRecord.expires_at).getTime() > Date.now()
  if (!forceNew && cachedToken && notExpired && txRecord.status === 'Pending') {
    return {
      ...getPaymentConfigStatus(),
      transaction_id: txRecord.id,
      invoice_number: txRecord.invoice_number,
      snap_token: cachedToken,
      redirect_url: txRecord.payment_redirect_url || '',
      midtrans_order_id: txRecord.payment_metadata?.midtrans_order_id || txRecord.invoice_number,
      gross_amount: Math.round(Number(txRecord.final_amount_idr))
    }
  }

  if (forceNew) {
    const prevMidtransOrderId =
      txRecord.payment_metadata?.midtrans_order_id || (cachedToken ? txRecord.invoice_number : null)
    if (prevMidtransOrderId && isMidtransConfigured()) {
      await cancelMidtransTransaction(prevMidtransOrderId)
    }
  }

  const midtransOrderId =
    cachedToken || forceNew || txRecord.status !== 'Pending'
      ? buildRetryMidtransOrderId(txRecord.invoice_number)
      : txRecord.invoice_number

  const returnPath = `/dashboard/billing?invoice=${encodeURIComponent(txRecord.invoice_number)}`

  const snap = await createMidtransSnapTransaction({
    midtransOrderId,
    grossAmount: Number(txRecord.final_amount_idr),
    itemDetails: [
      {
        id: String(txRecord.plan_code || txRecord.target_type || 'monthly_50k').slice(0, 50),
        price: Math.round(Number(txRecord.final_amount_idr)),
        quantity: 1,
        name: `TERRA ${txRecord.plan_name}`.slice(0, 50)
      }
    ],
    customerDetails: {
      first_name: user?.full_name || txRecord.organization?.name || 'Organizer TERRA',
      email: user?.email || txRecord.organization?.email,
      phone: user?.phone || txRecord.organization?.phone || undefined
    },
    finishRedirectUrl: `${env.frontendUrl}${returnPath}`,
    expiryMinutes: 1440
  })

  await pricingDb.updateBillingPaymentSession(txRecord.id, {
    ...(txRecord.status === 'Expired' || forceNew ? { status: 'Pending' } : {}),
    payment_provider: 'midtrans',
    payment_method: 'payment_gateway',
    payment_token: snap.token,
    payment_redirect_url: snap.redirect_url,
    payment_metadata: { midtrans_order_id: snap.midtrans_order_id }
  })

  return {
    ...getPaymentConfigStatus(),
    transaction_id: txRecord.id,
    invoice_number: txRecord.invoice_number,
    snap_token: snap.token,
    redirect_url: snap.redirect_url,
    midtrans_order_id: snap.midtrans_order_id,
    gross_amount: Math.round(Number(txRecord.final_amount_idr))
  }
}

export async function applyMidtransStateToOrder(order: any, normalizedState: string, gatewayPayload: any, fallbackUser: any = null) {
  if (normalizedState === 'settled') {
    const settled = await db.settleOrderFromGateway(order.id, {
      provider: 'midtrans',
      payment_type: gatewayPayload.payment_type || 'midtrans_snap',
      transaction_id: gatewayPayload.transaction_id || null,
      metadata: {
        midtrans_order_id: gatewayPayload.order_id || order.order_number,
        transaction_status: gatewayPayload.transaction_status || 'settlement',
        payment_type: gatewayPayload.payment_type || null,
        transaction_id: gatewayPayload.transaction_id || null
      }
    })
    const dispatched = await ticketingService.dispatchSettledOrderEmailAndQr(settled, fallbackUser)
    return {
      payment_state: 'settled',
      already_settled: Boolean(settled.alreadySettled),
      order: dispatched.order,
      tickets: dispatched.tickets,
      email_status: dispatched.email_status
    }
  }

  if (normalizedState === 'expired' || normalizedState === 'cancelled' || normalizedState === 'denied' || normalizedState === 'refunded') {
    const expiredRes = await db.expireOrCancelOrderFromGateway(order.id, normalizedState, {
      metadata: {
        midtrans_order_id: gatewayPayload.order_id || order.order_number,
        transaction_status: gatewayPayload.transaction_status,
        transaction_id: gatewayPayload.transaction_id || null
      }
    })
    const tickets = await ticketingService.listOrderTicketsWithQr(order.id).catch(() => [])
    return {
      payment_state: normalizedState,
      already_settled: false,
      order: expiredRes.order,
      tickets
    }
  }

  const updatedOrder = await db.updateOrderPaymentSession(order.id, {
    payment_provider: 'midtrans',
    payment_method: gatewayPayload.payment_type || order.payment_method || 'midtrans_snap',
    payment_reference: gatewayPayload.transaction_id || order.payment_reference || null,
    payment_metadata: {
      transaction_status: gatewayPayload.transaction_status || 'pending',
      payment_type: gatewayPayload.payment_type || null,
      transaction_id: gatewayPayload.transaction_id || null
    }
  })
  const tickets = await ticketingService.listOrderTicketsWithQr(order.id).catch(() => [])
  return {
    payment_state: normalizedState,
    already_settled: false,
    order: updatedOrder,
    tickets
  }
}

async function fetchFirstResolvedMidtransStatus(candidateIds: Array<string | null | undefined>) {
  const uniqueIds = Array.from(
    new Set(candidateIds.map((id) => String(id || '').trim()).filter(Boolean))
  )
  let lastPayload: any = { transaction_status: 'pending', not_yet_submitted: true }

  for (const id of uniqueIds) {
    const payload = await fetchMidtransTransactionStatus(id)
    if (payload?.not_yet_submitted) continue
    lastPayload = payload
    const mapped = mapMidtransTransactionState(payload)
    if (mapped === 'settled') return payload
  }

  return lastPayload
}

export async function syncOrderWithMidtrans(orderId: string, user: any, { midtransOrderId }: { midtransOrderId?: string } = {}) {
  const order = await ticketingService.assertOrderAccessById(orderId, user)

  if (['Paid', 'Verified', 'Not Required'].includes(order.payment_status) || order.order_status === 'Confirmed') {
    const tickets = await ticketingService.listOrderTicketsWithQr(order.id)
    return { payment_state: 'settled', already_settled: true, order, tickets }
  }
  if (!isMidtransConfigured()) {
    const tickets = await ticketingService.listOrderTicketsWithQr(order.id)
    return { payment_state: 'pending', configured: false, order, tickets }
  }

  const statusPayload = await fetchFirstResolvedMidtransStatus([
    midtransOrderId,
    order.payment_metadata?.midtrans_order_id,
    order.order_number
  ])
  if (statusPayload?.not_yet_submitted) {
    const tickets = await ticketingService.listOrderTicketsWithQr(order.id)
    return { payment_state: 'pending', order, tickets }
  }

  const state = mapMidtransTransactionState(statusPayload)
  return applyMidtransStateToOrder(order, state, statusPayload, user)
}

export async function syncBillingWithMidtrans(txId: string, user: any, { midtransOrderId }: { midtransOrderId?: string } = {}) {
  const txRecord = await pricingDb.findBillingTransactionByIdOrInvoice(txId)
  await ensureBillingAccess(txRecord, user)

  const readOrgSub = async () => {
    const orgUser = await db.findUserById(txRecord.organizer_id, 'organizer').catch(() => null)
    return orgUser ? db.evaluateOrganizerSubscription(orgUser) : null
  }

  if (txRecord.status === 'Paid') {
    const entitlement = txRecord.event_id ? await pricingDb.ensureEventEntitlement(txRecord.event_id).catch(() => null) : null
    return {
      payment_state: 'settled',
      already_settled: true,
      transaction: txRecord,
      entitlement,
      subscription: await readOrgSub()
    }
  }
  if (!isMidtransConfigured()) {
    return {
      payment_state: 'pending',
      configured: false,
      transaction: txRecord,
      entitlement: null,
      subscription: await readOrgSub()
    }
  }

  const statusPayload = await fetchFirstResolvedMidtransStatus([
    midtransOrderId,
    txRecord.payment_metadata?.midtrans_order_id,
    txRecord.invoice_number
  ])
  if (statusPayload?.not_yet_submitted) {
    return {
      payment_state: 'pending',
      transaction: txRecord,
      entitlement: null,
      subscription: await readOrgSub()
    }
  }

  const state = mapMidtransTransactionState(statusPayload)
  const settled = await pricingDb.settleOrUpdateBillingFromGateway(txRecord.id, state, statusPayload)
  const entitlement = settled.transaction?.event_id
    ? await pricingDb.ensureEventEntitlement(settled.transaction.event_id).catch(() => null)
    : null

  return {
    payment_state: state,
    already_settled: settled.alreadySettled,
    transaction: settled.transaction,
    entitlement,
    subscription: await readOrgSub()
  }
}

export async function cancelBillingMidtransSession(txId: string, user: any) {
  const txRecord = await pricingDb.findBillingTransactionByIdOrInvoice(txId)
  await ensureBillingAccess(txRecord, user)
  if (txRecord.status === 'Paid') {
    throw new AppError('Invoice billing ini sudah lunas dan tidak dapat dibatalkan.', 409, 'TX_ALREADY_PAID')
  }
  const midtransOrderId = txRecord.payment_metadata?.midtrans_order_id || txRecord.invoice_number
  const cancelRes = await cancelMidtransTransaction(midtransOrderId)
  const updated = await pricingDb.updateBillingPaymentSession(txRecord.id, {
    payment_token: null,
    payment_redirect_url: null,
    payment_metadata: { last_cancelled_order_id: midtransOrderId }
  })
  return { cancelled: true, midtrans: cancelRes, transaction: updated }
}

export async function processMidtransWebhook(payload: Record<string, any>) {
  verifyMidtransSignature(payload)

  const midtransOrderId = String(payload.order_id || '').trim()
  const baseRef = extractBaseOrderReference(midtransOrderId)
  const state = mapMidtransTransactionState(payload)
  const incomingAmount = Math.round(Number(payload.gross_amount || 0))

  // Route to BillingTransaction for INV-* invoices or Order for ORD-* / others
  if (baseRef.toUpperCase().startsWith('INV-')) {
    let txRecord: any
    try {
      txRecord = await pricingDb.findBillingTransactionByIdOrInvoice(midtransOrderId)
    } catch {
      txRecord = await pricingDb.findBillingTransactionByIdOrInvoice(baseRef)
    }

    const expectedAmount = Math.round(Number(txRecord.final_amount_idr || 0))
    if (incomingAmount !== expectedAmount) {
      throw new AppError(
        `Nominal webhook tidak cocok dengan invoice (${incomingAmount} vs ${expectedAmount}).`,
        400,
        'AMOUNT_MISMATCH'
      )
    }

    const res = await pricingDb.settleOrUpdateBillingFromGateway(txRecord.id, state, payload)
    return {
      target_type: 'billing_transaction',
      reference: txRecord.invoice_number,
      payment_state: state,
      already_settled: res.alreadySettled,
      status: res.transaction?.status
    }
  }

  let order: any
  try {
    order = await db.findOrderByOrderNumber(midtransOrderId)
  } catch {
    order = await db.findOrderByOrderNumber(baseRef)
  }

  const expectedAmount = Math.round(Number(order.total || 0))
  if (incomingAmount !== expectedAmount) {
    throw new AppError(
      `Nominal webhook tidak cocok dengan order (${incomingAmount} vs ${expectedAmount}).`,
      400,
      'AMOUNT_MISMATCH'
    )
  }

  const res = await applyMidtransStateToOrder(order, state, payload, null)
  return {
    target_type: 'order',
    reference: order.order_number,
    payment_state: state,
    already_settled: Boolean(res.already_settled),
    order_status: res.order?.order_status,
    payment_status: res.order?.payment_status
  }
}
