import crypto from 'node:crypto'
import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { env } from './env.js'
import * as db from '../repositories/db.js'
import type { AuthUser } from '../types/domain.js'

export const isGoogleOAuthEnabled = Boolean(
  env.googleClientId &&
    env.googleClientSecret &&
    !env.googleClientId.includes('your-') &&
    !env.googleClientSecret.includes('your-')
)

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
        callbackURL: env.googleCallbackUrl
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value
          if (!email) {
            return done(new Error('Akun Google tidak memiliki alamat email terverifikasi.'))
          }

          const existing = await db.findUserByEmail(email)
          const avatar = profile.photos?.[0]?.value || ''
          const fullName = profile.displayName || email.split('@')[0]

          const user = await db.upsertUser({
            id: existing?.id || `usr-google-${profile.id}`,
            full_name: existing?.full_name || fullName,
            email,
            avatar_url: existing?.avatar_url || avatar,
            role: existing?.role || 'customer',
            provider: 'google',
            email_verified: true
          })

          return done(null, user as any)
        } catch (err) {
          return done(err as Error)
        }
      }
    )
  )
}

export default passport
