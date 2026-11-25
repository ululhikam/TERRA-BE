export type UserRole = 'customer' | 'organizer' | 'admin'

export interface AuthUser {
  id: string
  full_name: string
  username?: string | null
  email: string
  role: UserRole
  avatar_url?: string | null
  phone?: string | null
  bio?: string | null
  provider?: string
  email_verified?: boolean
  is_suspended?: boolean
  subscription_plan?: string
  subscription_status?: string
  subscription_expires_at?: Date | string | null
  pro_trial_used_at?: Date | string | null
  created_at?: Date | string
  updated_at?: Date | string
  [key: string]: any
}

export interface EnvConfig {
  port: number
  nodeEnv: string
  corsOrigin: string
  appBaseUrl: string
  frontendUrl: string
  qrSigningSecret: string
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceRoleKey: string
  supabaseMediaBucket: string
  supabaseDocsBucket: string
  databaseUrl: string
  directUrl: string
  resendApiKey: string
  resendFromEmail: string
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPass: string
  smtpFrom: string
  googleClientId: string
  googleClientSecret: string
  googleCallbackUrl: string
  oauthJwtSecret: string
  adminWhatsappNumber: string
  midtransServerKey: string
  midtransClientKey: string
  midtransMerchantId: string
  midtransIsProduction: boolean
}

export interface EventBranding {
  title: string
  orgName: string
  themeColor: string
  textColor: string
  logoUrl: string
  initials: string
}
