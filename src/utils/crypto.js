import crypto from 'node:crypto'

export function generateTicketCode(prefix = 'EVT26') {
  const num = crypto.randomInt(1000, 9999)
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase().slice(0, 2)
  return `${prefix}-${num}-${suffix}`
}

export function generateOrderNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `ORD-${datePart}-${rand}`
}

export function generateQrToken() {
  return crypto.randomBytes(24).toString('hex')
}

export function hashQrToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex')
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}
