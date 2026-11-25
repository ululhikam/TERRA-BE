import crypto from 'node:crypto'
import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { env } from './env.js'
import * as db from '../repositories/db.js'

export const isGoogleOAuthEnabled = Boolean(
  env.googleClientId &&
    env.googleClientSecret &&
    !env.googleClientId.includes('your-') &&
    !env.googleClientSecret.includes('your-')
)

export function resolveOAuthFrontendOrigin(candidate?: unknown): string {
  const allowed = [
    env.frontendUrl,
    ...env.corsOrigin.split(',').map((s) => s.trim().replace(/\/+$/, ''))
  ].filter(Boolean)
  if (!candidate) return env.frontendUrl
  const cleaned = String(candidate).trim().replace(/\/+$/, '')
  if (allowed.includes(cleaned)) return cleaned
  if (cleaned.startsWith('http://localhost:') || cleaned.startsWith('http://127.0.0.1:')) {
    return cleaned
  }
  if (/^https:\/\/([a-z0-9-]+\.)?concern\.web\.id$/i.test(cleaned)) {
    return cleaned
  }
  return env.frontendUrl
}

export function encodeOAuthState(obj: {
  origin?: string
  next?: string
  role?: string
  organization_name?: string
}): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

export function decodeOAuthState(stateStr?: unknown): {
  origin: string
  next: string
  role: 'customer' | 'organizer'
  organization_name: string
} {
  try {
    if (!stateStr) {
      return { origin: env.frontendUrl, next: '/events', role: 'customer', organization_name: '' }
    }
    const parsed = JSON.parse(Buffer.from(String(stateStr), 'base64url').toString('utf8'))
    const role = parsed.role === 'organizer' ? 'organizer' : 'customer'
    const defaultNext = role === 'organizer' ? '/dashboard/billing' : '/events'
    return {
      origin: resolveOAuthFrontendOrigin(parsed.origin),
      next:
        typeof parsed.next === 'string' && parsed.next.startsWith('/') && !parsed.next.startsWith('//')
          ? parsed.next
          : defaultNext,
      role,
      organization_name: typeof parsed.organization_name === 'string' ? parsed.organization_name.trim() : ''
    }
  } catch {
    return { origin: env.frontendUrl, next: '/events', role: 'customer', organization_name: '' }
  }
}

export function signOAuthToken(user: any): string {
  const payload = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role || 'customer',
    avatar_url: user.avatar_url || '',
    provider: 'google',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto
    .createHmac('sha256', env.oauthJwtSecret)
    .update(encoded)
    .digest('base64url')
  return `oauth-jwt.${encoded}.${sig}`
}

export function verifyOAuthToken(token: string): any | null {
  if (!token || !token.startsWith('oauth-jwt.')) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [, encoded, sig] = parts
  const expectedSig = crypto
    .createHmac('sha256', env.oauthJwtSecret)
    .update(encoded)
    .digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

if (isGoogleOAuthEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.googleClientId,
        clientSecret: env.googleClientSecret,
        callbackURL: env.googleCallbackUrl,
        passReqToCallback: true
      },
      async (req, _accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value
          if (!email) {
            return done(new Error('Akun Google tidak memiliki alamat email terverifikasi.'))
          }

          const state = decodeOAuthState(req.query?.state)
          const targetRole = state.role === 'organizer' ? 'organizer' : 'customer'
          const existing = await db.findUserByEmail(email, targetRole)
          const avatar = profile.photos?.[0]?.value || ''
          const fullName = profile.displayName || email.split('@')[0]

          const user = await db.upsertUser({
            id: existing?.id || `usr-google-${targetRole}-${profile.id}`,
            full_name: existing?.full_name || fullName,
            email,
            avatar_url: existing?.avatar_url || avatar,
            role: targetRole,
            provider: 'google',
            email_verified: true,
            ...(targetRole === 'organizer' && existing
              ? {
                  subscription_plan: existing.subscription_plan,
                  subscription_status: existing.subscription_status,
                  subscription_expires_at: existing.subscription_expires_at
                }
              : targetRole === 'organizer'
                ? {
                    subscription_plan: 'unsubscribed',
                    subscription_status: 'unpaid',
                    subscription_expires_at: null
                  }
                : {})
          })

          if (targetRole === 'organizer') {
            await db.ensureOrganizerDefaultOrganization(user, state.organization_name || '')
          }

          return done(null, user as any)
        } catch (err) {
          return done(err as Error)
        }
      }
    )
  )
}

export default passport
