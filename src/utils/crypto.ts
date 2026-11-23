import crypto from 'node:crypto'

export function generateTicketCode(prefix = 'EVT26'): string {
  const num = crypto.randomInt(1000, 9999)
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase().slice(0, 2)
  return `${prefix}-${num}-${suffix}`
}

export function generateOrderNumber(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `ORD-${datePart}-${rand}`
}

export function generateQrToken(): string {
  return crypto.randomBytes(24).toString('hex')
}

export function hashQrToken(rawToken: string): string {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex')
}

export function slugify(text: string): string {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derived}`
}

export function verifyPassword(password?: string | null, storedHash?: string | null): boolean {
  if (!password || !storedHash || !storedHash.includes(':')) return false
  const [salt, expectedHex] = storedHash.split(':')
  if (!salt || !expectedHex) return false
  const actualBuf = crypto.scryptSync(String(password), salt, 64)
  const expectedBuf = Buffer.from(expectedHex, 'hex')
  return actualBuf.length === expectedBuf.length && crypto.timingSafeEqual(actualBuf, expectedBuf)
}
