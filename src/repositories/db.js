import crypto from 'node:crypto'
import { prisma, isDatabaseConfigured, runTransaction } from '../config/prisma.js'
import { store, MODULE_CATALOG, slugify } from './store.js'
import * as pricingDb from './pricing.db.js'
import {
  generateOrderNumber,
  generateQrToken,
  generateTicketCode,
  hashQrToken
} from '../utils/crypto.js'
import { parseTicketQrPayload } from '../utils/qrcode.js'
import { AppError } from '../utils/response.js'

export const ALL_EVENT_PERMISSIONS = [
  'View Event',
  'Edit Event',
  'Manage Timeline',
  'Manage Tickets',
  'View Participants',
  'Manage Check-in',
  'View Finance',
  'Manage Team'
]

export function usePrisma() {
  return Boolean(isDatabaseConfigured && prisma)
}

function asArray(val, fallback = []) {
  return Array.isArray(val) ? val : fallback
}

function addDaysIso(dateStr, delta) {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}

// =============================================================================
// USERS (SEPARATED TABLES: CUSTOMERS, ORGANIZERS, ADMINS), AUTH & NOTIFICATIONS
// =============================================================================
function roleDelegate(role, client = prisma) {
  if (role === 'admin') return client.admin
  if (role === 'organizer') return client.organizer
  return client.customer
}

function getOrderedRoles(roleHint = null) {
  const all = ['customer', 'organizer', 'admin']
  if (roleHint && all.includes(roleHint)) {
    return [roleHint, ...all.filter((r) => r !== roleHint)]
  }
  return all
}

export async function findUserById(id, roleHint = null) {
  if (!id) return null
  if (!usePrisma()) return store.users.find((u) => u.id === id) || null
  for (const role of getOrderedRoles(roleHint)) {
    const found = await roleDelegate(role).findUnique({ where: { id } })
    if (found) return { ...found, role }
  }
  return null
}

export async function findUserByEmail(email, roleHint = null) {
  if (!email) return null
  if (!usePrisma()) {
    const list = roleHint
      ? store.users.filter((u) => u.role === roleHint)
      : store.users
    return list.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null
  }
  const roles = roleHint ? [roleHint] : ['customer', 'organizer', 'admin']
  for (const role of roles) {
    const found = await roleDelegate(role).findFirst({
      where: { email: { equals: email, mode: 'insensitive' } }
    })
    if (found) return { ...found, role }
  }
  return null
}

export async function findUserByIdOrEmail(id, email, roleHint = null) {
  if (!usePrisma()) {
    return (
      store.users.find(
        (u) =>
          (!roleHint || u.role === roleHint) &&
          ((id && u.id === id) || (email && u.email?.toLowerCase() === email.toLowerCase()))
      ) ||
      store.users.find(
        (u) => (id && u.id === id) || (email && u.email?.toLowerCase() === email.toLowerCase())
      ) ||
      null
    )
  }
  for (const role of getOrderedRoles(roleHint)) {
    const found = await roleDelegate(role).findFirst({
      where: {
        OR: [
          ...(id ? [{ id }] : []),
          ...(email ? [{ email: { equals: email, mode: 'insensitive' } }] : [])
        ]
      }
    })
    if (found) return { ...found, role }
  }
  return null
}

export async function upsertUser(payload) {
  const targetRole = ['customer', 'organizer', 'admin'].includes(payload.role)
    ? payload.role
    : 'customer'

  if (!usePrisma()) {
    const idx = store.users.findIndex(
      (u) => u.id === payload.id || u.email?.toLowerCase() === payload.email?.toLowerCase()
    )
    if (idx === -1) {
      const next = { ...payload, role: targetRole }
      store.users.push(next)
      return next
    }
    store.users[idx] = { ...store.users[idx], ...payload, role: payload.role ?? store.users[idx].role }
    return store.users[idx]
  }

  const delegate = roleDelegate(targetRole)
  const existing = await delegate.findFirst({
    where: {
      OR: [
        ...(payload.id ? [{ id: payload.id }] : []),
        ...(payload.email ? [{ email: { equals: payload.email, mode: 'insensitive' } }] : [])
      ]
    }
  })

  if (existing) {
    const updated = await delegate.update({
      where: { id: existing.id },
      data: {
        full_name: payload.full_name ?? existing.full_name,
        username: payload.username ?? existing.username,
        password_hash: payload.password_hash ?? existing.password_hash,
        avatar_url: payload.avatar_url ?? existing.avatar_url,
        phone: payload.phone ?? existing.phone,
        bio: payload.bio ?? existing.bio,
        provider: payload.provider ?? existing.provider,
        ...(payload.email_verified !== undefined ? { email_verified: Boolean(payload.email_verified) } : {}),
        ...(payload.otp_code_hash !== undefined ? { otp_code_hash: payload.otp_code_hash } : {}),
        ...(payload.otp_expires_at !== undefined ? { otp_expires_at: payload.otp_expires_at } : {}),
        ...(payload.otp_attempts !== undefined ? { otp_attempts: payload.otp_attempts } : {}),
        ...(targetRole === 'organizer' && payload.subscription_plan !== undefined
          ? { subscription_plan: payload.subscription_plan }
          : {}),
        ...(targetRole === 'organizer' && payload.subscription_status !== undefined
          ? { subscription_status: payload.subscription_status }
          : {}),
        ...(targetRole === 'organizer' && payload.subscription_expires_at !== undefined
          ? { subscription_expires_at: payload.subscription_expires_at }
          : {})
      }
    })
    return { ...updated, role: targetRole }
  }

  const created = await delegate.create({
    data: {
      id: payload.id,
      full_name: payload.full_name,
      username: payload.username || null,
      email: payload.email,
      password_hash: payload.password_hash || null,
      avatar_url: payload.avatar_url || null,
      phone: payload.phone || null,
      bio: payload.bio || null,
      provider: payload.provider || 'email',
      email_verified: payload.email_verified !== undefined ? Boolean(payload.email_verified) : true,
      otp_code_hash: payload.otp_code_hash || null,
      otp_expires_at: payload.otp_expires_at || null,
      otp_attempts: payload.otp_attempts ?? 0,
      is_suspended: Boolean(payload.is_suspended),
      ...(targetRole === 'organizer'
        ? {
            subscription_plan: payload.subscription_plan || 'free_trial',
            subscription_status: payload.subscription_status || 'trialing',
            subscription_expires_at:
              payload.subscription_expires_at !== undefined
                ? payload.subscription_expires_at
                : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          }
        : {})
    }
  })
  return { ...created, role: targetRole }
}

export async function setUserOtp(userId, { otpCodeHash, otpExpiresAt }, roleHint = null) {
  if (!usePrisma()) {
    const user = store.users.find((u) => u.id === userId)
    if (!user) throw new AppError('User tidak ditemukan.', 404, 'USER_NOT_FOUND')
    user.otp_code_hash = otpCodeHash
    user.otp_expires_at = otpExpiresAt
    user.otp_attempts = 0
    return user
  }
  const existing = await findUserById(userId, roleHint)
  if (!existing) throw new AppError('User tidak ditemukan.', 404, 'USER_NOT_FOUND')
  const updated = await roleDelegate(existing.role).update({
    where: { id: userId },
    data: {
      otp_code_hash: otpCodeHash,
      otp_expires_at: otpExpiresAt,
      otp_attempts: 0
    }
  })
  return { ...updated, role: existing.role }
}

export async function incrementOtpAttempts(userId, roleHint = null) {
  if (!usePrisma()) {
    const user = store.users.find((u) => u.id === userId)
    if (user) user.otp_attempts = (user.otp_attempts || 0) + 1
    return user
  }
  const existing = await findUserById(userId, roleHint)
  if (!existing) return null
  const updated = await roleDelegate(existing.role).update({
    where: { id: userId },
    data: { otp_attempts: { increment: 1 } }
  })
  return { ...updated, role: existing.role }
}

export async function markUserEmailVerified(userId, roleHint = null) {
  if (!usePrisma()) {
    const user = store.users.find((u) => u.id === userId)
    if (!user) throw new AppError('User tidak ditemukan.', 404, 'USER_NOT_FOUND')
    user.email_verified = true
    user.otp_code_hash = null
    user.otp_expires_at = null
    user.otp_attempts = 0
    return user
  }
  const existing = await findUserById(userId, roleHint)
  if (!existing) throw new AppError('User tidak ditemukan.', 404, 'USER_NOT_FOUND')
  const updated = await roleDelegate(existing.role).update({
    where: { id: userId },
    data: {
      email_verified: true,
      otp_code_hash: null,
      otp_expires_at: null,
      otp_attempts: 0
    }
  })
  return { ...updated, role: existing.role }
}

export async function updateUnverifiedEmail(userId, oldEmail, newEmail, { otpCodeHash, otpExpiresAt }, roleHint = null) {
  if (!usePrisma()) {
    const user = store.users.find((u) => u.id === userId)
    if (!user) throw new AppError('User tidak ditemukan.', 404, 'USER_NOT_FOUND')
    user.email = newEmail
    user.email_verified = false
    user.otp_code_hash = otpCodeHash
    user.otp_expires_at = otpExpiresAt
    user.otp_attempts = 0
    store.organizations.forEach((o) => {
      if (o.created_by === userId && o.email?.toLowerCase() === oldEmail.toLowerCase()) {
        o.email = newEmail
      }
      o.members?.forEach((m) => {
        if (m.user_id === userId) m.email = newEmail
      })
    })
    return user
  }

  const existing = await findUserById(userId, roleHint)
  if (!existing) throw new AppError('User tidak ditemukan.', 404, 'USER_NOT_FOUND')

  return runTransaction(async (tx) => {
    const updatedUser = await roleDelegate(existing.role, tx).update({
      where: { id: userId },
      data: {
        email: newEmail,
        email_verified: false,
        otp_code_hash: otpCodeHash,
        otp_expires_at: otpExpiresAt,
        otp_attempts: 0
      }
    })
    if (existing.role === 'organizer') {
      await tx.organization.updateMany({
        where: { created_by: userId, email: { equals: oldEmail, mode: 'insensitive' } },
        data: { email: newEmail }
      })
      await tx.organizationMember.updateMany({
        where: { user_id: userId, email: { equals: oldEmail, mode: 'insensitive' } },
        data: { email: newEmail }
      })
    }
    return { ...updatedUser, role: existing.role }
  })
}

export async function updateUserProfile(user, patch) {
  if (!usePrisma()) {
    const idx = store.users.findIndex((u) => u.id === user.id)
    if (idx === -1) {
      const created = { id: user.id, email: user.email, role: user.role, ...patch }
      store.users.push(created)
      return created
    }
    store.users[idx] = { ...store.users[idx], ...patch }
    return store.users[idx]
  }
  const targetRole = user.role || 'customer'
  const updated = await roleDelegate(targetRole).upsert({
    where: { id: user.id },
    update: patch,
    create: {
      id: user.id,
      email: user.email,
      full_name: patch.full_name || user.full_name || user.email.split('@')[0],
      ...patch
    }
  })
  return { ...updated, role: targetRole }
}

export async function listNotifications(userId) {
  if (!usePrisma()) return store.notifications.filter((n) => n.user_id === userId)
  return prisma.userNotification.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' }
  })
}

export async function markNotificationRead(id, userId) {
  if (!usePrisma()) {
    const notif = store.notifications.find((n) => n.id === id && n.user_id === userId)
    if (!notif) throw new AppError('Notifikasi tidak ditemukan.', 404, 'NOT_FOUND')
    notif.is_read = true
    return notif
  }
  const existing = await prisma.userNotification.findFirst({ where: { id, user_id: userId } })
  if (!existing) throw new AppError('Notifikasi tidak ditemukan.', 404, 'NOT_FOUND')
  return prisma.userNotification.update({ where: { id }, data: { is_read: true } })
}

// =============================================================================
// ORGANIZATIONS
// =============================================================================
export async function listOrganizationsForUser(user) {
  if (!usePrisma()) {
    if (user.role === 'admin') return store.organizations
    return store.organizations.filter(
      (o) =>
        o.created_by === user.id ||
        o.members.some((m) => m.user_id === user.id || m.email?.toLowerCase() === user.email?.toLowerCase())
    )
  }
  if (user.role === 'admin') {
    return prisma.organization.findMany({
      where: { deleted_at: null },
      include: { members: true },
      orderBy: { created_at: 'desc' }
    })
  }
  return prisma.organization.findMany({
    where: {
      deleted_at: null,
      OR: [
        { created_by: user.id },
        {
          members: {
            some: {
              OR: [
                { user_id: user.id },
                ...(user.email ? [{ email: { equals: user.email, mode: 'insensitive' } }] : [])
              ]
            }
          }
        }
      ]
    },
    include: { members: true },
    orderBy: { created_at: 'desc' }
  })
}

export async function findOrganizationById(id) {
  if (!usePrisma()) {
    return store.organizations.find((o) => o.id === id) || null
  }
  return prisma.organization.findFirst({
    where: { id, deleted_at: null },
    include: { members: true }
  })
}

export async function isOrgMember(orgId, user) {
  const org = await findOrganizationById(orgId)
  if (!org) throw new AppError('Organisasi tidak ditemukan.', 404, 'ORG_NOT_FOUND')
  if (user.role === 'admin') return { org, allowed: true }
  const isMember = (org.members || []).some(
    (m) => (m.user_id === user.id || m.email?.toLowerCase() === user.email?.toLowerCase()) && m.status === 'active'
  )
  return { org, allowed: isMember || org.created_by === user.id }
}

