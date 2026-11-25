import { AppError } from '../utils/response.js'
import {
  generateTicketCode,
  generateOrderNumber,
  generateQrToken,
  hashQrToken,
  slugify
} from '../utils/crypto.js'
import { parseTicketQrPayload } from '../utils/qrcode.js'

export const MODULE_CATALOG = [
  { key: 'event_profile', name: 'Event Profile', isCore: true, dependsOn: [] },
  { key: 'timeline', name: 'Project Timeline', isCore: false, dependsOn: ['event_profile'] },
  { key: 'tasks', name: 'Task Management', isCore: false, dependsOn: ['event_profile'] },
  { key: 'team', name: 'Team Management', isCore: false, dependsOn: ['event_profile'] },
  { key: 'ticketing', name: 'Ticketing', isCore: false, dependsOn: ['event_profile'] },
  { key: 'participants', name: 'Participant Management', isCore: false, dependsOn: ['ticketing'] },
  { key: 'check_in', name: 'Check-in Scanner', isCore: false, dependsOn: ['ticketing'] },
  { key: 'finance', name: 'Finance', isCore: false, dependsOn: ['event_profile'] },
  { key: 'vendors', name: 'Vendor Management', isCore: false, dependsOn: ['event_profile'] },
  { key: 'sponsors', name: 'Sponsor Management', isCore: false, dependsOn: ['event_profile'] },
  { key: 'documents', name: 'Document Management', isCore: false, dependsOn: ['event_profile'] },
  { key: 'reports', name: 'Reports & Analytics', isCore: false, dependsOn: ['event_profile'] },
  { key: 'feedback', name: 'Feedback & Survey', isCore: false, dependsOn: ['event_profile'] }
]

class BackendStore {
  [key: string]: any
  users: any[]
  categories: any[]
  organizations: any[]
  organizationMembers: any[]
  events: any[]
  schedules: any[]
  tasks: any[]
  taskComments: any[]
  teamMembers: any[]
  teamInvites: any[]
  ticketTypes: any[]
  orders: any[]
  participants: any[]
  tickets: any[]
  checkinLogs: any[]
  budgets: Record<string, any>
  incomes: any[]
  expenses: any[]
  vendors: any[]
  sponsors: any[]
  documents: any[]
  surveys: any[]
  verifications: any[]
  reports: any[]
  moderationLogs: any[]
  activityLogs: any[]
  notifications: any[]
  companionPosts: any[]
  pricingPlans: any[]
  bundlePackages: any[]
  promoCodes: any[]
  eventSubscriptions: any[]
  bundleCredits: any[]
  billingTransactions: any[]
  billingAuditLogs: any[]
  emailOutbox: any[]

  constructor() {
    this.reset()
  }

