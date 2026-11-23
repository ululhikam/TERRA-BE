import crypto from 'node:crypto'
import QRCode from 'qrcode'
import sharp from 'sharp'
import { env } from '../config/env.js'
import { generateQrToken } from './crypto.js'

const logoCache = new Map()
const LOGO_CACHE_TTL_MS = 10 * 60 * 1000
const LOGO_CACHE_MAX = 50

export function normalizeHexColor(color, fallback = '#1e3a8a') {
  const raw = String(color || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [, r, g, b] = raw
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return fallback
}

export function getContrastTextColor(hexColor) {
  const hex = normalizeHexColor(hexColor, '#1e3a8a').slice(1)
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#000000' : '#ffffff'
}

export function getEventInitials(title = '') {
  const words = String(title || '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return 'TR'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

export function resolveEventBranding(event = null) {
  const title = event?.title || 'Event TERRA'
  const orgName = event?.organization?.name || event?.organization_name || 'TERRA Organizer'
  const themeColor = normalizeHexColor(event?.theme_color, '#1e3a8a')
  const textColor = getContrastTextColor(themeColor)
  const logoUrl =
    event?.logo_url ||
    event?.organization?.logo_url ||
    event?.poster_url ||
    event?.banner_url ||
    ''
  return {
    title,
    orgName,
    themeColor,
    textColor,
    logoUrl: String(logoUrl || '').trim(),
    initials: getEventInitials(title)
  }
}

export function isSafePublicImageUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim())
    const isProd = env.nodeEnv === 'production'
    if (isProd && u.protocol !== 'https:') return false
    if (!isProd && u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = u.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host === '::1' ||
      host === '[::1]' ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

async function fetchRawLogoImage(logoUrl) {
  const clean = String(logoUrl || '').trim()
  if (!clean) return null

  if (clean.startsWith('data:image/')) {
    const commaIdx = clean.indexOf(',')
    if (commaIdx === -1) return null
    const meta = clean.slice(0, commaIdx)
    const body = clean.slice(commaIdx + 1)
    if (meta.includes(';base64')) {
      return Buffer.from(body, 'base64')
    }
    return Buffer.from(decodeURIComponent(body), 'utf8')
  }

  if (process.env.NODE_ENV === 'test') {
    return null
  }

  if (!isSafePublicImageUrl(clean)) {
    return null
  }

  const cached = logoCache.get(clean)
  if (cached && Date.now() - cached.ts < LOGO_CACHE_TTL_MS) {
    return cached.buffer
  }

  try {
    const res = await fetch(clean, {
      signal: AbortSignal.timeout(3500),
      headers: { Accept: 'image/*' }
    })
    if (!res.ok) return null
    const arrayBuf = await res.arrayBuffer()
    if (!arrayBuf || arrayBuf.byteLength === 0 || arrayBuf.byteLength > 4 * 1024 * 1024) {
      return null
    }
    const buf = Buffer.from(arrayBuf)
    if (logoCache.size >= LOGO_CACHE_MAX) {
      const oldestKey = logoCache.keys().next().value
      logoCache.delete(oldestKey)
    }
    logoCache.set(clean, { ts: Date.now(), buffer: buf })
    return buf
  } catch {
    return null
  }
}

export async function buildMonogramLogoPngBuffer({
  initials = 'TR',
  themeColor = '#1e3a8a',
  size = 96
} = {}) {
  const safeTheme = normalizeHexColor(themeColor, '#1e3a8a')
  const safeText = getContrastTextColor(safeTheme)
  const radius = Math.round(size * 0.22)
  const fontSize = Math.round(size * 0.42)
  const cleanInitials = String(initials || 'TR')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase() || 'TR'

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${safeTheme}" />
      <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="${Math.max(2, radius - 2)}" ry="${Math.max(2, radius - 2)}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2" />
      <text
        x="50%"
        y="54%"
        dominant-baseline="middle"
        text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif"
        font-weight="800"
        font-size="${fontSize}"
        fill="${safeText}"
      >${cleanInitials}</text>
    </svg>
  `
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export async function fetchEventLogoBadgeBuffer(
  brandingInput = null,
  { size = 96, borderWidth = 6 } = {}
) {
  const branding = brandingInput?.initials
    ? brandingInput
    : resolveEventBranding(brandingInput)

  const pad = Math.max(2, Number(borderWidth) || 0)
  const innerSize = Math.max(20, size - pad * 2)
  const outerRadius = Math.round(size * 0.24)
  const innerRadius = Math.round(innerSize * 0.2)

  let innerPng = null
  if (branding.logoUrl) {
    const rawBuf = await fetchRawLogoImage(branding.logoUrl)
    if (rawBuf) {
      try {
        const maskSvg = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${innerSize}" height="${innerSize}">
            <rect x="0" y="0" width="${innerSize}" height="${innerSize}" rx="${innerRadius}" ry="${innerRadius}" fill="#fff" />
          </svg>`
        )
        const cropped = await sharp(rawBuf)
          .resize(innerSize, innerSize, { fit: 'cover', position: 'centre' })
          .ensureAlpha()
          .png()
          .toBuffer()

        innerPng = await sharp(cropped)
          .composite([{ input: maskSvg, blend: 'dest-in' }])
          .png()
          .toBuffer()
      } catch {
        innerPng = null
      }
    }
  }

  if (!innerPng) {
    innerPng = await buildMonogramLogoPngBuffer({
      initials: branding.initials,
      themeColor: branding.themeColor,
      size: innerSize
    })
  }

  const frameSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="${outerRadius}" ry="${outerRadius}" fill="#ffffff" stroke="#0f172a" stroke-width="2" />
    </svg>`
  )

  return sharp(frameSvg)
    .composite([{ input: innerPng, top: pad, left: pad }])
    .png()
    .toBuffer()
}

/**
 * Build the canonical QR payload string for a purchased or issued ticket.
 * Format: TERRA:<ticketCode>:<eventId>:<shortToken>
 */
export function buildTicketQrPayload(ticketCode, eventId, token = generateQrToken().slice(0, 16)) {
  const code = String(ticketCode || '').trim().toUpperCase()
  const evt = String(eventId || '').trim()
  const suffix = String(token || '').trim()
  return suffix ? `TERRA:${code}:${evt}:${suffix}` : `TERRA:${code}:${evt}`
}

/**
 * Parse a scanned QR string or manually entered ticket code into normalized components.
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
  if (options.event || options.branding) {
    return generateBrandedQrDataUrl(qrPayload, options)
  }
  return QRCode.toDataURL(String(qrPayload), {
    width: options.width || 280,
    margin: options.margin ?? 2,
    errorCorrectionLevel: options.errorCorrectionLevel || 'H',
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
    width: options.width || 360,
    margin: options.margin ?? 2,
    errorCorrectionLevel: options.errorCorrectionLevel || 'H',
    color: {
      dark: options.dark || '#0f172a',
      light: options.light || '#ffffff'
    }
  })
}

export async function generateBrandedQrBuffer(
  qrPayload,
  { width = 420, margin = 2, event = null, branding = null, dark = '#0f172a', light = '#ffffff' } = {}
) {
  if (!qrPayload) return Buffer.alloc(0)
  const resolvedBranding = branding || resolveEventBranding(event)
  const qrBuffer = await generateTicketQrBuffer(qrPayload, {
    width,
    margin,
    errorCorrectionLevel: 'H',
    dark,
    light
  })

  try {
    const meta = await sharp(qrBuffer).metadata()
    const actualWidth = meta.width || width
    const badgeSize = Math.max(40, Math.round(actualWidth * 0.21))
    const borderWidth = Math.max(4, Math.round(badgeSize * 0.08))
    const badgeBuffer = await fetchEventLogoBadgeBuffer(resolvedBranding, {
      size: badgeSize,
      borderWidth
    })

    return await sharp(qrBuffer)
      .composite([{ input: badgeBuffer, gravity: 'center' }])
      .png()
      .toBuffer()
  } catch {
    return qrBuffer
  }
}

export async function generateBrandedQrDataUrl(qrPayload, options = {}) {
  const buf = await generateBrandedQrBuffer(qrPayload, options)
  if (!buf.length) return ''
  return `data:image/png;base64,${buf.toString('base64')}`
}

export async function generateTicketQrSvg(qrPayload, options = {}) {
  if (!qrPayload) return ''
  return QRCode.toString(String(qrPayload), {
    type: 'svg',
    width: options.width || 280,
    margin: options.margin ?? 2,
    errorCorrectionLevel: options.errorCorrectionLevel || 'H',
    color: {
      dark: options.dark || '#0f172a',
      light: options.light || '#ffffff'
    }
  })
}

export function createQrDownloadToken(resourceId, ttlSeconds = 30 * 24 * 60 * 60) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const sig = crypto
    .createHmac('sha256', env.qrSigningSecret)
    .update(`${String(resourceId)}:${exp}`)
    .digest('hex')
    .slice(0, 32)
  return `${exp}.${sig}`
}

export function verifyQrDownloadToken(token, resourceId) {
  if (!token || !resourceId) return false
  const raw = String(token).trim()
  const parts = raw.split('.')
  if (parts.length !== 2) return false
  const [expStr, sig] = parts
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false

  const expected = crypto
    .createHmac('sha256', env.qrSigningSecret)
    .update(`${String(resourceId)}:${exp}`)
    .digest('hex')
    .slice(0, 32)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function createEmailPreviewToken(emailId, ttlSeconds = 7 * 24 * 60 * 60) {
  return createQrDownloadToken(`email:${emailId}`, ttlSeconds)
}

export function verifyEmailPreviewToken(token, emailId) {
  return verifyQrDownloadToken(token, `email:${emailId}`)
}

export async function attachTicketQr(ticket, event = null) {
  if (!ticket) return ticket
  const payload = ticket.qr_payload || buildTicketQrPayload(ticket.ticket_code, ticket.event_id, '')
  const brandingEvent = event || {
    title: ticket.event_title,
    theme_color: ticket.theme_color,
    logo_url: ticket.logo_url
  }
  const qrDataUrl = await generateBrandedQrDataUrl(payload, {
    width: 320,
    margin: 2,
    event: brandingEvent
  })
  const token = createQrDownloadToken(ticket.id)
  return {
    ...ticket,
    qr_payload: payload,
    qr_data_url: qrDataUrl,
    pdf_download_url: `${env.appBaseUrl}/api/v1/tickets/${encodeURIComponent(ticket.id)}/qr-pdf?token=${token}`
  }
}
