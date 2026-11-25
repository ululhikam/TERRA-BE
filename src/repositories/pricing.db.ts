import crypto from 'node:crypto'
import { prisma, isDatabaseConfigured, runTransaction } from '../config/prisma.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/response.js'
import { store } from './store.js'

const usePrisma = () => Boolean(isDatabaseConfigured && prisma)

export const PLAN_RANK = {
  unsubscribed: 0,
  free: 0,
  starter: 1,
  pro: 2,
  ultimate: 3,
  monthly_50k: 3
}

export const SUBSCRIPTION_PRICE_IDR = 50000
export const SUBSCRIPTION_DURATION_DAYS = 30

export const ALL_MODULES = [
  'event_profile',
  'timeline',
  'tasks',
  'team',
  'ticketing',
  'participants',
  'check_in',
  'finance',
  'vendors',
  'sponsors',
  'documents',
  'feedback',
  'reports'
]

export const SINGLE_MONTHLY_PLAN = {
  id: 'plan-monthly-50k',
  code: 'monthly_50k',
  name: 'TERRA Studio Subscribe',
  tagline: 'Langganan Bulanan All-Access 13 Modul',
  description:
    'Akses penuh seluruh fitur Event Organizer, 13 modul manajemen kepanitiaan, tiket QR otomatis, dan Live Gate Scanner tanpa batas jumlah event.',
  price_idr: SUBSCRIPTION_PRICE_IDR,
  billing_model: 'monthly_subscription',
  duration_days: SUBSCRIPTION_DURATION_DAYS,
  is_popular: true,
  is_active: true,
  sort_order: 1,
  max_active_events: 999999,
  max_participants: 999999,
  max_team_members: 999999,
  max_storage_mb: 10240,
  allowed_modules: ALL_MODULES,
  features: [
    'Unlimited event aktif selama 30 hari masa langganan',
    'Seluruh 13 modul manajemen kepanitiaan terbuka penuh',
    'Penjualan tiket gratis & berbayar otomatis via Midtrans',
    'E-Ticket QR Code & PDF otomatis ke email peserta',
    'Fullscreen Live QR Gate Scanner & ekspor data peserta',
    'Manajemen Tim Panitia, Timeline WBS, Kanban & Keuangan RAB'
  ],
  trial_days: 0,
  early_access_price_idr: null,
  early_access_limit: 0,
  community_discount_pct: 0,
  allow_downgrade: false
}

export const MANUAL_PAYMENT_INSTRUCTIONS = {
  bank_name: 'Midtrans Payment Gateway',
  account_number: 'AUTO',
  account_holder: 'TERRA Otomatis (QRIS / VA / E-Wallet / Kartu)',
  ewallet_note: 'Aktivasi instan otomatis setelah pembayaran Midtrans berhasil'
}

function generateInvoiceNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `INV-${datePart}-${rand}`
}

function toArray(val) {
  return Array.isArray(val) ? val : []
}

async function recordBillingAudit(
  { organization_id = null, event_id = null, actor_id = null, actor_role = null, action, from_plan = null, to_plan = null, details = {} },
  client = prisma
) {
  if (!usePrisma()) {
    store.billingAuditLogs.unshift({
      id: 'baud-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      organization_id,
      event_id,
      actor_id,
      actor_role,
      action,
      from_plan,
      to_plan,
      details,
      created_at: new Date().toISOString()
    })
    return
  }
  await client.billingAuditLog.create({
    data: { organization_id, event_id, actor_id, actor_role, action, from_plan, to_plan, details }
  })
}

export async function getPlanByCode(_code?: string) {
  if (!usePrisma()) {
    return store.pricingPlans[0] || SINGLE_MONTHLY_PLAN
  }
  const existing = await prisma.pricingPlan.findUnique({ where: { code: SINGLE_MONTHLY_PLAN.code } })
  if (existing) {
    return { ...existing, duration_days: SUBSCRIPTION_DURATION_DAYS }
  }
  return SINGLE_MONTHLY_PLAN
}

export async function listPublicPricingCatalog() {
  if (!usePrisma()) {
    return {
      plans: [store.pricingPlans[0] || SINGLE_MONTHLY_PLAN],
      bundles: [],
      promos: [],
      payment_methods: ['midtrans_snap'],
      manual_payment_enabled: false,
      subscription_duration_days: SUBSCRIPTION_DURATION_DAYS
    }
  }

  const upserted = await prisma.pricingPlan.upsert({
    where: { code: SINGLE_MONTHLY_PLAN.code },
    update: {
      name: SINGLE_MONTHLY_PLAN.name,
      tagline: SINGLE_MONTHLY_PLAN.tagline,
      description: SINGLE_MONTHLY_PLAN.description,
      price_idr: SUBSCRIPTION_PRICE_IDR,
      billing_model: SINGLE_MONTHLY_PLAN.billing_model,
      is_popular: true,
      is_active: true,
      sort_order: 1,
      max_active_events: SINGLE_MONTHLY_PLAN.max_active_events,
      max_participants: SINGLE_MONTHLY_PLAN.max_participants,
      max_team_members: SINGLE_MONTHLY_PLAN.max_team_members,
      max_storage_mb: SINGLE_MONTHLY_PLAN.max_storage_mb,
      allowed_modules: SINGLE_MONTHLY_PLAN.allowed_modules,
      features: SINGLE_MONTHLY_PLAN.features,
      trial_days: 0,
      early_access_price_idr: null,
      early_access_limit: 0,
      community_discount_pct: 0,
      allow_downgrade: false
    },
    create: {
      code: SINGLE_MONTHLY_PLAN.code,
      name: SINGLE_MONTHLY_PLAN.name,
      tagline: SINGLE_MONTHLY_PLAN.tagline,
      description: SINGLE_MONTHLY_PLAN.description,
      price_idr: SUBSCRIPTION_PRICE_IDR,
      billing_model: SINGLE_MONTHLY_PLAN.billing_model,
      is_popular: true,
      is_active: true,
      sort_order: 1,
      max_active_events: SINGLE_MONTHLY_PLAN.max_active_events,
      max_participants: SINGLE_MONTHLY_PLAN.max_participants,
      max_team_members: SINGLE_MONTHLY_PLAN.max_team_members,
      max_storage_mb: SINGLE_MONTHLY_PLAN.max_storage_mb,
      allowed_modules: SINGLE_MONTHLY_PLAN.allowed_modules,
      features: SINGLE_MONTHLY_PLAN.features,
      trial_days: 0,
      early_access_price_idr: null,
      early_access_limit: 0,
      community_discount_pct: 0,
      allow_downgrade: false
    }
  })

  return {
    plans: [{ ...upserted, duration_days: SUBSCRIPTION_DURATION_DAYS }],
    bundles: [],
    promos: [],
    payment_methods: ['midtrans_snap'],
    manual_payment_enabled: false,
    subscription_duration_days: SUBSCRIPTION_DURATION_DAYS
  }
}

