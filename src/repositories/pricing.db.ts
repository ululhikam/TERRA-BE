import crypto from 'node:crypto'
import { prisma, isDatabaseConfigured, runTransaction } from '../config/prisma.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/response.js'
import { store } from './store.js'

const usePrisma = () => Boolean(isDatabaseConfigured && prisma)

export const PLAN_RANK = {
  free: 0,
  starter: 1,
  pro: 2,
  ultimate: 3
}

export const MANUAL_PAYMENT_INSTRUCTIONS = {
  bank_name: 'Bank BCA',
  account_number: '5410-8899-2026',
  account_holder: 'PT TERRA EKOSISTEM DIGITAL',
  ewallet_note: 'QRIS / Transfer Bank / Konfirmasi instan melalui WhatsApp Admin TERRA'
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

export async function getPlanByCode(code) {
  if (!usePrisma()) {
    return store.pricingPlans.find((p) => p.code === code) || null
  }
  return prisma.pricingPlan.findUnique({ where: { code } })
}

export async function listPublicPricingCatalog() {
  if (!usePrisma()) {
    return {
      plans: store.pricingPlans.filter((p) => p.is_active).sort((a, b) => a.sort_order - b.sort_order),
      bundles: store.bundlePackages.filter((b) => b.is_active),
      promos: store.promoCodes.filter((p) => p.is_active),
      admin_whatsapp: env.adminWhatsappNumber || '6287897192601',
      manual_payment_instructions: MANUAL_PAYMENT_INSTRUCTIONS
    }
  }

  const [plans, bundles, promos] = await Promise.all([
    prisma.pricingPlan.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' } }),
    prisma.bundlePackage.findMany({ where: { is_active: true }, orderBy: { bundle_price_idr: 'asc' } }),
    prisma.promoCode.findMany({ where: { is_active: true }, orderBy: { created_at: 'desc' } })
  ])

  return {
    plans,
    bundles,
    promos: promos.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      promo_type: p.promo_type,
      discount_type: p.discount_type,
      discount_value: p.discount_value,
      applies_to_plan: p.applies_to_plan,
      requires_verification: p.requires_verification
    })),
    admin_whatsapp: env.adminWhatsappNumber || '6287897192601',
    manual_payment_instructions: MANUAL_PAYMENT_INSTRUCTIONS
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
  const freePlan = (await getPlanByCode('free')) || {
    code: 'free',
    name: 'FREE',
    price_idr: 0,
    max_active_events: 1,
    max_participants: 100,
    max_team_members: 3,
    max_storage_mb: 50,
    allowed_modules: ['event_profile', 'timeline', 'team']
  }

  if (!usePrisma()) {
    const evt = store.events.find((e) => e.id === eventId && !e.deleted_at)
    if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')

    let sub = store.eventSubscriptions.find((s) => s.event_id === eventId)
    if (!sub) {
      sub = {
        id: 'sub-' + eventId,
        event_id: eventId,
        organization_id: evt.organization_id,
        plan_code: 'free',
        plan_name: 'FREE',
        price_snapshot_idr: 0,
        limits_snapshot: buildPlanSnapshot(freePlan),
        status: 'active',
        is_trial: false,
        trial_started_at: null,
        trial_ends_at: null,
        activated_at: new Date().toISOString()
      }
      store.eventSubscriptions.push(sub)
    }

    if (sub.is_trial && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() < Date.now()) {
      sub.status = 'trial_expired'
      sub.is_trial = false
      sub.plan_code = 'free'
      sub.plan_name = 'FREE'
      sub.limits_snapshot = buildPlanSnapshot(freePlan)
    }

    const usage = await getEventUsage(eventId)
    const trialUsedBefore = store.billingAuditLogs.some(
      (l) => l.action === 'TRIAL_ACTIVATED' && (l.event_id === eventId || l.organization_id === evt.organization_id)
    )
    const daysRemaining =
      sub.is_trial && sub.trial_ends_at
        ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
        : null

    return {
      subscription: sub,
      plan_code: sub.plan_code,
      plan_name: sub.plan_name,
      limits: sub.limits_snapshot || buildPlanSnapshot(freePlan),
      allowed_modules: toArray(sub.limits_snapshot?.allowed_modules || freePlan.allowed_modules),
      usage,
      trial: {
        is_trial: Boolean(sub.is_trial),
        trial_started_at: sub.trial_started_at,
        trial_ends_at: sub.trial_ends_at,
        days_remaining: daysRemaining,
        warning:
          sub.is_trial && daysRemaining !== null && daysRemaining <= 3
            ? `Masa Free Trial Pro berakhir dalam ${daysRemaining} hari. Upgrade paket agar fitur Pro tetap terbuka.`
            : null,
        eligible: !trialUsedBefore && sub.plan_code === 'free' && !sub.is_trial
      }
    }
  }

  const evt = await prisma.event.findFirst({ where: { id: eventId, deleted_at: null }, select: { id: true, organization_id: true, created_by: true, title: true } })
  if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')

  let sub = await prisma.eventSubscription.findUnique({ where: { event_id: eventId } })
  if (!sub) {
    sub = await prisma.eventSubscription.create({
      data: {
        event_id: eventId,
        organization_id: evt.organization_id,
        plan_code: 'free',
        plan_name: freePlan.name,
        price_snapshot_idr: 0,
        limits_snapshot: buildPlanSnapshot(freePlan),
        status: 'active',
        is_trial: false
      }
    })
  }

  if (sub.is_trial && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() < Date.now()) {
    sub = await prisma.eventSubscription.update({
      where: { event_id: eventId },
      data: {
        status: 'trial_expired',
        is_trial: false,
        plan_code: 'free',
        plan_name: freePlan.name,
        limits_snapshot: buildPlanSnapshot(freePlan)
      }
    })
    await recordBillingAudit({
      organization_id: evt.organization_id,
      event_id: eventId,
      action: 'TRIAL_EXPIRED_TO_FREE',
      from_plan: 'pro',
      to_plan: 'free',
      details: { preserved_data: true }
    })
  }

  const [usage, trialLog] = await Promise.all([
    getEventUsage(eventId),
    prisma.billingAuditLog.findFirst({
      where: {
        action: 'TRIAL_ACTIVATED',
        OR: [{ event_id: eventId }, { organization_id: evt.organization_id }]
      }
    })
  ])

  const daysRemaining =
    sub.is_trial && sub.trial_ends_at
      ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : null

  return {
    subscription: sub,
    plan_code: sub.plan_code,
    plan_name: sub.plan_name,
    limits: sub.limits_snapshot || buildPlanSnapshot(freePlan),
    allowed_modules: toArray(sub.limits_snapshot?.allowed_modules || freePlan.allowed_modules),
    usage,
    trial: {
      is_trial: Boolean(sub.is_trial),
      trial_started_at: sub.trial_started_at,
      trial_ends_at: sub.trial_ends_at,
      days_remaining: daysRemaining,
      warning:
        sub.is_trial && daysRemaining !== null && daysRemaining <= 3
          ? `Masa Free Trial Pro berakhir dalam ${daysRemaining} hari. Upgrade paket agar fitur Pro tetap terbuka.`
          : null,
      eligible: !trialLog && sub.plan_code === 'free' && !sub.is_trial
    }
  }
}

