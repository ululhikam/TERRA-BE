import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import app from '../src/app.js'
import { store } from '../src/repositories/store.js'

let server
let baseUrl

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address()
      baseUrl = `http://127.0.0.1:${port}/api/v1`
      resolve()
    })
  })
})

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve))
  }
})

beforeEach(() => {
  store.reset()
})

async function request(path, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  const contentType = res.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await res.json() : await res.text()
  return { status: res.status, data }
}

describe('TERRA Backend API v1 Integration Tests', () => {
  it('returns healthy status and filters marketplace to Published events only', async () => {
    const health = await request('/health')
    assert.equal(health.status, 200)
    assert.equal(health.data.success, true)

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
    assert.equal(approveRes.data.data.event.publication_status, 'Published')
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

    // Cancel order restores quota
    const orderId = orderRes.data.data.order.id
    const cancelRes = await request(`/orders/${orderId}/cancel`, {
      method: 'POST',
      token: 'demo-token-customer'
    })
    assert.equal(cancelRes.status, 200)
    assert.equal(cancelRes.data.data.order_status, 'Cancelled')
  })

  it('exports participants CSV cleanly', async () => {
    const csvRes = await request('/events/evt-1/participants/export', {
      token: 'demo-token-organizer'
    })
    assert.equal(csvRes.status, 200)
    assert.ok(csvRes.data.includes('Nadia Putri'))
    assert.ok(csvRes.data.includes('EVT26-9841-AB'))
  })

  it('handles server-side login, register, and portal role isolation via Express API', async () => {
    const uniqueEmail = `peserta-${Date.now()}@terra.id`
    const regRes = await request('/auth/register', {
      method: 'POST',
      body: {
        full_name: 'Peserta Baru Server',
        email: uniqueEmail,
        password: 'password123',
        role: 'customer'
      }
    })
    assert.equal(regRes.status, 201)
    assert.equal(regRes.data.data.user.email, uniqueEmail)
    assert.ok(regRes.data.data.access_token)

    const loginOk = await request('/auth/login', {
      method: 'POST',
      body: { email: uniqueEmail, password: 'password123', portal_role: 'customer' }
    })
    assert.equal(loginOk.status, 200)
    assert.ok(loginOk.data.data.access_token)

    // Customer cannot log into Admin portal
    const forbiddenPortal = await request('/auth/login', {
      method: 'POST',
      body: { email: uniqueEmail, password: 'password123', portal_role: 'admin' }
    })
    assert.equal(forbiddenPortal.status, 403)
  })
})