function buildPlanSnapshot(plan) {
  return {
    code: plan.code,
    name: plan.name,
    price_idr: Number(plan.price_idr || 0),
    max_active_events: Number(plan.max_active_events || 1),
    max_participants: Number(plan.max_participants || 100),
    max_team_members: Number(plan.max_team_members || 3),
    max_storage_mb: Number(plan.max_storage_mb || 50),
    allowed_modules: toArray(plan.allowed_modules)
  }
}

export async function getEventUsage(eventId) {
  if (!usePrisma()) {
    const participantsCount = store.participants.filter(
      (p) => p.event_id === eventId && p.registration_status !== 'Cancelled'
    ).length
    const teamCount =
      store.teamMembers.filter((m) => m.event_id === eventId).length +
      store.teamInvites.filter((i) => i.event_id === eventId && i.status === 'pending').length
    const docsCount = store.documents.filter((d) => d.event_id === eventId).length
    return {
      participants_count: participantsCount,
      team_members_count: teamCount,
      documents_count: docsCount,
      storage_used_mb: docsCount * 2
    }
  }

  const [participantsCount, teamCount, inviteCount, docsCount] = await Promise.all([
    prisma.participant.count({ where: { event_id: eventId, registration_status: { not: 'Cancelled' } } }),
    prisma.teamMember.count({ where: { event_id: eventId } }),
    prisma.teamInvite.count({ where: { event_id: eventId, status: 'pending' } }),
    prisma.eventDocument.count({ where: { event_id: eventId } })
  ])

  return {
    participants_count: participantsCount,
    team_members_count: teamCount + inviteCount,
    documents_count: docsCount,
    storage_used_mb: docsCount * 2
  }
}

export async function ensureEventEntitlement(eventId) {
  const activePlan = SINGLE_MONTHLY_PLAN

  if (!usePrisma()) {
    const evt = store.events.find((e) => e.id === eventId && !e.deleted_at)
    if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')

    const usage = await getEventUsage(eventId)
    return {
      subscription: {
        id: 'sub-' + eventId,
        event_id: eventId,
        organization_id: evt.organization_id,
        plan_code: activePlan.code,
        plan_name: activePlan.name,
        price_snapshot_idr: SUBSCRIPTION_PRICE_IDR,
        limits_snapshot: buildPlanSnapshot(activePlan),
        status: 'active',
        is_trial: false,
        activated_at: new Date().toISOString()
      },
      plan_code: activePlan.code,
      plan_name: activePlan.name,
      limits: buildPlanSnapshot(activePlan),
      allowed_modules: ALL_MODULES,
      usage,
      trial: {
        is_trial: false,
        trial_started_at: null,
        trial_ends_at: null,
        days_remaining: null,
        warning: null,
        eligible: false
      }
    }
  }

  const evt = await prisma.event.findFirst({
    where: { id: eventId, deleted_at: null },
    select: { id: true, organization_id: true, created_by: true, title: true }
  })
  if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')

  const usage = await getEventUsage(eventId)
  return {
    subscription: {
      id: 'sub-' + eventId,
      event_id: eventId,
      organization_id: evt.organization_id,
      plan_code: activePlan.code,
      plan_name: activePlan.name,
      price_snapshot_idr: SUBSCRIPTION_PRICE_IDR,
      limits_snapshot: buildPlanSnapshot(activePlan),
      status: 'active',
      is_trial: false,
      activated_at: new Date().toISOString()
    },
    plan_code: activePlan.code,
    plan_name: activePlan.name,
    limits: buildPlanSnapshot(activePlan),
    allowed_modules: ALL_MODULES,
    usage,
    trial: {
      is_trial: false,
      trial_started_at: null,
      trial_ends_at: null,
      days_remaining: null,
      warning: null,
      eligible: false
    }
  }
}

export async function assertEventModuleAllowedByPlan(_eventId, _moduleKey) {
  return
}

export async function assertEventQuotaAvailable(_eventId, _quotaType, _incrementBy = 1) {
  return
}

export async function assertFreeEventCreationAllowed(_organizationId) {
  return { warn_upgrade_needed: false }
}

export async function activateEventTrial(_eventId, _user) {
  throw new AppError(
    'Program trial tidak tersedia. Gunakan langganan bulanan TERRA Studio Rp 50.000/bulan via Midtrans.',
    400,
    'TRIAL_DISABLED'
  )
}

export async function previewBillingCheckout(_params: any = {}) {
  const snapshot = buildPlanSnapshot(SINGLE_MONTHLY_PLAN)
  return {
    target_type: 'subscription',
    plan_code: SINGLE_MONTHLY_PLAN.code,
    plan_name: `${SINGLE_MONTHLY_PLAN.name} (1 Bulan)`,
    bundle_id: null,
    current_plan_code: null,
    base_price_idr: SUBSCRIPTION_PRICE_IDR,
    discount_idr: 0,
    upgrade_credit_idr: 0,
    final_amount_idr: SUBSCRIPTION_PRICE_IDR,
    applied_promo: null,
    early_access_saved_idr: 0,
    plan_snapshot: snapshot
  }
}

