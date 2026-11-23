import crypto from 'node:crypto'
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = ''
process.env.DIRECT_URL = ''
process.env.RESEND_API_KEY = ''
process.env.SUPABASE_URL = ''
process.env.SUPABASE_ANON_KEY = ''
process.env.SUPABASE_SERVICE_ROLE_KEY = ''

const { default: app } = await import('../src/app.js')
const { store } = await import('../src/repositories/store.js')
const { signOAuthToken } = await import('../src/config/passport.js')
const { verifyPassword, hashPassword } = await import('../src/utils/crypto.js')

const hashOtpCode = (code) => crypto.createHash('sha256').update(String(code).trim()).digest('hex')

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
  } else {
    data = await res.text()
  }
  return { status: res.status, headers: res.headers, data }
}

describe('TERRA Security & Business Rule Verification Suite', () => {
  it('verifyPassword fails closed on missing, empty, or malformed hashes', () => {
    assert.equal(verifyPassword('', 'salt:hash'), false)
    assert.equal(verifyPassword('secret', ''), false)
    assert.equal(verifyPassword('secret', null), false)
    assert.equal(verifyPassword('secret', 'malformedhash'), false)
    const valid = hashPassword('MySecret123!')
    assert.equal(verifyPassword('MySecret123!', valid), true)
    assert.equal(verifyPassword('WrongSecret!', valid), false)
  })

  it('rejects demo-token-* in production mode', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const res = await request('/admin/dashboard', { token: 'demo-token-admin' })
      assert.equal(res.status, 401)
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it('blocks suspended users at login and on existing bearer tokens', async () => {
    const user = store.users.find((u) => u.id === 'usr-customer')
    user.password_hash = hashPassword('CustPass123!')
    user.email_verified = true
    user.is_suspended = true

    const loginRes = await request('/auth/login', {
      method: 'POST',
      body: { email: user.email, password: 'CustPass123!' }
    })
    assert.equal(loginRes.status, 403)

    const token = signOAuthToken({ id: user.id, email: user.email, role: 'customer' })
    const meRes = await request('/auth/me', { token })
    assert.equal(meRes.status, 403)
    assert.equal(meRes.data.error.code, 'ACCOUNT_SUSPENDED')
  })

  it('sanitizes admin user responses to never expose password or OTP hashes', async () => {
    store.users[0].password_hash = hashPassword('Secret123!')
    store.users[0].otp_code_hash = hashOtpCode('123456')

    const res = await request('/admin/users', { token: 'demo-token-admin' })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.data.data))
    for (const u of res.data.data) {
      assert.equal('password_hash' in u, false)
      assert.equal('otp_code_hash' in u, false)
      assert.equal('otp_expires_at' in u, false)
    }
  })

  it('prevents mass-assignment of protected status fields on events and organizations', async () => {
    const evtRes = await request('/events/evt-3', {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: {
        title: 'Updated Title Only',
        publication_status: 'Published',
        organization_id: 'org-2'
      }
    })
    assert.equal(evtRes.status, 200)
    assert.equal(evtRes.data.data.title, 'Updated Title Only')
    assert.equal(evtRes.data.data.publication_status, 'Pending Review')
    assert.equal(evtRes.data.data.organization_id, 'org-1')

    const orgRes = await request('/organizations/org-2', {
      method: 'PATCH',
      token: 'demo-token-admin',
      body: {
        name: 'Kreatif Studio Renamed',
        verification_status: 'verified'
      }
    })
    assert.equal(orgRes.status, 200)
    assert.equal(orgRes.data.data.name, 'Kreatif Studio Renamed')
    assert.equal(orgRes.data.data.verification_status, 'pending')
  })

  it('enforces DELETE /media bucket whitelist and path ownership', async () => {
    const badBucket = await request('/media', {
      method: 'DELETE',
      token: 'demo-token-organizer',
      body: { bucket: 'terra-secrets', path: 'users/usr-organizer/file.png' }
    })
    assert.equal(badBucket.status, 403)

    const foreignMedia = await request('/media', {
      method: 'DELETE',
      token: 'demo-token-organizer',
      body: { bucket: 'terra-media', path: 'users/usr-other/secret.png' }
    })
    assert.equal(foreignMedia.status, 403)
  })

  it('enforces cross-tenant IDOR protection across all organizer and customer resources', async () => {
    // Create a second isolated organizer (usr-org2) belonging to org-2 only
    const org2User = {
      id: 'usr-org2',
      full_name: 'Other Organizer',
      email: 'other@kreatif.id',
      role: 'organizer',
      email_verified: true,
      is_suspended: false
    }
    store.users.push(org2User)
    const org2 = store.organizations.find((o) => o.id === 'org-2')
    org2.members.push({ id: 'om-org2', user_id: org2User.id, name: org2User.full_name, email: org2User.email, role: 'Owner', status: 'active' })
    const org2Token = signOAuthToken({ id: org2User.id, email: org2User.email, role: 'organizer' })

    // Create sample order, doc, finance, vendor, sponsor, schedule, task in org-1 evt-1
    const orderRes = await request('/orders', {
      method: 'POST',
      token: 'demo-token-customer',
      body: {
        event_id: 'evt-1',
        ticket_type_id: 'tkt-1',
        quantity: 1,
        full_name: 'Buyer One',
        email: 'buyer1@example.com',
        phone: '081211112222'
      }
    })
    assert.equal(orderRes.status, 201)
    const orderId = orderRes.data.data.order.id
    const ticketId = orderRes.data.data.tickets[0].id

    const [incC, expC, vndC, spnC, docC] = await Promise.all([
      request('/events/evt-1/finance/incomes', { method: 'POST', token: 'demo-token-organizer', body: { category: 'Tiket', description: 'Income Test', amount: 10000 } }),
      request('/events/evt-1/finance/expenses', { method: 'POST', token: 'demo-token-organizer', body: { category: 'Ops', description: 'Expense Test', amount: 5000 } }),
      request('/events/evt-1/vendors', { method: 'POST', token: 'demo-token-organizer', body: { name: 'Vendor Test', category: 'Sound' } }),
      request('/events/evt-1/sponsors', { method: 'POST', token: 'demo-token-organizer', body: { name: 'Sponsor Test', tier: 'Gold' } }),
      request('/events/evt-1/documents', { method: 'POST', token: 'demo-token-organizer', body: { file_name: 'internal-plan.pdf', visibility: 'internal' } })
    ])

    const schId = store.schedules.find((s) => s.event_id === 'evt-1')?.id
    const taskId = store.tasks.find((t) => t.event_id === 'evt-1')?.id
    const tktId = store.ticketTypes.find((t) => t.event_id === 'evt-1')?.id
    const incId = incC.data.data.id
    const expId = expC.data.data.id
    const vndId = vndC.data.data.id
    const spnId = spnC.data.data.id
    const docId = docC.data.data.id

    const org2Denied = await Promise.all([
      request('/organizations/org-1', { token: org2Token }),
      request('/organizations/org-1/members', { method: 'POST', token: org2Token, body: { email: 'x@y.com', role: 'Admin' } }),
      request('/events', { method: 'POST', token: org2Token, body: { organization_id: 'org-1', title: 'Hijacked Event', start_at: '2026-12-20T09:00', end_at: '2026-12-20T12:00' } }),
      request(`/schedules/${schId}`, { method: 'PATCH', token: org2Token, body: { title: 'Hacked' } }),
      request(`/tasks/${taskId}`, { method: 'PATCH', token: org2Token, body: { title: 'Hacked' } }),
      request(`/ticket-types/${tktId}`, { method: 'PATCH', token: org2Token, body: { price: 1 } }),
      request(`/finance/incomes/${incId}`, { method: 'DELETE', token: org2Token }),
      request(`/finance/expenses/${expId}`, { method: 'DELETE', token: org2Token }),
      request(`/vendors/${vndId}`, { method: 'DELETE', token: org2Token }),
      request(`/sponsors/${spnId}`, { method: 'DELETE', token: org2Token }),
      request(`/documents/${docId}/download`, { token: org2Token }),
      request(`/documents/${docId}`, { method: 'DELETE', token: org2Token }),
      request('/events/evt-1/subscription/trial', { method: 'POST', token: org2Token })
    ])
    for (const r of org2Denied) {
      assert.equal(r.status, 403, `Expected 403 for cross-tenant request, got ${r.status}`)
    }

    // Another customer cannot read or download Customer 1's order/ticket/PDF
    const cust2 = { id: 'usr-cust2', full_name: 'Other Cust', email: 'cust2@terra.id', role: 'customer', email_verified: true }
    store.users.push(cust2)
    const cust2Token = signOAuthToken({ id: cust2.id, email: cust2.email, role: 'customer' })

    const custDenied = await Promise.all([
      request(`/orders/${orderId}`, { token: cust2Token }),
      request(`/orders/${orderId}/tickets`, { token: cust2Token }),
      request(`/orders/${orderId}/qr-pdf`, { token: cust2Token }),
      request(`/tickets/${ticketId}`, { token: cust2Token }),
      request(`/tickets/${ticketId}/qr`, { token: cust2Token }),
      request(`/tickets/${ticketId}/qr-pdf`, { token: cust2Token })
    ])
    for (const r of custDenied) {
      assert.equal(r.status, 403, `Expected 403 for cross-customer request, got ${r.status}`)
    }
  })

  it('enforces ticket sale window, min/max quantity, and Cancelled event invalidation', async () => {
    const futureTicket = await request('/events/evt-1/ticket-types', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: {
        name: 'Future Flash Sale',
        price: 0,
        quantity: 50,
        min_per_order: 2,
        max_per_order: 4,
        sale_start_at: '2028-01-01T00:00:00Z',
        status: 'On Sale'
      }
    })
    assert.equal(futureTicket.status, 201)

    const notStartedRes = await request('/orders', {
      method: 'POST',
      token: 'demo-token-customer',
      body: {
        event_id: 'evt-1',
        ticket_type_id: futureTicket.data.data.id,
        quantity: 2,
        full_name: 'Tester',
        email: 't@example.com',
        phone: '0812345678'
      }
    })
    assert.equal(notStartedRes.status, 409)
    assert.equal(notStartedRes.data.error.code, 'TICKET_SALE_NOT_STARTED')

    // Quantity below min_per_order (after removing sale_start_at)
    await request(`/ticket-types/${futureTicket.data.data.id}`, {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { sale_start_at: '2025-01-01T00:00:00Z' }
    })
    const tooFewRes = await request('/orders', {
      method: 'POST',
      token: 'demo-token-customer',
      body: {
        event_id: 'evt-1',
        ticket_type_id: futureTicket.data.data.id,
        quantity: 1,
        full_name: 'Tester',
        email: 't@example.com',
        phone: '0812345678'
      }
    })
    assert.equal(tooFewRes.status, 400)
    assert.equal(tooFewRes.data.error.code, 'INVALID_TICKET_QUANTITY')

    // Create valid order then cancel event -> invalidates active ticket and blocks check-in
    const validOrder = await request('/orders', {
      method: 'POST',
      token: 'demo-token-customer',
      body: {
        event_id: 'evt-1',
        ticket_type_id: 'tkt-1',
        quantity: 1,
        full_name: 'Cancelled Event Guest',
        email: 'cancel@example.com',
        phone: '0812345678'
      }
    })
    assert.equal(validOrder.status, 201)
    const ticketCode = validOrder.data.data.tickets[0].ticket_code

    const cancelEvt = await request('/events/evt-1', {
      method: 'PATCH',
      token: 'demo-token-organizer',
      body: { status: 'Cancelled' }
    })
    assert.equal(cancelEvt.status, 200)

    const checkinCancelled = await request('/tickets/check-in', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: { code: ticketCode, station: 'Gate A' }
    })
    assert.equal(checkinCancelled.status, 409)
    assert.equal(checkinCancelled.data.error.code, 'EVENT_CANCELLED')
  })

  it('supports forgot-password OTP reset flow and public feedback surveys', async () => {
    const user = store.users.find((u) => u.id === 'usr-customer')
    user.password_hash = hashPassword('OldPass123!')

    const forgotRes = await request('/auth/forgot-password', {
      method: 'POST',
      body: { email: user.email }
    })
    assert.equal(forgotRes.status, 200)
    assert.equal(forgotRes.data.data.requested, true)

    // Set known OTP hash cleanly and verify reset-password
    user.otp_code_hash = hashOtpCode('654321')
    user.otp_expires_at = new Date(Date.now() + 600000).toISOString()
    user.otp_attempts = 0

    const resetRes = await request('/auth/reset-password', {
      method: 'POST',
      body: { email: user.email, otp_code: '654321', new_password: 'NewPass456!' }
    })
    assert.equal(resetRes.status, 200)
    assert.equal(verifyPassword('NewPass456!', user.password_hash), true)

    // Create survey and test public endpoint + submission
    const srvCreate = await request('/events/evt-1/surveys', {
      method: 'POST',
      token: 'demo-token-organizer',
      body: {
        title: 'Feedback Sesi Keynote',
        description: 'Bantu kami meningkatkan acara berikutnya.',
        questions: [{ id: 'q1', question: 'Bagaimana materinya?', question_type: 'rating', options: [] }]
      }
    })
    assert.equal(srvCreate.status, 201)

    const publicSurveys = await request('/marketplace/events/evt-1/surveys')
    assert.equal(publicSurveys.status, 200)
    assert.ok(publicSurveys.data.data.some((s) => s.id === srvCreate.data.data.id))

    const submitResp = await request(`/surveys/${srvCreate.data.data.id}/responses`, {
      method: 'POST',
      token: 'demo-token-customer',
      body: { answers: { q1: 5 } }
    })
    assert.equal(submitResp.status, 201)
  })
})