export async function assertEventModuleAllowedByPlan(eventId, moduleKey) {
  if (moduleKey === 'event_profile') return
  const ent = await ensureEventEntitlement(eventId)
  if (!ent.allowed_modules.includes(moduleKey)) {
    throw new AppError(
      `Modul "${moduleKey}" tidak termasuk dalam paket ${ent.plan_name}. Silakan aktifkan 14 Days Pro Trial atau upgrade paket event ini.`,
      403,
      'PLAN_UPGRADE_REQUIRED',
      [{ required_module: moduleKey, current_plan: ent.plan_code }]
    )
  }
}

export async function assertEventQuotaAvailable(eventId, quotaType, incrementBy = 1) {
  const ent = await ensureEventEntitlement(eventId)
  const limits = ent.limits || {}

  if (quotaType === 'participants') {
    const max = Number(limits.max_participants || 100)
    const next = ent.usage.participants_count + Number(incrementBy || 1)
    if (next > max) {
      throw new AppError(
        `Kuota peserta paket ${ent.plan_name} telah mencapai batas maksimal (${max} peserta). Upgrade paket event untuk menampung lebih banyak peserta.`,
        403,
        'QUOTA_EXCEEDED',
        [{ quota: 'participants', current: ent.usage.participants_count, max, plan: ent.plan_code }]
      )
    }
  }

  if (quotaType === 'team') {
    const max = Number(limits.max_team_members || 3)
    const next = ent.usage.team_members_count + Number(incrementBy || 1)
    if (next > max) {
      throw new AppError(
        `Kuota tim/panitia paket ${ent.plan_name} sudah penuh (${max} anggota). Upgrade paket untuk menambah panitia.`,
        403,
        'QUOTA_EXCEEDED',
        [{ quota: 'team_members', current: ent.usage.team_members_count, max, plan: ent.plan_code }]
      )
    }
  }
}

