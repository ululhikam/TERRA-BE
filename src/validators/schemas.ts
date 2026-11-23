import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  portal_role: z.enum(['customer', 'organizer', 'admin']).default('customer')
})

export const registerSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['customer', 'organizer']).default('customer'),
  organization_name: z.string().optional().default(''),
  plan: z.enum(['free_trial', 'pro_monthly']).optional().default('free_trial')
})

export const profileUpdateSchema = z.object({
  full_name: z.string().min(2).optional(),
  username: z.string().min(3).optional(),
  phone: z.string().optional(),
  bio: z.string().optional(),
  avatar_url: z.string().url().optional().or(z.literal(''))
})

export const organizationCreateSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).optional(),
  description: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  website: z.string().optional(),
  logo_url: z.string().optional(),
  cover_url: z.string().optional()
})

export const organizationMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['Owner', 'Admin', 'Manager', 'Staff', 'Viewer']).default('Staff')
})

export const speakerItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: z.string().default('Pemateri'),
  role_title: z.string().optional().default(''),
  topic: z.string().optional().default(''),
  avatar_url: z.string().optional().default('')
})

export const scheduleItemSchema = z.object({
  id: z.string().optional(),
  event_id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  date: z.string().optional(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  location: z.string().optional().default('Main Stage'),
  pic: z.string().optional().default(''),
  track: z.string().optional().default(''),
  visibility: z.enum(['public', 'internal']).default('public')
})

export const eventCreateSchema = z.object({
  organization_id: z.string().min(1),
  parent_event_id: z.string().nullable().optional(),
  title: z.string().min(3),
  slug: z.string().min(3).optional(),
  description: z.string().optional(),
  category_id: z.string().optional(),
  category: z.string().optional(),
  poster_url: z.string().optional(),
  banner_url: z.string().optional(),
  gallery: z.array(z.string()).optional(),
  location_type: z.enum(['online', 'offline', 'hybrid']).default('offline'),
  location_name: z.string().optional(),
  address: z.string().optional(),
  online_url: z.string().optional(),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  timezone: z.string().default('Asia/Jakarta'),
  capacity: z.coerce.number().int().min(0).default(100),
  visibility: z.enum(['public', 'private', 'unlisted']).default('public'),
  theme_color: z.string().optional()
})

export const eventUpdateSchema = eventCreateSchema
  .omit({ organization_id: true })
  .partial()
  .extend({
    status: z.enum(['Draft', 'Preparation', 'Published', 'Ongoing', 'Completed', 'Cancelled']).optional(),
    terms: z.string().optional(),
    contact_email: z.string().optional(),
    contact_phone: z.string().optional(),
    speakers: z.array(speakerItemSchema).optional(),
    schedules: z.array(scheduleItemSchema).optional(),
    faq: z.array(z.object({ q: z.string().min(1), a: z.string().min(1) })).optional()
  })

export const organizationUpdateSchema = organizationCreateSchema.partial()

export const organizationMemberUpdateSchema = z.object({
  role: z.enum(['Owner', 'Admin', 'Manager', 'Staff', 'Viewer'])
})

export const moduleConfigSchema = z.object({
  is_enabled: z.boolean(),
  configuration: z.record(z.any()).optional()
})

export const bulkModulesSchema = z.object({
  enabled_modules: z.array(z.string()).min(1)
})

export const scheduleSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  date: z.string().min(1),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  location: z.string().optional(),
  pic: z.string().optional(),
  track: z.string().optional(),
  visibility: z.enum(['public', 'internal']).default('public')
})

export const taskSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  is_group: z.boolean().optional(),
  phase: z.string().default('Production'),
  assigned_to: z.string().optional(),
  priority: z
    .string()
    .transform((v) => {
      const low = v.toLowerCase()
      if (low === 'low') return 'Low'
      if (low === 'high') return 'High'
      return 'Medium'
    })
    .default('Medium'),
  status: z.enum(['To Do', 'In Progress', 'Review', 'Done', 'Cancelled']).default('To Do'),
  start_date: z.string().optional(),
  due_at: z.string().optional(),
  due_date: z.string().optional(),
  progress: z.coerce.number().int().min(0).max(100).default(0),
  labels: z.array(z.string()).optional(),
  checklists: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1),
        is_completed: z.boolean().default(false)
      })
    )
    .optional()
})

export const taskCommentSchema = z.object({
  content: z.string().trim().min(1, 'Isi komentar wajib diisi.').max(1000)
})

export const taskUpdateSchema = taskSchema.partial().extend({
  shift_days: z.coerce.number().int().optional()
})

export const teamMemberSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email(),
  role: z.enum(['Owner', 'Admin', 'Manager', 'Staff', 'Viewer']).default('Staff'),
  department: z.string().default('Ticketing & Gate'),
  permissions: z.array(z.string()).optional()
})