export async function createBillingCheckout(user, payload: any = {}) {
  const preview = await previewBillingCheckout(payload)
  let orgId = payload.organization_id
  if (!orgId) {
    const dbMod = await import('./db.js')
    const org = await dbMod.ensureOrganizerDefaultOrganization(user)
    orgId = org.id
  }

  const invoiceNumber = generateInvoiceNumber()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  if (!usePrisma()) {
    const txRecord = {
      id: 'btx-' + Date.now(),
      invoice_number: invoiceNumber,
      organization_id: orgId,
      organizer_id: user.id,
      event_id: payload.event_id || null,
      target_type: 'subscription',
      plan_code: SINGLE_MONTHLY_PLAN.code,
      plan_name: `${SINGLE_MONTHLY_PLAN.name} (1 Bulan)`,
      bundle_id: null,
      promo_code: null,
      community_org_proof: null,
      payment_method: 'payment_gateway',
      payment_provider: 'midtrans',
      payment_token: null,
      payment_redirect_url: null,
      payment_reference: null,
      paid_at: null,
      payment_metadata: {},
      base_price_idr: SUBSCRIPTION_PRICE_IDR,
      discount_idr: 0,
      upgrade_credit_idr: 0,
      final_amount_idr: SUBSCRIPTION_PRICE_IDR,
      plan_snapshot: preview.plan_snapshot,
      payment_proof_url: null,
      payment_notes: payload.payment_notes || null,
      admin_notes: null,
      verified_by: null,
      verified_at: null,
      status: 'Pending',
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    store.billingTransactions.unshift(txRecord)
    await recordBillingAudit({
      organization_id: orgId,
      event_id: payload.event_id || null,
      actor_id: user.id,
      actor_role: user.role,
      action: 'SUBSCRIPTION_CHECKOUT_CREATED',
      to_plan: SINGLE_MONTHLY_PLAN.code,
      details: { invoice_number: invoiceNumber, amount: SUBSCRIPTION_PRICE_IDR, status: 'Pending' }
    })
    return { transaction: txRecord }
  }

  const created = await runTransaction(async (tx) => {
    const rec = await tx.billingTransaction.create({
      data: {
        invoice_number: invoiceNumber,
        organization_id: orgId,
        organizer_id: user.id,
        event_id: payload.event_id || null,
        target_type: 'subscription',
        plan_code: SINGLE_MONTHLY_PLAN.code,
        plan_name: `${SINGLE_MONTHLY_PLAN.name} (1 Bulan)`,
        payment_method: 'payment_gateway',
        payment_provider: 'midtrans',
        base_price_idr: SUBSCRIPTION_PRICE_IDR,
        discount_idr: 0,
        upgrade_credit_idr: 0,
        final_amount_idr: SUBSCRIPTION_PRICE_IDR,
        plan_snapshot: preview.plan_snapshot,
        payment_notes: payload.payment_notes || null,
        status: 'Pending',
        expires_at: expiresAt
      }
    })
    await recordBillingAudit(
      {
        organization_id: orgId,
        event_id: payload.event_id || null,
        actor_id: user.id,
        actor_role: user.role,
        action: 'SUBSCRIPTION_CHECKOUT_CREATED',
        to_plan: SINGLE_MONTHLY_PLAN.code,
        details: { invoice_number: invoiceNumber, amount: SUBSCRIPTION_PRICE_IDR }
      },
      tx
    )
    return rec
  })

  return { transaction: created }
}

export async function createOrReuseSubscriptionCheckout(user, { organization_id = null, force_new = false } = {}) {
  const now = Date.now()
  if (!force_new) {
    if (!usePrisma()) {
      const existingPending = store.billingTransactions.find(
        (t) =>
          t.organizer_id === user.id &&
          t.status === 'Pending' &&
          Number(t.final_amount_idr) === SUBSCRIPTION_PRICE_IDR &&
          (!t.expires_at || new Date(t.expires_at).getTime() > now)
      )
      if (existingPending) return { transaction: existingPending, reused: true }
    } else {
      const existingPending = await prisma.billingTransaction.findFirst({
        where: {
          organizer_id: user.id,
          status: 'Pending',
          final_amount_idr: SUBSCRIPTION_PRICE_IDR,
          expires_at: { gt: new Date() }
        },
        orderBy: { created_at: 'desc' }
      })
      if (existingPending) return { transaction: existingPending, reused: true }
    }
  }

  return createBillingCheckout(user, { organization_id, payment_method: 'payment_gateway' })
}

export async function submitTransactionProof(txId, user, { payment_proof_url, payment_notes }) {
  if (!usePrisma()) {
    const tx = store.billingTransactions.find((t) => t.id === txId)
    if (!tx) throw new AppError('Transaksi tidak ditemukan.', 404, 'TX_NOT_FOUND')
    if (tx.status === 'Paid') {
      throw new AppError('Transaksi sudah lunas dan diverifikasi.', 409, 'TX_ALREADY_PAID')
    }
    const org = store.organizations.find((o) => o.id === tx.organization_id)
    const isOrgMember = org?.members?.some((m) => m.user_id === user.id || m.email === user.email)
    if (user.role !== 'admin' && tx.organizer_id !== user.id && !isOrgMember) {
      throw new AppError('Anda tidak memiliki izin mengunggah bukti untuk transaksi ini.', 403, 'FORBIDDEN')
    }
    tx.payment_proof_url = payment_proof_url
    tx.payment_notes = payment_notes || tx.payment_notes
    tx.status = 'Waiting Verification'
    tx.updated_at = new Date().toISOString()
    await recordBillingAudit({
      organization_id: tx.organization_id,
      event_id: tx.event_id,
      actor_id: user.id,
      actor_role: user.role,
      action: 'PROOF_UPLOADED',
      details: { invoice_number: tx.invoice_number, payment_proof_url }
    })
    return tx
  }

  const existing = await prisma.billingTransaction.findUnique({ where: { id: txId } })
  if (!existing) throw new AppError('Transaksi tidak ditemukan.', 404, 'TX_NOT_FOUND')
  if (existing.status === 'Paid') {
    throw new AppError('Transaksi sudah lunas dan diverifikasi.', 409, 'TX_ALREADY_PAID')
  }
  if (user.role !== 'admin' && existing.organizer_id !== user.id) {
    const member = await prisma.organizationMember.findFirst({
      where: {
        organization_id: existing.organization_id,
        OR: [{ user_id: user.id }, { email: user.email }]
      }
    })
    if (!member) {
      throw new AppError('Anda tidak memiliki izin mengunggah bukti untuk transaksi ini.', 403, 'FORBIDDEN')
    }
  }

  const updated = await prisma.billingTransaction.update({
    where: { id: txId },
    data: {
      payment_proof_url,
      payment_notes: payment_notes || existing.payment_notes,
      status: 'Waiting Verification'
    }
  })
  await recordBillingAudit({
    organization_id: updated.organization_id,
    event_id: updated.event_id,
    actor_id: user.id,
    actor_role: user.role,
    action: 'PROOF_UPLOADED',
    details: { invoice_number: updated.invoice_number, payment_proof_url }
  })
  return updated
}

async function verifyBillingTransactionInternal(txId, adminUser, { status, admin_notes }) {
  const tx = store.billingTransactions.find((t) => t.id === txId)
  if (!tx) throw new AppError('Transaksi billing tidak ditemukan.', 404, 'TX_NOT_FOUND')
  if (tx.status === 'Paid' && status === 'Paid') return tx

  tx.status = status
  tx.admin_notes = admin_notes || null
  tx.verified_by = adminUser.id
  tx.verified_at = new Date().toISOString()
  tx.updated_at = tx.verified_at

  if (status === 'Paid') {
    const dbMod = await import('./db.js')
    await dbMod.activateOrganizerMonthlySubscription(tx.organizer_id, SUBSCRIPTION_DURATION_DAYS)
    if (tx.promo_code) {
      const p = store.promoCodes.find((x) => x.code.toUpperCase() === tx.promo_code.toUpperCase())
      if (p) p.used_count = Number(p.used_count || 0) + 1
    }
    if (tx.target_type === 'bundle' && tx.bundle_id) {
      const snap = tx.plan_snapshot || {}
      store.bundleCredits.unshift({
        id: 'bcrd-' + Date.now(),
        organization_id: tx.organization_id,
        bundle_id: tx.bundle_id,
        bundle_name: snap.bundle_name || tx.plan_name,
        plan_code: tx.plan_code,
        total_credits: Number(snap.event_quota || 3),
        remaining_credits: Number(snap.event_quota || 3),
        transaction_id: tx.id,
        created_at: tx.verified_at
      })
    } else if (tx.event_id) {
      const ent = await ensureEventEntitlement(tx.event_id)
      const prevPlan = ent.plan_code
      Object.assign(ent.subscription, {
        plan_code: tx.plan_code,
        plan_name: tx.plan_name,
        price_snapshot_idr: Number(tx.plan_snapshot?.price_idr ?? tx.final_amount_idr),
        limits_snapshot: tx.plan_snapshot,
        status: 'active',
        is_trial: false,
        activated_at: tx.verified_at
      })
      await recordBillingAudit({
        organization_id: tx.organization_id,
        event_id: tx.event_id,
        actor_id: adminUser.id,
        actor_role: adminUser.role,
        action: 'PLAN_ACTIVATED',
        from_plan: prevPlan,
        to_plan: tx.plan_code,
        details: { invoice_number: tx.invoice_number }
      })
    }
  }

  await recordBillingAudit({
    organization_id: tx.organization_id,
    event_id: tx.event_id,
    actor_id: adminUser.id,
    actor_role: adminUser.role,
    action: `PAYMENT_${status.toUpperCase()}`,
    to_plan: tx.plan_code,
    details: { invoice_number: tx.invoice_number, admin_notes }
  })

  return tx
}

export async function adminVerifyBillingTransaction(txId, adminUser, { status, admin_notes }) {
  if (!['Paid', 'Rejected', 'Expired', 'Refunded'].includes(status)) {
    throw new AppError('Status verifikasi transaksi tidak valid.', 400, 'INVALID_STATUS')
  }
  if (!usePrisma()) {
    return verifyBillingTransactionInternal(txId, adminUser, { status, admin_notes })
  }

  return runTransaction(async (txClient) => {
    const existing = await txClient.billingTransaction.findUnique({ where: { id: txId } })
    if (!existing) throw new AppError('Transaksi billing tidak ditemukan.', 404, 'TX_NOT_FOUND')
    if (existing.status === 'Paid' && status === 'Paid') return existing

    const updated = await txClient.billingTransaction.update({
      where: { id: txId },
      data: {
        status,
        admin_notes: admin_notes || null,
        verified_by: adminUser.id,
        verified_at: new Date()
      }
    })

    if (status === 'Paid') {
      const orgAccount = await txClient.organizer.findUnique({ where: { id: updated.organizer_id } })
      if (orgAccount) {
        const baseMs =
          orgAccount.subscription_expires_at && new Date(orgAccount.subscription_expires_at).getTime() > Date.now()
            ? new Date(orgAccount.subscription_expires_at).getTime()
            : Date.now()
        await txClient.organizer.update({
          where: { id: orgAccount.id },
          data: {
            subscription_plan: SINGLE_MONTHLY_PLAN.code,
            subscription_status: 'active',
            subscription_expires_at: new Date(baseMs + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000)
          }
        })
      }

      if (updated.promo_code) {
        await txClient.promoCode
          .updateMany({
            where: { code: updated.promo_code },
            data: { used_count: { increment: 1 } }
          })
          .catch(() => {})
      }

      if (updated.target_type === 'bundle' && updated.bundle_id) {
        const snap = updated.plan_snapshot || {}
        const quota = Number(snap.event_quota || 3)
        await txClient.organizationBundleCredit.create({
          data: {
            organization_id: updated.organization_id,
            bundle_id: updated.bundle_id,
            bundle_name: snap.bundle_name || updated.plan_name,
            plan_code: updated.plan_code,
            total_credits: quota,
            remaining_credits: quota,
            transaction_id: updated.id
          }
        })
      } else if (updated.event_id) {
        const currentSub = await txClient.eventSubscription.findUnique({ where: { event_id: updated.event_id } })
        const prevPlan = currentSub?.plan_code || 'free'
        const snapPrice = Number(updated.plan_snapshot?.price_idr ?? updated.final_amount_idr)
        await txClient.eventSubscription.upsert({
          where: { event_id: updated.event_id },
          update: {
            plan_code: updated.plan_code,
            plan_name: updated.plan_name,
            price_snapshot_idr: snapPrice,
            limits_snapshot: updated.plan_snapshot || {},
            status: 'active',
            is_trial: false,
            activated_at: new Date()
          },
          create: {
            event_id: updated.event_id,
            organization_id: updated.organization_id,
            plan_code: updated.plan_code,
            plan_name: updated.plan_name,
            price_snapshot_idr: snapPrice,
            limits_snapshot: updated.plan_snapshot || {},
            status: 'active',
            is_trial: false
          }
        })
        await recordBillingAudit(
          {
            organization_id: updated.organization_id,
            event_id: updated.event_id,
            actor_id: adminUser.id,
            actor_role: 'admin',
            action: 'PLAN_ACTIVATED',
            from_plan: prevPlan,
            to_plan: updated.plan_code,
            details: { invoice_number: updated.invoice_number }
          },
          txClient
        )
      }

      await txClient.userNotification.create({
        data: {
          user_id: updated.organizer_id,
          user_role: 'organizer',
          title: `Pembayaran ${updated.invoice_number} Disetujui`,
          message: `Paket ${updated.plan_name} telah aktif dan siap digunakan.`,
          type: 'success',
          reference_type: updated.event_id ? 'event' : 'bundle',
          reference_id: updated.event_id || updated.id
        }
      })
    }

    await recordBillingAudit(
      {
        organization_id: updated.organization_id,
        event_id: updated.event_id,
        actor_id: adminUser.id,
        actor_role: 'admin',
        action: `PAYMENT_${status.toUpperCase()}`,
        to_plan: updated.plan_code,
        details: { invoice_number: updated.invoice_number, admin_notes }
      },
      txClient
    )

    return updated
  })
}

export async function applyBundleCreditToEvent(eventId, bundleCreditId, user) {
  const ent = await ensureEventEntitlement(eventId)
  if (!usePrisma()) {
    const credit = store.bundleCredits.find(
      (c) => c.id === bundleCreditId && c.organization_id === ent.subscription.organization_id
    )
    if (!credit || credit.remaining_credits <= 0) {
      throw new AppError('Kredit bundle tidak ditemukan atau sudah habis.', 404, 'BUNDLE_CREDIT_EMPTY')
    }
    const plan = await getPlanByCode(credit.plan_code)
    if (!plan) throw new AppError('Paket rencana bundle tidak ditemukan.', 404, 'PLAN_NOT_FOUND')
    credit.remaining_credits -= 1
    const prevPlan = ent.plan_code
    Object.assign(ent.subscription, {
      plan_code: plan.code,
      plan_name: `${plan.name} (Bundle)`,
      price_snapshot_idr: plan.price_idr,
      limits_snapshot: buildPlanSnapshot(plan),
      status: 'active',
      is_trial: false,
      activated_at: new Date().toISOString()
    })
    await recordBillingAudit({
      organization_id: ent.subscription.organization_id,
      event_id: eventId,
      actor_id: user.id,
      actor_role: user.role,
      action: 'BUNDLE_APPLIED',
      from_plan: prevPlan,
      to_plan: plan.code,
      details: { bundle_credit_id: credit.id, remaining_credits: credit.remaining_credits }
    })
    return ensureEventEntitlement(eventId)
  }

  return runTransaction(async (txClient) => {
    const credit = await txClient.organizationBundleCredit.findUnique({ where: { id: bundleCreditId } })
    if (!credit || credit.organization_id !== ent.subscription.organization_id || credit.remaining_credits <= 0) {
      throw new AppError('Kredit bundle tidak tersedia atau sudah habis.', 404, 'BUNDLE_CREDIT_EMPTY')
    }
    const plan = await txClient.pricingPlan.findUnique({ where: { code: credit.plan_code } })
    if (!plan) throw new AppError('Paket rencana bundle tidak ditemukan.', 404, 'PLAN_NOT_FOUND')

    const dec = await txClient.organizationBundleCredit.updateMany({
      where: { id: credit.id, remaining_credits: { gt: 0 } },
      data: { remaining_credits: { decrement: 1 } }
    })
    if (dec.count === 0) throw new AppError('Kredit bundle sudah habis.', 409, 'BUNDLE_CREDIT_EMPTY')

    await txClient.eventSubscription.upsert({
      where: { event_id: eventId },
      update: {
        plan_code: plan.code,
        plan_name: `${plan.name} (Bundle)`,
        price_snapshot_idr: plan.price_idr,
        limits_snapshot: buildPlanSnapshot(plan),
        status: 'active',
        is_trial: false,
        activated_at: new Date()
      },
      create: {
        event_id: eventId,
        organization_id: ent.subscription.organization_id,
        plan_code: plan.code,
        plan_name: `${plan.name} (Bundle)`,
        price_snapshot_idr: plan.price_idr,
        limits_snapshot: buildPlanSnapshot(plan),
        status: 'active',
        is_trial: false
      }
    })
    await recordBillingAudit(
      {
        organization_id: ent.subscription.organization_id,
        event_id: eventId,
        actor_id: user.id,
        actor_role: user.role,
        action: 'BUNDLE_APPLIED',
        from_plan: ent.plan_code,
        to_plan: plan.code,
        details: { bundle_credit_id: credit.id }
      },
      txClient
    )
    return ensureEventEntitlement(eventId)
  })
}

export async function downgradeEventPlan(eventId, targetPlanCode, user) {
  const ent = await ensureEventEntitlement(eventId)
  const targetPlan = await getPlanByCode(targetPlanCode)
  if (!targetPlan) throw new AppError('Paket tujuan tidak ditemukan.', 404, 'PLAN_NOT_FOUND')
  if (!targetPlan.allow_downgrade) {
    throw new AppError('Paket tujuan tidak mendukung downgrade.', 400, 'DOWNGRADE_NOT_ALLOWED')
  }
  if ((PLAN_RANK[targetPlanCode] ?? 0) >= (PLAN_RANK[ent.plan_code] ?? 0)) {
    throw new AppError('Gunakan alur upgrade untuk berpindah ke paket yang lebih tinggi atau sama.', 400, 'NOT_A_DOWNGRADE')
  }

  const conflicts = []
  if (ent.usage.participants_count > Number(targetPlan.max_participants || 100)) {
    conflicts.push(`Jumlah peserta saat ini (${ent.usage.participants_count}) melebihi batas paket ${targetPlan.name} (${targetPlan.max_participants}).`)
  }
  if (ent.usage.team_members_count > Number(targetPlan.max_team_members || 3)) {
    conflicts.push(`Jumlah panitia saat ini (${ent.usage.team_members_count}) melebihi batas paket ${targetPlan.name} (${targetPlan.max_team_members}).`)
  }
  if (conflicts.length > 0) {
    throw new AppError(
      `Downgrade ke ${targetPlan.name} memerlukan penyesuaian kuota terlebih dahulu: ${conflicts.join(' ')} Data historis Anda tidak akan dihapus.`,
      409,
      'DOWNGRADE_USAGE_CONFLICT',
      conflicts.map((message) => ({ message }))
    )
  }

  const snapshot = buildPlanSnapshot(targetPlan)
  const prevPlan = ent.plan_code

  if (!usePrisma()) {
    Object.assign(ent.subscription, {
      plan_code: targetPlan.code,
      plan_name: targetPlan.name,
      price_snapshot_idr: targetPlan.price_idr,
      limits_snapshot: snapshot,
      status: 'downgraded',
      is_trial: false,
      activated_at: new Date().toISOString()
    })
    await recordBillingAudit({
      organization_id: ent.subscription.organization_id,
      event_id: eventId,
      actor_id: user.id,
      actor_role: user.role,
      action: 'PLAN_DOWNGRADED',
      from_plan: prevPlan,
      to_plan: targetPlan.code,
      details: { data_preserved: true }
    })
    return ensureEventEntitlement(eventId)
  }

  await runTransaction(async (txClient) => {
    await txClient.eventSubscription.update({
      where: { event_id: eventId },
      data: {
        plan_code: targetPlan.code,
        plan_name: targetPlan.name,
        price_snapshot_idr: targetPlan.price_idr,
        limits_snapshot: snapshot,
        status: 'downgraded',
        is_trial: false,
        activated_at: new Date()
      }
    })
    await recordBillingAudit(
      {
        organization_id: ent.subscription.organization_id,
        event_id: eventId,
        actor_id: user.id,
        actor_role: user.role,
        action: 'PLAN_DOWNGRADED',
        from_plan: prevPlan,
        to_plan: targetPlan.code,
        details: { data_preserved: true }
      },
      txClient
    )
  })

  return ensureEventEntitlement(eventId)
}

export async function listOrganizerBillingHistory(user, orgIds = []) {
  if (!usePrisma()) {
    const txs = store.billingTransactions.filter(
      (t) => t.organizer_id === user.id || orgIds.includes(t.organization_id)
    )
    const credits = store.bundleCredits.filter((c) => orgIds.includes(c.organization_id))
    const logs = store.billingAuditLogs.filter((l) => orgIds.includes(l.organization_id) || l.actor_id === user.id)
    return { transactions: txs, bundle_credits: credits, audit_logs: logs }
  }

  const orgFilter = orgIds.length > 0 ? { in: orgIds } : undefined
  const [transactions, bundleCredits, auditLogs] = await Promise.all([
    prisma.billingTransaction.findMany({
      where: {
        OR: [{ organizer_id: user.id }, ...(orgFilter ? [{ organization_id: orgFilter }] : [])]
      },
      include: { event: { select: { id: true, title: true } }, organization: { select: { id: true, name: true } } },
      orderBy: { created_at: 'desc' }
    }),
    prisma.organizationBundleCredit.findMany({
      where: orgFilter ? { organization_id: orgFilter } : { organization_id: '__none__' },
      orderBy: { created_at: 'desc' }
    }),
    prisma.billingAuditLog.findMany({
      where: {
        OR: [{ actor_id: user.id }, ...(orgFilter ? [{ organization_id: orgFilter }] : [])]
      },
      orderBy: { created_at: 'desc' },
      take: 40
    })
  ])

  return { transactions, bundle_credits: bundleCredits, audit_logs: auditLogs }
}

export async function getAdminPricingOverview() {
  if (!usePrisma()) {
    const paidTxs = store.billingTransactions.filter((t) => t.status === 'Paid')
    return {
      plans: store.pricingPlans.sort((a, b) => a.sort_order - b.sort_order),
      bundles: store.bundlePackages,
      promos: store.promoCodes,
      transactions: store.billingTransactions,
      subscriptions: store.eventSubscriptions,
      audit_logs: store.billingAuditLogs,
      stats: {
        total_paid_revenue_idr: paidTxs.reduce((s, t) => s + Number(t.final_amount_idr || 0), 0),
        paid_transactions_count: paidTxs.length,
        waiting_verification_count: store.billingTransactions.filter((t) =>
          ['Pending', 'Waiting Verification'].includes(t.status)
        ).length
      }
    }
  }

  const [plans, bundles, promos, transactions, subscriptions, auditLogs] = await Promise.all([
    prisma.pricingPlan.findMany({ orderBy: { sort_order: 'asc' } }),
    prisma.bundlePackage.findMany({ orderBy: { bundle_price_idr: 'asc' } }),
    prisma.promoCode.findMany({ orderBy: { created_at: 'desc' } }),
    prisma.billingTransaction.findMany({
      include: {
        organization: { select: { id: true, name: true, email: true } },
        event: { select: { id: true, title: true } }
      },
      orderBy: { created_at: 'desc' },
      take: 100
    }),
    prisma.eventSubscription.findMany({
      include: {
        event: { select: { id: true, title: true, slug: true } },
        organization: { select: { id: true, name: true } }
      },
      orderBy: { updated_at: 'desc' }
    }),
    prisma.billingAuditLog.findMany({ orderBy: { created_at: 'desc' }, take: 80 })
  ])

  const paidTxs = transactions.filter((t) => t.status === 'Paid')
  return {
    plans,
    bundles,
    promos,
    transactions,
    subscriptions,
    audit_logs: auditLogs,
    stats: {
      total_paid_revenue_idr: paidTxs.reduce((s, t) => s + Number(t.final_amount_idr || 0), 0),
      paid_transactions_count: paidTxs.length,
      waiting_verification_count: transactions.filter((t) =>
        ['Pending', 'Waiting Verification'].includes(t.status)
      ).length
    }
  }
}

export async function adminUpdatePricingPlan(code, patch, adminUser) {
  if (!usePrisma()) {
    const plan = store.pricingPlans.find((p) => p.code === code)
    if (!plan) throw new AppError('Paket tidak ditemukan.', 404, 'PLAN_NOT_FOUND')
    Object.assign(plan, patch)
    await recordBillingAudit({
      actor_id: adminUser?.id,
      actor_role: 'admin',
      action: 'PRICING_CONFIG_UPDATED',
      to_plan: code,
      details: patch
    })
    return plan
  }

  const updated = await prisma.pricingPlan.update({
    where: { code },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.price_idr !== undefined ? { price_idr: Number(patch.price_idr) } : {}),
      ...(patch.max_active_events !== undefined ? { max_active_events: Number(patch.max_active_events) } : {}),
      ...(patch.max_participants !== undefined ? { max_participants: Number(patch.max_participants) } : {}),
      ...(patch.max_team_members !== undefined ? { max_team_members: Number(patch.max_team_members) } : {}),
      ...(patch.max_storage_mb !== undefined ? { max_storage_mb: Number(patch.max_storage_mb) } : {}),
      ...(patch.allowed_modules !== undefined ? { allowed_modules: patch.allowed_modules } : {}),
      ...(patch.features !== undefined ? { features: patch.features } : {}),
      ...(patch.trial_days !== undefined ? { trial_days: Number(patch.trial_days) } : {}),
      ...(patch.early_access_price_idr !== undefined ? { early_access_price_idr: patch.early_access_price_idr === null ? null : Number(patch.early_access_price_idr) } : {}),
      ...(patch.community_discount_pct !== undefined ? { community_discount_pct: Number(patch.community_discount_pct) } : {}),
      ...(patch.is_active !== undefined ? { is_active: Boolean(patch.is_active) } : {}),
      ...(patch.allow_downgrade !== undefined ? { allow_downgrade: Boolean(patch.allow_downgrade) } : {})
    }
  })

  await recordBillingAudit({
    actor_id: adminUser?.id,
    actor_role: 'admin',
    action: 'PRICING_CONFIG_UPDATED',
    to_plan: code,
    details: patch
  })

  return updated
}

