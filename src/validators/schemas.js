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
  organization_name: z.string().optional().default('')
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
  website: z.string().optional()
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
  visibility: z.enum(['public', 'internal']).default('public')
})

export const eventCreateSchema = z.object({
  organization_id: z.string().min(1),
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
  visibility: z.enum(['public', 'private', 'unlisted']).default('public')
})

export const eventUpdateSchema = eventCreateSchema.partial().extend({
  status: z.enum(['Draft', 'Preparation', 'Published', 'Ongoing', 'Completed', 'Cancelled']).optional(),
  publication_status: z.enum(['Unpublished', 'Pending Review', 'Approved', 'Rejected', 'Published', 'Suspended']).optional(),
  terms: z.string().optional(),
  contact_email: z.string().optional(),
  contact_phone: z.string().optional(),
  speakers: z.array(speakerItemSchema).optional(),
  schedules: z.array(scheduleItemSchema).optional()
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
  progress: z.coerce.number().int().min(0).max(100).default(0)
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
  price: z.coerce.number().min(0).default(0),
  currency: z.string().default('IDR'),
  quantity: z.coerce.number().int().min(1),
  sale_start_at: z.string().optional(),
  sale_end_at: z.string().optional(),
  min_per_order: z.coerce.number().int().min(1).default(1),
  max_per_order: z.coerce.number().int().min(1).default(5),
  status: z.enum(['Draft', 'Scheduled', 'On Sale', 'Sold Out', 'Sales Ended', 'Disabled']).default('On Sale')
})

export const orderCreateSchema = z.object({
  event_id: z.string().min(1),
  ticket_type_id: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(10),
  attendee: z.object({
    full_name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(6)
  })
})

export const checkinSchema = z.object({
  code: z.string().min(3),
  station: z.string().default('Gate A - Main Lobby')
})

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
  value: z.string().optional(),
  status: z.enum(['Pending', 'Confirmed', 'Completed', 'Cancelled']).default('Pending')
})

export const sponsorSchema = z.object({
  name: z.string().min(2),
  tier: z.string().min(2),
  contribution: z.string().optional(),
  pic: z.string().optional(),
  status: z.enum(['Pending', 'Confirmed', 'Cancelled']).default('Pending')
})

export const moderationNoteSchema = z.object({
  notes: z.string().optional()
})

export const categorySchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  icon: z.string().optional()
})

export const reportCreateSchema = z.object({
  reason: z.string().min(3),
  description: z.string().min(5)
})