export async function createOrganization(data, user) {
  const slug = data.slug || slugify(data.name)
  if (!usePrisma()) {
    if (store.organizations.some((o) => o.slug === slug)) {
      throw new AppError('Slug organisasi sudah digunakan.', 409, 'DUPLICATE_SLUG')
    }
    const org = {
      id: 'org-' + Date.now(),
      ...data,
      slug,
      logo_url: data.logo_url || '',
      cover_url: data.cover_url || '',
      verification_status: 'pending',
      created_by: user.id,
      members: [
        { id: 'om-' + Date.now(), user_id: user.id, name: user.full_name, email: user.email, role: 'Owner', status: 'active' }
      ]
    }
    store.organizations.unshift(org)
    return org
  }

  return prisma.organization.create({
    data: {
      name: data.name,
      slug,
      description: data.description || null,
      logo_url: data.logo_url || null,
      cover_url: data.cover_url || null,
      email: data.email,
      phone: data.phone || null,
      website: data.website || null,
      verification_status: 'pending',
      created_by: user.id,
      members: {
        create: {
          user_id: user.id,
          name: user.full_name,
          email: user.email,
          role: 'Owner',
          status: 'active'
        }
      }
    },
    include: { members: true }
  })
}

export async function updateOrganization(id, patch) {
  if (!usePrisma()) {
    const org = store.organizations.find((o) => o.id === id)
    if (!org) throw new AppError('Organisasi tidak ditemukan.', 404, 'ORG_NOT_FOUND')
    Object.assign(org, patch)
    return org
  }
  return prisma.organization.update({
    where: { id },
    data: patch,
    include: { members: true }
  })
}

export async function deleteOrganization(id) {
  if (!usePrisma()) {
    const idx = store.organizations.findIndex((o) => o.id === id)
    if (idx === -1) throw new AppError('Organisasi tidak ditemukan.', 404, 'ORG_NOT_FOUND')
    store.organizations.splice(idx, 1)
    return { id }
  }
  await prisma.organization.update({ where: { id }, data: { deleted_at: new Date() } })
  return { id }
}

export async function createOrgVerification(orgId, userId, documents = []) {
  if (!usePrisma()) {
    const ver = {
      id: 'ver-' + Date.now(),
      organization_id: orgId,
      submitted_by: userId,
      verification_status: 'pending',
      documents,
      review_notes: ''
    }
    store.verifications.unshift(ver)
    return ver
  }
  return prisma.organizerVerification.create({
    data: {
      organization_id: orgId,
      submitted_by: userId,
      verification_status: 'pending',
      documents
    }
  })
}

export async function addOrganizationMember(orgId, { email, role }) {
  if (!usePrisma()) {
    const org = store.organizations.find((o) => o.id === orgId)
    const member = {
      id: 'om-' + Date.now(),
      user_id: 'usr-' + Date.now(),
      name: email.split('@')[0],
      email,
      role,
      status: 'active'
    }
    org.members.push(member)
    return member
  }
  const existingUser = await findUserByEmail(email)
  return prisma.organizationMember.create({
    data: {
      organization_id: orgId,
      user_id: existingUser?.id || null,
      name: existingUser?.full_name || email.split('@')[0],
      email,
      role,
      status: 'active'
    }
  })
}

export async function updateOrganizationMember(orgId, memberId, patch) {
  if (!usePrisma()) {
    const org = store.organizations.find((o) => o.id === orgId)
    const member = org.members.find((m) => m.id === memberId)
    if (!member) throw new AppError('Anggota tidak ditemukan.', 404, 'MEMBER_NOT_FOUND')
    if (patch.role) member.role = patch.role
    return member
  }
  return prisma.organizationMember.update({
    where: { id: memberId },
    data: { ...(patch.role ? { role: patch.role } : {}) }
  })
}

export async function removeOrganizationMember(orgId, memberId) {
  if (!usePrisma()) {
    const org = store.organizations.find((o) => o.id === orgId)
    org.members = org.members.filter((m) => m.id !== memberId)
    return { id: memberId }
  }
  await prisma.organizationMember.delete({ where: { id: memberId } })
  return { id: memberId }
}

// =============================================================================
// EVENTS, MODULES & PERMISSIONS
// =============================================================================
export async function getUserEventPermissions(user, eventId) {
  if (!user) return []
  if (user.role === 'admin') return ALL_EVENT_PERMISSIONS

  if (!usePrisma()) {
    const evt = store.events.find((e) => e.id === eventId && !e.deleted_at)
    if (!evt) return []
    if (evt.created_by === user.id) return ALL_EVENT_PERMISSIONS
    const org = store.organizations.find((o) => o.id === evt.organization_id)
    if (
      org &&
      (org.created_by === user.id ||
        org.members?.some(
          (m) => (m.user_id === user.id || m.email === user.email) && ['Owner', 'Admin'].includes(m.role)
        ))
    ) {
      return ALL_EVENT_PERMISSIONS
    }
    const member = store.teamMembers.find(
      (m) =>
        m.event_id === eventId &&
        ((m.user_id && m.user_id === user.id) || m.email?.toLowerCase() === user.email?.toLowerCase())
    )
    if (!member) return []
    if (member.role === 'Owner') return ALL_EVENT_PERMISSIONS
    return member.permissions || ['View Event']
  }

  const evt = await prisma.event.findFirst({
    where: { id: eventId, deleted_at: null },
    include: {
      organization: { include: { members: true } },
      teamMembers: true
    }
  })
  if (!evt) return []
  if (evt.created_by === user.id) return ALL_EVENT_PERMISSIONS

  const org = evt.organization
  if (
    org &&
    (org.created_by === user.id ||
      org.members.some(
        (m) =>
          (m.user_id === user.id || m.email?.toLowerCase() === user.email?.toLowerCase()) &&
          ['Owner', 'Admin'].includes(m.role)
      ))
  ) {
    return ALL_EVENT_PERMISSIONS
  }

  const member = evt.teamMembers.find(
    (m) => (m.user_id && m.user_id === user.id) || m.email?.toLowerCase() === user.email?.toLowerCase()
  )
  if (!member) return []
  if (member.role === 'Owner') return ALL_EVENT_PERMISSIONS
  return asArray(member.permissions, ['View Event'])
}

export async function isModuleEnabled(eventId, moduleKey) {
  if (!usePrisma()) return store.isModuleEnabled(eventId, moduleKey)
  const evt = await prisma.event.findFirst({ where: { id: eventId, deleted_at: null } })
  if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')
  return asArray(evt.enabled_modules).includes(moduleKey)
}

function formatPrismaEvent(evt, permissions = undefined) {
  return {
    ...evt,
    gallery: asArray(evt.gallery),
    speakers: asArray(evt.speakers),
    enabled_modules: asArray(evt.enabled_modules),
    ...(permissions !== undefined ? { my_permissions: permissions } : {})
  }
}

export async function getEventOrThrow(eventId) {
  if (!usePrisma()) return store.getEvent(eventId)
  const evt = await prisma.event.findFirst({
    where: { id: eventId, deleted_at: null },
    include: { organization: true, ticketTypes: true, schedules: true }
  })
  if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')
  return {
    ...formatPrismaEvent(evt),
    ticket_types: evt.ticketTypes,
    schedules: evt.schedules
  }
}

export async function listEventsForUser(user, { organization_id, status } = {}) {
  if (!usePrisma()) {
    let list = store.events.filter((e) => !e.deleted_at)
    if (organization_id) list = list.filter((e) => e.organization_id === organization_id)
    if (status) list = list.filter((e) => e.status === status)
    const enriched = []
    for (const evt of list) {
      const perms = user ? await getUserEventPermissions(user, evt.id) : ALL_EVENT_PERMISSIONS
      if (user && user.role !== 'admin' && !perms.includes('View Event')) continue
      enriched.push({
        ...evt,
        organization: store.organizations.find((o) => o.id === evt.organization_id) || null,
        ticket_types: store.ticketTypes.filter((t) => t.event_id === evt.id),
        schedules: store.schedules.filter((s) => s.event_id === evt.id),
        speakers: evt.speakers || [],
        my_permissions: perms
      })
    }
    return enriched
  }

  const events = await prisma.event.findMany({
    where: {
      deleted_at: null,
      ...(organization_id ? { organization_id } : {}),
      ...(status ? { status } : {})
    },
    include: { organization: true, ticketTypes: true, schedules: true },
    orderBy: { created_at: 'desc' }
  })

  const results = []
  for (const evt of events) {
    const perms = user ? await getUserEventPermissions(user, evt.id) : ALL_EVENT_PERMISSIONS
    if (user && user.role !== 'admin' && !perms.includes('View Event')) continue
    results.push({
      ...formatPrismaEvent(evt, perms),
      ticket_types: evt.ticketTypes,
      schedules: evt.schedules
    })
  }
  return results
}

export async function getEnrichedEvent(eventId, user = null) {
  if (!usePrisma()) {
    const evt = store.getEvent(eventId)
    const [perms, entitlement] = await Promise.all([
      user ? getUserEventPermissions(user, evt.id) : Promise.resolve(undefined),
      pricingDb.ensureEventEntitlement(evt.id)
    ])
    return {
      ...evt,
      organization: store.organizations.find((o) => o.id === evt.organization_id) || null,
      ticket_types: store.ticketTypes.filter((t) => t.event_id === evt.id),
      schedules: store.schedules.filter((s) => s.event_id === evt.id),
      speakers: evt.speakers || [],
      entitlement,
      ...(perms !== undefined ? { my_permissions: perms } : {})
    }
  }
  const evt = await getEventOrThrow(eventId)
  const [perms, entitlement] = await Promise.all([
    user ? getUserEventPermissions(user, evt.id) : Promise.resolve(undefined),
    pricingDb.ensureEventEntitlement(evt.id)
  ])
  return { ...evt, entitlement, ...(perms !== undefined ? { my_permissions: perms } : {}) }
}

export async function createEvent(data, user) {
  const slug = data.slug || slugify(data.title) + '-' + Math.floor(100 + Math.random() * 900)
  // Default new events start on FREE plan (event_profile, timeline, team active; paid modules locked until Trial/Upgrade)
  const freePlan = await pricingDb.getPlanByCode('free')
  const defaultModules = Array.isArray(freePlan?.allowed_modules) && freePlan.allowed_modules.length
    ? [...freePlan.allowed_modules]
    : ['event_profile', 'timeline', 'team']
  if (!usePrisma()) {
    const evt = {
      id: 'evt-' + Date.now(),
      ...data,
      slug,
      status: 'Draft',
      publication_status: 'Unpublished',
      is_featured: false,
      enabled_modules: defaultModules,
      created_by: user.id,
      deleted_at: null
    }
    store.events.unshift(evt)
    await pricingDb.ensureEventEntitlement(evt.id)
    return getEnrichedEvent(evt.id, user)
  }

  const isOrganizerRow = await prisma.organizer.findUnique({ where: { id: user.id }, select: { id: true } })
  const createdById = isOrganizerRow ? user.id : null

  const created = await prisma.event.create({
    data: {
      organization_id: data.organization_id,
      title: data.title,
      slug,
      description: data.description || null,
      category_id: data.category_id || null,
      category: data.category || null,
      poster_url: data.poster_url || null,
      banner_url: data.banner_url || null,
      gallery: data.gallery || [],
      location_type: data.location_type || 'offline',
      location_name: data.location_name || null,
      address: data.address || null,
      online_url: data.online_url || null,
      start_at: data.start_at,
      end_at: data.end_at,
      timezone: data.timezone || 'Asia/Jakarta',
      capacity: Number(data.capacity || 0),
      status: 'Draft',
      publication_status: 'Unpublished',
      visibility: data.visibility || 'public',
      enabled_modules: defaultModules,
      created_by: createdById
    }
  })
  await pricingDb.ensureEventEntitlement(created.id)
  return getEnrichedEvent(created.id, user)
}

export async function updateEvent(eventId, patch, schedules) {
  if (!usePrisma()) {
    const evt = store.getEvent(eventId)
    Object.assign(evt, patch)
    if (Array.isArray(schedules)) {
      store.schedules = store.schedules.filter((s) => s.event_id !== evt.id)
      const mapped = schedules.map((s, idx) => ({
        id: s.id || `sch-${Date.now()}-${idx}`,
        event_id: evt.id,
        date: s.date || (evt.start_at ? evt.start_at.slice(0, 10) : '2026-12-12'),
        ...s
      }))
      store.schedules.push(...mapped)
    }
    return getEnrichedEvent(evt.id)
  }

  await runTransaction(async (tx) => {
    const evt = await tx.event.findFirst({ where: { id: eventId, deleted_at: null } })
    if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')

    await tx.event.update({ where: { id: eventId }, data: patch })

    if (Array.isArray(schedules)) {
      await tx.eventSchedule.deleteMany({ where: { event_id: eventId } })
      if (schedules.length > 0) {
        await tx.eventSchedule.createMany({
          data: schedules.map((s, idx) => ({
            event_id: eventId,
            title: s.title,
            description: s.description || null,
            date: s.date || (evt.start_at ? evt.start_at.slice(0, 10) : '2026-12-12'),
            start_time: s.start_time,
            end_time: s.end_time,
            location: s.location || 'Main Stage',
            pic: s.pic || null,
            visibility: s.visibility || 'public',
            sort_order: idx
          }))
        })
      }
    }
  })

  return getEnrichedEvent(eventId)
}