export async function adminUpsertBundle(payload) {
  if (!usePrisma()) {
    const existing = store.bundlePackages.find((b) => b.id === payload.id || b.code === payload.code)
    if (existing) {
      Object.assign(existing, payload)
      return existing
    }
    const created = { id: 'bnd-' + Date.now(), is_active: true, ...payload }
    store.bundlePackages.push(created)
    return created
  }
  return prisma.bundlePackage.upsert({
    where: { code: payload.code },
    update: {
      name: payload.name,
      plan_code: payload.plan_code,
      event_quota: Number(payload.event_quota),
      bundle_price_idr: Number(payload.bundle_price_idr),
      description: payload.description || null,
      is_active: payload.is_active !== false
    },
    create: {
      code: payload.code,
      name: payload.name,
      plan_code: payload.plan_code,
      event_quota: Number(payload.event_quota),
      bundle_price_idr: Number(payload.bundle_price_idr),
      description: payload.description || null,
      is_active: payload.is_active !== false
    }
  })
}

export async function adminCreatePromo(payload) {
  const code = String(payload.code).trim().toUpperCase()
  if (!usePrisma()) {
    const existing = store.promoCodes.find((p) => p.code === code)
    if (existing) {
      Object.assign(existing, payload, { code })
      return existing
    }
    const created = { id: 'prm-' + Date.now(), used_count: 0, is_active: true, ...payload, code }
    store.promoCodes.unshift(created)
    return created
  }
  return prisma.promoCode.upsert({
    where: { code },
    update: {
      name: payload.name,
      promo_type: payload.promo_type || 'promo',
      discount_type: payload.discount_type || 'percent',
      discount_value: Number(payload.discount_value || 0),
      applies_to_plan: payload.applies_to_plan || null,
      requires_verification: Boolean(payload.requires_verification),
      max_redemptions: payload.max_redemptions ? Number(payload.max_redemptions) : null,
      is_active: payload.is_active !== false
    },
    create: {
      code,
      name: payload.name,
      promo_type: payload.promo_type || 'promo',
      discount_type: payload.discount_type || 'percent',
      discount_value: Number(payload.discount_value || 0),
      applies_to_plan: payload.applies_to_plan || null,
      requires_verification: Boolean(payload.requires_verification),
      max_redemptions: payload.max_redemptions ? Number(payload.max_redemptions) : null,
      is_active: payload.is_active !== false
    }
  })
}