  reset() {
    this.users = [
      {
        id: 'usr-organizer',
        full_name: 'Hikam Pratama',
        username: 'hikam',
        email: 'organizer@nusantaratech.id',
        phone: '081234567890',
        bio: 'Lead Event Architect at Nusantara Tech.',
        role: 'organizer',
        is_suspended: false,
        subscription_plan: 'pro_monthly',
        subscription_status: 'active',
        subscription_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'usr-customer',
        full_name: 'Nadia Putri',
        username: 'nadiaputri',
        email: 'peserta@terra.id',
        phone: '081345678901',
        bio: 'Software engineer & tech conference enthusiast.',
        role: 'customer',
        is_suspended: false
      },
      {
        id: 'usr-admin',
        full_name: 'System Administrator',
        username: 'sysadmin',
        email: 'admin@terra.id',
        phone: '081100001111',
        bio: 'TERRA Platform Trust & Safety.',
        role: 'admin',
        is_suspended: false
      }
    ]

    this.categories = [
      { id: 'cat-1', name: 'Teknologi & Startup', slug: 'teknologi-startup', icon: 'Cpu', is_active: true },
      { id: 'cat-2', name: 'Musik & Konser', slug: 'musik-konser', icon: 'Music', is_active: true },
      { id: 'cat-3', name: 'Workshop & Edukasi', slug: 'workshop-edukasi', icon: 'BookOpen', is_active: true },
      { id: 'cat-4', name: 'Bisnis & Karir', slug: 'bisnis-karir', icon: 'Briefcase', is_active: true },
      { id: 'cat-5', name: 'Komunitas & Sosial', slug: 'komunitas-sosial', icon: 'Users', is_active: true },
      { id: 'cat-6', name: 'Seni & Desain', slug: 'seni-desain', icon: 'Palette', is_active: true }
    ]

    this.organizations = [
      {
        id: 'org-1',
        name: 'Nusantara Tech Community',
        slug: 'nusantara-tech',
        description: 'Komunitas pengembang perangkat lunak, AI, dan ekosistem startup Indonesia.',
        logo_url: 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=200&q=80',
        cover_url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&q=80',
        email: 'hello@nusantaratech.id',
        phone: '+62 812 3456 7890',
        website: 'https://nusantaratech.id',
        verification_status: 'verified',
        created_by: 'usr-organizer',
        members: [
          { id: 'om-1', user_id: 'usr-organizer', name: 'Hikam Pratama', email: 'organizer@nusantaratech.id', role: 'Owner', status: 'active' }
        ]
      },
      {
        id: 'org-2',
        name: 'Kreatif Studio Lab',
        slug: 'kreatif-studio-lab',
        description: 'Penyelenggara workshop desain produk, UI/UX, dan pameran seni kontemporer.',
        logo_url: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=200&q=80',
        cover_url: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=1200&q=80',
        email: 'team@kreatiflab.id',
        phone: '+62 813 9876 5432',
        website: 'https://kreatiflab.id',
        verification_status: 'pending',
        created_by: 'usr-organizer',
        members: [
          { id: 'om-2', user_id: 'usr-organizer', name: 'Hikam Pratama', email: 'organizer@nusantaratech.id', role: 'Admin', status: 'active' }
        ]
      }
    ]

    this.events = [
      {
        id: 'evt-1',
        organization_id: 'org-1',
        title: 'Indonesia Fullstack & AI Summit 2026',
        slug: 'indonesia-fullstack-ai-summit-2026',
        description:
          'Konferensi tahunan membahas arsitektur web modern, Vue 3, Node.js, dan implementasi AI generatif di skala produksi bersama 20+ praktisi industri.',
        category_id: 'cat-1',
        category: 'Teknologi & Startup',
        poster_url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=900&q=80',
        banner_url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1400&q=80',
        gallery: [
          'https://images.unsplash.com/photo-1511578314322-379afb476865?w=500&q=80',
          'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=500&q=80'
        ],
        speakers: [
          {
            id: 'sp-1',
            name: 'Dr. Aris Wibowo',
            type: 'Keynote Speaker',
            role_title: 'VP of AI Engineering • Nusantara Cloud',
            topic: 'Production-Grade Generative AI',
            avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&q=80'
          },
          {
            id: 'sp-2',
            name: 'Sarah Wijaya',
            type: 'Pemateri',
            role_title: 'Principal Frontend Architect • TechScale',
            topic: 'Scalable Decoupled Vue 3 Architecture',
            avatar_url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&q=80'
          },
          {
            id: 'sp-3',
            name: 'Reza Prakoso',
            type: 'Guest Star',
            role_title: 'Tech Content Creator & Founder',
            topic: 'Fireside Chat: Future of Indonesian Developers',
            avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80'
          }
        ],
        location_type: 'hybrid',
        location_name: 'Jakarta Convention Center (Hall B)',
        address: 'Jl. Gatot Subroto, Senayan, Jakarta Pusat',
        start_at: '2026-12-12T09:00:00+07:00',
        end_at: '2026-12-12T17:30:00+07:00',
        timezone: 'Asia/Jakarta',
        capacity: 600,
        status: 'Published',
        publication_status: 'Published',
        visibility: 'public',
        is_featured: true,
        enabled_modules: [
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
          'reports',
          'feedback'
        ],
        deleted_at: null
      },
      {
        id: 'evt-2',
        organization_id: 'org-2',
        title: 'Design Systems & Product Craft Workshop',
        slug: 'design-systems-product-craft-workshop',
        description: 'Hands-on workshop membangun design system yang konsisten menggunakan Figma Tokens dan Tailwind CSS.',
        category_id: 'cat-6',
        category: 'Seni & Desain',
        poster_url: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=900&q=80',
        banner_url: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=1400&q=80',
        location_type: 'offline',
        location_name: 'Bandung Creative Hub',
        address: 'Jl. Laswi No.7, Bandung',
        start_at: '2026-12-20T13:00:00+07:00',
        end_at: '2026-12-20T17:00:00+07:00',
        timezone: 'Asia/Jakarta',
        capacity: 80,
        status: 'Published',
        publication_status: 'Published',
        visibility: 'public',
        is_featured: true,
        enabled_modules: ['event_profile', 'timeline', 'tasks', 'ticketing', 'participants', 'check_in', 'finance', 'reports'],
        deleted_at: null
      },
      {
        id: 'evt-3',
        organization_id: 'org-1',
        title: 'Startup Founder & Investor Networking Night',
        slug: 'startup-founder-investor-networking-night',
        description: 'Sesi networking eksklusif bagi founder tahap awal untuk bertukar wawasan dan pitching singkat.',
        category_id: 'cat-4',
        category: 'Bisnis & Karir',
        poster_url: 'https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=900&q=80',
        banner_url: 'https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=1400&q=80',
        location_type: 'offline',
        location_name: 'SCBD Equity Tower Lounge',
        address: 'Sudirman Central Business District, Jakarta',
        start_at: '2027-01-10T18:30:00+07:00',
        end_at: '2027-01-10T21:30:00+07:00',
        timezone: 'Asia/Jakarta',
        capacity: 120,
        status: 'Preparation',
        publication_status: 'Pending Review',
        visibility: 'public',
        is_featured: false,
        enabled_modules: ['event_profile', 'timeline', 'tasks', 'team', 'ticketing', 'participants', 'check_in'],
        deleted_at: null
      }
    ]

    this.ticketTypes = [
      {
        id: 'tkt-1',
        event_id: 'evt-1',
        name: 'Community Free Pass',
        description: 'Akses penuh seluruh sesi keynote & networking area.',
        price: 0,
        currency: 'IDR',
        quantity: 300,
        sold_quantity: 214,
        sale_start_at: '2026-10-01T00:00:00+07:00',
        sale_end_at: '2026-12-11T23:59:00+07:00',
        min_per_order: 1,
        max_per_order: 3,
        status: 'On Sale'
      },
      {
        id: 'tkt-vip-1',
        event_id: 'evt-1',
        name: 'VIP Executive Pass',
        description: 'Kursi barisan depan, makan siang eksklusif, & akses Speaker Lounge.',
        price: 250000,
        currency: 'IDR',
        quantity: 100,
        sold_quantity: 48,
        sale_start_at: '2026-10-01T00:00:00+07:00',
        sale_end_at: '2026-12-11T23:59:00+07:00',
        min_per_order: 1,
        max_per_order: 4,
        status: 'On Sale'
      },
      {
        id: 'tkt-2',
        event_id: 'evt-1',
        name: 'Online Livestream Pass',
        description: 'Akses streaming HD + rekaman sesi selama 30 hari.',
        price: 0,
        currency: 'IDR',
        quantity: 200,
        sold_quantity: 89,
        sale_start_at: '2026-10-01T00:00:00+07:00',
        sale_end_at: '2026-12-12T09:00:00+07:00',
        min_per_order: 1,
        max_per_order: 2,
        status: 'On Sale'
      },
      {
        id: 'tkt-3',
        event_id: 'evt-2',
        name: 'Regular Workshop Seat',
        description: 'Termasuk materi workshop, sertifikat digital, dan snack.',
        price: 150000,
        currency: 'IDR',
        quantity: 80,
        sold_quantity: 62,
        sale_start_at: '2026-10-15T00:00:00+07:00',
        sale_end_at: '2026-12-19T23:59:00+07:00',
        min_per_order: 1,
        max_per_order: 2,
        status: 'On Sale'
      }
    ]

    this.schedules = [
      {
        id: 'sch-1',
        event_id: 'evt-1',
        title: 'Registrasi & Morning Coffee',
        date: '2026-12-12',
        start_time: '08:30',
        end_time: '09:30',
        location: 'Main Lobby',
        pic: 'Rina Kusuma',
        visibility: 'public'
      },
      {
        id: 'sch-2',
        event_id: 'evt-1',
        title: 'Keynote: Scalable Decoupled Web Architecture',
        date: '2026-12-12',
        start_time: '09:30',
        end_time: '11:00',
        location: 'Hall B Stage',
        pic: 'Andi Pratama',
        visibility: 'public'
      }
    ]

    this.tasks = [
      {
        id: 'chk-p1',
        parent_id: null,
        is_group: true,
        event_id: 'evt-1',
        title: 'Persiapan Acara (2 Minggu)',
        phase: 'Pre-Event',
        assigned_to: 'Hikam Pratama',
        priority: 'High',
        status: 'In Progress',
        start_date: '2026-11-01',
        due_at: '2026-11-15',
        progress: 80,
        comments: []
      },
      {
        id: 'tsk-1',
        parent_id: 'chk-p1',
        is_group: false,
        event_id: 'evt-1',
        title: 'Konsep Acara & Tema Utama',
        phase: 'Pre-Event',
        assigned_to: 'Rina Kusuma',
        priority: 'High',
        status: 'Done',
        start_date: '2026-11-01',
        due_at: '2026-11-05',
        progress: 100,
        comments: []
      },
      {
        id: 'tsk-1b',
        parent_id: 'chk-p1',
        is_group: false,
        event_id: 'evt-1',
        title: 'Penyusunan Rundown & Kurasi Pembicara',
        phase: 'Pre-Event',
        assigned_to: 'Rina Kusuma',
        priority: 'High',
        status: 'Done',
        start_date: '2026-11-05',
        due_at: '2026-11-10',
        progress: 100,
        comments: []
      },
      {
        id: 'tsk-1c',
        parent_id: 'chk-p1',
        is_group: false,
        event_id: 'evt-1',
        title: 'Booking Venue & Kontrak Hall B JCC',
        phase: 'Pre-Event',
        assigned_to: 'Hikam Pratama',
        priority: 'High',
        status: 'In Progress',
        start_date: '2026-11-10',
        due_at: '2026-11-15',
        progress: 50,
        comments: []
      },
      {
        id: 'chk-p2',
        parent_id: null,
        is_group: true,
        event_id: 'evt-1',
        title: 'Marketing & Publikasi Tiket',
        phase: 'Marketing',
        assigned_to: 'Rina Kusuma',
        priority: 'Medium',
        status: 'In Progress',
        start_date: '2026-11-14',
        due_at: '2026-12-01',
        progress: 55,
        comments: []
      },
      {
        id: 'tsk-3',
        parent_id: 'chk-p2',
        is_group: false,
        event_id: 'evt-1',
        title: 'Kampanye Sosial Media & Partner Blast',
        phase: 'Marketing',
        assigned_to: 'Rina Kusuma',
        priority: 'Medium',
        status: 'In Progress',
        start_date: '2026-11-14',
        due_at: '2026-11-24',
        progress: 60,
        comments: []
      },
      {
        id: 'tsk-3b',
        parent_id: 'chk-p2',
        is_group: false,
        event_id: 'evt-1',
        title: 'Email Blast & Early Bird Reminder',
        phase: 'Marketing',
        assigned_to: 'Andi Pratama',
        priority: 'Medium',
        status: 'To Do',
        start_date: '2026-11-23',
        due_at: '2026-12-01',
        progress: 20,
        comments: []
      },
      {
        id: 'chk-p3',
        parent_id: null,
        is_group: true,
        event_id: 'evt-1',
        title: 'Produksi, Vendor & Persiapan Hari-H',
        phase: 'Production',
        assigned_to: 'Budi Santoso',
        priority: 'High',
        status: 'In Progress',
        start_date: '2026-11-18',
        due_at: '2026-12-12',
        progress: 50,
        comments: []
      },
      {
        id: 'tsk-2',
        parent_id: 'chk-p3',
        is_group: false,
        event_id: 'evt-1',
        title: 'Finalisasi Kontrak Audio & LED Stage',
        phase: 'Production',
        assigned_to: 'Budi Santoso',
        priority: 'High',
        status: 'In Progress',
        start_date: '2026-11-18',
        due_at: '2026-11-29',
        progress: 65,
        comments: []
      },
      {
        id: 'tsk-4',
        parent_id: 'chk-p3',
        is_group: false,
        event_id: 'evt-1',
        title: 'Konfirmasi Slide Materi Pembicara',
        phase: 'Production',
        assigned_to: 'Rina Kusuma',
        priority: 'Medium',
        status: 'To Do',
        start_date: '2026-11-28',
        due_at: '2026-12-08',
        progress: 15,
        comments: []
      },
      {
        id: 'tsk-5',
        parent_id: 'chk-p3',
        is_group: false,
        event_id: 'evt-1',
        title: 'Gladi Resik & Setup Gate QR Scanner',
        phase: 'Event Day',
        assigned_to: 'Andi Pratama',
        priority: 'High',
        status: 'Review',
        start_date: '2026-12-08',
        due_at: '2026-12-12',
        progress: 85,
        comments: []
      },
      {
        id: 'chk-p4',
        parent_id: null,
        is_group: true,
        event_id: 'evt-1',
        title: 'Pelaksanaan & Evaluasi Pasca Acara',
        phase: 'Post-Event',
        assigned_to: 'Hikam Pratama',
        priority: 'Medium',
        status: 'To Do',
        start_date: '2026-12-12',
        due_at: '2026-12-22',
        progress: 10,
        comments: []
      },
      {
        id: 'tsk-6',
        parent_id: 'chk-p4',
        is_group: false,
        event_id: 'evt-1',
        title: 'Registrasi Ulang & Acara Utama Hari-H',
        phase: 'Event Day',
        assigned_to: 'Seluruh Panitia',
        priority: 'High',
        status: 'To Do',
        start_date: '2026-12-12',
        due_at: '2026-12-14',
        progress: 0,
        comments: []
      },
      {
        id: 'tsk-7',
        parent_id: 'chk-p4',
        is_group: false,
        event_id: 'evt-1',
        title: 'Rekap Keuangan, Survei & Laporan Akhir',
        phase: 'Post-Event',
        assigned_to: 'Hikam Pratama',
        priority: 'Medium',
        status: 'To Do',
        start_date: '2026-12-15',
        due_at: '2026-12-22',
        progress: 0,
        comments: []
      }
    ]

    this.orders = [
      {
        id: 'ord-1',
        order_number: 'ORD-20261116-001',
        event_id: 'evt-1',
        customer_id: 'usr-customer',
        subtotal: 0,
        total: 0,
        currency: 'IDR',
        order_status: 'Confirmed',
        payment_status: 'Not Required',
        created_at: '2026-11-16T10:00:00Z'
      }
    ]

    this.participants = [
      {
        id: 'pt-1',
        event_id: 'evt-1',
        order_id: 'ord-1',
        user_id: 'usr-customer',
        full_name: 'Nadia Putri',
        email: 'peserta@terra.id',
        phone: '081345678901',
        ticket_type: 'VIP Executive Pass',
        ticket_code: 'EVT26-9841-AB',
        order_number: 'ORD-20261116-001',
        registration_status: 'Confirmed',
        checked_in: false
      },
      {
        id: 'pt-2',
        event_id: 'evt-1',
        order_id: 'ord-1',
        user_id: 'usr-customer',
        full_name: 'Nadia Putri',
        email: 'nadia@example.com',
        phone: '081345678901',
        ticket_type: 'Community Free Pass',
        ticket_code: 'EVT26-3310-XY',
        order_number: 'ORD-20261116-002',
        registration_status: 'Confirmed',
        checked_in: true
      },
      {
        id: 'pt-3',
        event_id: 'evt-1',
        order_id: null,
        user_id: null,
        full_name: 'Dimas Wijaya',
        email: 'dimas@example.com',
        phone: '081567890123',
        ticket_type: 'Online Livestream Pass',
        ticket_code: 'EVT26-7721-KL',
        order_number: 'ORD-20261116-003',
        registration_status: 'Confirmed',
        checked_in: false
      },
      {
        id: 'pt-4',
        event_id: 'evt-1',
        order_id: null,
        user_id: null,
        full_name: 'Siti Rahmawati',
        email: 'siti@example.com',
        phone: '081711223344',
        ticket_type: 'VIP Executive Pass',
        ticket_code: 'EVT26-4402-MN',
        order_number: 'ORD-20261116-004',
        registration_status: 'Confirmed',
        checked_in: true
      }
    ]

    this.tickets = [
      {
        id: 'tc-1',
        event_id: 'evt-1',
        order_id: 'ord-1',
        attendee_id: 'pt-1',
        ticket_type_id: 'tkt-vip-1',
        ticket_type: 'VIP Executive Pass',
        ticket_code: 'EVT26-9841-AB',
        qr_payload: 'TERRA:EVT26-9841-AB:evt-1',
        qr_token_hash: hashQrToken('TERRA:EVT26-9841-AB:evt-1'),
        participant_name: 'Nadia Putri',
        order_number: 'ORD-20261116-001',
        event_title: 'Indonesia Fullstack & AI Summit 2026',
        event_date: '2026-12-12T09:00:00+07:00',
        location: 'Jakarta Convention Center (Hall B)',
        status: 'Active',
        issued_at: '2026-11-16T10:00:00Z',
        used_at: null
      },
      {
        id: 'tc-2',
        event_id: 'evt-1',
        order_id: 'ord-1',
        attendee_id: 'pt-2',
        ticket_type_id: 'tkt-1',
        ticket_type: 'Community Free Pass',
        ticket_code: 'EVT26-3310-XY',
        qr_payload: 'TERRA:EVT26-3310-XY:evt-1',
        qr_token_hash: hashQrToken('TERRA:EVT26-3310-XY:evt-1'),
        participant_name: 'Nadia Putri',
        order_number: 'ORD-20261116-002',
        event_title: 'Indonesia Fullstack & AI Summit 2026',
        event_date: '2026-12-12T09:00:00+07:00',
        location: 'Jakarta Convention Center (Hall B)',
        status: 'Used',
        issued_at: '2026-11-16T08:00:00Z',
        used_at: '2026-11-16T08:42:00Z'
      },
      {
        id: 'tc-3',
        event_id: 'evt-1',
        order_id: null,
        attendee_id: 'pt-3',
        ticket_type_id: 'tkt-2',
        ticket_type: 'Online Livestream Pass',
        ticket_code: 'EVT26-7721-KL',
        qr_payload: 'TERRA:EVT26-7721-KL:evt-1',
        qr_token_hash: hashQrToken('TERRA:EVT26-7721-KL:evt-1'),
        participant_name: 'Dimas Wijaya',
        order_number: 'ORD-20261116-003',
        event_title: 'Indonesia Fullstack & AI Summit 2026',
        event_date: '2026-12-12T09:00:00+07:00',
        location: 'Jakarta Convention Center (Hall B)',
        status: 'Active',
        issued_at: '2026-11-16T08:15:00Z',
        used_at: null
      },
      {
        id: 'tc-4',
        event_id: 'evt-1',
        order_id: null,
        attendee_id: 'pt-4',
        ticket_type_id: 'tkt-vip-1',
        ticket_type: 'VIP Executive Pass',
        ticket_code: 'EVT26-4402-MN',
        qr_payload: 'TERRA:EVT26-4402-MN:evt-1',
        qr_token_hash: hashQrToken('TERRA:EVT26-4402-MN:evt-1'),
        participant_name: 'Siti Rahmawati',
        order_number: 'ORD-20261116-004',
        event_title: 'Indonesia Fullstack & AI Summit 2026',
        event_date: '2026-12-12T09:00:00+07:00',
        location: 'Jakarta Convention Center (Hall B)',
        status: 'Used',
        issued_at: '2026-11-16T08:20:00Z',
        used_at: '2026-11-16T08:55:00Z'
      }
    ]

    this.checkinLogs = [
      {
        id: 'chk-1',
        event_id: 'evt-1',
        ticket_id: 'tc-2',
        ticket_code: 'EVT26-3310-XY',
        participant_name: 'Nadia Putri',
        ticket_type: 'Community Free Pass',
        station: 'Gate A - Main Lobby',
        checked_in_at: '08:42 WIB'
      },
      {
        id: 'chk-2',
        event_id: 'evt-1',
        ticket_id: 'tc-4',
        ticket_code: 'EVT26-4402-MN',
        participant_name: 'Siti Rahmawati',
        ticket_type: 'VIP Executive Pass',
        station: 'Gate B - VIP Lounge',
        checked_in_at: '08:55 WIB'
      }
    ]

    this.teamMembers = [
      { id: 'tm-1', event_id: 'evt-1', name: 'Hikam Pratama', email: 'hikam@example.com', role: 'Owner', department: 'Executive Core', permissions: ['View Event', 'Edit Event', 'Manage Timeline', 'Manage Tickets', 'View Participants', 'Manage Check-in', 'View Finance', 'Manage Team'] },
      { id: 'tm-2', event_id: 'evt-1', name: 'Rina Kusuma', email: 'rina@example.com', role: 'Manager', department: 'Program & Timeline', permissions: ['View Event', 'Manage Timeline', 'View Participants'] },
      { id: 'tm-3', event_id: 'evt-1', name: 'Budi Santoso', email: 'budi@example.com', role: 'Staff', department: 'Gate & Check-in Desk', permissions: ['View Event', 'Manage Check-in'] }
    ]
    this.teamInvites = []

    this.budgets = { 'evt-1': 75000000, 'evt-2': 15000000 }
    this.incomes = [
      { id: 'inc-1', event_id: 'evt-1', category: 'Sponsorship', description: 'Sponsor Utama CloudTech', amount: 45000000, date: '2026-11-01' },
      { id: 'inc-2', event_id: 'evt-1', category: 'Partner Grant', description: 'Dukungan Komunitas', amount: 15000000, date: '2026-11-05' }
    ]
    this.expenses = [
      { id: 'exp-1', event_id: 'evt-1', category: 'Venue', description: 'Sewa Hall B JCC (DP)', amount: 25000000, date: '2026-11-03' },
      { id: 'exp-2', event_id: 'evt-1', category: 'AV & Stage', description: 'Vendor Sound & LED Screen', amount: 12500000, date: '2026-11-10' }
    ]

    this.vendors = [
      { id: 'v-1', event_id: 'evt-1', name: 'Nusantara AV Production', category: 'Audio & LED Stage', contact: '0812-8899-1122', value: 'Rp 12.500.000', status: 'Confirmed' }
    ]
    this.sponsors = [
      { id: 's-1', event_id: 'evt-1', name: 'CloudTech Indonesia', tier: 'Platinum Sponsor', contribution: 'Rp 45.000.000', pic: 'Aditya', status: 'Confirmed' }
    ]
    this.documents = [
      { id: 'd-1', event_id: 'evt-1', file_name: 'Proposal_Sponsorship_2026.pdf', category: 'Sponsorship', visibility: 'internal', file_path: 'events/evt-1/proposal.pdf', created_at: '2026-11-10T09:00:00Z' }
    ]
    this.surveys = [
      { id: 'srv-1', event_id: 'evt-1', title: 'Survei Kepuasan Peserta', description: 'Bantu kami meningkatkan kualitas event berikutnya.', is_active: true, responses: [] }
    ]

    this.verifications = [
      { id: 'ver-1', organization_id: 'org-2', submitted_by: 'usr-organizer', verification_status: 'pending', documents: ['akta_pendirian.pdf'], review_notes: '' }
    ]
    this.moderationLogs = []
    this.activityLogs = []
    this.reports = []
    this.companionPosts = [
      {
        id: 'cmp-1',
        event_id: 'evt-1',
        author_id: 'usr-customer',
        title: 'Barengan MRT / KRL ke Hall B JCC dari Jakarta Selatan',
        departure_city: 'Jakarta Selatan',
        departure_point: 'Stasiun MRT Blok M (Pintu Keluar B)',
        departure_time: '07:45 WIB',
        transport_mode: 'KRL / MRT / TransJakarta',
        slots_available: 4,
        contact_note: 'Balas di forum ini dulu biar koordinasi bareng',
        notes: 'Berangkat pagi biar sempat registrasi & morning coffee bareng sebelum keynote. Santai & ramah untuk yang datang sendiri!',
        status: 'open',
        created_at: '2026-11-17T08:00:00Z',
        updated_at: '2026-11-17T08:00:00Z'
      }
    ]
    this.companionReplies = [
      {
        id: 'cmpr-1',
        post_id: 'cmp-1',
        author_id: 'usr-organizer',
        message: 'Sampai jumpa di venue! Pintu registrasi Hall B dibuka mulai pukul 08:15 WIB ya.',
        created_at: '2026-11-17T08:30:00Z'
      }
    ]
    this.emailOutbox = []
    this.notifications = [
      { id: 'ntf-1', user_id: 'usr-organizer', title: 'Event Disetujui', message: 'Indonesia Fullstack & AI Summit 2026 telah dipublikasikan di marketplace.', is_read: false, created_at: '2026-11-16T09:00:00Z' }
    ]

    this.pricingPlans = [
      {
        id: 'plan-free',
        code: 'free',
        name: 'FREE',
        tagline: 'Mulai Gratis Tanpa Kartu Kredit',
        description: 'Untuk pengguna pemula, organisasi mahasiswa, dan komunitas kecil.',
        price_idr: 0,
        billing_model: 'per_event',
        is_popular: false,
        is_active: true,
        sort_order: 1,
        max_active_events: 1,
        max_participants: 100,
        max_team_members: 3,
        max_storage_mb: 50,
        allowed_modules: ['event_profile', 'timeline', 'team'],
        features: [
          '1 event aktif gratis',
          'Event profile & landing page',
          'Basic timeline dan rundown',
          'Basic team management (maks 3 panitia)',
          'Registrasi peserta maksimal 100 orang',
          'Marketplace listing standar'
        ],
        trial_days: 0,
        early_access_price_idr: null,
        early_access_limit: 100,
        community_discount_pct: 0,
        allow_downgrade: true
      },
      {
        id: 'plan-starter',
        code: 'starter',
        name: 'STARTER',
        tagline: 'Tiket QR & Check-in Praktis',
        description: 'Untuk event kecil hingga menengah seperti seminar, workshop, dan meetup kampus.',
        price_idr: 49000,
        billing_model: 'per_event',
        is_popular: false,
        is_active: true,
        sort_order: 2,
        max_active_events: 50,
        max_participants: 500,
        max_team_members: 10,
        max_storage_mb: 250,
        allowed_modules: [
          'event_profile',
          'timeline',
          'tasks',
          'team',
          'ticketing',
          'participants',
          'check_in',
          'documents',
          'reports'
        ],
        features: [
          'Semua fitur Free',
          'Maksimal 500 peserta per event',
          'Ticketing & QR Ticket otomatis via email',
          'Participant & Check-in scanner gate',
          'Task & Document management',
          'Participant reports & basic branding'
        ],
        trial_days: 0,
        early_access_price_idr: 39000,
        early_access_limit: 100,
        community_discount_pct: 20,
        allow_downgrade: true
      },
      {
        id: 'plan-pro',
        code: 'pro',
        name: 'PRO',
        tagline: 'Paling Populer • All-in-One Studio',
        description: 'Untuk event profesional dan organisasi yang membutuhkan pengelolaan lengkap.',
        price_idr: 129000,
        billing_model: 'per_event',
        is_popular: true,
        is_active: true,
        sort_order: 3,
        max_active_events: 100,
        max_participants: 2000,
        max_team_members: 25,
        max_storage_mb: 1024,
        allowed_modules: [
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
        ],
        features: [
          'Semua fitur Starter',
          'Maksimal 2.000 peserta per event',
          'Seluruh 13 modul manajemen event terbuka',
          'Finance, budgeting & pencatatan kas otomatis',
          'Vendor, Sponsor, Survey & Feedback',
          'Advanced analytics, complete reporting & priority support'
        ],
        trial_days: 14,
        early_access_price_idr: 99000,
        early_access_limit: 100,
        community_discount_pct: 25,
        allow_downgrade: true
      },
      {
        id: 'plan-ultimate',
        code: 'ultimate',
        name: 'ULTIMATE',
        tagline: 'Skala Festival & Konferensi Besar',
        description: 'Untuk festival, konferensi nasional, konser, dan event korporasi berskala besar.',
        price_idr: 299000,
        billing_model: 'per_event',
        is_popular: false,
        is_active: true,
        sort_order: 4,
        max_active_events: 999,
        max_participants: 10000,
        max_team_members: 100,
        max_storage_mb: 5120,
        allowed_modules: [
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
        ],
        features: [
          'Semua fitur Pro tanpa kompromi',
          'Maksimal 10.000 peserta per event',
          'Multi-team & granular role permission',
          'Complete data export & advanced customization',
          'Dedicated event support via WhatsApp & tim TERRA'
        ],
        trial_days: 0,
        early_access_price_idr: 249000,
        early_access_limit: 100,
        community_discount_pct: 20,
        allow_downgrade: true
      }
    ]

    this.bundlePackages = [
      {
        id: 'bnd-pro-3',
        code: 'bundle-3-pro',
        name: '3 Event PRO Bundle',
        plan_code: 'pro',
        event_quota: 3,
        bundle_price_idr: 299000,
        description: 'Hemat Rp 88.000! Aktifkan paket PRO penuh untuk 3 event berbeda kapan saja.',
        is_active: true
      },
      {
        id: 'bnd-starter-3',
        code: 'bundle-3-starter',
        name: '3 Event STARTER Bundle',
        plan_code: 'starter',
        event_quota: 3,
        bundle_price_idr: 119000,
        description: 'Paket hemat organisasi & himpunan mahasiswa untuk 3 agenda event per tahun.',
        is_active: true
      }
    ]

    this.promoCodes = [
      {
        id: 'prm-early',
        code: 'EARLY100',
        name: 'Early Access 100 Organizer Pertama',
        promo_type: 'early_access',
        discount_type: 'percent',
        discount_value: 20,
        applies_to_plan: null,
        requires_verification: false,
        max_redemptions: 100,
        used_count: 12,
        is_active: true
      },
      {
        id: 'prm-community',
        code: 'BEMUKM25',
        name: 'Diskon Komunitas, BEM & UKM Mahasiswa',
        promo_type: 'community',
        discount_type: 'percent',
        discount_value: 25,
        applies_to_plan: null,
        requires_verification: true,
        max_redemptions: null,
        used_count: 5,
        is_active: true
      }
    ]

    this.eventSubscriptions = [
      {
        id: 'sub-evt-1',
        event_id: 'evt-1',
        organization_id: 'org-1',
        plan_code: 'pro',
        plan_name: 'PRO',
        price_snapshot_idr: 129000,
        limits_snapshot: {
          max_active_events: 100,
          max_participants: 2000,
          max_team_members: 25,
          max_storage_mb: 1024,
          allowed_modules: [
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
        },
        status: 'active',
        is_trial: false,
        trial_started_at: null,
        trial_ends_at: null,
        activated_at: '2026-11-01T09:00:00Z'
      },
      {
        id: 'sub-evt-2',
        event_id: 'evt-2',
        organization_id: 'org-2',
        plan_code: 'pro',
        plan_name: 'PRO',
        price_snapshot_idr: 129000,
        limits_snapshot: {
          max_active_events: 100,
          max_participants: 2000,
          max_team_members: 25,
          max_storage_mb: 1024,
          allowed_modules: [
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
        },
        status: 'active',
        is_trial: false,
        trial_started_at: null,
        trial_ends_at: null,
        activated_at: '2026-11-01T09:00:00Z'
      },
      {
        id: 'sub-evt-3',
        event_id: 'evt-3',
        organization_id: 'org-1',
        plan_code: 'starter',
        plan_name: 'STARTER',
        price_snapshot_idr: 49000,
        limits_snapshot: {
          max_active_events: 50,
          max_participants: 500,
          max_team_members: 10,
          max_storage_mb: 250,
          allowed_modules: [
            'event_profile',
            'timeline',
            'tasks',
            'team',
            'ticketing',
            'participants',
            'check_in',
            'documents',
            'reports'
          ]
        },
        status: 'active',
        is_trial: false,
        trial_started_at: null,
        trial_ends_at: null,
        activated_at: '2026-11-05T09:00:00Z'
      }
    ]

    this.bundleCredits = []
    this.billingTransactions = []
    this.billingAuditLogs = []
  }

  getEvent(eventId) {
    const evt = this.events.find((e) => e.id === eventId && !e.deleted_at)
    if (!evt) throw new AppError('Event tidak ditemukan.', 404, 'EVENT_NOT_FOUND')
    return evt
  }

  isModuleEnabled(eventId, moduleKey) {
    const evt = this.getEvent(eventId)
    return evt.enabled_modules.includes(moduleKey)
  }

  toggleModule(eventId, moduleKey, isEnabled, userId) {
    const evt = this.getEvent(eventId)
    const mod = MODULE_CATALOG.find((m) => m.key === moduleKey)
    if (!mod) throw new AppError('Modul tidak valid.', 400, 'INVALID_MODULE')
    if (mod.isCore && !isEnabled) {
      throw new AppError('Event Profile adalah modul wajib dan tidak dapat dinonaktifkan.', 400, 'CORE_MODULE_REQUIRED')
    }

    if (isEnabled) {
      const missingDeps = mod.dependsOn.filter((dep) => !evt.enabled_modules.includes(dep))
      if (missingDeps.length > 0) {
        throw new AppError(
          `Modul ${mod.name} membutuhkan modul berikut aktif terlebih dahulu: ${missingDeps.join(', ')}`,
          400,
          'MODULE_DEPENDENCY_UNMET'
        )
      }
      if (!evt.enabled_modules.includes(moduleKey)) {
        evt.enabled_modules.push(moduleKey)
      }
    } else {
      const dependents = MODULE_CATALOG.filter((m) => m.dependsOn.includes(moduleKey)).map((m) => m.key)
      evt.enabled_modules = evt.enabled_modules.filter((k) => k !== moduleKey && !dependents.includes(k))
    }

    this.activityLogs.unshift({
      id: 'log-' + Date.now(),
      organization_id: evt.organization_id,
      event_id: evt.id,
      user_id: userId,
      action: isEnabled ? 'MODULE_ENABLED' : 'MODULE_DISABLED',
      entity_type: 'event_module',
      metadata: { moduleKey },
      created_at: new Date().toISOString()
    })

    return evt.enabled_modules
  }

  getPaidTicketBreakdown(eventId) {
    return this.ticketTypes
      .filter((t) => t.event_id === eventId && Number(t.price) > 0)
      .map((t) => ({
        ticket_type_id: t.id,
        name: t.name,
        price: Number(t.price),
        sold_quantity: Number(t.sold_quantity),
        revenue: Number(t.price) * Number(t.sold_quantity)
      }))
  }

  getFinanceSummary(eventId) {
    this.getEvent(eventId)
    const budget = this.budgets[eventId] || 0
    const paidBreakdown = this.getPaidTicketBreakdown(eventId)
    const paidTicketRevenue = paidBreakdown.reduce((s, t) => s + t.revenue, 0)
    const eventIncomes = this.incomes.filter((i) => i.event_id === eventId)
    const eventExpenses = this.expenses.filter((e) => e.event_id === eventId)
    const manualIncome = eventIncomes.reduce((s, i) => s + Number(i.amount), 0)
    const totalIncome = paidTicketRevenue + manualIncome
    const totalExpense = eventExpenses.reduce((s, e) => s + Number(e.amount), 0)

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

  createOrder({ event_id, ticket_type_id, quantity, attendee, customer_id }) {
    const evt = this.getEvent(event_id)
    if (evt.status === 'Cancelled') {
      throw new AppError('Event telah dibatalkan dan tidak menerima pemesanan.', 409, 'EVENT_CANCELLED')
    }
    if (evt.publication_status !== 'Published') {
      throw new AppError('Event belum dipublikasikan dan tidak menerima pemesanan.', 409, 'EVENT_NOT_PUBLISHED')
    }

    const tkt = this.ticketTypes.find((t) => t.id === ticket_type_id && t.event_id === event_id)
    if (!tkt) throw new AppError('Jenis tiket tidak ditemukan.', 404, 'TICKET_TYPE_NOT_FOUND')
    if (tkt.status !== 'On Sale') {
      throw new AppError(`Tiket sedang dalam status ${tkt.status}.`, 409, 'TICKET_NOT_ON_SALE')
    }

    const now = new Date()
    if (tkt.sale_start_at && new Date(tkt.sale_start_at) > now) {
      throw new AppError('Periode penjualan tiket ini belum dimulai.', 409, 'TICKET_SALE_NOT_STARTED')
    }
    if (tkt.sale_end_at && new Date(tkt.sale_end_at) < now) {
      throw new AppError('Periode penjualan tiket ini telah berakhir.', 409, 'TICKET_SALE_ENDED')
    }

    const minOrder = Number(tkt.min_per_order || 1)
    const maxOrder = Number(tkt.max_per_order || 10)
    if (quantity < minOrder || quantity > maxOrder) {
      throw new AppError(
        `Jumlah tiket harus antara ${minOrder} sampai ${maxOrder} per transaksi.`,
        400,
        'INVALID_TICKET_QUANTITY'
      )
    }

    const remaining = tkt.quantity - tkt.sold_quantity
    if (remaining < quantity) {
      throw new AppError('Kuota tiket tidak mencukupi.', 409, 'TICKET_SOLD_OUT')
    }

    // Reserve quota atomically
    tkt.sold_quantity += quantity
    if (tkt.sold_quantity >= tkt.quantity) {
      tkt.status = 'Sold Out'
    }

    const subtotal = Number(tkt.price) * quantity
    const isFree = Number(tkt.price) === 0
    const orderStatus = isFree ? 'Confirmed' : 'Pending'
    const paymentStatus = isFree ? 'Not Required' : 'Pending'
    const registrationStatus = isFree ? 'Confirmed' : 'Pending'
    const initialTicketStatus = isFree ? 'Active' : 'Pending'

    const order = {
      id: 'ord-' + Date.now(),
      order_number: generateOrderNumber(),
      event_id,
      customer_id,
      ticket_type_id,
      quantity,
      subtotal,
      total: subtotal,
      currency: tkt.currency,
      order_status: orderStatus,
      payment_status: paymentStatus,
      payment_method: isFree ? 'free' : 'midtrans_snap',
      payment_provider: isFree ? null : 'midtrans',
      payment_token: null,
      payment_redirect_url: null,
      payment_reference: null,
      payment_expires_at: null,
      paid_at: null,
      payment_metadata: {},
      payment_proof_url: null,
      payment_notes: null,
      verified_by: null,
      verified_at: null,
      created_at: new Date().toISOString()
    }
    this.orders.unshift(order)

    const participant = {
      id: 'pt-' + Date.now(),
      event_id,
      order_id: order.id,
      user_id: customer_id,
      full_name: attendee.full_name,
      email: attendee.email,
      phone: attendee.phone,
      ticket_type: tkt.name,
      ticket_code: null,
      order_number: order.order_number,
      registration_status: registrationStatus,
      registration_data: attendee.registration_data || {},
      checked_in: false
    }

    const issuedTickets = []
    for (let i = 0; i < quantity; i++) {
      const code = generateTicketCode()
      const rawToken = `TERRA:${code}:${event_id}:${generateQrToken().slice(0, 16)}`
      const ticket = {
        id: 'tc-' + Date.now() + '-' + i,
        event_id,
        event_title: evt.title,
        event_date: evt.start_at,
        location: evt.location_name,
        order_id: order.id,
        order_number: order.order_number,
        attendee_id: participant.id,
        ticket_type_id: tkt.id,
        ticket_type: tkt.name,
        ticket_code: code,
        qr_payload: rawToken,
        qr_token_hash: hashQrToken(rawToken),
        participant_name: attendee.full_name,
        status: initialTicketStatus,
        issued_at: new Date().toISOString(),
        used_at: null
      }
      if (i === 0) participant.ticket_code = code
      this.tickets.unshift(ticket)
      issuedTickets.push(ticket)
    }
    this.participants.unshift(participant)

    return { order, participant, tickets: issuedTickets }
  }

  cancelOrder(orderId, userId, isAdminOrAuthorized = false) {
    const order = this.orders.find((o) => o.id === orderId)
    if (!order) throw new AppError('Order tidak ditemukan.', 404, 'ORDER_NOT_FOUND')
    if (!isAdminOrAuthorized && order.customer_id !== userId) {
      throw new AppError('Tidak memiliki izin membatalkan order ini.', 403, 'FORBIDDEN')
    }
    if (order.order_status === 'Cancelled') {
      throw new AppError('Order sudah dibatalkan sebelumnya.', 409, 'ORDER_ALREADY_CANCELLED')
    }

    const orderTickets = this.tickets.filter((tk) => tk.order_id === order.id)
    if (orderTickets.some((tk) => tk.status === 'Used')) {
      throw new AppError('Order tidak dapat dibatalkan karena tiket sudah digunakan check-in.', 409, 'ORDER_ALREADY_USED')
    }

    // Restore ticket quota
    const tkt = this.ticketTypes.find((t) => t.id === order.ticket_type_id)
    if (tkt) {
      tkt.sold_quantity = Math.max(0, tkt.sold_quantity - order.quantity)
      if (tkt.status === 'Sold Out' && tkt.sold_quantity < tkt.quantity) {
        tkt.status = 'On Sale'
      }
    }

    order.order_status = 'Cancelled'
    orderTickets.forEach((tk) => {
      tk.status = 'Cancelled'
    })
    this.participants.forEach((p) => {
      if (p.order_id === order.id) p.registration_status = 'Cancelled'
    })

    return order
  }

  validateOrCheckIn(codeOrQr, station, operatorId, commitCheckIn = true, eventId = null) {
    const parsed = parseTicketQrPayload(codeOrQr)
    const raw = parsed.raw
    const cleanCode = parsed.ticketCode
    const hashed = hashQrToken(raw)

    const ticket = this.tickets.find(
      (t) =>
        (cleanCode && t.ticket_code.toUpperCase() === cleanCode) ||
        t.qr_token_hash === hashed ||
        (t.qr_payload && t.qr_payload === raw)
    )

    if (!ticket) {
      throw new AppError(`Tiket "${cleanCode || raw}" tidak ditemukan atau tidak valid.`, 404, 'TICKET_NOT_FOUND')
    }
    const evt = this.events.find((e) => e.id === ticket.event_id && !e.deleted_at)
    if (evt && evt.status === 'Cancelled') {
      throw new AppError('Event telah dibatalkan sehingga check-in ditutup.', 409, 'EVENT_CANCELLED')
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
    if (ticket.status === 'Pending') {
      throw new AppError('Pembayaran tiket belum diverifikasi oleh panitia.', 409, 'TICKET_PAYMENT_PENDING')
    }
    if (ticket.status === 'Expired') {
      throw new AppError('Tiket telah kedaluwarsa dan tidak berlaku.', 409, 'TICKET_EXPIRED')
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

    if (!commitCheckIn) {
      return { valid: true, ticket }
    }

    ticket.status = 'Used'
    ticket.used_at = new Date().toISOString()

    const participant = this.participants.find((p) => p.ticket_code === ticket.ticket_code || p.id === ticket.attendee_id)
    if (participant) participant.checked_in = true

    const log = {
      id: 'chk-' + Date.now(),
      event_id: ticket.event_id,
      ticket_id: ticket.id,
      ticket_code: ticket.ticket_code,
      participant_name: ticket.participant_name,
      ticket_type: ticket.ticket_type,
      station,
      checked_in_by: operatorId,
      checked_in_at: ticket.used_at
    }
    this.checkinLogs.unshift(log)

    return { valid: true, ticket, checkin: log }
  }
}

export const store = new BackendStore()
export { slugify }