export async function softDeleteEvent(eventId) {
  if (!usePrisma()) {
    const evt = store.getEvent(eventId)
    evt.deleted_at = new Date().toISOString()
    return { id: evt.id }
  }
  await prisma.event.update({ where: { id: eventId }, data: { deleted_at: new Date() } })
  return { id: eventId }
}

export async function duplicateEvent(eventId, user) {
  if (!usePrisma()) {
    const source = store.getEvent(eventId)
    const copy = {
      ...structuredClone(source),
      id: 'evt-' + Date.now(),
      title: `${source.title} (Copy)`,
      slug: `${source.slug}-copy-${Math.floor(100 + Math.random() * 900)}`,
      status: 'Draft',
      publication_status: 'Unpublished',
      created_by: user.id
    }
    store.events.unshift(copy)
    return getEnrichedEvent(copy.id, user)
  }

  const source = await prisma.event.findFirst({ where: { id: eventId, deleted_at: null } })
  if (!source) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')
  const created = await prisma.event.create({
    data: {
      organization_id: source.organization_id,
      title: `${source.title} (Copy)`,
      slug: `${source.slug}-copy-${Math.floor(100 + Math.random() * 900)}`,
      description: source.description,
      category_id: source.category_id,
      category: source.category,
      poster_url: source.poster_url,
      banner_url: source.banner_url,
      gallery: source.gallery || [],
      speakers: source.speakers || [],
      location_type: source.location_type,
      location_name: source.location_name,
      address: source.address,
      online_url: source.online_url,
      start_at: source.start_at,
      end_at: source.end_at,
      timezone: source.timezone,
      capacity: source.capacity,
      status: 'Draft',
      publication_status: 'Unpublished',
      visibility: source.visibility,
      enabled_modules: source.enabled_modules || [],
      created_by: user.id
    }
  })
  return getEnrichedEvent(created.id, user)
}

export async function toggleEventModule(eventId, moduleKey, isEnabled, userId) {
  if (isEnabled) {
    await pricingDb.assertEventModuleAllowedByPlan(eventId, moduleKey)
  }
  if (!usePrisma()) return store.toggleModule(eventId, moduleKey, isEnabled, userId)

  const evt = await prisma.event.findFirst({ where: { id: eventId, deleted_at: null } })
  if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')

  const mod = MODULE_CATALOG.find((m) => m.key === moduleKey)
  if (!mod) throw new AppError('Modul tidak valid.', 400, 'INVALID_MODULE')
  if (mod.isCore && !isEnabled) {
    throw new AppError('Event Profile adalah modul wajib dan tidak dapat dinonaktifkan.', 400, 'CORE_MODULE_REQUIRED')
  }

  let enabled = [...asArray(evt.enabled_modules)]
  if (isEnabled) {
    const missingDeps = mod.dependsOn.filter((dep) => !enabled.includes(dep))
    if (missingDeps.length > 0) {
      throw new AppError(
        `Modul ${mod.name} membutuhkan modul berikut aktif terlebih dahulu: ${missingDeps.join(', ')}`,
        400,
        'MODULE_DEPENDENCY_UNMET'
      )
    }
    if (!enabled.includes(moduleKey)) enabled.push(moduleKey)
  } else {
    const dependents = MODULE_CATALOG.filter((m) => m.dependsOn.includes(moduleKey)).map((m) => m.key)
    enabled = enabled.filter((k) => k !== moduleKey && !dependents.includes(k))
  }

  const orgActor = userId
    ? await prisma.organizer.findUnique({ where: { id: userId }, select: { id: true } })
    : null

  await prisma.$transaction([
    prisma.event.update({ where: { id: eventId }, data: { enabled_modules: enabled } }),
    prisma.activityLog.create({
      data: {
        organization_id: evt.organization_id,
        event_id: evt.id,
        user_id: orgActor?.id || null,
        action: isEnabled ? 'MODULE_ENABLED' : 'MODULE_DISABLED',
        entity_type: 'event_module',
        metadata: { moduleKey }
      }
    })
  ])
  return enabled
}

export async function setEventModules(eventId, requestedModules) {
  const requested = new Set(requestedModules)
  requested.add('event_profile')
  if ((requested.has('participants') || requested.has('check_in')) && !requested.has('ticketing')) {
    throw new AppError('Modul participants dan check_in membutuhkan modul ticketing aktif.', 400, 'MODULE_DEPENDENCY_UNMET')
  }
  const enabled = [...requested]
  if (!usePrisma()) {
    const evt = store.getEvent(eventId)
    evt.enabled_modules = enabled
    return enabled
  }
  await prisma.event.update({ where: { id: eventId }, data: { enabled_modules: enabled } })
  return enabled
}

// =============================================================================
// TEAM & INVITES
// =============================================================================
export async function listTeamMembers(eventId) {
  if (!usePrisma()) return store.teamMembers.filter((m) => m.event_id === eventId)
  return prisma.teamMember.findMany({ where: { event_id: eventId } })
}

export async function createTeamInvite(eventId, data, inviterUser) {
  const evt = await getEventOrThrow(eventId)
  await pricingDb.assertEventQuotaAvailable(eventId, 'team', 1)
  const defaultPerms = data.role === 'Staff'
    ? ['View Event', 'Manage Check-in']
    : data.role === 'Owner'
      ? [...ALL_EVENT_PERMISSIONS]
      : ['View Event', 'Edit Event', 'Manage Timeline', 'View Participants']

  const permissions = Array.isArray(data.permissions) && data.permissions.length
    ? [...new Set(['View Event', ...data.permissions])]
    : defaultPerms

  const inviteToken = crypto.randomBytes(24).toString('hex')
  const name = data.name || data.email.split('@')[0]

  if (!usePrisma()) {
    const member = {
      id: 'tm-' + Date.now(),
      event_id: eventId,
      name,
      email: data.email,
      role: data.role,
      department: data.department,
      permissions,
      status: 'Pending',
      invite_token: inviteToken,
      invited_at: new Date().toISOString()
    }
    store.teamMembers.push(member)
    store.teamInvites.push({
      id: 'inv-' + Date.now(),
      token: inviteToken,
      member_id: member.id,
      event_id: eventId,
      event_title: evt.title,
      email: data.email,
      name: member.name,
      role: member.role,
      department: member.department,
      permissions,
      inviter_name: inviterUser?.full_name || 'Organizer',
      status: 'Pending',
      created_at: new Date().toISOString()
    })
    return { evt, member, inviteToken, permissions }
  }

  const member = await prisma.$transaction(async (tx) => {
    const createdMember = await tx.teamMember.create({
      data: {
        event_id: eventId,
        name,
        email: data.email,
        role: data.role,
        department: data.department,
        permissions,
        status: 'Pending',
        invite_token: inviteToken,
        invited_at: new Date()
      }
    })
    await tx.teamInvite.create({
      data: {
        token: inviteToken,
        member_id: createdMember.id,
        event_id: eventId,
        event_title: evt.title,
        email: data.email,
        name,
        role: data.role,
        department: data.department,
        permissions,
        inviter_name: inviterUser?.full_name || 'Organizer',
        status: 'Pending'
      }
    })
    return createdMember
  })

  return { evt, member, inviteToken, permissions }
}

export async function updateTeamMember(eventId, memberId, patch) {
  if (!usePrisma()) {
    const member = store.teamMembers.find((m) => m.id === memberId && m.event_id === eventId)
    if (!member) throw new AppError('Anggota panitia tidak ditemukan.', 404, 'TEAM_MEMBER_NOT_FOUND')
    Object.assign(member, patch)
    const invite = store.teamInvites.find((inv) => inv.member_id === member.id)
    if (invite && Array.isArray(member.permissions)) invite.permissions = member.permissions
    return member
  }

  const existing = await prisma.teamMember.findFirst({ where: { id: memberId, event_id: eventId } })
  if (!existing) throw new AppError('Anggota panitia tidak ditemukan.', 404, 'TEAM_MEMBER_NOT_FOUND')
  const updated = await prisma.teamMember.update({
    where: { id: memberId },
    data: {
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.department ? { department: patch.department } : {}),
      ...(Array.isArray(patch.permissions) ? { permissions: patch.permissions } : {}),
      ...(patch.status ? { status: patch.status } : {})
    }
  })
  if (Array.isArray(patch.permissions)) {
    await prisma.teamInvite.updateMany({
      where: { member_id: memberId },
      data: { permissions: patch.permissions }
    })
  }
  return updated
}

export async function deleteTeamMember(eventId, memberId) {
  if (!usePrisma()) {
    store.teamMembers = store.teamMembers.filter((m) => !(m.id === memberId && m.event_id === eventId))
    store.teamInvites = store.teamInvites.filter((inv) => inv.member_id !== memberId)
    return { id: memberId }
  }
  await prisma.teamMember.deleteMany({ where: { id: memberId, event_id: eventId } })
  return { id: memberId }
}

export async function findInviteByToken(token) {
  if (!usePrisma()) {
    const invite = store.teamInvites.find((inv) => inv.token === token)
    if (!invite) throw new AppError('Undangan kepanitiaan tidak ditemukan atau sudah kedaluwarsa.', 404, 'INVITE_NOT_FOUND')
    const evt = store.events.find((e) => e.id === invite.event_id)
    const member = store.teamMembers.find((m) => m.id === invite.member_id)
    return {
      token: invite.token,
      status: invite.status,
      event_id: invite.event_id,
      event_title: evt?.title || invite.event_title || 'Event TERRA',
      email: invite.email,
      name: member?.name || invite.name,
      role: member?.role || invite.role,
      department: member?.department || invite.department,
      permissions: member?.permissions || invite.permissions || [],
      inviter_name: invite.inviter_name || 'Organizer'
    }
  }

  const invite = await prisma.teamInvite.findUnique({
    where: { token },
    include: { event: true, member: true }
  })
  if (!invite) throw new AppError('Undangan kepanitiaan tidak ditemukan atau sudah kedaluwarsa.', 404, 'INVITE_NOT_FOUND')
  return {
    token: invite.token,
    status: invite.status,
    event_id: invite.event_id,
    event_title: invite.event?.title || invite.event_title,
    email: invite.email,
    name: invite.member?.name || invite.name,
    role: invite.member?.role || invite.role,
    department: invite.member?.department || invite.department,
    permissions: asArray(invite.member?.permissions, asArray(invite.permissions)),
    inviter_name: invite.inviter_name || 'Organizer'
  }
}

export async function acceptTeamInvite(token, userPayload) {
  if (!usePrisma()) {
    const invite = store.teamInvites.find((inv) => inv.token === token)
    if (!invite) throw new AppError('Undangan kepanitiaan tidak ditemukan atau sudah kedaluwarsa.', 404, 'INVITE_NOT_FOUND')
    const member = store.teamMembers.find((m) => m.id === invite.member_id)
    const evt = store.events.find((e) => e.id === invite.event_id)
    if (member) {
      member.name = userPayload.full_name
      member.user_id = userPayload.id
      member.status = 'Active'
      member.accepted_at = new Date().toISOString()
    }
    if (evt) {
      const org = store.organizations.find((o) => o.id === evt.organization_id)
      if (org && !org.members?.some((m) => m.user_id === userPayload.id || m.email === userPayload.email)) {
        org.members = org.members || []
        org.members.push({
          id: `om-${Date.now()}`,
          user_id: userPayload.id,
          email: userPayload.email,
          role: member?.role || 'Staff',
          status: 'active'
        })
      }
    }
    invite.status = 'Accepted'
    invite.accepted_at = new Date().toISOString()
    return { event_id: invite.event_id, permissions: member?.permissions || invite.permissions || [] }
  }

  return runTransaction(async (tx) => {
    const invite = await tx.teamInvite.findUnique({
      where: { token },
      include: { event: true, member: true }
    })
    if (!invite) throw new AppError('Undangan kepanitiaan tidak ditemukan atau sudah kedaluwarsa.', 404, 'INVITE_NOT_FOUND')

    const updatedMember = await tx.teamMember.update({
      where: { id: invite.member_id },
      data: {
        name: userPayload.full_name,
        user_id: userPayload.id,
        status: 'Active',
        accepted_at: new Date()
      }
    })
    await tx.teamInvite.update({
      where: { id: invite.id },
      data: { status: 'Accepted', accepted_at: new Date() }
    })
    if (invite.event?.organization_id) {
      await tx.organizationMember.upsert({
        where: {
          organization_id_email: {
            organization_id: invite.event.organization_id,
            email: userPayload.email
          }
        },
        update: { user_id: userPayload.id, status: 'active' },
        create: {
          organization_id: invite.event.organization_id,
          user_id: userPayload.id,
          name: userPayload.full_name,
          email: userPayload.email,
          role: updatedMember.role || 'Staff',
          status: 'active'
        }
      })
    }
    return {
      event_id: invite.event_id,
      permissions: asArray(updatedMember.permissions, asArray(invite.permissions))
    }
  })
}

// =============================================================================
// SCHEDULES & TASKS
// =============================================================================
export async function listSchedules(eventId) {
  if (!usePrisma()) return store.schedules.filter((s) => s.event_id === eventId)
  return prisma.eventSchedule.findMany({ where: { event_id: eventId }, orderBy: { sort_order: 'asc' } })
}