export async function assertFreeEventCreationAllowed(organizationId) {
  const freePlan = await getPlanByCode('free')
  const maxFreeEvents = Number(freePlan?.max_active_events || 1)

  if (!usePrisma()) {
    const freeActiveCount = store.events.filter((e) => {
      if (e.organization_id !== organizationId || e.deleted_at) return false
      const sub = store.eventSubscriptions.find((s) => s.event_id === e.id)
      return !sub || sub.plan_code === 'free'
    }).length
    if (freeActiveCount >= maxFreeEvents) {
      // Allow creation, or if strict Free limit enforced cleanly check paid/credits
      const hasCredits = store.bundleCredits.some((c) => c.organization_id === organizationId && c.remaining_credits > 0)
      if (!hasCredits) {
        return { warn_upgrade_needed: true, max_free_events: maxFreeEvents }
      }
    }
    return { warn_upgrade_needed: false }
  }

  const orgEvents = await prisma.event.findMany({
    where: { organization_id: organizationId, deleted_at: null },
    include: { subscription: true }
  })
  const freeCount = orgEvents.filter((e) => !e.subscription || e.subscription.plan_code === 'free').length
  if (freeCount >= maxFreeEvents) {
    const credit = await prisma.organizationBundleCredit.findFirst({
      where: { organization_id: organizationId, remaining_credits: { gt: 0 } }
    })
    if (!credit) {
      return { warn_upgrade_needed: true, max_free_events: maxFreeEvents }
    }
  }
  return { warn_upgrade_needed: false }
}

export async function activateEventTrial(eventId, user) {
  const ent = await ensureEventEntitlement(eventId)
  if (ent.subscription.plan_code !== 'free' || ent.trial.is_trial) {
    throw new AppError('Event ini sudah menggunakan paket berbayar atau trial aktif.', 409, 'TRIAL_NOT_ELIGIBLE')
  }
  if (!ent.trial.eligible) {
    throw new AppError(
      'Program 14 Days Pro Access hanya dapat digunakan satu kali per organisasi/event agar tidak disalahgunakan.',
      409,
      'TRIAL_ALREADY_USED'
    )
  }

  const proPlan = await getPlanByCode('pro')
  if (!proPlan) throw new AppError('Konfigurasi paket Pro tidak ditemukan.', 404, 'PLAN_NOT_FOUND')

  const trialDays = Math.max(1, Number(proPlan.trial_days || 14))
  const startedAt = new Date()
  const endsAt = new Date(startedAt.getTime() + trialDays * 24 * 60 * 60 * 1000)
  const snapshot = buildPlanSnapshot(proPlan)

  if (!usePrisma()) {
    Object.assign(ent.subscription, {
      plan_code: 'pro',
      plan_name: `${proPlan.name} (Trial ${trialDays} Hari)`,
      price_snapshot_idr: 0,
      limits_snapshot: snapshot,
      status: 'trialing',
      is_trial: true,
      trial_started_at: startedAt.toISOString(),
      trial_ends_at: endsAt.toISOString(),
      activated_at: startedAt.toISOString()
    })
    await recordBillingAudit({
      organization_id: ent.subscription.organization_id,
      event_id: eventId,
      actor_id: user.id,
      actor_role: user.role,
      action: 'TRIAL_ACTIVATED',
      from_plan: 'free',
      to_plan: 'pro',
      details: { trial_days: trialDays, ends_at: endsAt.toISOString() }
    })
    return ensureEventEntitlement(eventId)
  }

  await runTransaction(async (tx) => {
    await tx.eventSubscription.update({
      where: { event_id: eventId },
      data: {
        plan_code: 'pro',
        plan_name: `${proPlan.name} (Trial ${trialDays} Hari)`,
        price_snapshot_idr: 0,
        limits_snapshot: snapshot,
        status: 'trialing',
        is_trial: true,
        trial_started_at: startedAt,
        trial_ends_at: endsAt,
        activated_at: startedAt
      }
    })
    await recordBillingAudit(
      {
        organization_id: ent.subscription.organization_id,
        event_id: eventId,
        actor_id: user.id,
        actor_role: user.role,
        action: 'TRIAL_ACTIVATED',
        from_plan: 'free',
        to_plan: 'pro',
        details: { trial_days: trialDays, ends_at: endsAt.toISOString() }
      },
      tx
    )
    await tx.userNotification.create({
      data: {
        user_id: user.id,
        user_role: 'organizer',
        title: `14 Days Pro Access Aktif`,
        message: `Trial Pro 14 hari aktif hingga ${endsAt.toLocaleDateString('id-ID')}. Semua modul siap digunakan tanpa biaya.`,
        type: 'success',
        reference_type: 'event',
        reference_id: eventId
      }
    })
  })

  return ensureEventEntitlement(eventId)
}

