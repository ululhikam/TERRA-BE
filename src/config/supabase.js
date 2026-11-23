import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'

const isValidHttpUrl = (str) => {
  try {
    const u = new URL(str)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export const isSupabaseEnabled = Boolean(
  env.supabaseUrl &&
  env.supabaseServiceRoleKey &&
  isValidHttpUrl(env.supabaseUrl) &&
  !env.supabaseUrl.includes('your-project') &&
  !env.supabaseServiceRoleKey.includes('your-service')
)

export const supabaseAdmin = isSupabaseEnabled
  ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  : null

export const supabasePublic =
  isSupabaseEnabled &&
    env.supabaseAnonKey &&
    !env.supabaseAnonKey.includes('your-supabase')
    ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    : null

export const supabaseOAuth =
  isSupabaseEnabled &&
    env.supabaseAnonKey &&
    !env.supabaseAnonKey.includes('your-supabase')
    ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        flowType: 'implicit',
        autoRefreshToken: false,
        persistSession: false
      }
    })
    : null

export async function checkSupabaseHealth() {
  if (!isSupabaseEnabled || !supabaseAdmin) {
    return { configured: false, connected: false, mode: 'in-memory-fallback' }
  }
  try {
    const { error } = await supabaseAdmin.from('events').select('id').limit(1)
    if (error) {
      return { configured: true, connected: false, mode: 'supabase-schema-pending', error: error.message }
    }
    return { configured: true, connected: true, mode: 'supabase-connected' }
  } catch (err) {
    return { configured: true, connected: false, mode: 'supabase-unreachable', error: err.message }
  }
}