export async function createSchedule(eventId, data) {
  if (!usePrisma()) {
    const item = { id: 'sch-' + Date.now(), event_id: eventId, ...data }
    store.schedules.push(item)
    return item
  }
  return prisma.eventSchedule.create({ data: { event_id: eventId, ...data } })
}

export async function updateSchedule(id, patch) {
  if (!usePrisma()) {
    const item = store.schedules.find((s) => s.id === id)
    if (!item) throw new AppError('Jadwal tidak ditemukan.', 404, 'SCHEDULE_NOT_FOUND')
    Object.assign(item, patch)
    return item
  }
  return prisma.eventSchedule.update({ where: { id }, data: patch })
}

export async function deleteSchedule(id) {
  if (!usePrisma()) {
    store.schedules = store.schedules.filter((s) => s.id !== id)
    return { id }
  }
  await prisma.eventSchedule.delete({ where: { id } })
  return { id }
}

export async function listTasks(eventId) {
  if (!usePrisma()) return store.tasks.filter((t) => t.event_id === eventId)
  return prisma.eventTask.findMany({
    where: { event_id: eventId },
    include: { comments: true },
    orderBy: { sort_order: 'asc' }
  })
}

export async function createTask(eventId, data) {
  const isGroup = data.is_group ?? !data.parent_id
  const dueAt = data.due_at || data.due_date || '2026-12-01'
  if (!usePrisma()) {
    const task = {
      id: (isGroup ? 'chk-' : 'tsk-') + Date.now(),
      event_id: eventId,
      parent_id: data.parent_id || null,
      is_group: Boolean(isGroup),
      ...data,
      due_at: dueAt,
      due_date: dueAt,
      comments: []
    }
    store.tasks.push(task)
    return task
  }
  return prisma.eventTask.create({
    data: {
      event_id: eventId,
      parent_id: data.parent_id || null,
      is_group: Boolean(isGroup),
      title: data.title,
      description: data.description || null,
      phase: data.phase || 'Production',
      assigned_to: data.assigned_to || null,
      priority: data.priority || 'Medium',
      status: data.status || 'To Do',
      start_date: data.start_date || null,
      due_at: dueAt,
      due_date: dueAt,
      progress: Number(data.progress || 0)
    },
    include: { comments: true }
  })
}

export async function updateTask(id, body) {
  if (!usePrisma()) {
    const task = store.tasks.find((t) => t.id === id)
    if (!task) throw new AppError('Task tidak ditemukan.', 404, 'TASK_NOT_FOUND')
    if (task.is_group && body.shift_days) {
      const delta = Number(body.shift_days)
      store.tasks.forEach((child) => {
        if (child.parent_id === task.id) {
          if (child.start_date) child.start_date = addDaysIso(child.start_date, delta)
          const dueStr = child.due_at || child.due_date
          if (dueStr) {
            const nextDue = addDaysIso(dueStr, delta)
            child.due_at = nextDue
            child.due_date = nextDue
          }
        }
      })
    }
    const patch = { ...body }
    delete patch.shift_days
    if (patch.due_date && !patch.due_at) patch.due_at = patch.due_date
    if (patch.due_at && !patch.due_date) patch.due_date = patch.due_at
    Object.assign(task, patch)
    return task
  }

  return runTransaction(async (tx) => {
    const task = await tx.eventTask.findUnique({ where: { id } })
    if (!task) throw new AppError('Task tidak ditemukan.', 404, 'TASK_NOT_FOUND')

    if (task.is_group && body.shift_days) {
      const delta = Number(body.shift_days)
      const children = await tx.eventTask.findMany({ where: { parent_id: task.id } })
      for (const child of children) {
        const nextStart = child.start_date ? addDaysIso(child.start_date, delta) : null
        const dueStr = child.due_at || child.due_date
        const nextDue = dueStr ? addDaysIso(dueStr, delta) : null
        await tx.eventTask.update({
          where: { id: child.id },
          data: {
            ...(nextStart ? { start_date: nextStart } : {}),
            ...(nextDue ? { due_at: nextDue, due_date: nextDue } : {})
          }
        })
      }
    }

    const patch = { ...body }
    delete patch.shift_days
    if (patch.due_date && !patch.due_at) patch.due_at = patch.due_date
    if (patch.due_at && !patch.due_date) patch.due_date = patch.due_at
    return tx.eventTask.update({
      where: { id },
      data: patch,
      include: { comments: true }
    })
  })
}

export async function deleteTask(id) {
  if (!usePrisma()) {
    store.tasks = store.tasks.filter((t) => t.id !== id && t.parent_id !== id)
    return { id }
  }
  await prisma.eventTask.delete({ where: { id } })
  return { id }
}

export async function addTaskComment(taskId, user, content) {
  if (!usePrisma()) {
    const task = store.tasks.find((t) => t.id === taskId)
    if (!task) throw new AppError('Task tidak ditemukan.', 404, 'TASK_NOT_FOUND')
    const comment = {
      id: 'cmt-' + Date.now(),
      user_id: user.id,
      author: user.full_name,
      content,
      created_at: new Date().toISOString()
    }
    task.comments = task.comments || []
    task.comments.push(comment)
    return comment
  }
  return prisma.taskComment.create({
    data: {
      task_id: taskId,
      user_id: user.id,
      author: user.full_name,
      content
    }
  })
}

// =============================================================================
// TICKETING, ORDERS, PARTICIPANTS & CHECK-IN
// =============================================================================
export async function listTicketTypes(eventId) {
  if (!usePrisma()) return store.ticketTypes.filter((t) => t.event_id === eventId)
  return prisma.ticketType.findMany({ where: { event_id: eventId } })
}

export async function createTicketType(eventId, data) {
  if (!usePrisma()) {
    const item = { id: 'tkt-' + Date.now(), event_id: eventId, sold_quantity: 0, ...data }
    store.ticketTypes.push(item)
    return item
  }
  return prisma.ticketType.create({ data: { event_id: eventId, sold_quantity: 0, ...data } })
}

export async function updateTicketType(id, patch) {
  if (!usePrisma()) {
    const tkt = store.ticketTypes.find((t) => t.id === id)
    if (!tkt) throw new AppError('Jenis tiket tidak ditemukan.', 404, 'TICKET_TYPE_NOT_FOUND')
    if (patch.quantity !== undefined && Number(patch.quantity) < tkt.sold_quantity) {
      throw new AppError('Kuota tidak boleh lebih kecil dari jumlah tiket yang sudah terjual.', 400, 'INVALID_QUOTA')
    }
    Object.assign(tkt, patch)
    return tkt
  }
  const tkt = await prisma.ticketType.findUnique({ where: { id } })
  if (!tkt) throw new AppError('Jenis tiket tidak ditemukan.', 404, 'TICKET_TYPE_NOT_FOUND')
  if (patch.quantity !== undefined && Number(patch.quantity) < tkt.sold_quantity) {
    throw new AppError('Kuota tidak boleh lebih kecil dari jumlah tiket yang sudah terjual.', 400, 'INVALID_QUOTA')
  }
  return prisma.ticketType.update({ where: { id }, data: patch })
}

export async function deleteTicketType(id) {
  if (!usePrisma()) {
    store.ticketTypes = store.ticketTypes.filter((t) => t.id !== id)
    return { id }
  }
  await prisma.ticketType.delete({ where: { id } })
  return { id }
}

export async function listOrdersByEvent(eventId) {
  if (!usePrisma()) return store.orders.filter((o) => o.event_id === eventId)
  return prisma.order.findMany({ where: { event_id: eventId }, orderBy: { created_at: 'desc' } })
}

export async function listOrdersByCustomer(customerId) {
  if (!usePrisma()) return store.orders.filter((o) => o.customer_id === customerId)
  return prisma.order.findMany({ where: { customer_id: customerId }, orderBy: { created_at: 'desc' } })
}

export async function findOrderById(id) {
  if (!usePrisma()) {
    const ord = store.orders.find((o) => o.id === id)
    if (!ord) throw new AppError('Order tidak ditemukan.', 404, 'ORDER_NOT_FOUND')
    return ord
  }
  const ord = await prisma.order.findUnique({ where: { id } })
  if (!ord) throw new AppError('Order tidak ditemukan.', 404, 'ORDER_NOT_FOUND')
  return ord
}

export async function createOrder({ event_id, ticket_type_id, quantity, attendee, customer_id }) {
  await pricingDb.assertEventQuotaAvailable(event_id, 'participants', quantity)
  if (!usePrisma()) return store.createOrder({ event_id, ticket_type_id, quantity, attendee, customer_id })

  const [evt, tkt] = await Promise.all([
    prisma.event.findFirst({ where: { id: event_id, deleted_at: null } }),
    prisma.ticketType.findFirst({ where: { id: ticket_type_id, event_id } })
  ])
  if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')
  if (evt.status === 'Cancelled') {
    throw new AppError('Event telah dibatalkan dan tidak menerima pemesanan.', 409, 'EVENT_CANCELLED')
  }
  if (!tkt) throw new AppError('Jenis tiket tidak ditemukan.', 404, 'TICKET_TYPE_NOT_FOUND')
  if (tkt.status !== 'On Sale') {
    throw new AppError(`Tiket sedang dalam status ${tkt.status}.`, 409, 'TICKET_NOT_ON_SALE')
  }

  // Resolve FK-safe customer_id outside the atomic write transaction
  let resolvedCustomerId = null
  if (customer_id) {
    const existingCustomer = await prisma.customer.findUnique({ where: { id: customer_id } })
    if (existingCustomer) {
      resolvedCustomerId = existingCustomer.id
    } else {
      const [organizerRow, adminRow] = await Promise.all([
        prisma.organizer.findUnique({ where: { id: customer_id } }),
        prisma.admin.findUnique({ where: { id: customer_id } })
      ])
      const buyerProfile = organizerRow || adminRow
      const buyerEmail = buyerProfile?.email || attendee.email
      const byEmail = await prisma.customer.findFirst({
        where: { email: { equals: buyerEmail, mode: 'insensitive' } }
      })
      if (byEmail) {
        resolvedCustomerId = byEmail.id
      } else {
        const syncedCustomer = await prisma.customer.create({
          data: {
            id: customer_id,
            full_name: buyerProfile?.full_name || attendee.full_name,
            email: buyerEmail,
            phone: buyerProfile?.phone || attendee.phone || null,
            email_verified: true
          }
        })
        resolvedCustomerId = syncedCustomer.id
      }
    }
  }

  const subtotal = Number(tkt.price) * quantity
  const isFree = Number(tkt.price) === 0
  const orderNumber = generateOrderNumber()
  const ticketDrafts = Array.from({ length: quantity }, () => {
    const code = generateTicketCode()
    const rawToken = `TERRA:${code}:${event_id}:${generateQrToken().slice(0, 8)}`
    return {
      code,
      rawToken,
      hash: hashQrToken(rawToken)
    }
  })

  return runTransaction(async (tx) => {
    const reserved = await tx.ticketType.updateMany({
      where: {
        id: ticket_type_id,
        event_id,
        status: 'On Sale',
        sold_quantity: { lte: tkt.quantity - quantity }
      },
      data: { sold_quantity: { increment: quantity } }
    })
    if (reserved.count === 0) {
      throw new AppError('Kuota tiket tidak mencukupi.', 409, 'TICKET_SOLD_OUT')
    }

    if (tkt.sold_quantity + quantity >= tkt.quantity) {
      await tx.ticketType.update({ where: { id: ticket_type_id }, data: { status: 'Sold Out' } })
    }

    const order = await tx.order.create({
      data: {
        order_number: orderNumber,
        event_id,
        customer_id: resolvedCustomerId,
        ticket_type_id,
        quantity,
        subtotal,
        total: subtotal,
        currency: tkt.currency,
        order_status: 'Confirmed',
        payment_status: isFree ? 'Not Required' : 'Paid',
        items: {
          create: {
            ticket_type_id,
            quantity,
            unit_price: Number(tkt.price),
            subtotal
          }
        }
      }
    })

    const participant = await tx.participant.create({
      data: {
        event_id,
        order_id: order.id,
        user_id: resolvedCustomerId,
        full_name: attendee.full_name,
        email: attendee.email,
        phone: attendee.phone,
        ticket_type: tkt.name,
        ticket_code: ticketDrafts[0]?.code || null,
        order_number: orderNumber,
        registration_status: 'Confirmed',
        checked_in: false
      }
    })

    const ticketData = ticketDrafts.map((draft) => ({
      event_id,
      event_title: evt.title,
      event_date: evt.start_at,
      location: evt.location_name,
      order_id: order.id,
      order_number: orderNumber,
      attendee_id: participant.id,
      ticket_type_id: tkt.id,
      ticket_type: tkt.name,
      ticket_code: draft.code,
      qr_payload: draft.rawToken,
      qr_token_hash: draft.hash,
      participant_name: attendee.full_name,
      status: 'Active'
    }))

    await tx.ticket.createMany({ data: ticketData })
    const issuedTickets = await tx.ticket.findMany({ where: { order_id: order.id } })

    return { order, participant, tickets: issuedTickets }
  })
}

