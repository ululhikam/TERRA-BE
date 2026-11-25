import crypto from 'node:crypto'
import { env } from '../config/env.js'
import { AppError } from '../utils/response.js'

export interface MidtransItemDetail {
  id: string
  price: number
  quantity: number
  name: string
}

export interface MidtransCustomerDetails {
  first_name?: string
  email?: string
  phone?: string
}

export type NormalizedGatewayState =
  | 'settled'
  | 'pending'
  | 'expired'
  | 'cancelled'
  | 'denied'
  | 'refunded'
  | 'failed'

export function isMidtransConfigured(): boolean {
  return Boolean(env.midtransServerKey && env.midtransClientKey)
}

export function getSnapJsUrl(): string {
  return env.midtransIsProduction
    ? 'https://app.midtrans.com/snap/snap.js'
    : 'https://app.sandbox.midtrans.com/snap/snap.js'
}

export function getSnapApiBaseUrl(): string {
  return env.midtransIsProduction
    ? 'https://app.midtrans.com/snap/v1'
    : 'https://app.sandbox.midtrans.com/snap/v1'
}

export function getCoreApiBaseUrl(): string {
  return env.midtransIsProduction
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'
}

export function getPaymentConfigStatus() {
  return {
    provider: 'midtrans',
    configured: isMidtransConfigured(),
    is_production: env.midtransIsProduction,
    client_key: env.midtransClientKey || null,
    snap_js_url: getSnapJsUrl(),
    webhook_path: '/api/v1/payments/midtrans/webhook'
  }
}

function buildBasicAuthHeader(serverKey = env.midtransServerKey): string {
  return `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`
}

export function computeMidtransSignature({
  orderId,
  statusCode,
  grossAmount,
  serverKey = env.midtransServerKey
}: {
  orderId: string
  statusCode: string | number
  grossAmount: string | number
  serverKey?: string
}): string {
  // Official Midtrans formula: SHA512(order_id + status_code + gross_amount + serverKey)
  const raw = `${String(orderId)}${String(statusCode)}${String(grossAmount)}${serverKey}`
  return crypto.createHash('sha512').update(raw).digest('hex')
}

export function verifyMidtransSignature(
  payload: {
    order_id?: string
    status_code?: string | number
    gross_amount?: string | number
    signature_key?: string
  },
  serverKey = env.midtransServerKey
): boolean {
  if (!serverKey) {
    throw new AppError('MIDTRANS_SERVER_KEY belum dikonfigurasi pada server.', 503, 'PAYMENT_GATEWAY_NOT_CONFIGURED')
  }
  const orderId = String(payload?.order_id || '').trim()
  const statusCode = payload?.status_code !== undefined && payload?.status_code !== null ? String(payload.status_code).trim() : ''
  const grossAmount =
    payload?.gross_amount !== undefined && payload?.gross_amount !== null ? String(payload.gross_amount).trim() : ''
  const incomingSig = String(payload?.signature_key || '').trim().toLowerCase()

  if (!orderId || !statusCode || !grossAmount || !incomingSig) {
    throw new AppError('Payload notifikasi Midtrans tidak lengkap.', 400, 'INVALID_WEBHOOK_PAYLOAD')
  }

  const expectedSig = computeMidtransSignature({ orderId, statusCode, grossAmount, serverKey }).toLowerCase()
  const expectedBuf = Buffer.from(expectedSig, 'utf8')
  const incomingBuf = Buffer.from(incomingSig, 'utf8')

  if (expectedBuf.length !== incomingBuf.length || !crypto.timingSafeEqual(expectedBuf, incomingBuf)) {
    throw new AppError('Signature webhook Midtrans tidak valid.', 401, 'INVALID_WEBHOOK_SIGNATURE')
  }
  return true
}

export function mapMidtransTransactionState({
  transaction_status,
  fraud_status
}: {
  transaction_status?: string
  fraud_status?: string
}): NormalizedGatewayState {
  const txStatus = String(transaction_status || '').toLowerCase()
  const fraud = String(fraud_status || '').toLowerCase()

  if (txStatus === 'settlement') return 'settled'
  if (txStatus === 'capture') {
    if (fraud === 'challenge') return 'pending'
    if (!fraud || fraud === 'accept') return 'settled'
    return 'failed'
  }
  if (txStatus === 'pending') return 'pending'
  if (txStatus === 'expire') return 'expired'
  if (txStatus === 'cancel') return 'cancelled'
  if (txStatus === 'deny') return 'denied'
  if (txStatus === 'refund' || txStatus === 'partial_refund') return 'refunded'
  return 'failed'
}

export function buildRetryMidtransOrderId(baseOrderNumber: string): string {
  return `${baseOrderNumber}-R${Date.now().toString(36).toUpperCase()}`
}

export function extractBaseOrderReference(midtransOrderId: string): string {
  return String(midtransOrderId || '').trim().replace(/-R[A-Z0-9]+$/i, '')
}