export async function previewBillingCheckout({
  plan_code,
  bundle_id = null,
  event_id = null,
  promo_code = '',
  use_early_access = false,
  is_community = false
}) {
  let targetPlan = null
  let bundle = null
  let basePrice = 0
  let snapshot = {}

  if (bundle_id) {
    bundle = !usePrisma()
      ? store.bundlePackages.find((b) => b.id === bundle_id || b.code === bundle_id)
      : await prisma.bundlePackage.findFirst({ where: { OR: [{ id: bundle_id }, { code: bundle_id }] } })
    if (!bundle || !bundle.is_active) throw new AppError('Paket bundle tidak ditemukan atau nonaktif.', 404, 'BUNDLE_NOT_FOUND')
    targetPlan = await getPlanByCode(bundle.plan_code)
    basePrice = Number(bundle.bundle_price_idr || 0)
    snapshot = {
      type: 'bundle',
      bundle_code: bundle.code,
      bundle_name: bundle.name,
      event_quota: bundle.event_quota,
      plan_code: bundle.plan_code,
      limits: targetPlan ? buildPlanSnapshot(targetPlan) : {}
    }
  } else {
    targetPlan = await getPlanByCode(plan_code)
    if (!targetPlan || !targetPlan.is_active) throw new AppError('Paket harga tidak ditemukan.', 404, 'PLAN_NOT_FOUND')
    basePrice = Number(targetPlan.price_idr || 0)
    snapshot = buildPlanSnapshot(targetPlan)
  }

  let effectiveBase = basePrice
  let earlyAccessSaved = 0
  if (use_early_access && targetPlan && !bundle && targetPlan.early_access_price_idr != null) {
    const now = Date.now()
    const afterStart = !targetPlan.early_access_starts_at || new Date(targetPlan.early_access_starts_at).getTime() <= now
    const beforeEnd = !targetPlan.early_access_ends_at || new Date(targetPlan.early_access_ends_at).getTime() >= now
    if (afterStart && beforeEnd && targetPlan.early_access_price_idr < basePrice) {
      earlyAccessSaved = basePrice - Number(targetPlan.early_access_price_idr)
      effectiveBase = Number(targetPlan.early_access_price_idr)
    }
  }

  let discountIdr = earlyAccessSaved
  let appliedPromo = null
  const cleanPromo = String(promo_code || '').trim().toUpperCase()
  if (cleanPromo) {
    const promo = !usePrisma()
      ? store.promoCodes.find((p) => p.code.toUpperCase() === cleanPromo && p.is_active)
      : await prisma.promoCode.findFirst({ where: { code: cleanPromo, is_active: true } })
    if (!promo) throw new AppError(`Kode promo "${cleanPromo}" tidak ditemukan atau tidak aktif.`, 404, 'PROMO_NOT_FOUND')
    const nowTs = Date.now()
    if (promo.starts_at && new Date(promo.starts_at).getTime() > nowTs) {
      throw new AppError(`Kode promo "${cleanPromo}" belum memasuki masa berlaku.`, 400, 'PROMO_NOT_STARTED')
    }
    if (promo.ends_at && new Date(promo.ends_at).getTime() < nowTs) {
      throw new AppError(`Kode promo "${cleanPromo}" sudah kedaluwarsa.`, 400, 'PROMO_EXPIRED')
    }
    if (promo.max_redemptions && promo.used_count >= promo.max_redemptions) {
      throw new AppError('Kuota penggunaan kode promo ini sudah habis.', 409, 'PROMO_EXHAUSTED')
    }
    if (promo.applies_to_plan && targetPlan && promo.applies_to_plan !== targetPlan.code) {
      throw new AppError(`Kode promo ini hanya berlaku untuk paket ${promo.applies_to_plan.toUpperCase()}.`, 400, 'PROMO_PLAN_MISMATCH')
    }
    const extraDiscount =
      promo.discount_type === 'percent'
        ? Math.round((effectiveBase * Number(promo.discount_value || 0)) / 100)
        : Math.min(effectiveBase, Number(promo.discount_value || 0))
    discountIdr += extraDiscount
    appliedPromo = { code: promo.code, name: promo.name, requires_verification: promo.requires_verification, saved: extraDiscount }
  } else if (is_community && targetPlan && Number(targetPlan.community_discount_pct || 0) > 0) {
    const commDiscount = Math.round((effectiveBase * Number(targetPlan.community_discount_pct)) / 100)
    discountIdr += commDiscount
    appliedPromo = { code: 'COMMUNITY', name: `Diskon Komunitas / BEM / UKM (${targetPlan.community_discount_pct}%)`, requires_verification: true, saved: commDiscount }
  }

  let upgradeCreditIdr = 0
  let currentPlanCode = null
  if (event_id && !bundle) {
    const ent = await ensureEventEntitlement(event_id)
    currentPlanCode = ent.plan_code
    const paidSnapshot = Number(ent.subscription.price_snapshot_idr || 0)
    if (!ent.trial.is_trial && paidSnapshot > 0 && (PLAN_RANK[targetPlan.code] || 0) > (PLAN_RANK[currentPlanCode] || 0)) {
      upgradeCreditIdr = paidSnapshot
    }
  }

  const finalAmountIdr = Math.max(0, basePrice - discountIdr - upgradeCreditIdr)

  return {
    target_type: bundle ? 'bundle' : upgradeCreditIdr > 0 ? 'upgrade' : 'event_plan',
    plan_code: targetPlan?.code || bundle?.plan_code,
    plan_name: bundle ? bundle.name : targetPlan.name,
    bundle_id: bundle?.id || null,
    current_plan_code: currentPlanCode,
    base_price_idr: basePrice,
    discount_idr: discountIdr,
    upgrade_credit_idr: upgradeCreditIdr,
    final_amount_idr: finalAmountIdr,
    applied_promo: appliedPromo,
    early_access_saved_idr: earlyAccessSaved,
    plan_snapshot: snapshot
  }
}

