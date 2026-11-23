import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { store } from '../src/repositories/store.js'
import { seedDemafestPlan } from './seed-demafest.js'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding TERRA PostgreSQL database via Prisma...')
  store.reset()

  for (const user of store.users) {
    const delegate =
      user.role === 'admin'
        ? prisma.admin
        : user.role === 'organizer'
          ? prisma.organizer
          : prisma.customer

    await delegate.upsert({
      where: { id: user.id },
      update: {
        full_name: user.full_name,
        username: user.username || null,
        phone: user.phone || null,
        bio: user.bio || null,
        is_suspended: Boolean(user.is_suspended)
      },
      create: {
        id: user.id,
        full_name: user.full_name,
        username: user.username || null,
        email: user.email,
        phone: user.phone || null,
        bio: user.bio || null,
        provider: user.provider || 'email',
        email_verified: true,
        is_suspended: Boolean(user.is_suspended),
        ...(user.role === 'organizer'
          ? {
              subscription_plan: user.subscription_plan || 'pro_monthly',
              subscription_status: user.subscription_status || 'active',
              subscription_expires_at: user.subscription_expires_at
                ? new Date(user.subscription_expires_at)
                : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            }
          : {})
      }
    })
  }

  for (const [idx, cat] of store.categories.entries()) {
    await prisma.category.upsert({
      where: { id: cat.id },
      update: { name: cat.name, icon: cat.icon || null, is_active: cat.is_active },
      create: {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        icon: cat.icon || null,
        sort_order: idx,
        is_active: cat.is_active
      }
    })
  }

  for (const org of store.organizations) {
    await prisma.organization.upsert({
      where: { id: org.id },
      update: {
        name: org.name,
        description: org.description || null,
        verification_status: org.verification_status
      },
      create: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description || null,
        logo_url: org.logo_url || null,
        cover_url: org.cover_url || null,
        email: org.email,
        phone: org.phone || null,
        website: org.website || null,
        verification_status: org.verification_status,
        created_by: org.created_by || null
      }
    })

    for (const m of org.members || []) {
      await prisma.organizationMember.upsert({
        where: { id: m.id },
        update: { role: m.role, status: m.status || 'active' },
        create: {
          id: m.id,
          organization_id: org.id,
          user_id: m.user_id || null,
          name: m.name || null,
          email: m.email,
          role: m.role,
          status: m.status || 'active'
        }
      })
    }
  }

  for (const evt of store.events) {
    await prisma.event.upsert({
      where: { id: evt.id },
      update: {
        title: evt.title,
        status: evt.status,
        publication_status: evt.publication_status
      },
      create: {
        id: evt.id,
        organization_id: evt.organization_id,
        title: evt.title,
        slug: evt.slug,
        description: evt.description || null,
        category_id: evt.category_id || null,
        category: evt.category || null,
        poster_url: evt.poster_url || null,
        banner_url: evt.banner_url || null,
        gallery: evt.gallery || [],
        speakers: evt.speakers || [],
        location_type: evt.location_type || 'offline',
        location_name: evt.location_name || null,
        address: evt.address || null,
        online_url: evt.online_url || null,
        start_at: evt.start_at,
        end_at: evt.end_at,
        timezone: evt.timezone || 'Asia/Jakarta',
        capacity: Number(evt.capacity || 0),
        status: evt.status || 'Draft',
        publication_status: evt.publication_status || 'Unpublished',
        visibility: evt.visibility || 'public',
        is_featured: Boolean(evt.is_featured),
        enabled_modules: evt.enabled_modules || [],
        created_by: evt.created_by || 'usr-organizer'
      }
    })
  }

  for (const tkt of store.ticketTypes) {
    await prisma.ticketType.upsert({
      where: { id: tkt.id },
      update: {},
      create: {
        id: tkt.id,
        event_id: tkt.event_id,
        name: tkt.name,
        description: tkt.description || null,
        price: Number(tkt.price || 0),
        currency: tkt.currency || 'IDR',
        quantity: Number(tkt.quantity || 0),
        sold_quantity: Number(tkt.sold_quantity || 0),
        min_per_order: Number(tkt.min_per_order || 1),
        max_per_order: Number(tkt.max_per_order || 5),
        status: tkt.status || 'On Sale'
      }
    })
  }

  for (const [idx, sch] of store.schedules.entries()) {
    await prisma.eventSchedule.upsert({
      where: { id: sch.id },
      update: {},
      create: {
        id: sch.id,
        event_id: sch.event_id,
        title: sch.title,
        description: sch.description || null,
        date: sch.date,
        start_time: sch.start_time,
        end_time: sch.end_time,
        location: sch.location || null,
        pic: sch.pic || null,
        visibility: sch.visibility || 'public',
        sort_order: idx
      }
    })
  }

  // Insert root checkpoint groups before child subtasks
  const orderedTasks = [...store.tasks].sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0))
  for (const [idx, task] of orderedTasks.entries()) {
    await prisma.eventTask.upsert({
      where: { id: task.id },
      update: {},
      create: {
        id: task.id,
        event_id: task.event_id,
        parent_id: task.parent_id || null,
        is_group: Boolean(task.is_group),
        title: task.title,
        description: task.description || null,
        phase: task.phase || 'Production',
        assigned_to: task.assigned_to || null,
        priority: task.priority || 'Medium',
        status: task.status || 'To Do',
        start_date: task.start_date || null,
        due_at: task.due_at || null,
        due_date: task.due_date || task.due_at || null,
        progress: Number(task.progress || 0),
        sort_order: idx
      }
    })
  }

  for (const ord of store.orders) {
    await prisma.order.upsert({
      where: { id: ord.id },
      update: {},
      create: {
        id: ord.id,
        order_number: ord.order_number,
        event_id: ord.event_id,
        customer_id: ord.customer_id || null,
        ticket_type_id: ord.ticket_type_id || null,
        quantity: Number(ord.quantity || 1),
        subtotal: Number(ord.subtotal || 0),
        total: Number(ord.total || 0),
        currency: ord.currency || 'IDR',
        order_status: ord.order_status || 'Confirmed',
        payment_status: ord.payment_status || 'Not Required'
      }
    })
  }

  for (const pt of store.participants) {
    await prisma.participant.upsert({
      where: { id: pt.id },
      update: {},
      create: {
        id: pt.id,
        event_id: pt.event_id,
        order_id: pt.order_id || null,
        user_id: pt.user_id || null,
        full_name: pt.full_name,
        email: pt.email,
        phone: pt.phone || null,
        ticket_type: pt.ticket_type || null,
        ticket_code: pt.ticket_code || null,
        order_number: pt.order_number || null,
        registration_status: pt.registration_status || 'Confirmed',
        checked_in: Boolean(pt.checked_in)
      }
    })
  }

  for (const tk of store.tickets) {
    await prisma.ticket.upsert({
      where: { id: tk.id },
      update: {},
      create: {
        id: tk.id,
        event_id: tk.event_id,
        event_title: tk.event_title || null,
        event_date: tk.event_date || null,
        location: tk.location || null,
        order_id: tk.order_id || null,
        order_number: tk.order_number || null,
        attendee_id: tk.attendee_id,
        ticket_type_id: tk.ticket_type_id || null,
        ticket_type: tk.ticket_type || null,
        ticket_code: tk.ticket_code,
        qr_payload: tk.qr_payload,
        qr_token_hash: tk.qr_token_hash,
        participant_name: tk.participant_name || null,
        status: tk.status || 'Active',
        used_at: tk.used_at || null
      }
    })
  }

  for (const chk of store.checkinLogs) {
    await prisma.checkinLog.upsert({
      where: { id: chk.id },
      update: {},
      create: {
        id: chk.id,
        event_id: chk.event_id,
        ticket_id: chk.ticket_id,
        ticket_code: chk.ticket_code,
        participant_name: chk.participant_name || null,
        ticket_type: chk.ticket_type || null,
        station: chk.station || 'Gate A - Main Lobby',
        checked_in_at: chk.checked_in_at
      }
    })
  }

  for (const tm of store.teamMembers) {
    await prisma.teamMember.upsert({
      where: { id: tm.id },
      update: {},
      create: {
        id: tm.id,
        event_id: tm.event_id,
        user_id: tm.user_id || null,
        name: tm.name,
        email: tm.email,
        role: tm.role,
        department: tm.department || 'General',
        permissions: tm.permissions || ['View Event'],
        status: tm.status || 'Active'
      }
    })
  }

  for (const [eventId, amount] of Object.entries(store.budgets)) {
    await prisma.eventBudget.upsert({
      where: { event_id: eventId },
      update: {},
      create: {
        event_id: eventId,
        amount: Number(amount || 0),
        currency: 'IDR'
      }
    })
  }

  for (const inc of store.incomes) {
    await prisma.financeIncome.upsert({
      where: { id: inc.id },
      update: {},
      create: {
        id: inc.id,
        event_id: inc.event_id,
        category: inc.category,
        description: inc.description,
        amount: Number(inc.amount || 0),
        date: inc.date
      }
    })
  }

  for (const exp of store.expenses) {
    await prisma.financeExpense.upsert({
      where: { id: exp.id },
      update: {},
      create: {
        id: exp.id,
        event_id: exp.event_id,
        category: exp.category,
        description: exp.description,
        amount: Number(exp.amount || 0),
        date: exp.date
      }
    })
  }

  for (const v of store.vendors) {
    await prisma.vendor.upsert({
      where: { id: v.id },
      update: {},
      create: {
        id: v.id,
        event_id: v.event_id,
        name: v.name,
        category: v.category,
        contact: v.contact || null,
        value: v.value || null,
        status: v.status || 'Pending'
      }
    })
  }

  for (const s of store.sponsors) {
    await prisma.sponsor.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        event_id: s.event_id,
        name: s.name,
        tier: s.tier || null,
        contribution: s.contribution || null,
        pic: s.pic || null,
        status: s.status || 'Pending'
      }
    })
  }

  for (const d of store.documents) {
    await prisma.eventDocument.upsert({
      where: { id: d.id },
      update: {},
      create: {
        id: d.id,
        event_id: d.event_id,
        file_name: d.file_name,
        file_path: d.file_path,
        category: d.category || 'Operasional',
        visibility: d.visibility || 'internal'
      }
    })
  }

  for (const srv of store.surveys) {
    await prisma.eventSurvey.upsert({
      where: { id: srv.id },
      update: {},
      create: {
        id: srv.id,
        event_id: srv.event_id,
        title: srv.title,
        description: srv.description || null,
        is_active: Boolean(srv.is_active),
        responses: srv.responses || []
      }
    })
  }

  for (const ver of store.verifications) {
    await prisma.organizerVerification.upsert({
      where: { id: ver.id },
      update: {},
      create: {
        id: ver.id,
        organization_id: ver.organization_id,
        submitted_by: ver.submitted_by || null,
        verification_status: ver.verification_status || 'pending',
        documents: ver.documents || [],
        review_notes: ver.review_notes || null
      }
    })
  }

  for (const post of store.companionPosts || []) {
    await prisma.eventCompanionPost.upsert({
      where: { id: post.id },
      update: {},
      create: {
        id: post.id,
        event_id: post.event_id,
        author_id: post.author_id,
        title: post.title,
        departure_city: post.departure_city,
        departure_point: post.departure_point,
        departure_time: post.departure_time || null,
        transport_mode: post.transport_mode,
        slots_available: Number(post.slots_available || 3),
        contact_note: post.contact_note || null,
        notes: post.notes,
        status: post.status || 'open'
      }
    })
  }

  for (const plan of store.pricingPlans || []) {
    await prisma.pricingPlan.upsert({
      where: { code: plan.code },
      update: {},
      create: {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        tagline: plan.tagline || null,
        description: plan.description || null,
        price_idr: plan.price_idr,
        billing_model: plan.billing_model || 'per_event',
        is_popular: Boolean(plan.is_popular),
        is_active: plan.is_active !== false,
        sort_order: plan.sort_order || 0,
        max_active_events: plan.max_active_events,
        max_participants: plan.max_participants,
        max_team_members: plan.max_team_members,
        max_storage_mb: plan.max_storage_mb,
        allowed_modules: plan.allowed_modules || [],
        features: plan.features || [],
        trial_days: plan.trial_days || 0,
        early_access_price_idr: plan.early_access_price_idr ?? null,
        early_access_limit: plan.early_access_limit || 100,
        community_discount_pct: plan.community_discount_pct || 0,
        allow_downgrade: plan.allow_downgrade !== false
      }
    })
  }

  for (const bnd of store.bundlePackages || []) {
    await prisma.bundlePackage.upsert({
      where: { code: bnd.code },
      update: {},
      create: {
        id: bnd.id,
        code: bnd.code,
        name: bnd.name,
        plan_code: bnd.plan_code,
        event_quota: bnd.event_quota,
        bundle_price_idr: bnd.bundle_price_idr,
        description: bnd.description || null,
        is_active: bnd.is_active !== false
      }
    })
  }

  for (const prm of store.promoCodes || []) {
    await prisma.promoCode.upsert({
      where: { code: prm.code },
      update: {},
      create: {
        id: prm.id,
        code: prm.code,
        name: prm.name,
        promo_type: prm.promo_type || 'promo',
        discount_type: prm.discount_type || 'percent',
        discount_value: prm.discount_value || 0,
        applies_to_plan: prm.applies_to_plan || null,
        requires_verification: Boolean(prm.requires_verification),
        max_redemptions: prm.max_redemptions ?? null,
        used_count: prm.used_count || 0,
        is_active: prm.is_active !== false
      }
    })
  }

  for (const sub of store.eventSubscriptions || []) {
    await prisma.eventSubscription.upsert({
      where: { event_id: sub.event_id },
      update: {},
      create: {
        id: sub.id,
        event_id: sub.event_id,
        organization_id: sub.organization_id,
        plan_code: sub.plan_code,
        plan_name: sub.plan_name,
        price_snapshot_idr: sub.price_snapshot_idr || 0,
        limits_snapshot: sub.limits_snapshot || {},
        status: sub.status || 'active',
        is_trial: Boolean(sub.is_trial),
        trial_started_at: sub.trial_started_at ? new Date(sub.trial_started_at) : null,
        trial_ends_at: sub.trial_ends_at ? new Date(sub.trial_ends_at) : null
      }
    })
  }

  for (const ntf of store.notifications) {
    await prisma.userNotification.upsert({
      where: { id: ntf.id },
      update: {},
      create: {
        id: ntf.id,
        user_id: ntf.user_id,
        title: ntf.title,
        message: ntf.message,
        is_read: Boolean(ntf.is_read)
      }
    })
  }

  const demafest = await seedDemafestPlan(prisma)
  console.log(`DEMAFEST 2026 seeded cleanly for ${demafest.email} (${demafest.eventIds.length} events)!`)

  console.log('TERRA seed completed cleanly!')
}

main()
  .catch((err) => {
    console.error('Seed error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
