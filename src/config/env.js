import 'dotenv/config'

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, ''),
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
  adminWhatsappNumber: (process.env.ADMIN_WHATSAPP_NUMBER || '6287897192601').replace(/[^0-9]/g, '')
}
