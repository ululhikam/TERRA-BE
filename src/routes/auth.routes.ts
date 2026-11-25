import crypto from 'node:crypto'
import { Router } from 'express'
import passport, {
  decodeOAuthState,
  encodeOAuthState,
  isGoogleOAuthEnabled,
  signOAuthToken
} from '../config/passport.js'
import { env } from '../config/env.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  acceptInviteSchema,
  changeUnverifiedEmailSchema,
  forgotPasswordSchema,
  loginSchema,
  profileUpdateSchema,
  registerSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema
} from '../validators/schemas.js'
import { isSupabaseEnabled, supabaseAdmin, supabasePublic } from '../config/supabase.js'
import { sendOtpEmail } from '../services/email.service.js'
import { hashPassword, verifyPassword } from '../utils/crypto.js'
import * as db from '../repositories/db.js'
import * as pricingDb from '../repositories/pricing.db.js'
import { sendSuccess, AppError, asyncHandler } from '../utils/response.js'

const router = Router()

const OTP_TTL_MS = 10 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5
const TRIAL_DAYS = 14

function sanitizeUser(user) {
  if (!user) return null
  const {
    password_hash: _ph,
    otp_code_hash: _oh,
    otp_expires_at: _oe,
    otp_attempts: _oa,
    ...safe
  } = user
  if (safe.role === 'organizer') {
    safe.subscription = db.evaluateOrganizerSubscription(safe)
  }
  return safe
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000))
}

function hashOtpCode(code) {
  return crypto.createHash('sha256').update(String(code).trim()).digest('hex')
}

function signOtpSessionToken(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role || 'customer',
    purpose: 'otp_pending',
    exp: Math.floor(Date.now() / 1000) + 60 * 30
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto
    .createHmac('sha256', env.oauthJwtSecret)
    .update(encoded)
    .digest('base64url')
  return `otp-sess.${encoded}.${sig}`
}