export const ticketTypeSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  category: z.string().optional(),
  price: z.coerce.number().min(0).default(0),
  currency: z.string().default('IDR'),
  quantity: z.coerce.number().int().min(1),
  sale_start_at: z.string().optional(),
  sale_end_at: z.string().optional(),
  benefits: z.string().optional(),
  terms: z.string().optional(),
  min_per_order: z.coerce.number().int().min(1).default(1),
  max_per_order: z.coerce.number().int().min(1).default(5),
  status: z.enum(['Draft', 'Scheduled', 'On Sale', 'Sold Out', 'Sales Ended', 'Disabled']).default('On Sale')
})

export const orderCreateSchema = z
  .object({
    event_id: z.string().min(1),
    ticket_type_id: z.string().min(1),
    quantity: z.coerce.number().int().min(1).max(20),
    registration_data: z.record(z.any()).optional(),
    attendee: z
      .object({
        full_name: z.string().min(2),
        email: z.string().email(),
        phone: z.string().min(6),
        registration_data: z.record(z.any()).optional()
      })
      .optional(),
    full_name: z.string().min(2).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(6).optional()
  })
  .superRefine((val, ctx) => {
    const hasNested = Boolean(val.attendee?.full_name && val.attendee?.email && val.attendee?.phone)
    const hasFlat = Boolean(val.full_name && val.email && val.phone)
    if (!hasNested && !hasFlat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data peserta (nama lengkap, email, nomor telepon) wajib dilengkapi.'
      })
    }
  })
  .transform((val) => ({
    event_id: val.event_id,
    ticket_type_id: val.ticket_type_id,
    quantity: val.quantity,
    registration_data: val.registration_data || val.attendee?.registration_data || {},
    attendee: val.attendee || {
      full_name: val.full_name,
      email: val.email,
      phone: val.phone
    }
  }))

export const checkinSchema = z.object({
  code: z.string().min(3),
  station: z.string().default('Gate A - Main Lobby'),
  event_id: z.string().optional()
})

export const qrDownloadQuerySchema = z.object({
  token: z.string().optional()
})

export const ticketTypeUpdateSchema = ticketTypeSchema.partial()

export const participantCreateSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  ticket_type: z.string().optional(),
  registration_status: z.enum(['Pending', 'Confirmed', 'Cancelled', 'Rejected']).default('Confirmed')
})

export const financeRecordSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(2),
  amount: z.coerce.number().min(0),
  date: z.string().optional()
})

export const vendorSchema = z.object({
  name: z.string().min(2),
  category: z.string().min(2),
  contact: z.string().optional(),
  contact_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  value: z.string().optional(),
  status: z.enum(['Pending', 'Confirmed', 'Completed', 'Cancelled']).default('Pending')
})

export const sponsorSchema = z.object({
  name: z.string().min(2),
  tier: z.string().min(2),
  logo_url: z.string().optional(),
  contribution: z.string().optional(),
  pic: z.string().optional(),
  benefits: z.string().optional(),
  contact_details: z.string().optional(),
  status: z.enum(['Pending', 'Confirmed', 'Cancelled']).default('Pending')
})

export const surveyCreateSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional().default(''),
  questions: z
    .array(
      z.object({
        id: z.string().optional(),
        question: z.string().min(1),
        question_type: z.enum(['text', 'rating', 'multiple_choice']).default('text'),
        options: z.array(z.string()).optional().default([])
      })
    )
    .optional()
    .default([])
})

export const moderationNoteSchema = z.object({
  notes: z.string().optional()
})

export const categorySchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  icon: z.string().optional(),
  image_url: z.string().optional(),
  sort_order: z.coerce.number().int().min(0).optional(),
  is_active: z.boolean().optional()
})

export const adminUserStatusSchema = z.object({
  is_suspended: z.boolean()
})

export const verificationReviewSchema = z.object({
  status: z.enum(['verified', 'rejected', 'request_documents']),
  notes: z.string().optional().default('')
})

export const reportStatusSchema = z.object({
  status: z.enum(['open', 'in_review', 'resolved', 'dismissed'])
})

export const forgotPasswordSchema = z.object({
  email: z.string().email('Format email tidak valid')
})

export const resetPasswordSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  otp_code: z.string().trim().regex(/^\d{6}$/, 'Kode OTP reset harus 6 digit angka'),
  new_password: z.string().min(6, 'Kata sandi baru minimal 6 karakter')
})

export const reportCreateSchema = z.object({
  reason: z.string().min(3),
  description: z.string().min(5)
})

export const acceptInviteSchema = z.object({
  token: z.string().min(8),
  full_name: z.string().min(2).optional(),
  password: z.string().min(6)
})

export const oauthSessionSchema = z.object({
  access_token: z.string().min(10)
})

export const verifyOtpSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  otp_code: z.string().trim().regex(/^\d{6}$/, 'Kode OTP harus terdiri dari 6 digit angka'),
  otp_session_token: z.string().optional()
})

export const resendOtpSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  otp_session_token: z.string().optional()
})

export const changeUnverifiedEmailSchema = z.object({
  current_email: z.string().email('Format email lama tidak valid'),
  new_email: z.string().email('Format email baru tidak valid'),
  otp_session_token: z.string().min(10, 'Sesi verifikasi tidak valid')
})