export async function createMidtransSnapTransaction({
  midtransOrderId,
  grossAmount,
  itemDetails,
  customerDetails,
  finishRedirectUrl,
  expiryMinutes = 1440
}: {
  midtransOrderId: string
  grossAmount: number
  itemDetails?: MidtransItemDetail[]
  customerDetails?: MidtransCustomerDetails
  finishRedirectUrl?: string
  expiryMinutes?: number
}) {
  if (!isMidtransConfigured()) {
    throw new AppError(
      'Payment Gateway Midtrans belum dikonfigurasi (MIDTRANS_SERVER_KEY / MIDTRANS_CLIENT_KEY kosong).',
      503,
      'PAYMENT_GATEWAY_NOT_CONFIGURED'
    )
  }

  const roundedTotal = Math.round(Number(grossAmount || 0))
  if (roundedTotal <= 0) {
    throw new AppError('Nominal pembayaran gateway harus lebih dari Rp 0.', 400, 'INVALID_PAYMENT_AMOUNT')
  }

  let safeItems: MidtransItemDetail[] = (itemDetails || []).map((item) => ({
    id: String(item.id || 'item').slice(0, 50),
    price: Math.round(Number(item.price || 0)),
    quantity: Math.max(1, Math.round(Number(item.quantity || 1))),
    name: String(item.name || 'TERRA Payment').slice(0, 50)
  }))

  const itemSum = safeItems.reduce((sum, it) => sum + it.price * it.quantity, 0)
  if (!safeItems.length || itemSum !== roundedTotal) {
    safeItems = [
      {
        id: String(midtransOrderId).slice(0, 50),
        price: roundedTotal,
        quantity: 1,
        name: (safeItems[0]?.name || `Pembayaran ${midtransOrderId}`).slice(0, 50)
      }
    ]
  }

  const bodyPayload: Record<string, any> = {
    transaction_details: {
      order_id: midtransOrderId,
      gross_amount: roundedTotal
    },
    item_details: safeItems,
    expiry: {
      unit: 'minutes',
      duration: Math.max(5, Math.min(4320, Math.round(expiryMinutes)))
    }
  }

  if (customerDetails && (customerDetails.first_name || customerDetails.email || customerDetails.phone)) {
    bodyPayload.customer_details = {
      ...(customerDetails.first_name ? { first_name: String(customerDetails.first_name).slice(0, 120) } : {}),
      ...(customerDetails.email ? { email: String(customerDetails.email).slice(0, 120) } : {}),
      ...(customerDetails.phone ? { phone: String(customerDetails.phone).slice(0, 19) } : {})
    }
  }

  if (finishRedirectUrl) {
    bodyPayload.callbacks = {
      finish: finishRedirectUrl
    }
  }

  let response: Response
  try {
    response = await fetch(`${getSnapApiBaseUrl()}/transactions`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: buildBasicAuthHeader()
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(12000)
    })
  } catch (err: any) {
    throw new AppError(
      `Gagal menghubungi server Midtrans Snap: ${err?.message || 'Timeout'}`,
      502,
      'PAYMENT_GATEWAY_UNREACHABLE'
    )
  }

  const data: any = await response.json().catch(() => ({}))
  if (!response.ok || !data?.token) {
    const detailMsg = Array.isArray(data?.error_messages)
      ? data.error_messages.join('; ')
      : data?.status_message || `HTTP ${response.status}`
    throw new AppError(`Midtrans Snap error: ${detailMsg}`, 502, 'PAYMENT_GATEWAY_ERROR')
  }

  return {
    provider: 'midtrans',
    token: String(data.token),
    redirect_url: String(data.redirect_url || ''),
    midtrans_order_id: midtransOrderId,
    client_key: env.midtransClientKey,
    snap_js_url: getSnapJsUrl(),
    is_production: env.midtransIsProduction
  }
}

export async function fetchMidtransTransactionStatus(midtransOrderId: string) {
  if (!isMidtransConfigured()) {
    throw new AppError(
      'Payment Gateway Midtrans belum dikonfigurasi (MIDTRANS_SERVER_KEY / MIDTRANS_CLIENT_KEY kosong).',
      503,
      'PAYMENT_GATEWAY_NOT_CONFIGURED'
    )
  }

  let response: Response
  try {
    response = await fetch(`${getCoreApiBaseUrl()}/${encodeURIComponent(midtransOrderId)}/status`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: buildBasicAuthHeader()
      },
      signal: AbortSignal.timeout(12000)
    })
  } catch (err: any) {
    throw new AppError(
      `Gagal memeriksa status transaksi Midtrans: ${err?.message || 'Timeout'}`,
      502,
      'PAYMENT_GATEWAY_UNREACHABLE'
    )
  }

  const data: any = await response.json().catch(() => ({}))
  if (response.status === 404 || String(data?.status_code) === '404') {
    return {
      transaction_status: 'pending',
      status_code: '404',
      order_id: midtransOrderId,
      not_yet_submitted: true
    }
  }

  if (!response.ok) {
    throw new AppError(
      data?.status_message || `Midtrans status check gagal (${response.status})`,
      502,
      'PAYMENT_GATEWAY_ERROR'
    )
  }

  return data
}