export async function findBillingTransactionByIdOrInvoice(identifier: string) {
  const raw = Array.isArray(identifier) ? identifier[identifier.length - 1] : identifier
  const clean =
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .pop() || ''
  if (!clean) throw new AppError('Transaksi billing tidak ditemukan.', 404, 'TX_NOT_FOUND')
  const baseRef = clean.replace(/-R[A-Z0-9]+$/i, '')
  if (!usePrisma()) {
    const tx = store.billingTransactions.find(
      (t) =>
        t.id === clean ||
        t.invoice_number === clean ||
        t.invoice_number === baseRef ||
        t.payment_metadata?.midtrans_order_id === clean
    )
    if (!tx) throw new AppError('Transaksi billing tidak ditemukan.', 404, 'TX_NOT_FOUND')
    return tx
  }
  const orFilters: any[] = [{ id: clean }, { invoice_number: clean }]
  if (baseRef && baseRef !== clean) {
    orFilters.push({ invoice_number: baseRef })
  }
  const tx = await prisma.billingTransaction.findFirst({
    where: {
      OR: orFilters
    },
    include: {
      organization: { select: { id: true, name: true, email: true, phone: true } },
      event: { select: { id: true, title: true } }
    }
  })
  if (!tx) throw new AppError('Transaksi billing tidak ditemukan.', 404, 'TX_NOT_FOUND')
  return tx
}