export async function createBillingCheckout(user, payload) {
  const preview = await previewBillingCheckout(payload)
  const orgId = payload.organization_id
  if (!orgId) throw new AppError('Organisasi wajib dipilih.', 400, 'ORG_REQUIRED')

  const invoiceNumber = generateInvoiceNumber()
  const isFree = preview.final_amount_idr === 0
  const requiresManualVerify = Boolean(preview.applied_promo?.requires_verification)
  const autoActivate = isFree && !requiresManualVerify
  const txStatus = autoActivate ? 'Paid' : 'Pending'
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

  if (!usePrisma()) {
    const txRecord = {
      id: 'btx-' + Date.now(),
      invoice_number: invoiceNumber,
      organization_id: orgId,
      organizer_id: user.id,
      event_id: payload.event_id || null,
      target_type: preview.target_type,
      plan_code: preview.plan_code,
      plan_name: preview.plan_name,
      bundle_id: preview.bundle_id,
      promo_code: payload.promo_code ? String(payload.promo_code).trim().toUpperCase() : null,
      community_org_proof: payload.community_org_proof || null,
      payment_method: isFree ? 'free' : payload.payment_method || 'payment_gateway',
      payment_provider: isFree ? null : 'midtrans',
      payment_token: null,
      payment_redirect_url: null,
      payment_reference: null,
      paid_at: null,
      payment_metadata: {},
      base_price_idr: preview.base_price_idr,
      discount_idr: preview.discount_idr,
      upgrade_credit_idr: preview.upgrade_credit_idr,
      final_amount_idr: preview.final_amount_idr,
      plan_snapshot: preview.plan_snapshot,
      payment_proof_url: null,
      payment_notes: payload.payment_notes || null,
      admin_notes: null,
      verified_by: null,
      verified_at: autoActivate ? new Date().toISOString() : null,
      status: txStatus,
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
      action: 'CHECKOUT_CREATED',
      from_plan: preview.current_plan_code,
      to_plan: preview.plan_code,
      details: { invoice_number: invoiceNumber, amount: preview.final_amount_idr, status: txStatus }
    })
    if (autoActivate) {
      await verifyBillingTransactionInternal(txRecord.id, { id: 'system', role: 'admin' }, { status: 'Paid', admin_notes: 'Otomatis aktif (Rp 0).' })
    }
    return {
      transaction: store.billingTransactions.find((t) => t.id === txRecord.id) || txRecord,
      admin_whatsapp: env.adminWhatsappNumber || '6287897192601',
      manual_payment_instructions: MANUAL_PAYMENT_INSTRUCTIONS
    }
  }

  const created = await runTransaction(async (tx) => {
    const rec = await tx.billingTransaction.create({
      data: {
        invoice_number: invoiceNumber,
        organization_id: orgId,
        organizer_id: user.id,
        event_id: payload.event_id || null,
        target_type: preview.target_type,
        plan_code: preview.plan_code,
        plan_name: preview.plan_name,
        bundle_id: preview.bundle_id,
        promo_code: payload.promo_code ? String(payload.promo_code).trim().toUpperCase() : null,
        community_org_proof: payload.community_org_proof || null,
        payment_method: isFree ? 'free' : payload.payment_method || 'payment_gateway',
        payment_provider: isFree ? null : 'midtrans',
        base_price_idr: preview.base_price_idr,
        discount_idr: preview.discount_idr,
        upgrade_credit_idr: preview.upgrade_credit_idr,
        final_amount_idr: preview.final_amount_idr,
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
        action: 'CHECKOUT_CREATED',
        from_plan: preview.current_plan_code,
        to_plan: preview.plan_code,
        details: { invoice_number: invoiceNumber, amount: preview.final_amount_idr }
      },
      tx
    )
    return rec
  })

  if (autoActivate) {
    const verified = await adminVerifyBillingTransaction(created.id, { id: user.id, role: 'admin' }, { status: 'Paid', admin_notes: 'Aktivasi otomatis (Rp 0).' })
    return {
      transaction: verified,
      admin_whatsapp: env.adminWhatsappNumber || '6287897192601',
      manual_payment_instructions: MANUAL_PAYMENT_INSTRUCTIONS
    }
  }

  return {
    transaction: created,
    admin_whatsapp: env.adminWhatsappNumber || '6287897192601',
    manual_payment_instructions: MANUAL_PAYMENT_INSTRUCTIONS
  }
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
  const clean = String(identifier || '').trim()
  if (!clean) throw new AppError('Transaksi billing tidak ditemukan.', 404, 'TX_NOT_FOUND')
  if (!usePrisma()) {
    const tx = store.billingTransactions.find(
      (t) =>
        t.id === clean ||
        t.invoice_number === clean ||
        t.payment_metadata?.midtrans_order_id === clean
    )
    if (!tx) throw new AppError('Transaksi billing tidak ditemukan.', 404, 'TX_NOT_FOUND')
    return tx
  }
  const tx = await prisma.billingTransaction.findFirst({
    where: {
      OR: [{ id: clean }, { invoice_number: clean }]
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
