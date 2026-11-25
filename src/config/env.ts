import 'dotenv/config'
import type { EnvConfig } from '../types/domain.js'

export const CANONICAL_BACKEND_URL = 'https://backend-six-sand-66.vercel.app'
export const CANONICAL_SITE_URL = 'https://terra.concern.web.id'

function resolveAppBaseUrl(): string {
  const explicit = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '')
  if (explicit) {
    if (/^https?:\/\/terra-concern\.vercel\.app$/i.test(explicit)) {
      return CANONICAL_BACKEND_URL
    }
    return explicit
  }

  const vercelProd = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim()
  if (vercelProd && !/^[a-z0-9-]+-concern2\.vercel\.app$/i.test(vercelProd)) {
    const withProto = vercelProd.startsWith('http') ? vercelProd : `https://${vercelProd}`
    return withProto.replace(/\/+$/, '')
  }

  if (process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)) {
    return CANONICAL_BACKEND_URL
  }

  return `http://localhost:${process.env.PORT || 3000}`
}

function resolveFrontendUrl(): string {
  const explicit = (process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '')
  if (explicit) {
    if (/^https?:\/\/terra-concern\.vercel\.app$/i.test(explicit)) {
      return CANONICAL_SITE_URL
    }
    return explicit
  }
  if (process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)) {
    return CANONICAL_SITE_URL
  }
  return 'http://localhost:5173'
}

export const env: EnvConfig = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  appBaseUrl: resolveAppBaseUrl(),
  frontendUrl: resolveFrontendUrl(),
  qrSigningSecret: (process.env.QR_SIGNING_SECRET || 'terra-dev-qr-signing-secret-2026').trim(),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseMediaBucket: (process.env.SUPABASE_MEDIA_BUCKET || 'terra-media').trim(),
  supabaseDocsBucket: (process.env.SUPABASE_DOCS_BUCKET || 'terra-documents').trim(),
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  directUrl: (process.env.DIRECT_URL || '').trim(),
  resendApiKey: (process.env.RESEND_API_KEY || '').trim(),
  resendFromEmail: (
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    'TERRA Events <onboarding@resend.dev>'
  ).trim(),
  smtpHost: (process.env.SMTP_HOST || '').trim(),
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: (process.env.SMTP_USER || '').trim(),
  smtpPass: (process.env.SMTP_PASS || '').trim(),
  smtpFrom: (process.env.SMTP_FROM || process.env.RESEND_FROM_EMAIL || 'TERRA Tickets <tickets@terra.id>').trim(),
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  googleCallbackUrl: (
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/v1/auth/google/callback'
  ).trim(),
  oauthJwtSecret: (
    process.env.OAUTH_JWT_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'terra-local-oauth-secret'
  ).trim(),
  adminWhatsappNumber: (process.env.ADMIN_WHATSAPP_NUMBER || '6287897192601').replace(/[^0-9]/g, ''),
  midtransServerKey: (process.env.MIDTRANS_SERVER_KEY || '').trim(),
  midtransClientKey: (process.env.MIDTRANS_CLIENT_KEY || '').trim(),
  midtransMerchantId: (process.env.MIDTRANS_MERCHANT_ID || '').trim(),
  midtransIsProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true'
}