export async function cancelOrder(orderId, userId, isAdmin = false) {
  if (!usePrisma()) return store.cancelOrder(orderId, userId, isAdmin)

  return runTransaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } })
    if (!order) throw new AppError('Order tidak ditemukan.', 404, 'ORDER_NOT_FOUND')
    if (!isAdmin && order.customer_id !== userId) {
      throw new AppError('Tidak memiliki izin membatalkan order ini.', 403, 'FORBIDDEN')
    }
    if (order.order_status === 'Cancelled') {
      throw new AppError('Order sudah dibatalkan sebelumnya.', 409, 'ORDER_ALREADY_CANCELLED')
    }

    if (order.ticket_type_id) {
      const tkt = await tx.ticketType.findUnique({ where: { id: order.ticket_type_id } })
      if (tkt) {
        const nextSold = Math.max(0, tkt.sold_quantity - order.quantity)
        await tx.ticketType.update({
          where: { id: tkt.id },
          data: {
            sold_quantity: nextSold,
            ...(tkt.status === 'Sold Out' && nextSold < tkt.quantity ? { status: 'On Sale' } : {})
          }
        })
      }
    }

    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: { order_status: 'Cancelled' }
    })
    await tx.ticket.updateMany({ where: { order_id: orderId }, data: { status: 'Cancelled' } })
    await tx.participant.updateMany({ where: { order_id: orderId }, data: { registration_status: 'Cancelled' } })
    return updatedOrder
  })
}

export async function listTicketsByOrder(orderId) {
  if (!usePrisma()) return store.tickets.filter((t) => t.order_id === orderId)
  return prisma.ticket.findMany({ where: { order_id: orderId } })
}

export async function listTicketsByCustomer(customerId) {
  if (!usePrisma()) {
    const myOrderIds = new Set(store.orders.filter((o) => o.customer_id === customerId).map((o) => o.id))
    return store.tickets.filter((t) => myOrderIds.has(t.order_id))
  }
  return prisma.ticket.findMany({
    where: { order: { customer_id: customerId } },
    orderBy: { issued_at: 'desc' }
  })
}

export async function findTicketById(id) {
  if (!usePrisma()) {
    const tk = store.tickets.find((t) => t.id === id)
    if (!tk) throw new AppError('Tiket tidak ditemukan.', 404, 'TICKET_NOT_FOUND')
    return tk
  }
  const tk = await prisma.ticket.findUnique({ where: { id } })
  if (!tk) throw new AppError('Tiket tidak ditemukan.', 404, 'TICKET_NOT_FOUND')
  return tk
}

export async function findTicketEventIdByCode(code) {
  const parsed = parseTicketQrPayload(code)
  const raw = parsed.raw
  const cleanCode = parsed.ticketCode
  const hashed = hashQrToken(raw)
  if (!usePrisma()) {
    return (
      store.tickets.find(
        (t) =>
          (cleanCode && t.ticket_code.toUpperCase() === cleanCode) ||
          t.qr_token_hash === hashed ||
          t.qr_token_hash === raw ||
          t.qr_payload === raw ||
          t.id === raw
      )?.event_id || null
    )
  }
  const tk = await prisma.ticket.findFirst({
    where: {
      OR: [
        ...(cleanCode ? [{ ticket_code: { equals: cleanCode, mode: 'insensitive' } }] : []),
        { qr_token_hash: hashed },
        { qr_token_hash: raw },
        { id: raw }
      ]
    },
    select: { event_id: true }
  })
  return tk?.event_id || null
}

export async function listCheckins(eventId) {
  if (!usePrisma()) return store.checkinLogs.filter((c) => c.event_id === eventId)
  return prisma.checkinLog.findMany({ where: { event_id: eventId } })
}

export async function validateOrCheckIn(codeOrQr, station, operatorId, commitCheckIn = true, eventId = null) {
  if (!usePrisma()) return store.validateOrCheckIn(codeOrQr, station, operatorId, commitCheckIn, eventId)

  const parsed = parseTicketQrPayload(codeOrQr)
  const raw = parsed.raw
  const cleanCode = parsed.ticketCode
  const hashed = hashQrToken(raw)

  return runTransaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: {
        OR: [
          ...(cleanCode ? [{ ticket_code: { equals: cleanCode, mode: 'insensitive' } }] : []),
          { qr_token_hash: hashed },
          { qr_payload: raw }
        ]
      }
    })
    if (!ticket) {
      throw new AppError(`Tiket "${cleanCode || raw}" tidak ditemukan atau tidak valid.`, 404, 'TICKET_NOT_FOUND')
    }
    if (parsed.isTerraQr && parsed.eventId && ticket.event_id !== parsed.eventId) {
      throw new AppError('Payload QR Code tidak sesuai dengan event tiket.', 400, 'INVALID_QR_PAYLOAD')
    }
    if (eventId && ticket.event_id !== eventId) {
      throw new AppError(
        `Tiket ${ticket.ticket_code} terdaftar untuk event lain dan tidak berlaku di gate ini.`,
        409,
        'WRONG_EVENT_TICKET'
      )
    }
    if (ticket.status === 'Cancelled') {
      throw new AppError('Tiket telah dibatalkan dan tidak berlaku.', 409, 'TICKET_CANCELLED')
    }
    if (ticket.status === 'Used') {
      throw new AppError(
        `Tiket ${ticket.ticket_code} (${ticket.participant_name}) sudah digunakan untuk check-in.`,
        409,
        'DUPLICATE_CHECKIN'
      )
    }

    if (!commitCheckIn) return { valid: true, ticket }

    const nowIso = new Date().toISOString()
    const claim = await tx.ticket.updateMany({
      where: { id: ticket.id, status: 'Active' },
      data: { status: 'Used', used_at: nowIso }
    })
    if (claim.count === 0) {
      throw new AppError(
        `Tiket ${ticket.ticket_code} sudah digunakan untuk check-in.`,
        409,
        'DUPLICATE_CHECKIN'
      )
    }

    const updatedTicket = await tx.ticket.findUnique({ where: { id: ticket.id } })
    await tx.participant.updateMany({
      where: {
        OR: [{ id: ticket.attendee_id }, { ticket_code: ticket.ticket_code }]
      },
      data: { checked_in: true }
    })

    const checkin = await tx.checkinLog.create({
      data: {
        event_id: ticket.event_id,
        ticket_id: ticket.id,
        ticket_code: ticket.ticket_code,
        participant_name: ticket.participant_name,
        ticket_type: ticket.ticket_type,
        station,
        checked_in_by: operatorId,
        checked_in_at: nowIso
      }
    })

    return { valid: true, ticket: updatedTicket, checkin }
  })
}

export async function listParticipants(eventId, { search, checked_in } = {}) {
  if (!usePrisma()) {
    let list = store.participants.filter((p) => p.event_id === eventId)
    if (checked_in === 'true') list = list.filter((p) => p.checked_in)
    if (checked_in === 'false') list = list.filter((p) => !p.checked_in)
    if (search) {
      const q = String(search).toLowerCase()
      list = list.filter(
        (p) =>
          p.full_name.toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q) ||
          (p.ticket_code || '').toLowerCase().includes(q)
      )
    }
    return list
  }

  return prisma.participant.findMany({
    where: {
      event_id: eventId,
      ...(checked_in === 'true' ? { checked_in: true } : {}),
      ...(checked_in === 'false' ? { checked_in: false } : {}),
      ...(search
        ? {
            OR: [
              { full_name: { contains: String(search), mode: 'insensitive' } },
              { email: { contains: String(search), mode: 'insensitive' } },
              { ticket_code: { contains: String(search), mode: 'insensitive' } }
            ]
          }
        : {})
    },
    orderBy: { created_at: 'desc' }
  })
}

export async function createManualParticipant(eventId, data) {
  await pricingDb.assertEventQuotaAvailable(eventId, 'participants', 1)
  const code = generateTicketCode()
  const rawPayload = `TERRA:${code}:${eventId}`
  if (!usePrisma()) {
    const p = {
      id: 'pt-' + Date.now(),
      event_id: eventId,
      order_id: null,
      user_id: null,
      ...data,
      ticket_type: data.ticket_type || 'Manual Registration',
      ticket_code: code,
      order_number: 'MAN-' + Math.floor(10000 + Math.random() * 90000),
      checked_in: false
    }
    store.participants.unshift(p)
    store.tickets.unshift({
      id: 'tc-' + Date.now(),
      event_id: eventId,
      order_id: null,
      attendee_id: p.id,
      ticket_type: p.ticket_type,
      ticket_code: code,
      qr_payload: rawPayload,
      qr_token_hash: hashQrToken(rawPayload),
      participant_name: p.full_name,
      status: 'Active',
      issued_at: new Date().toISOString(),
      used_at: null
    })
    return p
  }

  const evt = await getEventOrThrow(eventId)
  return runTransaction(async (tx) => {
    const participant = await tx.participant.create({
      data: {
        event_id: eventId,
        full_name: data.full_name,
        email: data.email,
        phone: data.phone || null,
        ticket_type: data.ticket_type || 'Manual Registration',
        ticket_code: code,
        order_number: 'MAN-' + Math.floor(10000 + Math.random() * 90000),
        registration_status: data.registration_status || 'Confirmed',
        checked_in: false
      }
    })
    await tx.ticket.create({
      data: {
        event_id: eventId,
        event_title: evt.title,
        event_date: evt.start_at,
        location: evt.location_name,
        attendee_id: participant.id,
        ticket_type: participant.ticket_type,
        ticket_code: code,
        qr_payload: rawPayload,
        qr_token_hash: hashQrToken(rawPayload),
        participant_name: participant.full_name,
        status: 'Active'
      }
    })
    return participant
  })
}

export async function findParticipantById(id) {
  if (!usePrisma()) {
    const p = store.participants.find((item) => item.id === id)
    if (!p) throw new AppError('Peserta tidak ditemukan.', 404, 'PARTICIPANT_NOT_FOUND')
    return p
  }
  const p = await prisma.participant.findUnique({ where: { id } })
  if (!p) throw new AppError('Peserta tidak ditemukan.', 404, 'PARTICIPANT_NOT_FOUND')
  return p
}

export async function updateParticipant(id, patch) {
  if (!usePrisma()) {
    const p = store.participants.find((item) => item.id === id)
    if (!p) throw new AppError('Peserta tidak ditemukan.', 404, 'PARTICIPANT_NOT_FOUND')
    Object.assign(p, patch)
    return p
  }
  return prisma.participant.update({ where: { id }, data: patch })
}

export async function deleteParticipant(id) {
  if (!usePrisma()) {
    store.participants = store.participants.filter((item) => item.id !== id)
    return { id }
  }
  await prisma.participant.delete({ where: { id } })
  return { id }
}

// =============================================================================
// FINANCE, VENDORS, SPONSORS, DOCUMENTS, SURVEYS & REPORTS
// =============================================================================
export async function getFinanceSummary(eventId) {
  if (!usePrisma()) return store.getFinanceSummary(eventId)
  await getEventOrThrow(eventId)

  const [budgetRow, tickets, incomes, expenses] = await Promise.all([
    prisma.eventBudget.findUnique({ where: { event_id: eventId } }),
    prisma.ticketType.findMany({ where: { event_id: eventId } }),
    prisma.financeIncome.findMany({ where: { event_id: eventId } }),
    prisma.financeExpense.findMany({ where: { event_id: eventId } })
  ])

  const budget = Number(budgetRow?.amount || 0)
  const paidBreakdown = tickets
    .filter((t) => Number(t.price) > 0)
    .map((t) => ({
      ticket_type_id: t.id,
      name: t.name,
      price: Number(t.price),
      sold_quantity: Number(t.sold_quantity),
      revenue: Number(t.price) * Number(t.sold_quantity)
    }))
  const paidTicketRevenue = paidBreakdown.reduce((s, t) => s + t.revenue, 0)
  const manualIncome = incomes.reduce((s, i) => s + Number(i.amount), 0)
  const totalIncome = paidTicketRevenue + manualIncome
  const totalExpense = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return {
    budget,
    paid_ticket_breakdown: paidBreakdown,
    paid_ticket_revenue: paidTicketRevenue,
    manual_income: manualIncome,
    total_income: totalIncome,
    total_expense: totalExpense,
    net_balance: totalIncome - totalExpense,
    budget_utilization_pct: budget > 0 ? Math.round((totalExpense / budget) * 100) : 0
  }
}

export async function getBudget(eventId) {
  if (!usePrisma()) return { event_id: eventId, amount: store.budgets[eventId] || 0, currency: 'IDR' }
  const b = await prisma.eventBudget.findUnique({ where: { event_id: eventId } })
  return { event_id: eventId, amount: Number(b?.amount || 0), currency: b?.currency || 'IDR' }
}

export async function setBudget(eventId, amount) {
  if (!usePrisma()) {
    store.budgets[eventId] = amount
    return { event_id: eventId, amount }
  }
  return prisma.eventBudget.upsert({
    where: { event_id: eventId },
    update: { amount },
    create: { event_id: eventId, amount, currency: 'IDR' }
  })
}

export async function listIncomes(eventId) {
  if (!usePrisma()) return store.incomes.filter((i) => i.event_id === eventId)
  return prisma.financeIncome.findMany({ where: { event_id: eventId }, orderBy: { created_at: 'desc' } })
}

export async function createIncome(eventId, data, userId) {
  const date = data.date || new Date().toISOString().slice(0, 10)
  if (!usePrisma()) {
    const item = { id: 'inc-' + Date.now(), event_id: eventId, ...data, date }
    store.incomes.unshift(item)
    return item
  }
  return prisma.financeIncome.create({
    data: { event_id: eventId, ...data, date, created_by: userId }
  })
}