function verifyOtpSessionToken(token) {
  if (!token || !String(token).startsWith('otp-sess.')) return null
  const parts = String(token).split('.')
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
    if (payload.purpose !== 'otp_pending') return null
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

router.post('/auth/login', validateBody(loginSchema), asyncHandler(async (req, res) => {
  const { email, password, portal_role } = req.validatedBody

  if (isSupabaseEnabled && supabasePublic) {
    const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password })

    if (error) {
      const msg = (error.message || '').toLowerCase()
      const existingLocal =
        (await db.findUserByEmail(email, portal_role)) || (await db.findUserByEmail(email))
      if (
        (msg.includes('not confirmed') || msg.includes('confirm')) &&
        existingLocal &&
        existingLocal.email_verified === false
      ) {
        throw new AppError(
          'Email Anda belum diverifikasi. Masukkan kode OTP dari email atau ubah alamat email.',
          403,
          'EMAIL_NOT_VERIFIED',
          [
            {
              requires_otp: true,
              email: existingLocal.email,
              otp_session_token: signOtpSessionToken(existingLocal)
            }
          ]
        )
      }

      // Allow verified Prisma accounts with valid password_hash (e.g. seeded Super Admin) to authenticate cleanly
      if (existingLocal && existingLocal.password_hash && verifyPassword(password, existingLocal.password_hash)) {
        if (existingLocal.is_suspended) {
          throw new AppError('Akun Anda sedang ditangguhkan oleh Administrator.', 403, 'ACCOUNT_SUSPENDED')
        }
        if (existingLocal.email_verified === false) {
          throw new AppError(
            'Email Anda belum diverifikasi. Masukkan kode OTP terlebih dahulu.',
            403,
            'EMAIL_NOT_VERIFIED',
            [
              {
                requires_otp: true,
                email: existingLocal.email,
                otp_session_token: signOtpSessionToken(existingLocal)
              }
            ]
          )
        }
        if (portal_role === 'admin' && existingLocal.role !== 'admin') {
          throw new AppError('Akun ini tidak memiliki akses Platform Administrator.', 403, 'FORBIDDEN_PORTAL')
        }
        if (portal_role === 'organizer' && existingLocal.role !== 'organizer') {
          throw new AppError('Akun ini bukan akun Organizer. Silakan masuk melalui Login Peserta.', 403, 'FORBIDDEN_PORTAL')
        }
        const token = signOAuthToken(existingLocal)
        return sendSuccess(
          res,
          {
            user: sanitizeUser(existingLocal),
            access_token: token,
            refresh_token: null,
            mode: 'prisma-jwt'
          },
          'Login berhasil.'
        )
      }

      throw new AppError(error.message || 'Email atau kata sandi salah.', 401, 'INVALID_CREDENTIALS')
    }

    if (!data?.user || !data?.session) {
      throw new AppError('Email atau kata sandi salah.', 401, 'INVALID_CREDENTIALS')
    }

    const stored = await db.findUserByIdOrEmail(data.user.id, data.user.email, portal_role)
    if (stored && stored.email_verified === false) {
      throw new AppError(
        'Email Anda belum diverifikasi. Masukkan kode OTP terlebih dahulu.',
        403,
        'EMAIL_NOT_VERIFIED',
        [
          {
            requires_otp: true,
            email: stored.email,
            otp_session_token: signOtpSessionToken(stored)
          }
        ]
      )
    }

    const actualRole = stored?.role || data.user.user_metadata?.role || portal_role
    if (stored?.is_suspended) {
      throw new AppError('Akun Anda sedang ditangguhkan oleh Administrator.', 403, 'ACCOUNT_SUSPENDED')
    }
    if (portal_role === 'admin' && actualRole !== 'admin') {
      throw new AppError('Akun ini tidak memiliki akses Platform Administrator.', 403, 'FORBIDDEN_PORTAL')
    }
    if (portal_role === 'organizer' && actualRole !== 'organizer') {
      throw new AppError('Akun ini bukan akun Organizer. Silakan masuk melalui Login Peserta.', 403, 'FORBIDDEN_PORTAL')
    }

    const syncedUser = await db.upsertUser({
      id: data.user.id,
      email: data.user.email,
      full_name: stored?.full_name || data.user.user_metadata?.full_name || email.split('@')[0],
      role: actualRole,
      provider: 'email',
      email_verified: true
    })

    return sendSuccess(
      res,
      {
        user: sanitizeUser(syncedUser),
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        mode: 'supabase'
      },
      'Login berhasil.'
    )
  }

  // Server-side local/fallback mode
  const existing = (await db.findUserByEmail(email, portal_role)) || (await db.findUserByEmail(email))
  if (existing) {
    if (existing.is_suspended) {
      throw new AppError('Akun Anda sedang ditangguhkan oleh Administrator.', 403, 'ACCOUNT_SUSPENDED')
    }
    if (existing.password_hash && !verifyPassword(password, existing.password_hash)) {
      throw new AppError('Email atau kata sandi salah.', 401, 'INVALID_CREDENTIALS')
    }
    if (existing.email_verified === false) {
      throw new AppError(
        'Email Anda belum diverifikasi. Masukkan kode OTP dari email atau ubah alamat email.',
        403,
        'EMAIL_NOT_VERIFIED',
        [
          {
            requires_otp: true,
            email: existing.email,
            otp_session_token: signOtpSessionToken(existing)
          }
        ]
      )
    }
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
    role: effectiveRole,
    email_verified: true
  }

  return sendSuccess(
    res,
    {
      user: sanitizeUser(userPayload),
      access_token: `demo-token-${effectiveRole}`,
      mode: 'in-memory-fallback'
    },
    'Login berhasil.'
  )
}))