export const companionPostCreateSchema = z.object({
  title: z.string().trim().min(3, 'Judul ajakan minimal 3 karakter').max(120),
  departure_city: z.string().trim().min(2, 'Kota/area asal wajib diisi').max(60),
  departure_point: z.string().trim().min(2, 'Titik kumpul wajib diisi').max(120),
  departure_time: z.string().trim().max(40).optional().default(''),
  transport_mode: z.string().trim().min(2).max(50).default('KRL / MRT / TransJakarta'),
  slots_available: z.coerce.number().int().min(1).max(20).default(3),
  contact_note: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().min(5, 'Catatan ajakan minimal 5 karakter').max(600)
})

export const companionPostUpdateSchema = z.object({
  status: z.enum(['open', 'full', 'closed']).optional(),
  slots_available: z.coerce.number().int().min(0).max(20).optional(),
  notes: z.string().trim().min(5).max(600).optional(),
  contact_note: z.string().trim().max(120).optional()
})

export const companionReplyCreateSchema = z.object({
  message: z.string().trim().min(2, 'Balasan minimal 2 karakter').max(400)
})

export const adminCreateOrganizerSchema = z.object({
  full_name: z.string().trim().min(2, 'Nama pelanggan / PIC minimal 2 karakter'),
  organization_name: z.string().trim().min(2, 'Nama organisasi minimal 2 karakter'),
  email: z.string().trim().email('Format email tidak valid'),
  phone: z.string().trim().min(6, 'Kontak / No. HP minimal 6 karakter').optional().default(''),
  password: z.string().min(6, 'Password minimal 6 karakter'),
  plan: z.enum(['pro_monthly', 'free_trial']).default('pro_monthly'),
  duration_days: z.coerce.number().int().min(1).max(3650).default(30)
})

export const adminUpdateSubscriptionSchema = z.object({
  plan: z.enum(['free_trial', 'pro_monthly', 'unpaid']).optional(),
  status: z.enum(['trialing', 'active', 'expired', 'unpaid']),
  duration_days: z.coerce.number().int().min(0).max(3650).optional()
})

export const billingPreviewSchema = z.object({
  plan_code: z.enum(['free', 'starter', 'pro', 'ultimate']).optional().default('starter'),
  bundle_id: z.string().nullable().optional(),
  event_id: z.string().nullable().optional(),
  promo_code: z.string().max(40).optional().default(''),
  use_early_access: z.boolean().optional().default(false),
  is_community: z.boolean().optional().default(false)
})

export const billingCheckoutSchema = billingPreviewSchema.extend({
  organization_id: z.string().min(1, 'Organisasi wajib dipilih'),
  payment_method: z.enum(['manual_whatsapp', 'manual_transfer', 'payment_gateway', 'free']).default('manual_whatsapp'),
  community_org_proof: z.string().max(240).optional().default(''),
  payment_notes: z.string().max(300).optional().default('')
})

export const billingVerifySchema = z.object({
  status: z.enum(['Paid', 'Rejected', 'Expired', 'Refunded']),
  admin_notes: z.string().max(300).optional().default('')
})

export const adminPlanUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  tagline: z.string().optional(),
  description: z.string().optional(),
  price_idr: z.coerce.number().int().min(0).optional(),
  max_active_events: z.coerce.number().int().min(1).optional(),
  max_participants: z.coerce.number().int().min(1).optional(),
  max_team_members: z.coerce.number().int().min(1).optional(),
  max_storage_mb: z.coerce.number().int().min(1).optional(),
  allowed_modules: z.array(z.string()).optional(),
  features: z.array(z.string()).optional(),
  trial_days: z.coerce.number().int().min(0).max(90).optional(),
  early_access_price_idr: z.coerce.number().int().min(0).nullable().optional(),
  community_discount_pct: z.coerce.number().int().min(0).max(90).optional(),
  is_active: z.boolean().optional(),
  allow_downgrade: z.boolean().optional()
})

export const bundleUpsertSchema = z.object({
  code: z.string().trim().min(3),
  name: z.string().trim().min(3),
  plan_code: z.enum(['free', 'starter', 'pro', 'ultimate']).default('pro'),
  event_quota: z.coerce.number().int().min(2).max(100),
  bundle_price_idr: z.coerce.number().int().min(0),
  description: z.string().optional().default(''),
  is_active: z.boolean().optional().default(true)
})

export const promoUpsertSchema = z.object({
  code: z.string().trim().min(3).max(32),
  name: z.string().trim().min(3),
  promo_type: z.enum(['early_access', 'community', 'promo']).default('promo'),
  discount_type: z.enum(['percent', 'fixed']).default('percent'),
  discount_value: z.coerce.number().int().min(1),
  applies_to_plan: z.string().nullable().optional(),
  requires_verification: z.boolean().optional().default(false),
  max_redemptions: z.coerce.number().int().min(1).nullable().optional(),
  is_active: z.boolean().optional().default(true)
})