export async function updateBillingPaymentSession(txId: string, patch: Record<string, any>) {
  if (!usePrisma()) {
    const tx = store.billingTransactions.find((t) => t.id === txId)
    if (!tx) throw new AppError('Transaksi billing tidak ditemukan.', 404, 'TX_NOT_FOUND')
    Object.assign(tx, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.payment_provider !== undefined ? { payment_provider: patch.payment_provider } : {}),
      ...(patch.payment_method !== undefined ? { payment_method: patch.payment_method } : {}),
      ...(patch.payment_token !== undefined ? { payment_token: patch.payment_token } : {}),
      ...(patch.payment_redirect_url !== undefined ? { payment_redirect_url: patch.payment_redirect_url } : {}),
      ...(patch.payment_reference !== undefined ? { payment_reference: patch.payment_reference } : {}),
      ...(patch.paid_at !== undefined ? { paid_at: patch.paid_at } : {}),
      ...(patch.payment_metadata !== undefined
        ? { payment_metadata: { ...(tx.payment_metadata || {}), ...patch.payment_metadata } }
        : {}),
      updated_at: new Date().toISOString()
    })
    return tx
  }

  const existing = await prisma.billingTransaction.findUnique({ where: { id: txId } })
  if (!existing) throw new AppError('Transaksi billing tidak ditemukan.', 404, 'TX_NOT_FOUND')
  const mergedMeta =
    patch.payment_metadata !== undefined
      ? { ...((existing.payment_metadata as Record<string, any>) || {}), ...patch.payment_metadata }
      : undefined
  return prisma.billingTransaction.update({
    where: { id: txId },
    data: {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.payment_provider !== undefined ? { payment_provider: patch.payment_provider } : {}),
      ...(patch.payment_method !== undefined ? { payment_method: patch.payment_method } : {}),
      ...(patch.payment_token !== undefined ? { payment_token: patch.payment_token } : {}),
      ...(patch.payment_redirect_url !== undefined ? { payment_redirect_url: patch.payment_redirect_url } : {}),
      ...(patch.payment_reference !== undefined ? { payment_reference: patch.payment_reference } : {}),
      ...(patch.paid_at !== undefined ? { paid_at: patch.paid_at } : {}),
      ...(mergedMeta !== undefined ? { payment_metadata: mergedMeta } : {})
    }
  })
}