router.post('/auth/register', validateBody(registerSchema), asyncHandler(async (req, res) => {
  const { full_name, email, password, role, organization_name } = req.validatedBody

  const existingLocal = await db.findUserByEmail(email, role)
  if (existingLocal) {
    if (existingLocal.email_verified === false) {
      throw new AppError(
        'Email ini sudah terdaftar tetapi belum diverifikasi OTP. Lanjutkan verifikasi atau ganti email.',
        409,
        'EMAIL_NOT_VERIFIED',
        [
          {
            requires_otp: true,
            email: existingLocal.email,
            otp_session_token: signOtpSessionToken(existingLocal)
          }
        ]
      )
    }
    throw new AppError('Email sudah terdaftar.', 409, 'EMAIL_EXISTS')
  }

  let authUserId = `usr-${Date.now()}`
  let authMode = 'prisma-otp'

  if (isSupabaseEnabled && supabaseAdmin) {
    const { data: createdData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { full_name, role, organization_name }
    })
    if (createError || !createdData?.user) {
      const isDuplicate = (createError?.message || '').toLowerCase().includes('already')
      throw new AppError(
        createError?.message || 'Gagal mendaftarkan akun.',
        isDuplicate ? 409 : 400,
        isDuplicate ? 'EMAIL_EXISTS' : 'REGISTER_FAILED'
      )
    }
    authUserId = createdData.user.id
    authMode = 'supabase-otp'
  }

  const otpCode = generateOtpCode()
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS)

  const syncedUser = await db.upsertUser({
    id: authUserId,
    full_name,
    email,
    password_hash: hashPassword(password),
    role,
    provider: 'email',
    email_verified: false,
    otp_code_hash: hashOtpCode(otpCode),
    otp_expires_at: otpExpiresAt,
    otp_attempts: 0,
    ...(role === 'organizer'
      ? {
          subscription_plan: 'unsubscribed',
          subscription_status: 'unpaid',
          subscription_expires_at: null
        }
      : {})
  })

  if (role === 'organizer') {
    await db.ensureOrganizerDefaultOrganization(syncedUser, organization_name)
  }

  const otpSessionToken = signOtpSessionToken(syncedUser)
  const emailStatus = await sendOtpEmail({
    to: email,
    fullName: full_name,
    otpCode
  })

  return sendSuccess(
    res,
    {
      user: { ...sanitizeUser(syncedUser), organization_name },
      requires_otp: true,
      otp_session_token: otpSessionToken,
      email_status: emailStatus,
      expires_in_seconds: Math.floor(OTP_TTL_MS / 1000),
      mode: authMode
    },
    emailStatus.sent
      ? 'Registrasi berhasil. Kode OTP telah dikirim ke email Anda.'
      : 'Akun dibuat, namun email OTP gagal dikirim. Anda dapat mengganti email atau mengirim ulang OTP.',
    201
  )
}))

router.post('/auth/verify-otp', validateBody(verifyOtpSchema), asyncHandler(async (req, res) => {
  const { email, otp_code, otp_session_token } = req.validatedBody

  const sess = otp_session_token ? verifyOtpSessionToken(otp_session_token) : null
  let user = await db.findUserByEmail(email, sess?.role || null)
  if (!user && sess?.sub) {
    user = await db.findUserById(sess.sub, sess.role || null)
  }

  if (!user) {
    throw new AppError('Akun dengan email tersebut tidak ditemukan.', 404, 'USER_NOT_FOUND')
  }
  if (user.email_verified) {
    throw new AppError('Email akun ini sudah terverifikasi. Silakan langsung login.', 400, 'ALREADY_VERIFIED')
  }
  if (!user.otp_code_hash || !user.otp_expires_at) {
    throw new AppError('Kode OTP belum dibuat atau sudah kedaluwarsa. Silakan kirim ulang OTP.', 400, 'OTP_NOT_FOUND')
  }
  if (new Date(user.otp_expires_at).getTime() < Date.now()) {
    throw new AppError('Kode OTP telah kedaluwarsa. Silakan kirim ulang kode OTP baru.', 400, 'OTP_EXPIRED')
  }
  if ((user.otp_attempts || 0) >= OTP_MAX_ATTEMPTS) {
    throw new AppError('Terlalu banyak percobaan OTP salah. Silakan kirim ulang kode OTP baru.', 429, 'OTP_MAX_ATTEMPTS')
  }

  const submittedHash = Buffer.from(hashOtpCode(otp_code), 'hex')
  const expectedHash = Buffer.from(user.otp_code_hash, 'hex')
  const matched =
    submittedHash.length === expectedHash.length && crypto.timingSafeEqual(submittedHash, expectedHash)

  if (!matched) {
    await db.incrementOtpAttempts(user.id, user.role)
    throw new AppError('Kode OTP tidak cocok. Periksa kembali inbox email Anda.', 400, 'INVALID_OTP')
  }

  if (isSupabaseEnabled && supabaseAdmin) {
    const { error: confirmErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email_confirm: true
    })
    if (confirmErr) {
      throw new AppError(confirmErr.message || 'Gagal mengonfirmasi user di Supabase Auth.', 500, 'SUPABASE_CONFIRM_FAILED')
    }
  }

  const verifiedUser = await db.markUserEmailVerified(user.id, user.role)
  const accessToken = signOAuthToken({ ...verifiedUser, provider: 'email' })

  return sendSuccess(
    res,
    {
      user: sanitizeUser(verifiedUser),
      access_token: accessToken,
      verified: true
    },
    'Email berhasil diverifikasi! Akun Anda kini aktif.'
  )
}))