export async function updateIncome(id, patch) {
  const clean = {}
  if (patch.category !== undefined) clean.category = patch.category
  if (patch.description !== undefined) clean.description = patch.description
  if (patch.amount !== undefined) clean.amount = Number(patch.amount)
  if (patch.date !== undefined) clean.date = patch.date

  if (!usePrisma()) {
    const item = store.incomes.find((i) => i.id === id)
    if (!item) throw new AppError('Catatan pemasukan tidak ditemukan.', 404, 'INCOME_NOT_FOUND')
    Object.assign(item, clean)
    return item
  }
  const existing = await prisma.financeIncome.findUnique({ where: { id } })
  if (!existing) throw new AppError('Catatan pemasukan tidak ditemukan.', 404, 'INCOME_NOT_FOUND')
  return prisma.financeIncome.update({ where: { id }, data: clean })
}

export async function deleteIncome(id) {
  if (!usePrisma()) {
    const exists = store.incomes.some((i) => i.id === id)
    if (!exists) throw new AppError('Catatan pemasukan tidak ditemukan.', 404, 'INCOME_NOT_FOUND')
    store.incomes = store.incomes.filter((i) => i.id !== id)
    return { id }
  }
  const existing = await prisma.financeIncome.findUnique({ where: { id } })
  if (!existing) throw new AppError('Catatan pemasukan tidak ditemukan.', 404, 'INCOME_NOT_FOUND')
  await prisma.financeIncome.delete({ where: { id } })
  return { id }
}

export async function listExpenses(eventId) {
  if (!usePrisma()) return store.expenses.filter((e) => e.event_id === eventId)
  return prisma.financeExpense.findMany({ where: { event_id: eventId }, orderBy: { created_at: 'desc' } })
}

export async function createExpense(eventId, data, userId) {
  const date = data.date || new Date().toISOString().slice(0, 10)
  if (!usePrisma()) {
    const item = { id: 'exp-' + Date.now(), event_id: eventId, ...data, date }
    store.expenses.unshift(item)
    return item
  }
  return prisma.financeExpense.create({
    data: { event_id: eventId, ...data, date, created_by: userId }
  })
}

export async function updateExpense(id, patch) {
  const clean = {}
  if (patch.category !== undefined) clean.category = patch.category
  if (patch.description !== undefined) clean.description = patch.description
  if (patch.amount !== undefined) clean.amount = Number(patch.amount)
  if (patch.date !== undefined) clean.date = patch.date

  if (!usePrisma()) {
    const item = store.expenses.find((e) => e.id === id)
    if (!item) throw new AppError('Catatan pengeluaran tidak ditemukan.', 404, 'EXPENSE_NOT_FOUND')
    Object.assign(item, clean)
    return item
  }
  const existing = await prisma.financeExpense.findUnique({ where: { id } })
  if (!existing) throw new AppError('Catatan pengeluaran tidak ditemukan.', 404, 'EXPENSE_NOT_FOUND')
  return prisma.financeExpense.update({ where: { id }, data: clean })
}

export async function deleteExpense(id) {
  if (!usePrisma()) {
    const exists = store.expenses.some((e) => e.id === id)
    if (!exists) throw new AppError('Catatan pengeluaran tidak ditemukan.', 404, 'EXPENSE_NOT_FOUND')
    store.expenses = store.expenses.filter((e) => e.id !== id)
    return { id }
  }
  const existing = await prisma.financeExpense.findUnique({ where: { id } })
  if (!existing) throw new AppError('Catatan pengeluaran tidak ditemukan.', 404, 'EXPENSE_NOT_FOUND')
  await prisma.financeExpense.delete({ where: { id } })
  return { id }
}

export async function listVendors(eventId) {
  if (!usePrisma()) return store.vendors.filter((v) => v.event_id === eventId)
  return prisma.vendor.findMany({ where: { event_id: eventId }, orderBy: { created_at: 'desc' } })
}

export async function createVendor(eventId, data) {
  if (!usePrisma()) {
    const v = { id: 'v-' + Date.now(), event_id: eventId, ...data }
    store.vendors.unshift(v)
    return v
  }
  return prisma.vendor.create({ data: { event_id: eventId, ...data } })
}

export async function updateVendor(id, patch) {
  if (!usePrisma()) {
    const v = store.vendors.find((item) => item.id === id)
    if (!v) throw new AppError('Vendor tidak ditemukan.', 404, 'VENDOR_NOT_FOUND')
    Object.assign(v, patch)
    return v
  }
  return prisma.vendor.update({ where: { id }, data: patch })
}

export async function deleteVendor(id) {
  if (!usePrisma()) {
    store.vendors = store.vendors.filter((v) => v.id !== id)
    return { id }
  }
  await prisma.vendor.delete({ where: { id } })
  return { id }
}

export async function listSponsors(eventId) {
  if (!usePrisma()) return store.sponsors.filter((s) => s.event_id === eventId)
  return prisma.sponsor.findMany({ where: { event_id: eventId }, orderBy: { created_at: 'desc' } })
}

export async function createSponsor(eventId, data) {
  if (!usePrisma()) {
    const s = { id: 's-' + Date.now(), event_id: eventId, ...data }
    store.sponsors.unshift(s)
    return s
  }
  return prisma.sponsor.create({ data: { event_id: eventId, ...data } })
}

export async function updateSponsor(id, patch) {
  if (!usePrisma()) {
    const s = store.sponsors.find((item) => item.id === id)
    if (!s) throw new AppError('Sponsor tidak ditemukan.', 404, 'SPONSOR_NOT_FOUND')
    Object.assign(s, patch)
    return s
  }
  return prisma.sponsor.update({ where: { id }, data: patch })
}

export async function deleteSponsor(id) {
  if (!usePrisma()) {
    store.sponsors = store.sponsors.filter((s) => s.id !== id)
    return { id }
  }
  await prisma.sponsor.delete({ where: { id } })
  return { id }
}

export async function listDocuments(eventId) {
  if (!usePrisma()) return store.documents.filter((d) => d.event_id === eventId)
  return prisma.eventDocument.findMany({ where: { event_id: eventId }, orderBy: { created_at: 'desc' } })
}

export async function createDocument(eventId, body, userId) {
  const payload = {
    event_id: eventId,
    uploaded_by: userId || null,
    file_name: body?.file_name || 'Document.pdf',
    category: body?.category || 'Operasional',
    visibility: body?.visibility || 'internal',
    file_path: body?.file_path || `events/${eventId}/${Date.now()}.pdf`
  }
  if (!usePrisma()) {
    const doc = { id: 'doc-' + Date.now(), ...payload, created_at: new Date().toISOString() }
    store.documents.unshift(doc)
    return doc
  }
  return prisma.eventDocument.create({ data: payload })
}

export async function findDocument(id) {
  if (!usePrisma()) {
    const doc = store.documents.find((d) => d.id === id)
    if (!doc) throw new AppError('Dokumen tidak ditemukan.', 404, 'DOC_NOT_FOUND')
    return doc
  }
  const doc = await prisma.eventDocument.findUnique({ where: { id } })
  if (!doc) throw new AppError('Dokumen tidak ditemukan.', 404, 'DOC_NOT_FOUND')
  return doc
}

export async function deleteDocument(id) {
  if (!usePrisma()) {
    store.documents = store.documents.filter((d) => d.id !== id)
    return { id }
  }
  await prisma.eventDocument.delete({ where: { id } })
  return { id }
}

export async function listSurveys(eventId) {
  if (!usePrisma()) return store.surveys.filter((s) => s.event_id === eventId)
  return prisma.eventSurvey.findMany({ where: { event_id: eventId }, orderBy: { created_at: 'desc' } })
}

export async function createSurvey(eventId, body) {
  if (!usePrisma()) {
    const srv = {
      id: 'srv-' + Date.now(),
      event_id: eventId,
      title: body?.title || 'Survey Event',
      description: body?.description || '',
      is_active: true,
      responses: []
    }
    store.surveys.unshift(srv)
    return srv
  }
  return prisma.eventSurvey.create({
    data: {
      event_id: eventId,
      title: body?.title || 'Survey Event',
      description: body?.description || '',
      is_active: true,
      responses: []
    }
  })
}

export async function submitSurveyResponse(surveyId, userId, answers = {}) {
  if (!usePrisma()) {
    const srv = store.surveys.find((s) => s.id === surveyId)
    if (!srv) throw new AppError('Survey tidak ditemukan.', 404, 'SURVEY_NOT_FOUND')
    const resp = { id: 'res-' + Date.now(), user_id: userId, answers, submitted_at: new Date().toISOString() }
    srv.responses.push(resp)
    return resp
  }
  const srv = await prisma.eventSurvey.findUnique({ where: { id: surveyId } })
  if (!srv) throw new AppError('Survey tidak ditemukan.', 404, 'SURVEY_NOT_FOUND')
  const resp = { id: 'res-' + Date.now(), user_id: userId, answers, submitted_at: new Date().toISOString() }
  const responses = [...asArray(srv.responses), resp]
  await prisma.eventSurvey.update({ where: { id: surveyId }, data: { responses } })
  return resp
}

export async function getEventReports(eventId) {
  const evt = await getEventOrThrow(eventId)
  const tickets = await listTicketTypes(evt.id)
  const evtParticipants = await listParticipants(evt.id)
  const finance = await getFinanceSummary(evt.id)

  const totalQuota = tickets.reduce((s, t) => s + Number(t.quantity), 0)
  const totalSold = tickets.reduce((s, t) => s + Number(t.sold_quantity), 0)
  const checkedIn = evtParticipants.filter((p) => p.checked_in).length

  return {
    event_id: evt.id,
    title: evt.title,
    sell_through_rate_pct: totalQuota ? Math.round((totalSold / totalQuota) * 100) : 0,
    total_quota: totalQuota,
    total_sold: totalSold,
    registered_participants: evtParticipants.length,
    checked_in_count: checkedIn,
    attendance_rate_pct: evtParticipants.length ? Math.round((checkedIn / evtParticipants.length) * 100) : 0,
    finance
  }
}

// =============================================================================
// MARKETPLACE & ADMIN
// =============================================================================
export async function listMarketplaceEvents({ q, category, format, sort = 'upcoming', page = 1, limit = 12 } = {}) {
  if (!usePrisma()) {
    let list = store.events.filter(
      (e) => !e.deleted_at && e.publication_status === 'Published' && e.visibility === 'public'
    )
    if (q) {
      const term = String(q).toLowerCase()
      list = list.filter((e) => e.title.toLowerCase().includes(term) || (e.location_name || '').toLowerCase().includes(term))
    }
    if (category) list = list.filter((e) => e.category === category)
    if (format) list = list.filter((e) => e.location_type === format)
    if (sort === 'upcoming') list = [...list].sort((a, b) => new Date(a.start_at) - new Date(b.start_at))

    const p = Number(page)
    const l = Number(limit)
    const items = list.slice((p - 1) * l, p * l).map((evt) => ({
      ...evt,
      organization: store.organizations.find((o) => o.id === evt.organization_id),
      ticket_types: store.ticketTypes.filter((t) => t.event_id === evt.id)
    }))
    return { items, meta: { page: p, limit: l, total: list.length } }
  }

  const where = {
    deleted_at: null,
    publication_status: 'Published',
    visibility: 'public',
    ...(category ? { category } : {}),
    ...(format ? { location_type: format } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: String(q), mode: 'insensitive' } },
            { location_name: { contains: String(q), mode: 'insensitive' } }
          ]
        }
      : {})
  }
  const p = Number(page)
  const l = Number(limit)
  const [total, rows] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      include: { organization: true, ticketTypes: true },
      orderBy: sort === 'upcoming' ? { start_at: 'asc' } : { created_at: 'desc' },
      skip: (p - 1) * l,
      take: l
    })
  ])
  return {
    items: rows.map((evt) => ({ ...formatPrismaEvent(evt), ticket_types: evt.ticketTypes })),
    meta: { page: p, limit: l, total }
  }
}

export async function listFeaturedMarketplaceEvents() {
  if (!usePrisma()) {
    return store.events
      .filter((e) => !e.deleted_at && e.publication_status === 'Published' && e.visibility === 'public' && e.is_featured)
      .map((evt) => ({
        ...evt,
        organization: store.organizations.find((o) => o.id === evt.organization_id),
        ticket_types: store.ticketTypes.filter((t) => t.event_id === evt.id)
      }))
  }
  const rows = await prisma.event.findMany({
    where: { deleted_at: null, publication_status: 'Published', visibility: 'public', is_featured: true },
    include: { organization: true, ticketTypes: true }
  })
  return rows.map((evt) => ({ ...formatPrismaEvent(evt), ticket_types: evt.ticketTypes }))
}

export async function searchMarketplaceEvents(q) {
  if (!usePrisma()) {
    const term = String(q || '').toLowerCase()
    return store.events
      .filter((e) => !e.deleted_at && e.publication_status === 'Published' && e.visibility === 'public')
      .filter((e) => e.title.toLowerCase().includes(term))
  }
  const rows = await prisma.event.findMany({
    where: {
      deleted_at: null,
      publication_status: 'Published',
      visibility: 'public',
      ...(q ? { title: { contains: String(q), mode: 'insensitive' } } : {})
    }
  })
  return rows.map((e) => formatPrismaEvent(e))
}

