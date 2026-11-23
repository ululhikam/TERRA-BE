import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../src/utils/crypto.js'
import { supabaseAdmin, isSupabaseEnabled } from '../src/config/supabase.js'
import { env } from '../src/config/env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ALL_PERMS = [
  'View Event',
  'Edit Event',
  'Manage Timeline',
  'Manage Tickets',
  'View Participants',
  'Manage Check-in',
  'View Finance',
  'Manage Team'
]

const ALL_MODULES = [
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
]

export async function seedDemafestPlan(prisma) {
  const email = 'bestan@bemust.id'
  const initialPassword = 'Demafest2026!'
  let organizerId = 'usr-bestan-bemust'

  // 1. Ensure Bestan Dhya Ul Haq exists & is confirmed in Supabase Auth (when Supabase Auth is configured)
  if (isSupabaseEnabled && supabaseAdmin) {
    const { data: listed } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    const existingAuth = (listed?.users || []).find(
      (u) => String(u.email || '').toLowerCase() === email
    )

    if (existingAuth) {
      organizerId = existingAuth.id
      await supabaseAdmin.auth.admin.updateUserById(existingAuth.id, {
        password: initialPassword,
        email_confirm: true,
        user_metadata: {
          full_name: 'Bestan Dhya Ul Haq',
          role: 'organizer',
          organization_name: 'BEM UST Yogyakarta'
        }
      })
    } else {
      const { data: createdAuth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: initialPassword,
        email_confirm: true,
        user_metadata: {
          full_name: 'Bestan Dhya Ul Haq',
          role: 'organizer',
          organization_name: 'BEM UST Yogyakarta'
        }
      })
      if (!authErr && createdAuth?.user?.id) {
        organizerId = createdAuth.user.id
      }
    }
  }

  // 2. Upsert Organizer record for Bestan Dhya Ul Haq
  await prisma.organizer.upsert({
    where: { email },
    update: {
      full_name: 'Bestan Dhya Ul Haq',
      username: 'bestan',
      phone: '087897192601',
      bio: 'Organizer & Koordinator Utama DEMAFEST 2026 — BEM Universitas Sarjanawiyata Tamansiswa',
      password_hash: hashPassword(initialPassword),
      email_verified: true,
      is_suspended: false,
      subscription_plan: 'pro_monthly',
      subscription_status: 'active',
      subscription_expires_at: new Date('2027-01-31T23:59:59+07:00')
    },
    create: {
      id: organizerId,
      full_name: 'Bestan Dhya Ul Haq',
      username: 'bestan',
      email,
      phone: '087897192601',
      bio: 'Organizer & Koordinator Utama DEMAFEST 2026 — BEM Universitas Sarjanawiyata Tamansiswa',
      password_hash: hashPassword(initialPassword),
      provider: 'email',
      email_verified: true,
      is_suspended: false,
      subscription_plan: 'pro_monthly',
      subscription_status: 'active',
      subscription_expires_at: new Date('2027-01-31T23:59:59+07:00')
    }
  })

  const bestanOrgRow = await prisma.organizer.findUnique({ where: { email } })
  const bestanId = bestanOrgRow.id

  // 3. Organization: BEM Universitas Sarjanawiyata Tamansiswa
  const orgId = 'org-bem-ust'
  await prisma.organization.upsert({
    where: { id: orgId },
    update: {
      name: 'BEM UST — Dewantara Muda Festival',
      description:
        'Badan Eksekutif Mahasiswa Universitas Sarjanawiyata Tamansiswa (BEM UST). Penyelenggara DEMAFEST 2026: "Resonansi Dewantara — Merawat Gagasan, Menggerakkan Perubahan, Merayakan Karya".',
      email,
      phone: '087897192601',
      verification_status: 'verified',
      created_by: bestanId
    },
    create: {
      id: orgId,
      name: 'BEM UST — Dewantara Muda Festival',
      slug: 'bem-ust-yogyakarta',
      description:
        'Badan Eksekutif Mahasiswa Universitas Sarjanawiyata Tamansiswa (BEM UST). Penyelenggara DEMAFEST 2026: "Resonansi Dewantara — Merawat Gagasan, Menggerakkan Perubahan, Merayakan Karya".',
      logo_url: 'https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=300&q=80',
      cover_url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&q=80',
      email,
      phone: '087897192601',
      website: 'https://ustjogja.ac.id',
      verification_status: 'verified',
      created_by: bestanId
    }
  })

  await prisma.organizationMember.upsert({
    where: {
      organization_id_email: {
        organization_id: orgId,
        email
      }
    },
    update: {
      user_id: bestanId,
      name: 'Bestan Dhya Ul Haq',
      role: 'Owner',
      status: 'active'
    },
    create: {
      id: 'om-bestan-bemust',
      organization_id: orgId,
      user_id: bestanId,
      name: 'Bestan Dhya Ul Haq',
      email,
      role: 'Owner',
      status: 'active'
    }
  })

  // 4. All Events from MASTER PLAN DEMAFEST 2026 (Main Event + 5 Pre-Event Kementerian)
  const demafestEvents = [
    {
      id: 'evt-demafest-2026',
      title: 'DEMAFEST 2026: Dewantara Muda Festival — Resonansi Dewantara',
      slug: 'demafest-2026-resonansi-dewantara',
      category_id: 'cat-5',
      category: 'Komunitas & Sosial',
      description:
        'Puncak rangkaian program kerja kolaboratif seluruh kementerian BEM Universitas Sarjanawiyata Tamansiswa (UST). Mengusung tema "Resonansi Dewantara" dengan tagline: Merawat Gagasan, Menggerakkan Perubahan, Merayakan Karya. Terdiri dari 5 agenda utama: Dewantara Public Forum (Pendidikan Merdeka, Mahasiswa Berdaya), Tamansiswa Heritage Expo, Dewantara Achievement Awards, Ormawa Performance & Showcase, serta Dewantara Celebration.',
      poster_url: 'https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=900&q=80',
      banner_url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1400&q=80',
      location_type: 'offline',
      location_name: 'Kampus Pusat & Auditorium Universitas Sarjanawiyata Tamansiswa (UST), Yogyakarta',
      address: 'Jl. Kusumanegara No.157, Muja Muju, Kec. Umbulharjo, Kota Yogyakarta',
      start_at: '2026-12-10T07:00:00+07:00',
      end_at: '2026-12-10T21:00:00+07:00',
      capacity: 300,
      status: 'Published',
      publication_status: 'Published',
      is_featured: true,
      speakers: [
        {
          id: 'sp-df-1',
          name: 'Narasumber I — Akademisi & Pemikir Pendidikan Tamansiswa',
          type: 'Keynote Speaker',
          role_title: 'Dewantara Public Forum (Auditorium UST)',
          topic: 'Pendidikan Merdeka: Relevansi Pemikiran Ki Hadjar Dewantara Masa Kini',
          avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80'
        },
        {
          id: 'sp-df-2',
          name: 'Narasumber II — Praktisi Kebijakan Publik & Pemuda',
          type: 'Pemateri',
          role_title: 'Dewantara Public Forum (Auditorium UST)',
          topic: 'Mahasiswa Berdaya: Mengawal Perubahan Sosial & Inovasi Kampus',
          avatar_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&q=80'
        },
        {
          id: 'sp-df-3',
          name: 'Kementerian & Perwakilan Ormawa UST',
          type: 'Showcase & Awards',
          role_title: 'Tamansiswa Heritage Expo & Achievement Awards',
          topic: 'Presentasi Hasil Proker 5 Kementerian BEM & Apresiasi Mahasiswa Berprestasi',
          avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&q=80'
        }
      ],
      schedules: [
        ['07:00', '08:00', 'Persiapan Panitia', 'Sterilisasi dan pengecekan venue seluruh zona', 'Divisi Keamanan & Perlengkapan'],
        ['08:00', '08:30', 'Registrasi Peserta', 'Registrasi tamu undangan dan mahasiswa + Pembukaan Booth Tamansiswa Heritage Expo', 'Divisi Humas & Acara'],
        ['08:30', '09:00', 'Opening Ceremony', 'Pembukaan resmi DEMAFEST 2026 — Resonansi Dewantara', 'Divisi Acara'],
        ['09:00', '09:15', 'Sambutan Ketua BEM & Pimpinan Universitas', 'Sambutan Ketua BEM UST & Rektorat', 'Bestan Dhya Ul Haq'],
        ['09:15', '09:30', 'Pembukaan Tamansiswa Heritage Expo', 'Resmi membuka pameran sejarah & hasil proker 5 kementerian BEM', 'Panitia Inti'],
        ['09:30', '11:30', 'Dewantara Public Forum (Auditorium)', 'Seminar Pendidikan Merdeka: Moderator (09.30), Narasumber I (09.50), Narasumber II (10.30), Diskusi & Kesimpulan (11.00–11.30)', 'Kementerian KASTRAT'],
        ['11:30', '12:30', 'ISHOMA', 'Istirahat, sholat, makan siang & kunjungan booth Expo', 'All Panitia'],
        ['12:30', '13:00', 'Pengantar Penghargaan', 'Profil nominasi mahasiswa & ormawa berprestasi', 'Divisi Acara'],
        ['13:00', '14:00', 'Dewantara Achievement Awards', 'Penyerahan penghargaan 6 kategori akademik, nonakademik, olahraga, seni, kontribusi & ormawa terinspiratif', 'Divisi Acara'],
        ['14:00', '15:30', 'Ormawa Performance I', 'Pembukaan showcase (14.00), UKM Seni (14.15), Penampilan Musik (14.35), Penampilan Tari (14.55)', 'Kementerian MENDAGRI'],
        ['15:30', '16:00', 'Break Sore', 'Persiapan teknis sesi kedua & kunjungan Tamansiswa Expo', 'Divisi Perlengkapan'],
        ['16:00', '17:30', 'Ormawa Performance II', 'Penampilan Teater (16.00), Musik (16.20), Penampilan Organisasi (16.40), Kolaborasi Seluruh Ormawa (17.00)', 'Kementerian MENDAGRI'],
        ['17:30', '18:30', 'ISHOMA Malam', 'Istirahat & persiapan Dewantara Celebration', 'All Panitia'],
        ['18:30', '19:00', 'Closing Ceremony', 'Penutupan formal rangkaian DEMAFEST 2026', 'Panitia Inti'],
        ['19:00', '20:30', 'Dewantara Celebration', 'Hiburan malam puncak & apresiasi kolaborasi mahasiswa', 'Divisi Acara & PDD'],
        ['20:30', '21:00', 'Dokumentasi & Penutupan', 'Foto bersama panitia/pengisi acara dan pembongkaran booth Expo', 'Divisi PDD & Perlengkapan']
      ]
    },
    {
      id: 'evt-demafest-dewa-connect',
      title: 'Pre-Event MENLU: Dewa Connect — Building Bridges, Expanding Horizons',
      slug: 'demafest-pre-event-dewa-connect',
      category_id: 'cat-4',
      category: 'Bisnis & Karir',
      description:
        'Program kerja Kementerian Luar Negeri (MENLU) BEM UST: Kunjungan / studi banding dengan BEM universitas mitra untuk bertukar gagasan tata kelola organisasi, strategi advokasi mahasiswa, pengelolaan program kerja, serta pengembangan relasi antarlembaga.',
      poster_url: 'https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=900&q=80',
      banner_url: 'https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=1400&q=80',
      location_type: 'offline',
      location_name: 'Kampus Universitas Mitra (Yogyakarta)',
      address: 'Kunjungan Studi Banding Pengurus BEM UST',
      start_at: '2026-11-28T07:00:00+07:00',
      end_at: '2026-11-28T16:00:00+07:00',
      capacity: 60,
      status: 'Published',
      publication_status: 'Published',
      is_featured: false,
      speakers: [],
      schedules: [
        ['07:00', '08:00', 'Persiapan dan keberangkatan', 'Briefing delegasi BEM UST', 'MENLU'],
        ['08:00', '09:00', 'Perjalanan menuju kampus mitra', 'Koordinasi kedatangan', 'MENLU'],
        ['09:00', '09:30', 'Penyambutan dan pembukaan', 'Sambutan BEM UST & BEM Mitra', 'MENLU'],
        ['09:30', '10:00', 'Presentasi profil organisasi', 'Pengenalan struktur & visi misi', 'MENLU'],
        ['10:00', '11:30', 'Forum diskusi dan sharing', 'Tata kelola organisasi & advokasi mahasiswa', 'MENLU'],
        ['11:30', '12:30', 'ISHOMA', 'Istirahat & makan siang bersama', 'Panitia'],
        ['12:30', '13:30', 'Diskusi program unggulan', 'Relasi antarlembaga & inovasi proker', 'MENLU'],
        ['13:30', '14:00', 'Penyerahan cenderamata', 'Plakat resmi BEM UST', 'Humas & MENLU'],
        ['14:00', '15:00', 'Dokumentasi & penutupan', 'Penyusunan notulensi & kepulangan', 'PDD & MENLU']
      ]
    },
    {
      id: 'evt-demafest-badminton',
      title: 'Pre-Event MENPORA: Dewantara Badminton Cup',
      slug: 'demafest-pre-event-dewantara-badminton-cup',
      category_id: 'cat-5',
      category: 'Komunitas & Sosial',
      description:
        'Program kerja Kementerian Pemuda dan Olahraga (MENPORA) BEM UST dengan tema "One Court, One Spirit, One Victory". Turnamen badminton antarmahasiswa UST kategori Ganda Putra, Ganda Putri, dan Ganda Campuran.',
      poster_url: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=900&q=80',
      banner_url: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=1400&q=80',
      location_type: 'offline',
      location_name: 'GOR Kampus UST Yogyakarta',
      address: 'Lingkungan Kampus Universitas Sarjanawiyata Tamansiswa, Yogyakarta',
      start_at: '2026-11-29T07:00:00+07:00',
      end_at: '2026-11-29T17:00:00+07:00',
      capacity: 120,
      status: 'Published',
      publication_status: 'Published',
      is_featured: false,
      speakers: [],
      schedules: [
        ['07:00', '08:00', 'Registrasi peserta turnamen', 'Verifikasi tim ganda putra, putri & campuran', 'MENPORA'],
        ['08:00', '08:20', 'Pembukaan', 'Pembukaan resmi Dewantara Badminton Cup', 'MENPORA'],
        ['08:20', '08:40', 'Technical meeting singkat', 'Sistem gugur & pembagian lapangan', 'Wasit & MENPORA'],
        ['08:40', '12:00', 'Babak penyisihan', 'Pertandingan paralel kategori ganda', 'MENPORA'],
        ['12:00', '13:00', 'ISHOMA', 'Istirahat siang', 'Panitia'],
        ['13:00', '15:00', 'Babak Semifinal', 'Penentuan finalis terbaik', 'MENPORA'],
        ['15:00', '16:30', 'Babak Final', 'Perebutan Juara 1, 2, dan 3', 'MENPORA'],
        ['16:30', '17:00', 'Penyerahan hadiah dan penutupan', 'Apresiasi juara & dokumentasi kompetisi', 'PDD & MENPORA']
      ]
    },
    {
      id: 'evt-demafest-critical-space',
      title: 'Pre-Event KASTRAT: Dewantara Critical Space',
      slug: 'demafest-pre-event-dewantara-critical-space',
      category_id: 'cat-3',
      category: 'Workshop & Edukasi',
      description:
        'Program kerja Kementerian Kajian dan Strategi (KASTRAT): Forum kajian dan diskusi kritis bertema "Mahasiswa sebagai Subjek Kritis dalam Mengawal Kebijakan Publik" (akses pendidikan tinggi, demokrasi kampus, dan pemikiran Ki Hadjar Dewantara).',
      poster_url: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=900&q=80',
      banner_url: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=1400&q=80',
      location_type: 'offline',
      location_name: 'Ruang Diskusi Kampus UST Yogyakarta',
      address: 'Gedung Perkuliahan UST, Umbulharjo, Yogyakarta',
      start_at: '2026-12-02T13:00:00+07:00',
      end_at: '2026-12-02T16:30:00+07:00',
      capacity: 100,
      status: 'Published',
      publication_status: 'Published',
      is_featured: false,
      speakers: [],
      schedules: [
        ['13:00', '13:30', 'Registrasi peserta diskusi', 'Pendataan peserta forum kajian', 'KASTRAT'],
        ['13:30', '13:45', 'Pembukaan', 'Pengantar tema Mahasiswa sebagai Subjek Kritis', 'KASTRAT'],
        ['13:45', '14:15', 'Pemaparan isu & pengantar kajian', 'Bedah kebijakan publik & pemikiran Ki Hadjar Dewantara', 'KASTRAT'],
        ['14:15', '15:15', 'Diskusi kelompok terarah', '4 kelompok topik pendidikan & demokrasi kampus', 'Moderator'],
        ['15:15', '15:45', 'Presentasi hasil kajian', 'Pemaparan rekomendasi tiap kelompok', 'KASTRAT'],
        ['15:45', '16:15', 'Tanggapan & penyusunan rekomendasi', 'Finalisasi naskah kajian untuk forum DEMAFEST 10 Des', 'KASTRAT'],
        ['16:15', '16:30', 'Penutupan', 'Dokumentasi hasil kajian', 'PDD']
      ]
    },
    {
      id: 'evt-demafest-suara-mahasiswa',
      title: 'Pre-Event Advokasi: Suara Mahasiswa — Posko Aspirasi UST',
      slug: 'demafest-pre-event-suara-mahasiswa',
      category_id: 'cat-5',
      category: 'Komunitas & Sosial',
      description:
        'Program kerja Kementerian Advokasi bertema "Mendengar Aspirasi, Mengawal Hak, Mewujudkan Keadilan". Membuka posko aspirasi, survei permasalahan mahasiswa, konsultasi & pendampingan, hingga penyusunan dokumen aspirasi untuk disampaikan di Public Forum 10 Desember 2026.',
      poster_url: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=900&q=80',
      banner_url: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1400&q=80',
      location_type: 'offline',
      location_name: 'Posko Aspirasi Kampus UST Yogyakarta',
      address: 'Area Student Center Kampus UST, Yogyakarta',
      start_at: '2026-12-03T09:00:00+07:00',
      end_at: '2026-12-05T15:30:00+07:00',
      capacity: 150,
      status: 'Published',
      publication_status: 'Published',
      is_featured: false,
      speakers: [],
      schedules: [
        ['09:00', '09:30', 'Persiapan posko aspirasi', 'Penataan meja konsultasi & formulir survei', 'Advokasi'],
        ['09:30', '10:00', 'Pembukaan posko aspirasi', 'Sesi pembukaan layanan aspirasi akademik & nonakademik', 'Advokasi'],
        ['10:00', '12:00', 'Pengumpulan aspirasi mahasiswa', 'Pengisian survei & pengaduan langsung mahasiswa', 'Advokasi'],
        ['12:00', '13:00', 'ISHOMA', 'Istirahat siang', 'Panitia'],
        ['13:00', '14:00', 'Konsultasi & klasifikasi aspirasi', 'Pendampingan & pemetaan isu prioritas', 'Advokasi'],
        ['14:00', '15:00', 'Penyusunan laporan hasil aspirasi', 'Kompilasi dokumen aspirasi untuk DEMAFEST 10 Des', 'Advokasi'],
        ['15:00', '15:30', 'Publikasi hasil awal', 'Rilis ringkasan suara mahasiswa', 'PDD & Advokasi']
      ]
    },
    {
      id: 'evt-demafest-leadership-forum',
      title: 'Pre-Event MENDAGRI: Dewantara Leadership Forum',
      slug: 'demafest-pre-event-dewantara-leadership-forum',
      category_id: 'cat-3',
      category: 'Workshop & Edukasi',
      description:
        'Program kerja Kementerian Dalam Negeri (MENDAGRI) bertema "Membangun Kepemimpinan, Menguatkan Solidaritas Organisasi". Pelatihan kepemimpinan dan tata kelola organisasi bagi pengurus BEM, HMJ, UKM, dan ormawa UST.',
      poster_url: 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=900&q=80',
      banner_url: 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=1400&q=80',
      location_type: 'offline',
      location_name: 'Auditorium & Ruang Ormawa UST Yogyakarta',
      address: 'Kampus UST Yogyakarta',
      start_at: '2026-12-06T08:00:00+07:00',
      end_at: '2026-12-06T12:15:00+07:00',
      capacity: 120,
      status: 'Published',
      publication_status: 'Published',
      is_featured: false,
      speakers: [],
      schedules: [
        ['08:00', '08:30', 'Registrasi pengurus ormawa', 'Pendataan perwakilan BEM, HMJ & UKM UST', 'MENDAGRI'],
        ['08:30', '08:45', 'Pembukaan', 'Sambutan penguatan solidaritas ormawa', 'MENDAGRI'],
        ['08:45', '09:30', 'Materi kepemimpinan organisasi', 'Sesi kepemimpinan Tamansiswa', 'MENDAGRI'],
        ['09:30', '10:15', 'Materi tata kelola organisasi', 'Best practice manajemen ormawa & kolaborasi', 'MENDAGRI'],
        ['10:15', '10:30', 'Istirahat', 'Coffee break singkat', 'Panitia'],
        ['10:30', '11:30', 'Forum diskusi antarlembaga', 'Penyelarasan program kerja BEM, HMJ & UKM', 'MENDAGRI'],
        ['11:30', '12:00', 'Penyusunan komitmen kolaborasi', 'Persiapan Ormawa Performance & Showcase 10 Des', 'MENDAGRI'],
        ['12:00', '12:15', 'Penutupan', 'Foto bersama pimpinan ormawa UST', 'PDD']
      ]
    }
  ]

  const proPlan = await prisma.pricingPlan.findUnique({ where: { code: 'pro' } })
  const proLimits = {
    code: 'pro',
    name: 'PRO',
    price_idr: Number(proPlan?.price_idr ?? 129000),
    max_active_events: Number(proPlan?.max_active_events ?? 100),
    max_participants: Number(proPlan?.max_participants ?? 2000),
    max_team_members: Number(proPlan?.max_team_members ?? 25),
    max_storage_mb: Number(proPlan?.max_storage_mb ?? 1024),
    allowed_modules: ALL_MODULES
  }

  for (const evtDef of demafestEvents) {
    await prisma.event.upsert({
      where: { id: evtDef.id },
      update: {
        title: evtDef.title,
        description: evtDef.description,
        location_name: evtDef.location_name,
        address: evtDef.address,
        start_at: evtDef.start_at,
        end_at: evtDef.end_at,
        capacity: evtDef.capacity,
        status: evtDef.status,
        publication_status: evtDef.publication_status,
        enabled_modules: ALL_MODULES,
        speakers: evtDef.speakers,
        created_by: bestanId
      },
      create: {
        id: evtDef.id,
        organization_id: orgId,
        title: evtDef.title,
        slug: evtDef.slug,
        description: evtDef.description,
        category_id: evtDef.category_id,
        category: evtDef.category,
        poster_url: evtDef.poster_url,
        banner_url: evtDef.banner_url,
        gallery: [],
        speakers: evtDef.speakers,
        location_type: evtDef.location_type,
        location_name: evtDef.location_name,
        address: evtDef.address,
        start_at: evtDef.start_at,
        end_at: evtDef.end_at,
        timezone: 'Asia/Jakarta',
        capacity: evtDef.capacity,
        status: evtDef.status,
        publication_status: evtDef.publication_status,
        visibility: 'public',
        is_featured: evtDef.is_featured,
        enabled_modules: ALL_MODULES,
        created_by: bestanId
      }
    })

    // Ensure full PRO entitlement so Bestan can operate all modules (Finance, Vendors, Ticketing, Timeline, Tasks, Team)
    await prisma.eventSubscription.upsert({
      where: { event_id: evtDef.id },
      update: {
        organization_id: orgId,
        plan_code: 'pro',
        plan_name: 'PRO',
        limits_snapshot: proLimits,
        status: 'active'
      },
      create: {
        id: `sub-${evtDef.id}`,
        event_id: evtDef.id,
        organization_id: orgId,
        plan_code: 'pro',
        plan_name: 'PRO',
        price_snapshot_idr: 96750, // Community BEM UST discount snapshot
        limits_snapshot: proLimits,
        status: 'active',
        is_trial: false
      }
    })

    // Add Bestan Dhya Ul Haq as Owner in TeamMember for full workspace permission
    const existingBestanTm = await prisma.teamMember.findFirst({
      where: { event_id: evtDef.id, email }
    })
    if (!existingBestanTm) {
      await prisma.teamMember.create({
        data: {
          id: `tm-bestan-${evtDef.id}`,
          event_id: evtDef.id,
          user_id: bestanId,
          name: 'Bestan Dhya Ul Haq',
          email,
          role: 'Owner',
          department: 'Panitia Inti / Koordinator Utama',
          permissions: ALL_PERMS,
          status: 'Active'
        }
      })
    }

    // Schedules / Rundown
    const eventDate = evtDef.start_at.slice(0, 10)
    for (const [idx, [start, end, title, description, pic]] of evtDef.schedules.entries()) {
      const schId = `sch-${evtDef.id}-${idx + 1}`
      await prisma.eventSchedule.upsert({
        where: { id: schId },
        update: { title, description, start_time: start, end_time: end, pic, sort_order: idx },
        create: {
          id: schId,
          event_id: evtDef.id,
          title,
          description,
          date: eventDate,
          start_time: start,
          end_time: end,
          location: evtDef.location_name,
          pic,
          visibility: 'public',
          sort_order: idx
        }
      })
    }

    // Default ticket tier per event
    const freeTktId = `tkt-free-${evtDef.id}`
    await prisma.ticketType.upsert({
      where: { id: freeTktId },
      update: {},
      create: {
        id: freeTktId,
        event_id: evtDef.id,
        name:
          evtDef.id === 'evt-demafest-2026'
            ? 'Tiket Mahasiswa UST (Gratis)'
            : 'Registrasi Peserta Gratis',
        description: `Tiket resmi ${evtDef.title} (termasuk QR E-Ticket & akses venue).`,
        price: 0,
        currency: 'IDR',
        quantity: evtDef.id === 'evt-demafest-2026' ? 200 : evtDef.capacity,
        sold_quantity: 0,
        min_per_order: 1,
        max_per_order: 3,
        status: 'On Sale'
      }
    })
  }

  // Additional public ticket tier on DEMAFEST Main Event
  await prisma.ticketType.upsert({
    where: { id: 'tkt-umum-evt-demafest-2026' },
    update: {},
    create: {
      id: 'tkt-umum-evt-demafest-2026',
      event_id: 'evt-demafest-2026',
      name: 'Tiket Umum & Tamu Public Forum',
      description: 'Akses Seminar Dewantara Public Forum, Tamansiswa Heritage Expo & Dewantara Celebration.',
      price: 25000,
      currency: 'IDR',
      quantity: 100,
      sold_quantity: 0,
      min_per_order: 1,
      max_per_order: 5,
      status: 'On Sale'
    }
  })

  // 5. Hierarchical Timeline Checkpoints & Sub-tasks for Main Event (Section 4, 5 & 9 of plan.docx)
  const mainId = 'evt-demafest-2026'
  const tasksData = [
    // Week 1 Group
    { id: 'df-grp-w1', parent_id: null, is_group: true, title: 'Minggu 1 (18–22 Nov): Fondasi Kegiatan & Publikasi Awal', phase: 'Pre-Event', assigned_to: 'Bestan Dhya Ul Haq', priority: 'High', status: 'In Progress', start_date: '2026-11-18', due_at: '2026-11-22', progress: 40 },
    { id: 'df-t1', parent_id: 'df-grp-w1', is_group: false, title: 'Finalisasi konsep, tema visual (Midnight Blue & Gold) & persetujuan proker', phase: 'Pre-Event', assigned_to: 'Divisi Acara & PDD', priority: 'High', status: 'Done', start_date: '2026-11-18', due_at: '2026-11-19', progress: 100 },
    { id: 'df-t2', parent_id: 'df-grp-w1', is_group: false, title: 'Penyusunan Master RAB 5 Divisi, proposal & surat perizinan kampus', phase: 'Pre-Event', assigned_to: 'Bendahara & Humas', priority: 'High', status: 'In Progress', start_date: '2026-11-18', due_at: '2026-11-21', progress: 50 },
    { id: 'df-t3', parent_id: 'df-grp-w1', is_group: false, title: 'Rapat Koordinasi I (20 Nov) & Rilis Teaser DEMAFEST', phase: 'Marketing', assigned_to: 'Divisi PDD', priority: 'High', status: 'To Do', start_date: '2026-11-20', due_at: '2026-11-20', progress: 0 },
    { id: 'df-t4', parent_id: 'df-grp-w1', is_group: false, title: 'Rapat Teknis I, Rilis Poster Resmi & Pemesanan venue/perlengkapan', phase: 'Production', assigned_to: 'Divisi Perlengkapan & PDD', priority: 'Medium', status: 'To Do', start_date: '2026-11-22', due_at: '2026-11-22', progress: 0 },

    // Week 2 Group
    { id: 'df-grp-w2', parent_id: null, is_group: true, title: 'Minggu 2 (23–29 Nov): Open Reg, Dewa Connect & Badminton Cup', phase: 'Pre-Event', assigned_to: 'MENLU & MENPORA', priority: 'High', status: 'To Do', start_date: '2026-11-23', due_at: '2026-11-29', progress: 0 },
    { id: 'df-t5', parent_id: 'df-grp-w2', is_group: false, title: 'Open Registration DEMAFEST (23 Nov) & Rapat Koordinasi II–III (24 & 26 Nov)', phase: 'Marketing', assigned_to: 'Divisi Humas & PDD', priority: 'High', status: 'To Do', start_date: '2026-11-23', due_at: '2026-11-26', progress: 0 },
    { id: 'df-t6', parent_id: 'df-grp-w2', is_group: false, title: 'Pelaksanaan Pre-Event Dewa Connect (MENLU) & Pengumuman Narasumber (28 Nov)', phase: 'Main-Event', assigned_to: 'Kementerian MENLU', priority: 'High', status: 'To Do', start_date: '2026-11-28', due_at: '2026-11-28', progress: 0 },
    { id: 'df-t7', parent_id: 'df-grp-w2', is_group: false, title: 'Pelaksanaan Dewantara Badminton Cup (MENPORA) & Evaluasi I (29 Nov)', phase: 'Main-Event', assigned_to: 'Kementerian MENPORA', priority: 'High', status: 'To Do', start_date: '2026-11-29', due_at: '2026-11-29', progress: 0 },

    // Week 3 Group
    { id: 'df-grp-w3', parent_id: null, is_group: true, title: 'Minggu 3 (30 Nov–6 Des): Critical Space, Suara Mahasiswa & Leadership Forum', phase: 'Production', assigned_to: 'KASTRAT, Advokasi & MENDAGRI', priority: 'High', status: 'To Do', start_date: '2026-11-30', due_at: '2026-12-06', progress: 0 },
    { id: 'df-t8', parent_id: 'df-grp-w3', is_group: false, title: 'Publikasi Tamansiswa Expo (1 Des), Achievement Awards (2 Des) & Critical Space', phase: 'Marketing', assigned_to: 'KASTRAT & PDD', priority: 'Medium', status: 'To Do', start_date: '2026-12-01', due_at: '2026-12-02', progress: 0 },
    { id: 'df-t9', parent_id: 'df-grp-w3', is_group: false, title: 'Posko Aspirasi Suara Mahasiswa (3–5 Des) & Rapat Koordinasi V (4 Des)', phase: 'Production', assigned_to: 'Kementerian Advokasi', priority: 'Medium', status: 'To Do', start_date: '2026-12-03', due_at: '2026-12-05', progress: 0 },
    { id: 'df-t10', parent_id: 'df-grp-w3', is_group: false, title: 'Pelaksanaan Dewantara Leadership Forum (MENDAGRI) & Rapat Teknis II (6 Des)', phase: 'Production', assigned_to: 'Kementerian MENDAGRI', priority: 'High', status: 'To Do', start_date: '2026-12-06', due_at: '2026-12-06', progress: 0 },

    // Week 4 Group
    { id: 'df-grp-w4', parent_id: null, is_group: true, title: 'Minggu 4 (7–15 Des): Gladi Bersih, Main Event & Aftermovie', phase: 'Showtime', assigned_to: 'Seluruh Panitia DEMAFEST', priority: 'High', status: 'To Do', start_date: '2026-12-07', due_at: '2026-12-15', progress: 0 },
    { id: 'df-t11', parent_id: 'df-grp-w4', is_group: false, title: 'Rekapitulasi hasil seluruh proker kementerian & Countdown H-3 (7 Des)', phase: 'Showtime', assigned_to: 'Seluruh Kementerian', priority: 'High', status: 'To Do', start_date: '2026-12-07', due_at: '2026-12-07', progress: 0 },
    { id: 'df-t12', parent_id: 'df-grp-w4', is_group: false, title: 'Gladi bersih teknis, Rapat Final (8 Des), Setup Venue & Briefing Akhir (9 Des)', phase: 'Showtime', assigned_to: 'Perlengkapan, Keamanan & Acara', priority: 'High', status: 'To Do', start_date: '2026-12-08', due_at: '2026-12-09', progress: 0 },
    { id: 'df-t13', parent_id: 'df-grp-w4', is_group: false, title: 'Puncak DEMAFEST Main Event & Live Report (10 Des) + Aftermovie (12–15 Des)', phase: 'Showtime', assigned_to: 'Bestan Dhya Ul Haq & PDD', priority: 'High', status: 'To Do', start_date: '2026-12-10', due_at: '2026-12-15', progress: 0 }
  ]

  for (const t of tasksData) {
    await prisma.eventTask.upsert({
      where: { id: t.id },
      update: { title: t.title, start_date: t.start_date, due_at: t.due_at },
      create: {
        id: t.id,
        event_id: mainId,
        parent_id: t.parent_id,
        is_group: t.is_group,
        title: t.title,
        phase: t.phase,
        assigned_to: t.assigned_to,
        priority: t.priority,
        status: t.status,
        start_date: t.start_date,
        due_at: t.due_at,
        progress: t.progress
      }
    })
  }

  // 6. 5 Divisi Kepanitiaan (Team Members for Main Event)
  const divisionLeads = [
    { id: 'tm-df-acara', name: 'Koordinator Divisi Acara', email: 'acara@bemust.id', role: 'Manager', department: 'Divisi Acara (Konsep, Rundown, MC, Narasumber)', permissions: ['View Event', 'Edit Event', 'Manage Timeline', 'View Participants'] },
    { id: 'tm-df-humas', name: 'Koordinator Divisi Humas', email: 'humas@bemust.id', role: 'Manager', department: 'Divisi Humas (Undangan, Rektorat, Sponsor, Medpart)', permissions: ['View Event', 'View Participants', 'Manage Tickets'] },
    { id: 'tm-df-perkap', name: 'Koordinator Divisi Perlengkapan', email: 'perlengkapan@bemust.id', role: 'Staff', department: 'Divisi Perlengkapan (Panggung, Sound, Tenda Expo)', permissions: ['View Event', 'Manage Timeline'] },
    { id: 'tm-df-keamanan', name: 'Koordinator Divisi Keamanan', email: 'keamanan@bemust.id', role: 'Staff', department: 'Divisi Keamanan (Akses, Parkir, Massa, P3K)', permissions: ['View Event', 'Manage Check-in'] },
    { id: 'tm-df-pdd', name: 'Koordinator Divisi PDD', email: 'pdd@bemust.id', role: 'Manager', department: 'Divisi PDD (Branding, Poster, Dokumentasi, Aftermovie)', permissions: ['View Event', 'Edit Event'] }
  ]

  for (const dm of divisionLeads) {
    await prisma.teamMember.upsert({
      where: { id: dm.id },
      update: {},
      create: {
        id: dm.id,
        event_id: mainId,
        name: dm.name,
        email: dm.email,
        role: dm.role,
        department: dm.department,
        permissions: dm.permissions,
        status: 'Active'
      }
    })
  }

  // 7. Finance Budget, RAB Categories (Section 8 of plan.docx), Vendors & Documents
  await prisma.eventBudget.upsert({
    where: { event_id: mainId },
    update: {},
    create: {
      event_id: mainId,
      amount: 25000000
    }
  })

  const rabExpenses = [
    { id: 'df-exp-1', category: 'Divisi Acara', description: 'Honor moderator, transport narasumber, plakat, sertifikat, trofi awards & konsumsi pengisi', amount: 4500000, date: '2026-11-22' },
    { id: 'df-exp-2', category: 'Divisi Humas', description: 'Cetak undangan VIP/rektorat, souvenir tamu & operasional sponsorship', amount: 2200000, date: '2026-11-24' },
    { id: 'df-exp-3', category: 'Divisi Perlengkapan', description: 'Sound system, panggung, tenda booth Tamansiswa Expo, backdrop & listrik (estimasi Yogyakarta)', amount: 7500000, date: '2026-11-25' },
    { id: 'df-exp-4', category: 'Divisi Keamanan', description: 'Rompi panitia, sewa HT komunikasi, P3K medis, tali pembatas & konsumsi keamanan', amount: 1800000, date: '2026-11-26' },
    { id: 'df-exp-5', category: 'Divisi PDD', description: 'Desain identitas visual Midnight Blue & Gold, cetak poster/banner, ID card & produksi aftermovie', amount: 2500000, date: '2026-11-22' },
    { id: 'df-exp-6', category: 'Pre-Event 5 Kementerian', description: 'Estimasi tambahan: Dewa Connect, Badminton Cup, Critical Space, Suara Mahasiswa & Leadership Forum', amount: 4000000, date: '2026-11-27' }
  ]

  for (const exp of rabExpenses) {
    await prisma.financeExpense.upsert({
      where: { id: exp.id },
      update: {},
      create: {
        id: exp.id,
        event_id: mainId,
        category: exp.category,
        description: exp.description,
        amount: exp.amount,
        date: exp.date,
        created_by: bestanId
      }
    })
  }

  await prisma.financeIncome.upsert({
    where: { id: 'df-inc-1' },
    update: {},
    create: {
      id: 'df-inc-1',
      event_id: mainId,
      category: 'Anggaran Lembaga Kemahasiswaan UST',
      description: 'Alokasi dana awal BEM Universitas Sarjanawiyata Tamansiswa',
      amount: 15000000,
      date: '2026-11-18',
      created_by: bestanId
    }
  })

  const dfVendors = [
    { id: 'df-vnd-1', name: 'Jogja Stage & Sound Production', category: 'Sound System & Panggung', contact: 'Divisi Perlengkapan', value: 'Rp 4.500.000', status: 'Pending' },
    { id: 'df-vnd-2', name: 'Tamansiswa Expo Booth & Tenda', category: 'Tenda Booth Expo & Meja Kursi', contact: 'Divisi Perlengkapan', value: 'Rp 3.000.000', status: 'Pending' },
    { id: 'df-vnd-3', name: 'Kopi & Media Dokumentasi Yogyakarta', category: 'Banner, ID Card & Aftermovie', contact: 'Divisi PDD', value: 'Rp 2.500.000', status: 'Confirmed' }
  ]
  for (const v of dfVendors) {
    await prisma.vendor.upsert({
      where: { id: v.id },
      update: {},
      create: { id: v.id, event_id: mainId, ...v }
    })
  }

  await prisma.sponsor.upsert({
    where: { id: 'df-spn-1' },
    update: {},
    create: {
      id: 'df-spn-1',
      event_id: mainId,
      name: 'Keluarga Alumni & Mitra Pendidikan Yogyakarta',
      tier: 'Mitra Strategis DEMAFEST',
      contribution: 'Dukungan Sponsorship & Media Partner',
      pic: 'Divisi Humas BEM UST',
      status: 'Pending'
    }
  })

  const docPath = 'events/evt-demafest-2026/documents/master-plan-demafest-2026.docx'
  await prisma.eventDocument.upsert({
    where: { id: 'df-doc-1' },
    update: {},
    create: {
      id: 'df-doc-1',
      event_id: mainId,
      uploaded_by: bestanId,
      file_name: 'MASTER_PLAN_DEMAFEST_2026.docx',
      file_path: docPath,
      category: 'Operasional',
      visibility: 'internal'
    }
  })

  // Also store the real plan.docx into private Supabase Storage bucket (terra-documents) when available
  const planFile = path.resolve(__dirname, '../../plan.docx')
  if (isSupabaseEnabled && supabaseAdmin && fs.existsSync(planFile)) {
    try {
      const buf = fs.readFileSync(planFile)
      await supabaseAdmin.storage
        .from(env.supabaseDocsBucket)
        .upload(docPath, buf, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: true
        })
    } catch {
      // Non-fatal during offline seeding
    }
  }

  return { bestanId, email, initialPassword, orgId, eventIds: demafestEvents.map((e) => e.id) }
}