router.post('/auth/resend-otp', validateBody(resendOtpSchema), asyncHandler(async (req, res) => {
  const { email, otp_session_token } = req.validatedBody

  const sess = verifyOtpSessionToken(otp_session_token)
  if (!sess) {
    throw new AppError('Sesi verifikasi tidak valid atau kedaluwarsa. Silakan login ulang untuk mendapatkan sesi baru.', 401, 'INVALID_OTP_SESSION')
  }

  let user = await db.findUserByEmail(email, sess?.role || null)
  if (sess && user && sess.sub !== user.id) {
    throw new AppError('Sesi verifikasi tidak cocok dengan email tersebut.', 403, 'FORBIDDEN')
  }
  if (!user && sess?.sub) {
    user = await db.findUserById(sess.sub, sess.role || null)
  }

  if (!user) {
    throw new AppError('Akun tidak ditemukan.', 404, 'USER_NOT_FOUND')
  }
  if (user.email_verified) {
    throw new AppError('Email akun ini sudah terverifikasi.', 400, 'ALREADY_VERIFIED')
  }

  const otpCode = generateOtpCode()
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS)
  await db.setUserOtp(
    user.id,
    {
      otpCodeHash: hashOtpCode(otpCode),
      otpExpiresAt
    },
    user.role
  )

  const emailStatus = await sendOtpEmail({
    to: user.email,
    fullName: user.full_name,
    otpCode
  })

  return sendSuccess(
    res,
    {
      email: user.email,
      otp_session_token: signOtpSessionToken(user),
      email_status: emailStatus,
      expires_in_seconds: Math.floor(OTP_TTL_MS / 1000)
    },
    emailStatus.sent
      ? 'Kode OTP baru telah dikirim ke email Anda.'
      : 'Gagal mengirim OTP ke alamat email ini. Pertimbangkan untuk mengganti email Anda.'
  )
}))

router.post('/auth/change-unverified-email', validateBody(changeUnverifiedEmailSchema), asyncHandler(async (req, res) => {
  const { current_email, new_email, otp_session_token } = req.validatedBody

  const sess = verifyOtpSessionToken(otp_session_token)
  if (!sess) {
    throw new AppError('Sesi ganti email tidak valid atau sudah kedaluwarsa. Silakan login ulang terlebih dahulu.', 401, 'INVALID_OTP_SESSION')
  }

  const user = await db.findUserById(sess.sub, sess.role || null)
  if (!user) {
    throw new AppError('Akun tidak ditemukan.', 404, 'USER_NOT_FOUND')
  }
  if (user.email_verified) {
    throw new AppError('Email sudah terverifikasi dan tidak dapat diganti lewat alur ini.', 400, 'ALREADY_VERIFIED')
  }
  if (user.email.toLowerCase() !== current_email.trim().toLowerCase()) {
    throw new AppError('Email lama tidak cocok dengan sesi pendaftaran.', 400, 'EMAIL_MISMATCH')
  }

  const trimmedNew = new_email.trim().toLowerCase()
  if (trimmedNew === user.email.toLowerCase()) {
    throw new AppError('Alamat email baru harus berbeda dari email sebelumnya.', 400, 'SAME_EMAIL')
  }

  const conflict = await db.findUserByEmail(trimmedNew, user.role)
  if (conflict) {
    throw new AppError('Alamat email baru sudah digunakan oleh akun lain.', 409, 'EMAIL_EXISTS')
  }

  if (isSupabaseEnabled && supabaseAdmin) {
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email: trimmedNew,
      email_confirm: false
    })
    if (updateErr) {
      throw new AppError(updateErr.message || 'Gagal memperbarui email di Supabase Auth.', 400, 'EMAIL_UPDATE_FAILED')
    }
  }

  const otpCode = generateOtpCode()
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS)
  const updatedUser = await db.updateUnverifiedEmail(
    user.id,
    user.email,
    trimmedNew,
    {
      otpCodeHash: hashOtpCode(otpCode),
      otpExpiresAt
    },
    user.role
  )

  const nextToken = signOtpSessionToken(updatedUser)
  const emailStatus = await sendOtpEmail({
    to: trimmedNew,
    fullName: updatedUser.full_name,
    otpCode
  })

  return sendSuccess(
    res,
    {
      email: trimmedNew,
      otp_session_token: nextToken,
      email_status: emailStatus,
      expires_in_seconds: Math.floor(OTP_TTL_MS / 1000)
    },
    emailStatus.sent
      ? `Email diubah ke ${trimmedNew} dan OTP baru berhasil dikirim.`
      : `Email diubah ke ${trimmedNew}, namun pengiriman OTP belum berhasil: ${emailStatus.reason || 'cek alamat email'}`
  )
}))

