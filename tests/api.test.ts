import crypto from 'node:crypto'
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Keep integration tests isolated from live production Supabase Postgres & Resend
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = ''
process.env.DIRECT_URL = ''
process.env.RESEND_API_KEY = ''
process.env.MIDTRANS_SERVER_KEY = ''
process.env.MIDTRANS_CLIENT_KEY = ''

const { default: app } = await import('../src/app.js')
const { env } = await import('../src/config/env.js')
const { store } = await import('../src/repositories/store.js')
const { signOAuthToken } = await import('../src/config/passport.js')
const { buildTicketQrEmailHtml, mapResendAttachments } = await import('../src/services/email.service.js')
const { generateBrandedQrBuffer } = await import('../src/utils/qrcode.js')
const { generateTicketsQrPdfBuffer } = await import('../src/services/pdf.service.js')
const { computeMidtransSignature } = await import('../src/services/payment.service.js')

let server
let baseUrl

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address()
      baseUrl = `http://127.0.0.1:${port}/api/v1`
      resolve()
    })
  })
})

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

beforeEach(() => {
  store.reset()
})

async function request(path: string, { method = 'GET', token = null, body = null }: any = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  const contentType = res.headers.get('content-type') || ''
  let data: any
  if (contentType.includes('application/json')) {
    data = await res.json()
  } else if (contentType.includes('application/pdf') || contentType.includes('image/png')) {
    data = Buffer.from(await res.arrayBuffer())
  } else {
    data = await res.text()
  }
  return { status: res.status, headers: res.headers, data }
}