export async function listActiveCategories() {
  if (!usePrisma()) return store.categories.filter((c) => c.is_active)
  return prisma.category.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' } })
}

export async function listMarketplaceOrganizers() {
  if (!usePrisma()) {
    const pubEvents = store.events.filter((e) => !e.deleted_at && e.publication_status === 'Published' && e.visibility === 'public')
    return store.organizations.map((org) => ({
      ...org,
      event_count: pubEvents.filter((e) => e.organization_id === org.id).length
    }))
  }
  const orgs = await prisma.organization.findMany({
    where: { deleted_at: null },
    include: {
      events: {
        where: { deleted_at: null, publication_status: 'Published', visibility: 'public' },
        select: { id: true }
      }
    }
  })
  return orgs.map((org) => ({ ...org, event_count: org.events.length }))
}

export async function getPublicEventBySlugOrId(slug) {
  if (!usePrisma()) {
    const evt = store.events.find(
      (e) => !e.deleted_at && e.publication_status === 'Published' && e.visibility === 'public' && (e.slug === slug || e.id === slug)
    )
    if (!evt) throw new AppError('Event tidak ditemukan di marketplace.', 404, 'EVENT_NOT_FOUND')
    return {
      ...evt,
      organization: store.organizations.find((o) => o.id === evt.organization_id) || null,
      ticket_types: store.ticketTypes.filter((t) => t.event_id === evt.id && t.status !== 'Disabled'),
      schedules: store.schedules.filter((s) => s.event_id === evt.id && s.visibility === 'public')
    }
  }

  const evt = await prisma.event.findFirst({
    where: {
      deleted_at: null,
      publication_status: 'Published',
      visibility: 'public',
      OR: [{ slug }, { id: slug }]
    },
    include: {
      organization: true,
      ticketTypes: { where: { status: { not: 'Disabled' } } },
      schedules: { where: { visibility: 'public' }, orderBy: { sort_order: 'asc' } }
    }
  })
  if (!evt) throw new AppError('Event tidak ditemukan di marketplace.', 404, 'EVENT_NOT_FOUND')
  return {
    ...formatPrismaEvent(evt),
    ticket_types: evt.ticketTypes,
    schedules: evt.schedules
  }
}

export async function getPublicOrganizerBySlug(slug) {
  if (!usePrisma()) {
    const org = store.organizations.find((o) => o.slug === slug)
    if (!org) throw new AppError('Organizer tidak ditemukan.', 404, 'ORG_NOT_FOUND')
    const events = store.events.filter(
      (e) => !e.deleted_at && e.publication_status === 'Published' && e.visibility === 'public' && e.organization_id === org.id
    )
    return { ...org, events }
  }
  const org = await prisma.organization.findFirst({
    where: { slug, deleted_at: null },
    include: {
      events: {
        where: { deleted_at: null, publication_status: 'Published', visibility: 'public' }
      }
    }
  })
  if (!org) throw new AppError('Organizer tidak ditemukan.', 404, 'ORG_NOT_FOUND')
  return { ...org, events: org.events.map((e) => formatPrismaEvent(e)) }
}

export async function createEventReport(eventId, reporterId, data) {
  await getEventOrThrow(eventId)
  if (!usePrisma()) {
    const report = {
      id: 'rep-' + Date.now(),
      event_id: eventId,
      reporter_id: reporterId || null,
      ...data,
      status: 'open',
      created_at: new Date().toISOString()
    }
    store.reports.unshift(report)
    return report
  }
  const custReporter = reporterId
    ? await prisma.customer.findUnique({ where: { id: reporterId }, select: { id: true } })
    : null
  return prisma.eventReport.create({
    data: { event_id: eventId, reporter_id: custReporter?.id || null, ...data, status: 'open' }
  })
}

export async function getAdminDashboard() {
  if (!usePrisma()) {
    return {
      total_users: store.users.length,
      total_customers: store.users.filter((u) => u.role === 'customer').length,
      total_organizers: store.users.filter((u) => u.role === 'organizer').length,
      total_admins: store.users.filter((u) => u.role === 'admin').length,
      total_organizations: store.organizations.length,
      total_events: store.events.filter((e) => !e.deleted_at).length,
      published_events: store.events.filter((e) => e.publication_status === 'Published').length,
      pending_events: store.events.filter((e) => e.publication_status === 'Pending Review').length,
      total_orders: store.orders.length,
      total_issued_tickets: store.tickets.length,
      total_checkins: store.checkinLogs.length
    }
  }
  const [
    total_customers,
    total_organizers,
    total_admins,
    total_organizations,
    total_events,
    published_events,
    pending_events,
    total_orders,
    total_issued_tickets,
    total_checkins
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.organizer.count(),
    prisma.admin.count(),
    prisma.organization.count({ where: { deleted_at: null } }),
    prisma.event.count({ where: { deleted_at: null } }),
    prisma.event.count({ where: { deleted_at: null, publication_status: 'Published' } }),
    prisma.event.count({ where: { deleted_at: null, publication_status: 'Pending Review' } }),
    prisma.order.count(),
    prisma.ticket.count(),
    prisma.checkinLog.count()
  ])
  return {
    total_users: total_customers + total_organizers + total_admins,
    total_customers,
    total_organizers,
    total_admins,
    total_organizations,
    total_events,
    published_events,
    pending_events,
    total_orders,
    total_issued_tickets,
    total_checkins
  }
}

export function evaluateOrganizerSubscription(organizer) {
  if (!organizer || organizer.role === 'admin') {
    return {
      is_active: true,
      plan: 'unlimited',
      status: 'active',
      expires_at: null,
      days_remaining: null
    }
  }

  const plan = organizer.subscription_plan || 'free_trial'
  const rawStatus = organizer.subscription_status || 'trialing'
  const expiresAt = organizer.subscription_expires_at ? new Date(organizer.subscription_expires_at) : null
  const now = Date.now()
  const msLeft = expiresAt ? expiresAt.getTime() - now : 30 * 24 * 60 * 60 * 1000
  const daysRemaining = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)))

  const notExpired = !expiresAt || msLeft > 0
  const statusAllows = rawStatus === 'active' || rawStatus === 'trialing'
  const isActive = Boolean(statusAllows && notExpired && !organizer.is_suspended)

  return {
    is_active: isActive,
    plan,
    status: isActive ? rawStatus : rawStatus === 'unpaid' ? 'unpaid' : 'expired',
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    days_remaining: isActive ? daysRemaining : 0
  }
}