router.post('/auth/logout', (_req, res) => {
  return sendSuccess(res, { logged_out: true }, 'Sesi berhasil diakhiri.')
})

router.post('/auth/forgot-password', validateBody(forgotPasswordSchema), asyncHandler(async (req, res) => {
  const email = req.validatedBody.email.trim().toLowerCase()
  const user = await db.findUserByEmail(email)
  if (!user) {
    return sendSuccess(
      res,
      { requested: true },
      'Jika email terdaftar, kode OTP reset kata sandi telah dikirimkan.'
    )
  }

  const otpCode = generateOtpCode()
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS)
  await db.setUserOtp(
    user.id,
    {
      otpCodeHash: hashOtpCode(otpCode),
      otpExpiresAt
    },
    user.role
  )

  const emailStatus = await sendOtpEmail({
    to: user.email,
    fullName: user.full_name,
    otpCode,
    purpose: 'Reset Kata Sandi Akun TERRA'
  })

  return sendSuccess(
    res,
    {
      requested: true,
      email_status: emailStatus,
      expires_in_seconds: Math.floor(OTP_TTL_MS / 1000)
    },
    emailStatus.sent
      ? 'Kode OTP reset kata sandi telah dikirim ke email Anda.'
      : 'Kode reset dibuat. Periksa konfigurasi pengiriman email.'
  )
}))

router.post('/auth/reset-password', validateBody(resetPasswordSchema), asyncHandler(async (req, res) => {
  const { email, otp_code, new_password } = req.validatedBody
  const cleanEmail = email.trim().toLowerCase()
  const user = await db.findUserByEmail(cleanEmail)
  if (!user || !user.otp_code_hash) {
    throw new AppError('Kode OTP reset tidak valid atau belum diminta.', 400, 'INVALID_OTP')
  }
  if (user.otp_expires_at && new Date(user.otp_expires_at).getTime() < Date.now()) {
    throw new AppError('Kode OTP reset sudah kedaluwarsa.', 400, 'OTP_EXPIRED')
  }
  if (Number(user.otp_attempts || 0) >= OTP_MAX_ATTEMPTS) {
    throw new AppError('Terlalu banyak percobaan OTP gagal. Minta kode OTP baru.', 429, 'OTP_MAX_ATTEMPTS')
  }

  if (hashOtpCode(otp_code) !== user.otp_code_hash) {
    await db.incrementOtpAttempts(user.id, user.role)
    throw new AppError('Kode OTP reset tidak sesuai.', 400, 'INVALID_OTP')
  }

  if (isSupabaseEnabled && supabaseAdmin && user.id && !String(user.id).startsWith('usr-') && !String(user.id).startsWith('orgu-')) {
    await supabaseAdmin.auth.admin.updateUserById(user.id, { password: new_password }).catch(() => {})
  }

  await db.resetUserPassword(user.id, hashPassword(new_password), user.role)
  return sendSuccess(res, { reset: true }, 'Kata sandi berhasil diperbarui. Silakan login dengan kata sandi baru.')
}))

router.get('/auth/me', requireAuth, asyncHandler(async (req, res) => {
  const user = (await db.findUserByIdOrEmail(req.user.id, req.user.email, req.user.role)) || req.user
  const orgs = await db.listOrganizationsForUser(user)
  const safe = sanitizeUser(user)
  if (safe?.role === 'organizer') {
    safe.subscription.has_invited_event_access = await db.hasActiveOrganizerOrTeamAccess(user)
  }
  return sendSuccess(res, { user: safe, organizations: orgs }, 'Profil pengguna diambil.')
}))

router.post('/auth/profile', requireAuth, validateBody(profileUpdateSchema), asyncHandler(async (req, res) => {
  const user = await db.updateUserProfile(req.user, req.validatedBody)
  return sendSuccess(res, sanitizeUser(user), 'Profil diperbarui.')
}))

router.patch('/auth/profile', requireAuth, validateBody(profileUpdateSchema), asyncHandler(async (req, res) => {
  const user = await db.updateUserProfile(req.user, req.validatedBody)
  return sendSuccess(res, sanitizeUser(user), 'Profil diperbarui.')
}))

router.get('/notifications', requireAuth, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listNotifications(req.user.id))
}))

router.patch('/notifications/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const notif = await db.markNotificationRead(req.params.id, req.user.id)
  return sendSuccess(res, notif, 'Notifikasi ditandai sudah dibaca.')
}))

// ---------------- ORGANIZER PLANS & GOOGLE OAUTH ----------------
router.get('/auth/organizer/plans', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await pricingDb.listPublicPricingCatalog())
}))