export async function settleOrUpdateBillingFromGateway(
  txId: string,
  normalizedState: string,
  gatewayPayload: Record<string, any> = {}
) {
  const existing = await findBillingTransactionByIdOrInvoice(txId)

  if (normalizedState === 'settled') {
    if (existing.status === 'Paid') {
      return { alreadySettled: true, transaction: existing }
    }
    await updateBillingPaymentSession(existing.id, {
      payment_provider: 'midtrans',
      payment_method: gatewayPayload.payment_type || existing.payment_method || 'midtrans_snap',
      payment_reference: gatewayPayload.transaction_id || existing.payment_reference || null,
      paid_at: new Date(),
      payment_metadata: gatewayPayload
    })
    const verified = await adminVerifyBillingTransaction(
      existing.id,
      { id: 'midtrans-gateway', role: 'admin' },
      {
        status: 'Paid',
        admin_notes: `Settled otomatis via Midtrans (${gatewayPayload.payment_type || 'snap'} • ${gatewayPayload.transaction_id || existing.invoice_number})`
      }
    )
    return { alreadySettled: false, transaction: verified }
  }

  if (existing.status === 'Paid') {
    if (normalizedState === 'refunded') {
      const refunded = await adminVerifyBillingTransaction(
        existing.id,
        { id: 'midtrans-gateway', role: 'admin' },
        {
          status: 'Refunded',
          admin_notes: `Refunded via Midtrans (${gatewayPayload.transaction_id || existing.invoice_number})`
        }
      )
      return { alreadySettled: false, transaction: refunded }
    }
    return { alreadySettled: true, transaction: existing }
  }

  if (normalizedState === 'expired' || normalizedState === 'cancelled') {
    const expired = await adminVerifyBillingTransaction(
      existing.id,
      { id: 'midtrans-gateway', role: 'admin' },
      {
        status: 'Expired',
        admin_notes: `Pembayaran Midtrans ${normalizedState} (${gatewayPayload.transaction_id || existing.invoice_number})`
      }
    )
    return { alreadySettled: false, transaction: expired }
  }

  const updated = await updateBillingPaymentSession(existing.id, {
    payment_provider: 'midtrans',
    payment_method: gatewayPayload.payment_type || existing.payment_method || 'midtrans_snap',
    payment_reference: gatewayPayload.transaction_id || existing.payment_reference || null,
    payment_metadata: gatewayPayload
  })
  return { alreadySettled: false, transaction: updated }
}