export async function listAdminUsers() {
  if (!usePrisma()) {
    return store.users.map((u) =>
      u.role === 'organizer' ? { ...u, subscription: evaluateOrganizerSubscription(u) } : u
    )
  }
  const [customers, organizers, admins] = await Promise.all([
    prisma.customer.findMany({ orderBy: { created_at: 'desc' } }),
    prisma.organizer.findMany({ orderBy: { created_at: 'desc' } }),
    prisma.admin.findMany({ orderBy: { created_at: 'desc' } })
  ])
  return [
    ...customers.map((u) => ({ ...u, role: 'customer' })),
    ...organizers.map((u) => {
      const orgUser = { ...u, role: 'organizer' }
      return { ...orgUser, subscription: evaluateOrganizerSubscription(orgUser) }
    }),
    ...admins.map((u) => ({ ...u, role: 'admin' }))
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

export async function createAdminOrganizer({
  id,
  full_name,
  organization_name,
  email,
  phone,
  password_hash,
  plan = 'pro_monthly',
  duration_days = 30
}) {
  const cleanEmail = String(email).trim().toLowerCase()
  const days = Math.max(1, Number(duration_days) || (plan === 'free_trial' ? 14 : 30))
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const status = plan === 'free_trial' ? 'trialing' : 'active'

  const existing = await findUserByEmail(cleanEmail, 'organizer')
  if (existing) {
    throw new AppError('Email Organizer ini sudah terdaftar di database.', 409, 'EMAIL_EXISTS')
  }

  const organizer = await upsertUser({
    id: id || `orgu-${Date.now()}`,
    full_name: full_name.trim(),
    email: cleanEmail,
    phone: phone || null,
    password_hash,
    role: 'organizer',
    provider: 'email',
    email_verified: true,
    is_suspended: false,
    subscription_plan: plan,
    subscription_status: status,
    subscription_expires_at: expiresAt
  })

  let organization = null
  if (organization_name && organization_name.trim()) {
    organization = await createOrganization(
      {
        name: organization_name.trim(),
        description: `Organisasi penyelenggara event ${organization_name.trim()}.`,
        email: cleanEmail,
        phone: phone || undefined,
        website: 'https://terra.id'
      },
      organizer
    )
  }

  return {
    organizer: {
      ...organizer,
      subscription: evaluateOrganizerSubscription(organizer)
    },
    organization
  }
}

export async function updateOrganizerSubscription(organizerId, { plan, status, duration_days }) {
  const expiresAt =
    status === 'expired' || status === 'unpaid'
      ? new Date(Date.now() - 60 * 1000)
      : duration_days !== undefined
        ? new Date(Date.now() + Number(duration_days) * 24 * 60 * 60 * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  if (!usePrisma()) {
    const user = store.users.find((u) => u.id === organizerId && u.role === 'organizer')
    if (!user) throw new AppError('Organizer tidak ditemukan.', 404, 'USER_NOT_FOUND')
    if (plan) user.subscription_plan = plan
    user.subscription_status = status
    user.subscription_expires_at = expiresAt.toISOString()
    return { ...user, subscription: evaluateOrganizerSubscription(user) }
  }

  const existing = await prisma.organizer.findUnique({ where: { id: organizerId } })
  if (!existing) throw new AppError('Organizer tidak ditemukan.', 404, 'USER_NOT_FOUND')

  const updated = await prisma.organizer.update({
    where: { id: organizerId },
    data: {
      ...(plan ? { subscription_plan: plan } : {}),
      subscription_status: status,
      subscription_expires_at: expiresAt
    }
  })
  const orgUser = { ...updated, role: 'organizer' }
  return { ...orgUser, subscription: evaluateOrganizerSubscription(orgUser) }
}

export async function updateAdminUserStatus(id, isSuspended) {
  if (!usePrisma()) {
    const user = store.users.find((u) => u.id === id)
    if (!user) throw new AppError('User tidak ditemukan.', 404, 'USER_NOT_FOUND')
    user.is_suspended = Boolean(isSuspended)
    return user
  }
  const existing = await findUserById(id)
  if (!existing) throw new AppError('User tidak ditemukan.', 404, 'USER_NOT_FOUND')
  const updated = await roleDelegate(existing.role).update({
    where: { id },
    data: { is_suspended: Boolean(isSuspended) }
  })
  return { ...updated, role: existing.role }
}

export async function listAllOrganizations() {
  if (!usePrisma()) return store.organizations
  return prisma.organization.findMany({
    where: { deleted_at: null },
    include: { members: true },
    orderBy: { created_at: 'desc' }
  })
}

export async function listVerifications() {
  if (!usePrisma()) return store.verifications
  return prisma.organizerVerification.findMany()
}

export async function reviewVerification(idOrOrgId, statusInput, notes, adminId) {
  const status = statusInput === 'verified' ? 'verified' : 'rejected'
  if (!usePrisma()) {
    let ver = store.verifications.find((v) => v.id === idOrOrgId || v.organization_id === idOrOrgId)
    const org = store.organizations.find((o) => o.id === idOrOrgId || o.id === ver?.organization_id)
    if (!ver && !org) throw new AppError('Data verifikasi tidak ditemukan.', 404, 'VERIFICATION_NOT_FOUND')
    if (!ver && org) {
      ver = { id: 'ver-' + Date.now(), organization_id: org.id, verification_status: status }
      store.verifications.push(ver)
    }
    ver.verification_status = status
    ver.review_notes = notes || ''
    ver.reviewed_by = adminId
    ver.reviewed_at = new Date().toISOString()
    if (org) org.verification_status = status
    return { verification: ver, organization: org }
  }

  return runTransaction(async (tx) => {
    let ver = await tx.organizerVerification.findFirst({
      where: { OR: [{ id: idOrOrgId }, { organization_id: idOrOrgId }] }
    })
    const org = await tx.organization.findFirst({
      where: { OR: [{ id: idOrOrgId }, ...(ver ? [{ id: ver.organization_id }] : [])] }
    })
    if (!ver && !org) throw new AppError('Data verifikasi tidak ditemukan.', 404, 'VERIFICATION_NOT_FOUND')

    const nowIso = new Date().toISOString()
    if (ver) {
      ver = await tx.organizerVerification.update({
        where: { id: ver.id },
        data: { verification_status: status, review_notes: notes || '', reviewed_by: adminId, reviewed_at: nowIso }
      })
    } else if (org) {
      ver = await tx.organizerVerification.create({
        data: {
          organization_id: org.id,
          verification_status: status,
          review_notes: notes || '',
          reviewed_by: adminId,
          reviewed_at: nowIso
        }
      })
    }
    const updatedOrg = org
      ? await tx.organization.update({ where: { id: org.id }, data: { verification_status: status } })
      : null
    return { verification: ver, organization: updatedOrg }
  })
}

export async function listAdminEvents() {
  if (!usePrisma()) {
    return store.events
      .filter((e) => !e.deleted_at)
      .map((evt) => ({
        ...evt,
        organization: store.organizations.find((o) => o.id === evt.organization_id),
        ticket_types: store.ticketTypes.filter((t) => t.event_id === evt.id)
      }))
  }
  const rows = await prisma.event.findMany({
    where: { deleted_at: null },
    include: { organization: true, ticketTypes: true },
    orderBy: { created_at: 'desc' }
  })
  return rows.map((evt) => ({ ...formatPrismaEvent(evt), ticket_types: evt.ticketTypes }))
}

export async function moderateEvent(eventId, action, adminId, notes = '') {
  const map = {
    approve: { pub: 'Published', op: 'Published' },
    reject: { pub: 'Rejected', op: null },
    suspend: { pub: 'Suspended', op: null }
  }
  if (!usePrisma()) {
    const evt = store.getEvent(eventId)
    evt.publication_status = map[action].pub
    if (map[action].op) evt.status = map[action].op
    const log = {
      id: 'mod-' + Date.now(),
      event_id: evt.id,
      admin_id: adminId,
      action,
      notes,
      created_at: new Date().toISOString()
    }
    store.moderationLogs.unshift(log)
    return { event: evt, log }
  }

  return runTransaction(async (tx) => {
    const existing = await tx.event.findFirst({ where: { id: eventId, deleted_at: null } })
    if (!existing) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')
    const event = await tx.event.update({
      where: { id: eventId },
      data: {
        publication_status: map[action].pub,
        status: map[action].op || existing.status
      }
    })
    const log = await tx.eventModerationLog.create({
      data: { event_id: eventId, admin_id: adminId, action, notes }
    })
    return { event: formatPrismaEvent(event), log }
  })
}

export async function listModerationLogs() {
  if (!usePrisma()) return store.moderationLogs
  return prisma.eventModerationLog.findMany({ orderBy: { created_at: 'desc' } })
}

export async function listAllCategories() {
  if (!usePrisma()) return store.categories
  return prisma.category.findMany({ orderBy: { sort_order: 'asc' } })
}

export async function createCategory(data) {
  const slug = slugify(data.name)
  if (!usePrisma()) {
    const cat = { id: 'cat-' + Date.now(), slug, is_active: true, ...data }
    store.categories.push(cat)
    return cat
  }
  return prisma.category.create({ data: { slug, is_active: true, ...data } })
}

export async function updateCategory(id, patch) {
  if (!usePrisma()) {
    const cat = store.categories.find((c) => c.id === id)
    if (!cat) throw new AppError('Kategori tidak ditemukan.', 404, 'CATEGORY_NOT_FOUND')
    Object.assign(cat, patch)
    return cat
  }
  return prisma.category.update({ where: { id }, data: patch })
}

export async function deleteCategory(id) {
  if (!usePrisma()) {
    store.categories = store.categories.filter((c) => c.id !== id)
    return { id }
  }
  await prisma.category.delete({ where: { id } })
  return { id }
}

export async function listReports() {
  if (!usePrisma()) return store.reports
  return prisma.eventReport.findMany({ orderBy: { created_at: 'desc' } })
}

export async function updateReportStatus(id, status, adminId) {
  if (!usePrisma()) {
    const rep = store.reports.find((r) => r.id === id)
    if (!rep) throw new AppError('Laporan tidak ditemukan.', 404, 'REPORT_NOT_FOUND')
    rep.status = status
    rep.reviewed_by = adminId
    return rep
  }
  return prisma.eventReport.update({
    where: { id },
    data: { status, reviewed_by: adminId }
  })
}

async function ensureCustomerProfileForForum(user, client = prisma) {
  if (!user?.id) throw new AppError('Autentikasi diperlukan.', 401, 'UNAUTHORIZED')
  const existing = await client.customer.findUnique({ where: { id: user.id } })
  if (existing) return existing

  const cleanEmail = String(user.email || `${user.id}@terra.local`).toLowerCase()
  const existingByEmail = await client.customer.findUnique({ where: { email: cleanEmail } })
  if (existingByEmail) return existingByEmail

  return client.customer.create({
    data: {
      id: user.id,
      full_name: user.full_name || cleanEmail.split('@')[0],
      email: cleanEmail,
      avatar_url: user.avatar_url || null,
      provider: user.provider || 'email',
      email_verified: true
    }
  })
}

export async function listEventCompanionPosts(slugOrId) {
  if (!usePrisma()) {
    const evt = store.events.find((e) => !e.deleted_at && (e.slug === slugOrId || e.id === slugOrId))
    if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')

    const ticketHolderIds = new Set(
      store.orders
        .filter((o) => o.event_id === evt.id && o.order_status !== 'Cancelled')
        .map((o) => o.customer_id)
    )
    const ticketHolderEmails = new Set(
      store.participants
        .filter((p) => p.event_id === evt.id && p.registration_status !== 'Cancelled')
        .map((p) => String(p.email || '').toLowerCase())
    )

    const resolveAuthor = (uid) => {
      const u = store.users.find((x) => x.id === uid)
      const email = String(u?.email || '').toLowerCase()
      return {
        id: u?.id || uid,
        full_name: u?.full_name || 'Peserta TERRA',
        avatar_url: u?.avatar_url || null,
        has_ticket: ticketHolderIds.has(uid) || (email && ticketHolderEmails.has(email))
      }
    }

    return (store.companionPosts || [])
      .filter((p) => p.event_id === evt.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((post) => ({
        ...post,
        author: resolveAuthor(post.author_id),
        replies: (store.companionReplies || [])
          .filter((r) => r.post_id === post.id)
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
          .map((r) => ({ ...r, author: resolveAuthor(r.author_id) }))
      }))
  }

  const evt = await prisma.event.findFirst({
    where: { deleted_at: null, OR: [{ slug: slugOrId }, { id: slugOrId }] },
    select: { id: true }
  })
  if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')

  const [posts, paidOrders, participants] = await Promise.all([
    prisma.eventCompanionPost.findMany({
      where: { event_id: evt.id },
      orderBy: { created_at: 'desc' },
      include: {
        author: { select: { id: true, full_name: true, avatar_url: true, email: true } },
        replies: {
          orderBy: { created_at: 'asc' },
          include: { author: { select: { id: true, full_name: true, avatar_url: true, email: true } } }
        }
      }
    }),
    prisma.order.findMany({
      where: { event_id: evt.id, order_status: { not: 'Cancelled' } },
      select: { customer_id: true }
    }),
    prisma.participant.findMany({
      where: { event_id: evt.id, registration_status: { not: 'Cancelled' } },
      select: { user_id: true, email: true }
    })
  ])

  const holderIds = new Set([
    ...paidOrders.map((o) => o.customer_id),
    ...participants.map((p) => p.user_id).filter(Boolean)
  ])
  const holderEmails = new Set(participants.map((p) => String(p.email || '').toLowerCase()).filter(Boolean))

  const mapAuthor = (a) => ({
    id: a.id,
    full_name: a.full_name,
    avatar_url: a.avatar_url || null,
    has_ticket: holderIds.has(a.id) || holderEmails.has(String(a.email || '').toLowerCase())
  })

  return posts.map((post) => ({
    id: post.id,
    event_id: post.event_id,
    author_id: post.author_id,
    title: post.title,
    departure_city: post.departure_city,
    departure_point: post.departure_point,
    departure_time: post.departure_time,
    transport_mode: post.transport_mode,
    slots_available: post.slots_available,
    contact_note: post.contact_note,
    notes: post.notes,
    status: post.status,
    created_at: post.created_at,
    updated_at: post.updated_at,
    author: mapAuthor(post.author),
    replies: post.replies.map((r) => ({
      id: r.id,
      post_id: r.post_id,
      author_id: r.author_id,
      message: r.message,
      created_at: r.created_at,
      author: mapAuthor(r.author)
    }))
  }))
}

export async function createEventCompanionPost(slugOrId, user, payload) {
  if (!usePrisma()) {
    const evt = store.events.find((e) => !e.deleted_at && (e.slug === slugOrId || e.id === slugOrId))
    if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')
    const now = new Date().toISOString()
    const post = {
      id: 'cmp-' + Date.now(),
      event_id: evt.id,
      author_id: user.id,
      title: payload.title,
      departure_city: payload.departure_city,
      departure_point: payload.departure_point,
      departure_time: payload.departure_time || '',
      transport_mode: payload.transport_mode || 'KRL / MRT / TransJakarta',
      slots_available: Number(payload.slots_available || 3),
      contact_note: payload.contact_note || '',
      notes: payload.notes,
      status: 'open',
      created_at: now,
      updated_at: now
    }
    store.companionPosts.unshift(post)
    const list = await listEventCompanionPosts(evt.id)
    return list.find((p) => p.id === post.id) || post
  }

  const evt = await prisma.event.findFirst({
    where: { deleted_at: null, OR: [{ slug: slugOrId }, { id: slugOrId }] },
    select: { id: true }
  })
  if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')

  const customer = await ensureCustomerProfileForForum(user)
  const created = await prisma.eventCompanionPost.create({
    data: {
      event_id: evt.id,
      author_id: customer.id,
      title: payload.title,
      departure_city: payload.departure_city,
      departure_point: payload.departure_point,
      departure_time: payload.departure_time || null,
      transport_mode: payload.transport_mode || 'KRL / MRT / TransJakarta',
      slots_available: Number(payload.slots_available || 3),
      contact_note: payload.contact_note || null,
      notes: payload.notes,
      status: 'open'
    }
  })

  const list = await listEventCompanionPosts(evt.id)
  return list.find((p) => p.id === created.id) || created
}

export async function updateEventCompanionPost(postId, user, payload) {
  if (!usePrisma()) {
    const post = (store.companionPosts || []).find((p) => p.id === postId)
    if (!post) throw new AppError('Postingan forum tidak ditemukan.', 404, 'POST_NOT_FOUND')
    if (post.author_id !== user.id && user.role !== 'admin') {
      throw new AppError('Anda hanya dapat mengubah ajakan milik sendiri.', 403, 'FORBIDDEN')
    }
    Object.assign(post, payload, { updated_at: new Date().toISOString() })
    const list = await listEventCompanionPosts(post.event_id)
    return list.find((p) => p.id === post.id) || post
  }

  const existing = await prisma.eventCompanionPost.findUnique({ where: { id: postId } })
  if (!existing) throw new AppError('Postingan forum tidak ditemukan.', 404, 'POST_NOT_FOUND')
  const customer = await ensureCustomerProfileForForum(user)
  if (existing.author_id !== customer.id && existing.author_id !== user.id && user.role !== 'admin') {
    throw new AppError('Anda hanya dapat mengubah ajakan milik sendiri.', 403, 'FORBIDDEN')
  }

  const updated = await prisma.eventCompanionPost.update({
    where: { id: postId },
    data: {
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.slots_available !== undefined ? { slots_available: Number(payload.slots_available) } : {}),
      ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      ...(payload.contact_note !== undefined ? { contact_note: payload.contact_note || null } : {})
    }
  })

  const list = await listEventCompanionPosts(updated.event_id)
  return list.find((p) => p.id === updated.id) || updated
}

export async function deleteEventCompanionPost(postId, user) {
  if (!usePrisma()) {
    const post = (store.companionPosts || []).find((p) => p.id === postId)
    if (!post) throw new AppError('Postingan forum tidak ditemukan.', 404, 'POST_NOT_FOUND')
    if (post.author_id !== user.id && user.role !== 'admin') {
      throw new AppError('Anda hanya dapat menghapus ajakan milik sendiri.', 403, 'FORBIDDEN')
    }
    store.companionPosts = store.companionPosts.filter((p) => p.id !== postId)
    store.companionReplies = (store.companionReplies || []).filter((r) => r.post_id !== postId)
    return { id: postId }
  }

  const existing = await prisma.eventCompanionPost.findUnique({ where: { id: postId } })
  if (!existing) throw new AppError('Postingan forum tidak ditemukan.', 404, 'POST_NOT_FOUND')
  const customer = await ensureCustomerProfileForForum(user)
  if (existing.author_id !== customer.id && existing.author_id !== user.id && user.role !== 'admin') {
    throw new AppError('Anda hanya dapat menghapus ajakan milik sendiri.', 403, 'FORBIDDEN')
  }

  await prisma.eventCompanionPost.delete({ where: { id: postId } })
  return { id: postId }
}

export async function createEventCompanionReply(postId, user, payload) {
  if (!usePrisma()) {
    const post = (store.companionPosts || []).find((p) => p.id === postId)
    if (!post) throw new AppError('Postingan forum tidak ditemukan.', 404, 'POST_NOT_FOUND')
    const reply = {
      id: 'cmpr-' + Date.now(),
      post_id: postId,
      author_id: user.id,
      message: payload.message,
      created_at: new Date().toISOString()
    }
    store.companionReplies.push(reply)
    const list = await listEventCompanionPosts(post.event_id)
    return list.find((p) => p.id === post.id) || post
  }

  const post = await prisma.eventCompanionPost.findUnique({ where: { id: postId } })
  if (!post) throw new AppError('Postingan forum tidak ditemukan.', 404, 'POST_NOT_FOUND')

  const customer = await ensureCustomerProfileForForum(user)
  await prisma.eventCompanionReply.create({
    data: {
      post_id: postId,
      author_id: customer.id,
      message: payload.message
    }
  })

  const list = await listEventCompanionPosts(post.event_id)
  return list.find((p) => p.id === postId)
}