router.get('/auth/oauth/status', (_req, res) => {
  return sendSuccess(res, { google_enabled: isGoogleOAuthEnabled })
})

router.get('/auth/google', (req, res, next) => {
  const role = req.query.role === 'organizer' ? 'organizer' : 'customer'
  const organizationName = typeof req.query.organization_name === 'string' ? req.query.organization_name.trim() : ''
  const state = encodeOAuthState({
    origin: typeof req.query.origin === 'string' ? req.query.origin : undefined,
    next: typeof req.query.next === 'string' ? req.query.next : role === 'organizer' ? '/dashboard/billing' : '/events',
    role,
    organization_name: organizationName
  })
  const decoded = decodeOAuthState(state)
  const errorRedirectPath = role === 'organizer' ? '/organizer/login' : '/login'

  if (!isGoogleOAuthEnabled) {
    return res.redirect(
      `${decoded.origin}${errorRedirectPath}?oauth_error=${encodeURIComponent(
        'Google OAuth belum dikonfigurasi di .env backend (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET).'
      )}`
    )
  }

  return passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    prompt: 'select_account',
    state
  })(req, res, next)
})

router.get('/auth/google/callback', (req, res, next) => {
  const { origin, next: nextPath, role } = decodeOAuthState(req.query.state)
  const errorRedirectPath = role === 'organizer' ? '/organizer/login' : '/login'

  if (!isGoogleOAuthEnabled) {
    return res.redirect(
      `${origin}${errorRedirectPath}?oauth_error=${encodeURIComponent('Google OAuth belum aktif di server.')}`
    )
  }

  return passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) {
      const message = err?.message || 'Autentikasi Google dibatalkan atau gagal.'
      return res.redirect(`${origin}${errorRedirectPath}?oauth_error=${encodeURIComponent(message)}`)
    }

    const signedToken = signOAuthToken(user)
    return res.redirect(
      `${origin}/auth/callback?token=${encodeURIComponent(signedToken)}&next=${encodeURIComponent(nextPath)}`
    )
  })(req, res, next)
})

// ---------------- TEAM INVITATION ACCEPTANCE ----------------
router.get('/auth/invite/:token', asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.findInviteByToken(req.params.token))
}))

router.post('/auth/accept-invite', validateBody(acceptInviteSchema), asyncHandler(async (req, res) => {
  const { token, full_name, password } = req.validatedBody
  const invite = await db.findInviteByToken(token)
  const displayName = full_name?.trim() || invite.name || invite.email.split('@')[0]

  let userPayload = null
  let accessToken = null
  let authMode = 'oauth-jwt'

  if (isSupabaseEnabled && supabaseAdmin && supabasePublic) {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName, role: 'organizer' }
    })

    if (!createErr && created?.user) {
      const { data: signInData } = await supabasePublic.auth.signInWithPassword({
        email: invite.email,
        password
      })
      userPayload = {
        id: created.user.id,
        email: invite.email,
        full_name: displayName,
        role: 'organizer',
        provider: 'invite',
        email_verified: true
      }
      if (signInData?.session?.access_token) {
        accessToken = signInData.session.access_token
        authMode = 'supabase'
      }
    } else {
      const { data: signInData } = await supabasePublic.auth.signInWithPassword({
        email: invite.email,
        password
      })
      if (signInData?.user && signInData?.session) {
        userPayload = {
          id: signInData.user.id,
          email: signInData.user.email,
          full_name: signInData.user.user_metadata?.full_name || displayName,
          role: 'organizer',
          provider: 'invite',
          email_verified: true
        }
        accessToken = signInData.session.access_token
        authMode = 'supabase'
      }
    }
  }

  const existing = await db.findUserByEmail(invite.email, 'organizer')
  userPayload = await db.upsertUser({
    id: userPayload?.id || existing?.id || `usr-team-${Date.now()}`,
    full_name: displayName,
    email: invite.email,
    role: 'organizer',
    provider: 'invite',
    email_verified: true
  })

  if (!accessToken) {
    accessToken = signOAuthToken({ ...userPayload, provider: 'invite' })
  }

  const accepted = await db.acceptTeamInvite(token, userPayload)

  return sendSuccess(
    res,
    {
      user: sanitizeUser(userPayload),
      access_token: accessToken,
      event_id: accepted.event_id,
      permissions: accepted.permissions,
      mode: authMode
    },
    'Undangan kepanitiaan diterima. Selamat bergabung!'
  )
}))

export default router
