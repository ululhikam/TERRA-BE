import crypto from 'node:crypto'
import QRCode from 'qrcode'
import { env } from '../config/env.js'
import { generateQrToken } from './crypto.js'

/**
 * Build the canonical QR payload string for a purchased or issued ticket.
 * Format: TERRA:<ticketCode>:<eventId>:<shortToken>
 */
export function buildTicketQrPayload(ticketCode, eventId, token = generateQrToken().slice(0, 8)) {
  const code = String(ticketCode || '').trim().toUpperCase()
  const evt = String(eventId || '').trim()
  const suffix = String(token || '').trim()
  return suffix ? `TERRA:${code}:${evt}:${suffix}` : `TERRA:${code}:${evt}`
}

/**
 * Parse a scanned QR string or manual ticket code into normalized components.
 */
export function parseTicketQrPayload(rawInput) {
  const raw = String(rawInput || '').trim()
  if (!raw) {
    return { raw: '', ticketCode: '', eventId: null, token: null, isTerraQr: false }
  }

  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw)
      const code = String(parsed.ticket_code || parsed.ticketCode || parsed.code || '').trim()
      const eventId = parsed.event_id || parsed.eventId || null
      return {
        raw: parsed.qr_payload || raw,
        ticketCode: code.toUpperCase(),
        eventId: eventId ? String(eventId) : null,
        token: parsed.token ? String(parsed.token) : null,
        isTerraQr: Boolean(parsed.qr_payload?.startsWith('TERRA:') || code)
      }
    } catch {
      // Fall through to plain string parsing
    }
  }

  if (raw.toUpperCase().startsWith('TERRA:')) {
    const parts = raw.split(':')
    return {
      raw,
      ticketCode: String(parts[1] || '').trim().toUpperCase(),
      eventId: parts[2] ? String(parts[2]).trim() : null,
      token: parts[3] ? String(parts[3]).trim() : null,
      isTerraQr: true
    }
  }

  return {
    raw,
    ticketCode: raw.toUpperCase(),
    eventId: null,
    token: null,
    isTerraQr: false
  }
}

export async function generateTicketQrDataUrl(qrPayload, options = {}) {
  if (!qrPayload) return ''
  return QRCode.toDataURL(String(qrPayload), {
    width: options.width || 280,
    margin: options.margin ?? 2,
    errorCorrectionLevel: options.errorCorrectionLevel || 'M',
    color: {
      dark: options.dark || '#0f172a',
      light: options.light || '#ffffff'
    }
  })
}

export async function generateTicketQrBuffer(qrPayload, options = {}) {
  if (!qrPayload) return Buffer.alloc(0)
  return QRCode.toBuffer(String(qrPayload), {
    type: 'png',
    width: options.width || 320,
    margin: options.margin ?? 2,
    errorCorrectionLevel: options.errorCorrectionLevel || 'M',
    color: {
      dark: options.dark || '#0f172a',
      light: options.light || '#ffffff'
    }
  })
}

export async function generateTicketQrSvg(qrPayload, options = {}) {
  if (!qrPayload) return ''
  return QRCode.toString(String(qrPayload), {
    type: 'svg',
    width: options.width || 280,
    margin: options.margin ?? 2,
    errorCorrectionLevel: options.errorCorrectionLevel || 'M',
    color: {
      dark: options.dark || '#0f172a',
      light: options.light || '#ffffff'
    }
  })
}

export function createQrDownloadToken(resourceId) {
  return crypto
    .createHmac('sha256', env.qrSigningSecret)
    .update(String(resourceId))
    .digest('hex')
    .slice(0, 32)
}

export function verifyQrDownloadToken(token, resourceId) {
  if (!token || !resourceId) return false
  const expected = createQrDownloadToken(resourceId)
  const a = Buffer.from(String(token))
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function attachTicketQr(ticket) {
  if (!ticket) return ticket
  const payload = ticket.qr_payload || buildTicketQrPayload(ticket.ticket_code, ticket.event_id, '')
  const qrDataUrl = await generateTicketQrDataUrl(payload)
  const token = createQrDownloadToken(ticket.id)
  return {
    ...ticket,
    qr_payload: payload,
    qr_data_url: qrDataUrl,
    pdf_download_url: `${env.appBaseUrl}/api/v1/tickets/${encodeURIComponent(ticket.id)}/qr-pdf?token=${token}`
  }
}