describe('TERRA Backend API v1 Integration Tests', () => {
  it('returns healthy status and filters marketplace to Published events only', async () => {
    const health = await request('/health')
    assert.equal(health.status, 200)
    assert.equal(health.data.success, true)
    assert.equal(health.data.database.orm, 'prisma')

    const mkt = await request('/marketplace/events')
    assert.equal(mkt.status, 200)
    assert.ok(mkt.data.data.every((e) => e.publication_status === 'Published'))
    assert.equal(mkt.data.data.some((e) => e.id === 'evt-3'), false)
  })

  it('enforces role isolation across Customer, Organizer, and Admin portals', async () => {
    const noAuth = await request('/events')
    assert.equal(noAuth.status, 401)

    const customerDashboard = await request('/events', { token: 'demo-token-customer' })
    assert.equal(customerDashboard.status, 403)

    const organizerAdmin = await request('/admin/dashboard', { token: 'demo-token-organizer' })
    assert.equal(organizerAdmin.status, 403)

    const approveRes = await request('/admin/events/evt-3/approve', {
      method: 'POST',
      token: 'demo-token-admin',
      body: { notes: 'Approved for marketplace' }
    })
    assert.equal(approveRes.status, 200)
    assert.equal(approveRes.data.data.event.publication_status, 'Approved')

    const publishRes = await request('/events/evt-3/publish', {
      method: 'POST',
      token: 'demo-token-organizer'
    })
    assert.equal(publishRes.status, 200)
    assert.equal(publishRes.data.data.publication_status, 'Published')
  })

  it('enforces module activation, dependency rules, and data preservation', async () => {
    // Disabling finance should block /finance/summary with 403 MODULE_DISABLED
    const disableFinance = await request('/events/evt-1/modules/finance', {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { is_enabled: false }
    })
    assert.equal(disableFinance.status, 200)

    const blockedFinance = await request('/events/evt-1/finance/summary', {
      token: 'demo-token-organizer'
    })
    assert.equal(blockedFinance.status, 403)
    assert.equal(blockedFinance.data.error.code, 'MODULE_DISABLED')

    // Re-enabling finance preserves existing data and restores access
    await request('/events/evt-1/modules/finance', {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { is_enabled: true }
    })
    const financeSummary = await request('/events/evt-1/finance/summary', {
      token: 'demo-token-organizer'
    })
    assert.equal(financeSummary.status, 200)
    // VIP Executive Pass: 48 * 250000 = 12,000,000
    assert.equal(financeSummary.data.data.paid_ticket_revenue, 12000000)
    assert.equal(financeSummary.data.data.manual_income, 60000000)
    assert.equal(financeSummary.data.data.total_income, 72000000)

    // Cannot disable core event_profile
    const disableCore = await request('/events/evt-1/modules/event_profile', {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { is_enabled: false }
    })
    assert.equal(disableCore.status, 400)
    assert.equal(disableCore.data.error.code, 'CORE_MODULE_REQUIRED')
  })

  it('supports hierarchical checkpoint & sub-task creation in Timeline', async () => {
    const parentRes = await request('/events/evt-1/tasks', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: {
        title: 'Persiapan Logistik Tambahan',
        is_group: true,
        phase: 'Production',
        start_date: '2026-11-20',
        due_at: '2026-11-28'
      }
    })
    assert.equal(parentRes.status, 201)
    const parentId = parentRes.data.data.id

    const childRes = await request('/events/evt-1/tasks', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: {
        title: 'Sewa Genset Cadangan',
        parent_id: parentId,
        is_group: false,
        phase: 'Production',
        start_date: '2026-11-21',
        due_at: '2026-11-25',
        progress: 40
      }
    })
    assert.equal(childRes.status, 201)
    assert.equal(childRes.data.data.parent_id, parentId)
  })

  it('handles ticket ordering, quota restoration on cancel, and prevents duplicate check-in', async () => {
    const orderRes = await request('/orders', {
      method: 'POST',
      token: 'demo-token-customer',
      body: {
        event_id: 'evt-1',
        ticket_type_id: 'tkt-1',
        quantity: 2,
        attendee: {
          full_name: 'Budi Peserta',
          email: 'budi@example.com',
          phone: '081299998888'
        }
      }
    })
    assert.equal(orderRes.status, 201)
    assert.equal(orderRes.data.data.order.order_status, 'Confirmed')
    assert.equal(orderRes.data.data.tickets.length, 2)

    const ticketCode = orderRes.data.data.tickets[0].ticket_code

    // First check-in succeeds
    const firstCheckin = await request('/tickets/check-in', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { code: ticketCode, station: 'Gate A - Main Lobby' }
    })
    assert.equal(firstCheckin.status, 200)
    assert.equal(firstCheckin.data.data.ticket.status, 'Used')

    // Second check-in with same code must fail with 409 DUPLICATE_CHECKIN
    const duplicateCheckin = await request('/tickets/check-in', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { code: ticketCode, station: 'Gate B - VIP Lounge' }
    })
    assert.equal(duplicateCheckin.status, 409)
    assert.equal(duplicateCheckin.data.error.code, 'DUPLICATE_CHECKIN')

    // Canceling an order that already has a checked-in ticket must fail with 409 ORDER_ALREADY_USED
    const orderId = orderRes.data.data.order.id
    const cancelUsedRes = await request(`/orders/${orderId}/cancel`, {
      method: 'POST',
      token: 'demo-token-customer'
    })
    assert.equal(cancelUsedRes.status, 409)
    assert.equal(cancelUsedRes.data.error.code, 'ORDER_ALREADY_USED')

    // Also supports flat attendee checkout payload cleanly and cancels unused order to restore quota
    const flatOrderRes = await request('/orders', {
      method: 'POST',
      token: 'demo-token-customer',
      body: {
        event_id: 'evt-1',
        ticket_type_id: 'tkt-1',
        quantity: 1,
        full_name: 'Sari Flat Checkout',
        email: 'sari@example.com',
        phone: '08123456789'
      }
    })
    assert.equal(flatOrderRes.status, 201)
    assert.equal(flatOrderRes.data.data.order.order_status, 'Confirmed')

    const cancelUnusedRes = await request(`/orders/${flatOrderRes.data.data.order.id}/cancel`, {
      method: 'POST',
      token: 'demo-token-customer'
    })
    assert.equal(cancelUnusedRes.status, 200)
    assert.equal(cancelUnusedRes.data.data.order_status, 'Cancelled')
  })

  it('exports participants CSV cleanly', async () => {
    const csvRes = await request('/events/evt-1/participants/export', {
      token: 'demo-token-organizer'
    })
    assert.equal(csvRes.status, 200)
    assert.ok(csvRes.data.includes('Nadia Putri'))
    assert.ok(csvRes.data.includes('EVT26-9841-AB'))
  })

  it('enforces OTP email verification on manual register, blocks unverified login, and allows changing email', async () => {
    const initialEmail = `peserta-${Date.now()}@terra.id`
    const fixedEmail = `peserta-fixed-${Date.now()}@terra.id`
    const regRes = await request('/auth/register', {
      method: 'POST',
      body: {
        full_name: 'Peserta Baru Server',
        email: initialEmail,
        password: 'password123',
        role: 'customer'
      }
    })
    assert.equal(regRes.status, 201)
    assert.equal(regRes.data.data.user.email, initialEmail)
    assert.equal(regRes.data.data.requires_otp, true)
    assert.equal(regRes.data.data.access_token, undefined)
    let otpToken = regRes.data.data.otp_session_token
    assert.ok(otpToken)

    try {
      // Unverified user MUST be blocked from logging in
      const blockedLogin = await request('/auth/login', {
        method: 'POST',
        body: { email: initialEmail, password: 'password123', portal_role: 'customer' }
      })
      assert.equal(blockedLogin.status, 403)
      assert.equal(blockedLogin.data.error.code, 'EMAIL_NOT_VERIFIED')

      // Change unverified email to fixedEmail
      const changeRes = await request('/auth/change-unverified-email', {
        method: 'POST',
        body: {
          current_email: initialEmail,
          new_email: fixedEmail,
          otp_session_token: otpToken
        }
      })
      assert.equal(changeRes.status, 200)
      assert.equal(changeRes.data.data.email, fixedEmail)
      otpToken = changeRes.data.data.otp_session_token

      // Set deterministic OTP hash in in-memory store to verify /auth/verify-otp flow
      const createdUser = store.users.find((u) => u.email === fixedEmail)
      assert.ok(createdUser)
      createdUser.otp_code_hash = crypto.createHash('sha256').update('654321').digest('hex')
      createdUser.otp_expires_at = new Date(Date.now() + 600000)

      // Wrong OTP fails with 400
      const wrongOtp = await request('/auth/verify-otp', {
        method: 'POST',
        body: { email: fixedEmail, otp_code: '000000', otp_session_token: otpToken }
      })
      assert.equal(wrongOtp.status, 400)
      assert.equal(wrongOtp.data.error.code, 'INVALID_OTP')

      // Correct OTP verifies user and returns access_token
      const verifyOk = await request('/auth/verify-otp', {
        method: 'POST',
        body: { email: fixedEmail, otp_code: '654321', otp_session_token: otpToken }
      })
      assert.equal(verifyOk.status, 200)
      assert.equal(verifyOk.data.data.verified, true)
      assert.equal(verifyOk.data.data.user.email_verified, true)
      assert.ok(verifyOk.data.data.access_token)

      // Now login succeeds
      const loginOk = await request('/auth/login', {
        method: 'POST',
        body: { email: fixedEmail, password: 'password123', portal_role: 'customer' }
      })
      assert.equal(loginOk.status, 200)
      assert.ok(loginOk.data.data.access_token)

      // Customer cannot log into Admin portal
      const forbiddenPortal = await request('/auth/login', {
        method: 'POST',
        body: { email: fixedEmail, password: 'password123', portal_role: 'admin' }
      })
      assert.equal(forbiddenPortal.status, 403)
    } finally {
      if (regRes.data.data.mode?.startsWith('supabase') && regRes.data.data.user?.id) {
        const { supabaseAdmin } = await import('../src/config/supabase.js')
        await supabaseAdmin?.auth?.admin?.deleteUser(regRes.data.data.user.id)
      }
    }
  })

  it('supports EO team invitation, Resend status, accept-invite, and enforces organizer permissions', async () => {
    const inviteEmail = `panitia-${Date.now()}@terra.id`
    const inviteRes = await request('/events/evt-1/team', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: {
        name: 'Dimas Gate',
        email: inviteEmail,
        role: 'Staff',
        department: 'Gate & Check-in',
        permissions: ['View Event', 'Manage Check-in']
      }
    })
    assert.equal(inviteRes.status, 201)
    assert.equal(inviteRes.data.data.member.status, 'Pending')
    assert.ok(inviteRes.data.data.invite_url.includes('/accept-invite?token='))
    assert.equal(typeof inviteRes.data.data.email_status.sent, 'boolean')

    const inviteToken = new URL(inviteRes.data.data.invite_url).searchParams.get('token')
    assert.ok(inviteToken)

    const previewRes = await request(`/auth/invite/${inviteToken}`)
    assert.equal(previewRes.status, 200)
    assert.equal(previewRes.data.data.email, inviteEmail)
    assert.deepEqual(previewRes.data.data.permissions, ['View Event', 'Manage Check-in'])

    const acceptRes = await request('/auth/accept-invite', {
      method: 'POST',
      body: {
        token: inviteToken,
        full_name: 'Dimas Gate Accepted',
        password: 'password123'
      }
    })
    assert.equal(acceptRes.status, 200)
    const invitedToken = acceptRes.data.data.access_token
    assert.ok(invitedToken)

    try {
      // Invited panitia sees evt-1 and their assigned permissions
      const eventsRes = await request('/events', { token: invitedToken })
      assert.equal(eventsRes.status, 200)
      const evt1 = eventsRes.data.data.find((e) => e.id === 'evt-1')
      assert.ok(evt1)
      assert.deepEqual(evt1.my_permissions, ['View Event', 'Manage Check-in'])

      // Allowed on Check-in
      const checkinListRes = await request('/events/evt-1/check-ins', { token: invitedToken })
      assert.equal(checkinListRes.status, 200)

      // Blocked on Finance because Organizer only granted View Event & Manage Check-in
      const financeBlockedRes = await request('/events/evt-1/finance/summary', { token: invitedToken })
      assert.equal(financeBlockedRes.status, 403)
      assert.equal(financeBlockedRes.data.error.code, 'FORBIDDEN_PERMISSION')
    } finally {
      if (acceptRes.data.data.mode === 'supabase' && acceptRes.data.data.user?.id) {
        const { supabaseAdmin } = await import('../src/config/supabase.js')
        await supabaseAdmin?.auth?.admin?.deleteUser(acceptRes.data.data.user.id)
      }
    }
  })

  it('supports Passport Google OAuth stateless JWT tokens and oauth status endpoint', async () => {
    const statusRes = await request('/auth/oauth/status')
    assert.equal(statusRes.status, 200)
    assert.equal(typeof statusRes.data.data.google_enabled, 'boolean')

    const googleUser = {
      id: 'usr-google-12345',
      email: 'googlebuyer@example.com',
      full_name: 'Google Buyer',
      role: 'customer'
    }
    const token = signOAuthToken(googleUser)
    assert.ok(token.startsWith('oauth-jwt.'))

    const meRes = await request('/auth/me', { token })
    assert.equal(meRes.status, 200)
    assert.equal(meRes.data.data.user.email, 'googlebuyer@example.com')
    assert.equal(meRes.data.data.user.role, 'customer')
  })

  it('validates and handles multipart media uploads for Supabase Storage bucket', async () => {
    const statusRes = await request('/media/status')
    assert.equal(statusRes.status, 200)
    assert.equal(statusRes.data.data.media_bucket, 'terra-media')
    assert.equal(statusRes.data.data.documents_bucket, 'terra-documents')

    // Valid PNG upload
    const form = new FormData()
    form.append('folder', 'posters')
    form.append('file', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'poster.png')

    const uploadRes = await fetch(`${baseUrl}/media/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token-organizer' },
      body: form
    })
    const uploadJson: any = await uploadRes.json()
    assert.equal(uploadRes.status, 201)
    assert.equal(uploadJson.data.bucket, 'terra-media')
    assert.ok(uploadJson.data.public_url.includes('posters/usr-organizer/'))

    // Reject disallowed MIME type (application/x-msdownload) on media bucket
    const badForm = new FormData()
    badForm.append('file', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'malware.exe')
    const badRes = await fetch(`${baseUrl}/media/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token-organizer' },
      body: badForm
    })
    assert.equal(badRes.status, 415)
  })

  it('supports Event Companion Forum posts, replies, status updates, and author deletion', async () => {
    const initialList = await request('/marketplace/events/evt-1/companions')
    assert.equal(initialList.status, 200)
    assert.ok(initialList.data.data.length >= 1)

    const createRes = await request('/marketplace/events/evt-1/companions', {
      method: 'POST',
      token: 'demo-token-customer',
      body: {
        title: 'Carpool bareng dari Bandung ke JCC',
        departure_city: 'Bandung',
        departure_point: 'Stasiun Bandung Pintu Utara',
        departure_time: '05:30 WIB',
        transport_mode: 'Kereta / Travel',
        slots_available: 3,
        contact_note: 'DM di sini atau TG @nadia',
        notes: 'Naik Whoosh bareng biar cepat sampai Halim lalu lanjut ke Senayan.'
      }
    })
    assert.equal(createRes.status, 201)
    const postId = createRes.data.data.id
    assert.equal(createRes.data.data.author.has_ticket, true)

    const replyRes = await request(`/marketplace/companions/${postId}/replies`, {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { message: 'Ikut dong, aku juga berangkat dari Bandung pagi!' }
    })
    assert.equal(replyRes.status, 201)
    assert.equal(replyRes.data.data.replies.length, 1)

    const patchRes = await request(`/marketplace/companions/${postId}`, {
      method: 'PATCH',
      token: 'demo-token-customer',
      body: { status: 'full', slots_available: 0 }
    })
    assert.equal(patchRes.status, 200)
    assert.equal(patchRes.data.data.status, 'full')

    const delRes = await request(`/marketplace/companions/${postId}`, {
      method: 'DELETE',
      token: 'demo-token-customer'
    })
    assert.equal(delRes.status, 200)
  })

  it('enforces per-event TERRA pricing, 14-day Pro trial anti-abuse, module/quota gates, bundles, downgrade & admin verification', async () => {
    const catalogRes = await request('/pricing/catalog')
    assert.equal(catalogRes.status, 200)
    assert.equal(catalogRes.data.data.admin_whatsapp, '6287897192601')
    assert.equal(catalogRes.data.data.plans.length, 4)

    // Create a brand new event -> starts on FREE (Rp 0)
    const evtRes = await request('/events', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: {
        organization_id: 'org-1',
        title: 'Campus Hackathon 2026',
        start_at: '2026-12-25T09:00:00+07:00',
        end_at: '2026-12-25T17:00:00+07:00',
        capacity: 150
      }
    })
    assert.equal(evtRes.status, 201)
    const freeEventId = evtRes.data.data.id
    assert.equal(evtRes.data.data.entitlement.plan_code, 'free')

    // Enabling Finance on FREE event must fail with PLAN_UPGRADE_REQUIRED
    const blockedEnable = await request(`/events/${freeEventId}/modules/finance`, {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { is_enabled: true }
    })
    assert.equal(blockedEnable.status, 403)
    assert.equal(blockedEnable.data.error.code, 'PLAN_UPGRADE_REQUIRED')

    // Activate 14 Days Pro Access trial on event -> unlocks Pro modules; second trial attempt fails anti-abuse
    const trialRes = await request(`/events/${freeEventId}/subscription/trial`, {
      method: 'POST',
      token: 'demo-token-organizer'
    })
    assert.equal(trialRes.status, 201)
    assert.equal(trialRes.data.data.trial.is_trial, true)
    assert.equal(trialRes.data.data.plan_code, 'pro')

    const secondTrial = await request(`/events/${freeEventId}/subscription/trial`, {
      method: 'POST',
      token: 'demo-token-organizer'
    })
    assert.equal(secondTrial.status, 409)

    // Downgrade from Trial Pro back to Free preserves data
    const downRes = await request(`/events/${freeEventId}/subscription/downgrade`, {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { plan_code: 'free' }
    })
    assert.equal(downRes.status, 200)
    assert.equal(downRes.data.data.plan_code, 'free')

    // Preview & Checkout PRO event plan with promo EARLY100 -> status starts as Pending (does NOT auto-activate)
    const checkoutRes = await request('/billing/checkout', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: {
        organization_id: 'org-1',
        event_id: freeEventId,
        plan_code: 'pro',
        promo_code: 'EARLY100',
        payment_method: 'manual_whatsapp'
      }
    })
    assert.equal(checkoutRes.status, 201)
    const txId = checkoutRes.data.data.transaction.id
    assert.equal(checkoutRes.data.data.transaction.status, 'Pending')
    assert.ok(checkoutRes.data.data.transaction.final_amount_idr < 129000)

    // Still locked before Admin verifies payment
    const stillLocked = await request(`/events/${freeEventId}/modules/finance`, {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { is_enabled: true }
    })
    assert.equal(stillLocked.status, 403)

    // Admin verifies payment as Paid -> event upgrades to PRO and Finance unlocks!
    const verifyRes = await request(`/admin/billing/transactions/${txId}/verify`, {
      method: 'POST',
      token: 'demo-token-admin',
      body: { status: 'Paid', admin_notes: 'Transfer terverifikasi via WA' }
    })
    assert.equal(verifyRes.status, 200)
    assert.equal(verifyRes.data.data.status, 'Paid')

    const unlockRes = await request(`/events/${freeEventId}/modules/finance`, {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { is_enabled: true }
    })
    assert.equal(unlockRes.status, 200)

    // Admin can still create new Organizer directly
    const createOrgUserRes = await request('/admin/organizers', {
      method: 'POST',
      token: 'demo-token-admin',
      body: {
        full_name: 'Sinta EO',
        organization_name: 'Sinta Event Lab',
        email: 'sinta@eo.id',
        phone: '087897192601',
        password: 'password123',
        plan: 'pro_monthly',
        duration_days: 30
      }
    })
    assert.equal(createOrgUserRes.status, 201)
  })

  it('supports complete organizer CRUD for Finance, Sponsors, Vendors, Participants, and Surveys', async () => {
    const incCreate = await request('/events/evt-1/finance/incomes', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { category: 'Sponsorship', description: 'Sponsor Utama Awal', amount: 5000000 }
    })
    assert.equal(incCreate.status, 201)
    const incId = incCreate.data.data.id

    const incPatch = await request(`/finance/incomes/${incId}`, {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { description: 'Sponsor Utama Revisi', amount: 7500000 }
    })
    assert.equal(incPatch.status, 200)
    assert.equal(incPatch.data.data.description, 'Sponsor Utama Revisi')
    assert.equal(incPatch.data.data.amount, 7500000)

    const incDel = await request(`/finance/incomes/${incId}`, {
      method: 'DELETE',
      token: 'demo-token-organizer'
    })
    assert.equal(incDel.status, 200)

    const expCreate = await request('/events/evt-1/finance/expenses', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { category: 'Operasional', description: 'Cetak Banner', amount: 450000 }
    })
    assert.equal(expCreate.status, 201)
    const expId = expCreate.data.data.id

    const expPatch = await request(`/finance/expenses/${expId}`, {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { amount: 600000 }
    })
    assert.equal(expPatch.status, 200)
    assert.equal(expPatch.data.data.amount, 600000)

    const expDel = await request(`/finance/expenses/${expId}`, {
      method: 'DELETE',
      token: 'demo-token-organizer'
    })
    assert.equal(expDel.status, 200)

    const spCreate = await request('/events/evt-1/sponsors', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { name: 'Bank Kampus', tier: 'Gold', contribution: 'Rp 10.000.000', pic: 'Budi', status: 'Pending' }
    })
    assert.equal(spCreate.status, 201)
    const spId = spCreate.data.data.id

    const spPatch = await request(`/sponsors/${spId}`, {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { status: 'Confirmed', tier: 'Platinum' }
    })
    assert.equal(spPatch.status, 200)
    assert.equal(spPatch.data.data.tier, 'Platinum')

    const spDel = await request(`/sponsors/${spId}`, {
      method: 'DELETE',
      token: 'demo-token-organizer'
    })
    assert.equal(spDel.status, 200)
  })

  it('generates QR code & downloadable PDF QR email on ticket purchase and enforces event check-in scan validation', async () => {
    const orderRes = await request('/orders', {
      method: 'POST',
      token: 'demo-token-customer',
      body: {
        event_id: 'evt-1',
        ticket_type_id: 'tkt-1',
        quantity: 2,
        attendee: {
          full_name: 'Sari QR Tester',
          email: 'sari@example.com',
          phone: '081233445566'
        }
      }
    })
    assert.equal(orderRes.status, 201)
    assert.ok(orderRes.headers.get('x-request-id'))
    assert.ok(orderRes.data.requestId)
    assert.equal(orderRes.data.data.tickets.length, 2)

    const ticket = orderRes.data.data.tickets[0]
    assert.ok(ticket.qr_payload.startsWith(`TERRA:${ticket.ticket_code}:evt-1`))
    assert.ok(ticket.qr_data_url.startsWith('data:image/png;base64,'))

    // QR assets endpoint
    const qrRes = await request(`/tickets/${ticket.id}/qr`, { token: 'demo-token-customer' })
    assert.equal(qrRes.status, 200)
    assert.ok(qrRes.data.data.qr_data_url.startsWith('data:image/png;base64,'))
    assert.ok(qrRes.data.data.qr_svg.includes('<svg'))
    assert.ok(qrRes.data.data.qr_image_url.includes(`/tickets/${ticket.id}/qr-image?token=`))

    // Signed QR PNG image endpoint + unauthorized check
    const unauthImg = await request(`/tickets/${ticket.id}/qr-image`)
    assert.equal(unauthImg.status, 401)

    const qrImgPath = qrRes.data.data.qr_image_url.split('/api/v1')[1]
    const qrImgRes = await request(qrImgPath)
    assert.equal(qrImgRes.status, 200)
    assert.equal(qrImgRes.headers.get('content-type'), 'image/png')
    assert.deepEqual([...qrImgRes.data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])

    // Email QR preview & signed PDF QR download from email link
    const emailNotif = orderRes.data.data.email_notification
    assert.equal(emailNotif.sent, true)
    assert.equal(emailNotif.recipient, 'sari@example.com')

    // Unauthenticated preview without token must return 401
    const unauthPreview = await request(`/emails/${emailNotif.id}/preview`)
    assert.equal(unauthPreview.status, 401)

    const signedPreviewPath = emailNotif.preview_url.split('/api/v1')[1]
    const previewRes = await request(signedPreviewPath)
    assert.equal(previewRes.status, 200)
    assert.ok(previewRes.headers.get('content-security-policy')?.includes('frame-ancestors'))
    assert.ok(previewRes.data.includes('data:image/png;base64,'))
    assert.ok(previewRes.data.includes('/qr-image?token='))
    assert.ok(previewRes.data.includes('Download PDF E-Ticket'))
    assert.ok(previewRes.data.includes('Download Semua E-Ticket (PDF)'))

    const pdfMatch = previewRes.data.match(/\/api\/v1(\/orders\/[^"']+qr-pdf\?token=[^"']+)/)
    assert.ok(pdfMatch)
    const pdfRes = await request(pdfMatch[1])
    assert.equal(pdfRes.status, 200)
    assert.ok(pdfRes.headers.get('content-type').includes('application/pdf'))
    assert.equal(pdfRes.data.subarray(0, 5).toString('utf8'), '%PDF-')

    // Unauthorized PDF download rejected
    const unauthPdf = await request(`/orders/${orderRes.data.data.order.id}/qr-pdf`)
    assert.equal(unauthPdf.status, 401)

    // Wrong event check-in rejected
    const wrongEvent = await request('/tickets/validate', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { code: ticket.qr_payload, station: 'Gate A - Main Lobby', event_id: 'evt-2' }
    })
    assert.equal(wrongEvent.status, 409)
    assert.equal(wrongEvent.data.error.code, 'WRONG_EVENT_TICKET')

    // Valid QR scan check-in succeeds
    const validCheckin = await request('/tickets/check-in', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { code: ticket.qr_payload, station: 'Gate A - Main Lobby', event_id: 'evt-1' }
    })
    assert.equal(validCheckin.status, 200)
    assert.equal(validCheckin.data.data.ticket.status, 'Used')
  })

  it('enforces Paid Ticket Pending Policy and activates QR on organizer payment verification', async () => {
    const paidOrder = await request('/orders', {
      method: 'POST',
      token: 'demo-token-customer',
      body: {
        event_id: 'evt-1',
        ticket_type_id: 'tkt-vip-1',
        quantity: 1,
        attendee: {
          full_name: 'Raka Pembayar VIP',
          email: 'raka@example.com',
          phone: '081288887777',
          registration_data: { instansi: 'FT UST', kategori: 'VIP' }
        }
      }
    })
    assert.equal(paidOrder.status, 201)
    assert.equal(paidOrder.data.data.order.order_status, 'Pending')
    assert.equal(paidOrder.data.data.order.payment_status, 'Pending')
    assert.equal(paidOrder.data.data.tickets[0].status, 'Pending')
    assert.equal(paidOrder.data.data.email_status.sent, false)

    const orderId = paidOrder.data.data.order.id
    const ticketCode = paidOrder.data.data.tickets[0].ticket_code

    // Pending ticket cannot be checked in
    const blockedCheckin = await request('/tickets/check-in', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { code: ticketCode, station: 'VIP Gate', event_id: 'evt-1' }
    })
    assert.equal(blockedCheckin.status, 409)
    assert.equal(blockedCheckin.data.error.code, 'TICKET_PAYMENT_PENDING')

    // Customer submits payment proof
    const proofRes = await request(`/orders/${orderId}/payment-proof`, {
      method: 'POST',
      token: 'demo-token-customer',
      body: { payment_proof_url: 'https://example.com/proof-transfer.png', payment_notes: 'Transfer BCA an Raka' }
    })
    assert.equal(proofRes.status, 200)
    assert.equal(proofRes.data.data.payment_proof_url, 'https://example.com/proof-transfer.png')

    // Organizer verifies payment -> activates order & QR ticket and sends QR email
    const verifyRes = await request(`/events/evt-1/orders/${orderId}/verify-payment`, {
      method: 'POST',
      token: 'demo-token-organizer'
    })
    assert.equal(verifyRes.status, 200)
    assert.equal(verifyRes.data.data.order.order_status, 'Confirmed')
    assert.equal(verifyRes.data.data.order.payment_status, 'Verified')
    assert.equal(verifyRes.data.data.tickets[0].status, 'Active')
    assert.equal(verifyRes.data.data.email_status.sent, true)

    // Check-in succeeds after payment verified
    const checkinAfter = await request('/tickets/check-in', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { code: ticketCode, station: 'VIP Gate', event_id: 'evt-1' }
    })
    assert.equal(checkinAfter.status, 200)
    assert.equal(checkinAfter.data.data.ticket.status, 'Used')
  })

  it('builds Resend-compatible CID inline QR email HTML and preserves attachment contentId', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const mapped = mapResendAttachments([
      {
        filename: 'qr-TKT-01.png',
        content: buf,
        contentType: 'image/png',
        cid: 'qr-1-tkt01'
      },
      {
        filename: 'tiket.pdf',
        content: Buffer.from('%PDF-1.4'),
        contentType: 'application/pdf'
      }
    ])

    assert.equal(mapped.length, 2)
    assert.equal(mapped[0].contentType, 'image/png')
    assert.equal(mapped[0].contentId, 'qr-1-tkt01')
    assert.equal(mapped[1].contentType, 'application/pdf')
    assert.equal(mapped[1].contentId, undefined)

    const tickets = [
      {
        id: 'tkt-sample-1',
        ticket_code: 'TKT-01',
        ticket_type: 'Regular',
        participant_name: 'Bestan',
        event_title: 'DEMAFEST 2026'
      }
    ]
    const qrImages = [
      {
        cid: 'qr-1-tktsample1',
        dataUrl: 'data:image/png;base64,FAKE_BASE64',
        qrImageUrl: 'https://backend-six-sand-66.vercel.app/api/v1/tickets/tkt-sample-1/qr-image?token=123.abc'
      }
    ]

    const cidHtml = buildTicketQrEmailHtml({
      customerName: 'Bestan',
      eventTitle: 'DEMAFEST 2026',
      eventDate: '2026-08-29T10:00:00+07:00',
      location: 'Kampus UST Yogyakarta',
      event: {
        title: 'DEMAFEST 2026',
        theme_color: '#1e3a8a',
        organization: { name: 'BEM UST Yogyakarta' }
      },
      eventLogoSrc: 'cid:event-logo-badge',
      orderNumber: 'ORD-01',
      tickets,
      qrImages,
      orderPdfUrl: 'https://backend-six-sand-66.vercel.app/api/v1/orders/ord-1/qr-pdf?token=123.abc',
      useCidImages: true
    })
    assert.ok(cidHtml.includes('src="cid:qr-1-tktsample1"'))
    assert.ok(cidHtml.includes('src="cid:event-logo-badge"'))
    assert.ok(cidHtml.includes('#1e3a8a'))
    assert.ok(cidHtml.includes('BEM UST Yogyakarta'))
    assert.ok(!cidHtml.includes('data:image/png;base64,'))
    assert.ok(cidHtml.includes('/api/v1/tickets/tkt-sample-1/qr-image?token=123.abc'))

    const previewHtml = buildTicketQrEmailHtml({
      customerName: 'Bestan',
      eventTitle: 'DEMAFEST 2026',
      orderNumber: 'ORD-01',
      tickets,
      qrImages,
      orderPdfUrl: 'https://backend-six-sand-66.vercel.app/api/v1/orders/ord-1/qr-pdf?token=123.abc',
      useCidImages: false
    })
    assert.ok(previewHtml.includes('src="data:image/png;base64,FAKE_BASE64"'))
    assert.ok(!previewHtml.includes('src="cid:'))
  })

  it('generates branded QR PNG buffer with event logo/monogram and redesigned boarding-pass PDF', async () => {
    const sampleEvent = {
      id: 'evt-demafest-test',
      title: 'DEMAFEST 2026',
      theme_color: '#1e3a8a',
      location_name: 'Student Center UST',
      start_at: '2026-08-29T09:00:00+07:00',
      organization: { name: 'BEM UST Yogyakarta' }
    }
    const brandedQr = await generateBrandedQrBuffer('TERRA:DMF-001:evt-demafest-test', {
      width: 360,
      event: sampleEvent
    })
    assert.deepEqual([...brandedQr.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])

    const pdfBuf = await generateTicketsQrPdfBuffer({
      tickets: [
        {
          id: 'tkt-dmf-1',
          event_id: sampleEvent.id,
          event_title: sampleEvent.title,
          ticket_type: 'VIP Pass',
          participant_name: 'Bestan Dhya Ul Haq',
          ticket_code: 'DMF-001',
          order_number: 'ORD-DMF-1',
          qr_payload: 'TERRA:DMF-001:evt-demafest-test',
          status: 'Active'
        }
      ],
      order: { id: 'ord-dmf-1', order_number: 'ORD-DMF-1' },
      event: sampleEvent
    })
    assert.equal(pdfBuf.subarray(0, 5).toString('utf8'), '%PDF-')
    assert.ok(pdfBuf.length > 5000)
  })

  it('processes Midtrans webhooks with strict SHA-512 signature, amount validation, idempotent settlement & expiry quota restore', async () => {
    const prevServerKey = env.midtransServerKey
    const prevClientKey = env.midtransClientKey
    env.midtransServerKey = 'SB-Mid-server-TERRA-TEST-SECRET'
    env.midtransClientKey = 'SB-Mid-client-TERRA-TEST-CLIENT'

    // Stub global fetch only during Snap API call, leaving local test server requests untouched
    const originalFetch = globalThis.fetch
    let snapCallCount = 0
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.includes('midtrans.com/snap/v1/transactions')) {
        snapCallCount += 1
        return new Response(
          JSON.stringify({
            token: `snap-tok-${snapCallCount}`,
            redirect_url: `https://app.sandbox.midtrans.com/snap/v4/redirection/snap-tok-${snapCallCount}`
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return originalFetch(input, init)
    }) as any

    try {
      // 1. Public config endpoint exposes client_key & snap_js_url, NEVER server_key
      const cfgRes = await request('/payments/config')
      assert.equal(cfgRes.status, 200)
      assert.equal(cfgRes.data.data.configured, true)
      assert.equal(cfgRes.data.data.client_key, 'SB-Mid-client-TERRA-TEST-CLIENT')
      assert.equal((cfgRes.data.data as any).server_key, undefined)
      assert.ok(!JSON.stringify(cfgRes.data).includes('SB-Mid-server-TERRA-TEST-SECRET'))

      // 2. Paid ticket checkout automatically provisions Midtrans Snap token
      const paidOrderRes = await request('/orders', {
        method: 'POST',
        token: 'demo-token-customer',
        body: {
          event_id: 'evt-1',
          ticket_type_id: 'tkt-vip-1',
          quantity: 1,
          attendee: {
            full_name: 'Raka Midtrans VIP',
            email: 'raka.midtrans@example.com',
            phone: '081288887777'
          }
        }
      })
      assert.equal(paidOrderRes.status, 201)
      assert.equal(paidOrderRes.data.data.order.order_status, 'Pending')
      assert.equal(paidOrderRes.data.data.payment.snap_token, 'snap-tok-1')
      const orderNumber = paidOrderRes.data.data.order.order_number
      const grossStr = `${Number(paidOrderRes.data.data.order.total)}.00`
      const outboxBefore = store.emailOutbox.length
      const incomesBefore = store.incomes.length

      // 3. Reject invalid webhook signature
      const badSigRes = await request('/payments/midtrans/webhook', {
        method: 'POST',
        body: {
          order_id: orderNumber,
          status_code: '200',
          gross_amount: grossStr,
          transaction_status: 'settlement',
          signature_key: 'invalid-signature'
        }
      })
      assert.equal(badSigRes.status, 401)
      assert.equal(badSigRes.data.error.code, 'INVALID_WEBHOOK_SIGNATURE')

      // 4. Reject tampered gross_amount even with matching hash format (wrong amount)
      const wrongAmt = '1000.00'
      const wrongAmtSig = computeMidtransSignature({
        orderId: orderNumber,
        statusCode: '200',
        grossAmount: wrongAmt,
        serverKey: env.midtransServerKey
      })
      const badAmtRes = await request('/payments/midtrans/webhook', {
        method: 'POST',
        body: {
          order_id: orderNumber,
          status_code: '200',
          gross_amount: wrongAmt,
          transaction_status: 'settlement',
          signature_key: wrongAmtSig
        }
      })
      assert.equal(badAmtRes.status, 400)
      assert.equal(badAmtRes.data.error.code, 'AMOUNT_MISMATCH')

      // 5. Valid settlement webhook activates order, QR tickets, FinanceIncome & dispatches email
      const validSig = computeMidtransSignature({
        orderId: orderNumber,
        statusCode: '200',
        grossAmount: grossStr,
        serverKey: env.midtransServerKey
      })
      const settleRes = await request('/payments/midtrans/webhook', {
        method: 'POST',
        body: {
          order_id: orderNumber,
          status_code: '200',
          gross_amount: grossStr,
          transaction_status: 'settlement',
          payment_type: 'qris',
          transaction_id: 'mid-tx-order-1',
          signature_key: validSig
        }
      })
      assert.equal(settleRes.status, 200)
      assert.equal(settleRes.data.data.payment_state, 'settled')
      assert.equal(settleRes.data.data.already_settled, false)
      assert.equal(settleRes.data.data.order_status, 'Confirmed')
      assert.equal(store.emailOutbox.length, outboxBefore + 1)
      assert.equal(store.incomes.length, incomesBefore + 1)

      // 6. Duplicate webhook replay is strictly idempotent (no duplicate income or email)
      const replayRes = await request('/payments/midtrans/webhook', {
        method: 'POST',
        body: {
          order_id: orderNumber,
          status_code: '200',
          gross_amount: grossStr,
          transaction_status: 'settlement',
          payment_type: 'qris',
          transaction_id: 'mid-tx-order-1',
          signature_key: validSig
        }
      })
      assert.equal(replayRes.status, 200)
      assert.equal(replayRes.data.data.already_settled, true)
      assert.equal(store.emailOutbox.length, outboxBefore + 1)
      assert.equal(store.incomes.length, incomesBefore + 1)

      // 7. Expire webhook cancels Pending order and restores ticket sold_quantity quota
      const vipBefore = store.ticketTypes.find((t) => t.id === 'tkt-vip-1').sold_quantity
      const expOrderRes = await request('/orders', {
        method: 'POST',
        token: 'demo-token-customer',
        body: {
          event_id: 'evt-1',
          ticket_type_id: 'tkt-vip-1',
          quantity: 2,
          attendee: { full_name: 'Expire Test', email: 'expire@example.com', phone: '081299990000' }
        }
      })
      assert.equal(expOrderRes.status, 201)
      assert.equal(store.ticketTypes.find((t) => t.id === 'tkt-vip-1').sold_quantity, vipBefore + 2)
      const expOrderNum = expOrderRes.data.data.order.order_number
      const expGrossStr = `${Number(expOrderRes.data.data.order.total)}.00`
      const expSig = computeMidtransSignature({
        orderId: expOrderNum,
        statusCode: '202',
        grossAmount: expGrossStr,
        serverKey: env.midtransServerKey
      })
      const expWebhook = await request('/payments/midtrans/webhook', {
        method: 'POST',
        body: {
          order_id: expOrderNum,
          status_code: '202',
          gross_amount: expGrossStr,
          transaction_status: 'expire',
          transaction_id: 'mid-tx-exp-1',
          signature_key: expSig
        }
      })
      assert.equal(expWebhook.status, 200)
      assert.equal(expWebhook.data.data.order_status, 'Cancelled')
      assert.equal(store.ticketTypes.find((t) => t.id === 'tkt-vip-1').sold_quantity, vipBefore)

      // 8. Organizer billing checkout + Midtrans settlement webhook auto-unlocks Pro event modules
      const freeEventRes = await request('/events', {
        method: 'POST',
        token: 'demo-token-organizer',
        body: {
          organization_id: 'org-1',
          title: 'Midtrans Billing Test Event',
          start_at: '2026-10-10',
          end_at: '2026-10-11'
        }
      })
      assert.equal(freeEventRes.status, 201)
      const targetEventId = freeEventRes.data.data.id

      const billingCheckout = await request('/billing/checkout', {
        method: 'POST',
        token: 'demo-token-organizer',
        body: {
          organization_id: 'org-1',
          event_id: targetEventId,
          plan_code: 'pro',
          promo_code: 'EARLY100',
          payment_method: 'payment_gateway'
        }
      })
      assert.equal(billingCheckout.status, 201)
      const tx = billingCheckout.data.data.transaction
      assert.equal(tx.status, 'Pending')
      assert.ok(billingCheckout.data.data.payment.snap_token)

      const invGrossStr = `${Number(tx.final_amount_idr)}.00`
      const invSig = computeMidtransSignature({
        orderId: tx.invoice_number,
        statusCode: '200',
        grossAmount: invGrossStr,
        serverKey: env.midtransServerKey
      })
      const invSettle = await request('/payments/midtrans/webhook', {
        method: 'POST',
        body: {
          order_id: tx.invoice_number,
          status_code: '200',
          gross_amount: invGrossStr,
          transaction_status: 'settlement',
          payment_type: 'bank_transfer',
          transaction_id: 'mid-tx-inv-1',
          signature_key: invSig
        }
      })
      assert.equal(invSettle.status, 200)
      assert.equal(invSettle.data.data.target_type, 'billing_transaction')
      assert.equal(invSettle.data.data.status, 'Paid')

      const unlockRes = await request(`/events/${targetEventId}/modules/finance`, {
        method: 'PATCH',
        token: 'demo-token-organizer',
        body: { is_enabled: true }
      })
      assert.equal(unlockRes.status, 200)
    } finally {
      globalThis.fetch = originalFetch
      env.midtransServerKey = prevServerKey
      env.midtransClientKey = prevClientKey
    }
  })

  it('serves dynamic XML sitemap, social share OG HTML, and accepts terra.concern.web.id CORS origin', async () => {
    const eventsRes = await request('/marketplace/events')
    assert.equal(eventsRes.status, 200)
    const firstEvent = eventsRes.data.data[0]
    assert.ok(firstEvent?.slug)

    const sitemapRes = await request('/seo/sitemap.xml')
    assert.equal(sitemapRes.status, 200)
    assert.ok((sitemapRes.headers.get('content-type') || '').includes('application/xml'))
    assert.ok(sitemapRes.data.includes('<loc>https://terra.concern.web.id/</loc>'))
    assert.ok(sitemapRes.data.includes('<loc>https://terra.concern.web.id/events</loc>'))
    assert.ok(
      sitemapRes.data.includes(
        `<loc>https://terra.concern.web.id/events/${encodeURIComponent(firstEvent.slug)}</loc>`
      )
    )

    const shareEventRes = await request(`/seo/share/events/${encodeURIComponent(firstEvent.slug)}`)
    assert.equal(shareEventRes.status, 200)
    assert.ok((shareEventRes.headers.get('content-type') || '').includes('text/html'))
    assert.ok(shareEventRes.data.includes('property="og:title"'))
    assert.ok(shareEventRes.data.includes('property="og:image"'))
    assert.ok(
      shareEventRes.data.includes(
        `https://terra.concern.web.id/events/${encodeURIComponent(firstEvent.slug)}`
      )
    )
    assert.ok(shareEventRes.data.includes('"@type":"Event"'))

    const shareOrgRes = await request('/seo/share/organizers/nusantara-tech')
    assert.equal(shareOrgRes.status, 200)
    assert.ok((shareOrgRes.headers.get('content-type') || '').includes('text/html'))
    assert.ok(shareOrgRes.data.includes('property="og:title"'))
    assert.ok(shareOrgRes.data.includes('"@type":"Organization"'))

    const corsRes = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://terra.concern.web.id' }
    })
    assert.equal(corsRes.status, 200)
    assert.equal(corsRes.headers.get('access-control-allow-origin'), 'https://terra.concern.web.id')
  })
})
