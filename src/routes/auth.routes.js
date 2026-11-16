import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { loginSchema, profileUpdateSchema, registerSchema } from '../validators/schemas.js'
import { isSupabaseEnabled, supabasePublic } from '../config/supabase.js'
import { store } from '../repositories/store.js'
import { sendSuccess, AppError } from '../utils/response.js'

const router = Router()

function slugifyText(value = '') {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

router.post('/auth/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password, portal_role } = req.validatedBody

    if (isSupabaseEnabled && supabasePublic) {
      const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password })
      if (error || !data?.user || !data?.session) {
        throw new AppError(error?.message || 'Email atau kata sandi salah.', 401, 'INVALID_CREDENTIALS')
      }

      const actualRole = data.user.user_metadata?.role || portal_role
      if (portal_role === 'admin' && actualRole !== 'admin') {
        throw new AppError('Akun ini tidak memiliki akses Platform Administrator.', 403, 'FORBIDDEN_PORTAL')
      }
      if (portal_role === 'organizer' && actualRole !== 'organizer') {
        throw new AppError('Akun ini bukan akun Organizer. Silakan masuk melalui Login Peserta.', 403, 'FORBIDDEN_PORTAL')
      }

      const userPayload = {
        id: data.user.id,
        email: data.user.email,
        full_name: data.user.user_metadata?.full_name || email.split('@')[0],
        role: actualRole
      }

      const existingIdx = store.users.findIndex((u) => u.id === userPayload.id || u.email === userPayload.email)
      if (existingIdx === -1) {
        store.users.push(userPayload)
      } else {
        store.users[existingIdx] = { ...store.users[existingIdx], ...userPayload }
      }

      return sendSuccess(
        res,
        {
          user: userPayload,
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          mode: 'supabase'
        },
        'Login berhasil.'
      )
    }

    // Server-side in-memory / demo fallback when Supabase env is not yet configured
    const existing = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase())
    if (existing) {
      if (portal_role === 'admin' && existing.role !== 'admin') {
        throw new AppError('Akun ini tidak memiliki akses Platform Administrator.', 403, 'FORBIDDEN_PORTAL')
      }
      if (portal_role === 'organizer' && existing.role !== 'organizer') {
        throw new AppError('Akun ini bukan akun Organizer. Silakan masuk melalui Login Peserta.', 403, 'FORBIDDEN_PORTAL')
      }
    }

    const defaultNames = {
      customer: 'Nadia Putri (Peserta)',
      organizer: 'Hikam Pratama (Organizer)',
      admin: 'System Administrator'
    }

    const effectiveRole = existing?.role || portal_role
    const userPayload = existing || {
      id: `usr-${portal_role}`,
      full_name: defaultNames[portal_role] || email.split('@')[0],
      email,
      role: effectiveRole
    }

    return sendSuccess(
      res,
      {
        user: userPayload,
        access_token: `demo-token-${effectiveRole}`,
        mode: 'in-memory-fallback'
      },
      'Login berhasil.'
    )
  } catch (err) {
    return next(err)
  }
})

router.post('/auth/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const { full_name, email, password, role, organization_name } = req.validatedBody

    if (isSupabaseEnabled && supabasePublic) {
      const { data, error } = await supabasePublic.auth.signUp({
        email,
        password,
        options: { data: { full_name, role, organization_name } }
      })
      if (error || !data?.user) {
        throw new AppError(error?.message || 'Gagal mendaftarkan akun.', 400, 'REGISTER_FAILED')
      }

      const userPayload = {
        id: data.user.id,
        full_name,
        email: data.user.email || email,
        role,
        organization_name
      }

      if (!store.users.some((u) => u.email === userPayload.email)) {
        store.users.push(userPayload)
      }

      return sendSuccess(
        res,
        {
          user: userPayload,
          access_token: data.session?.access_token || null,
          requires_email_confirmation: !data.session?.access_token,
          mode: 'supabase'
        },
        data.session?.access_token
          ? 'Registrasi berhasil.'
          : 'Registrasi berhasil. Silakan cek email untuk verifikasi akun.',
        201
      )
    }

    if (store.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new AppError('Email sudah terdaftar.', 409, 'EMAIL_EXISTS')
    }

    const userPayload = {
      id: `usr-${Date.now()}`,
      full_name,
      email,
      role,
      organization_name
    }
    store.users.push(userPayload)

    if (role === 'organizer' && organization_name.trim()) {
      store.organizations.unshift({
        id: `org-${Date.now()}`,
        name: organization_name.trim(),
        slug: slugifyText(organization_name) || `org-${Date.now()}`,
        description: `Organisasi penyelenggara event ${organization_name.trim()}.`,
        email,
        website: 'https://terra.id',
        verification_status: 'pending',
        created_by: userPayload.id,
        members: [{ id: `om-${Date.now()}`, user_id: userPayload.id, email, role: 'Owner' }]
      })
    }

    return sendSuccess(
      res,
      {
        user: userPayload,
        access_token: `demo-token-${role}`,
        requires_email_confirmation: false,
        mode: 'in-memory-fallback'
      },
      'Registrasi berhasil.',
      201
    )
  } catch (err) {
    return next(err)
  }
})

router.post('/auth/logout', (_req, res) => {
  return sendSuccess(res, { logged_out: true }, 'Sesi berhasil diakhiri.')
})

router.get('/auth/me', requireAuth, (req, res) => {
  const user = store.users.find((u) => u.id === req.user.id) || req.user
  const orgs = store.organizations.filter(
    (o) => o.created_by === user.id || o.members.some((m) => m.user_id === user.id)
  )
  return sendSuccess(res, { user, organizations: orgs }, 'Profil pengguna diambil.')
})

router.post('/auth/profile', requireAuth, validateBody(profileUpdateSchema), (req, res) => {
  const idx = store.users.findIndex((u) => u.id === req.user.id)
  if (idx === -1) {
    const newUser = { id: req.user.id, email: req.user.email, role: req.user.role, ...req.validatedBody }
    store.users.push(newUser)
    return sendSuccess(res, newUser, 'Profil dibuat.', 201)
  }
  store.users[idx] = { ...store.users[idx], ...req.validatedBody }
  return sendSuccess(res, store.users[idx], 'Profil diperbarui.')
})

router.patch('/auth/profile', requireAuth, validateBody(profileUpdateSchema), (req, res) => {
  const user = store.users.find((u) => u.id === req.user.id)
  if (!user) throw new AppError('Profil tidak ditemukan.', 404, 'PROFILE_NOT_FOUND')
  Object.assign(user, req.validatedBody)
  return sendSuccess(res, user, 'Profil diperbarui.')
})

router.get('/notifications', requireAuth, (req, res) => {
  const list = store.notifications.filter((n) => n.user_id === req.user.id)
  return sendSuccess(res, list)
})

router.patch('/notifications/:id/read', requireAuth, (req, res) => {
  const notif = store.notifications.find((n) => n.id === req.params.id && n.user_id === req.user.id)
  if (!notif) throw new AppError('Notifikasi tidak ditemukan.', 404, 'NOT_FOUND')
  notif.is_read = true
  return sendSuccess(res, notif, 'Notifikasi ditandai sudah dibaca.')
})

export default router
