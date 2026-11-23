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
      parent_event_id: null,
      theme_color: '#1e3a8a',
      title: 'DEMAFEST 2026: Dewantara Muda Festival — Resonansi Dewantara',
      slug: 'demafest-2026-resonansi-dewantara',
      category_id: 'cat-5',
      category: 'Komunitas & Sosial',
      description:
        'Puncak rangkaian program kerja kolaboratif seluruh kementerian BEM Universitas Sarjanawiyata Tamansiswa (UST). Tema: "Resonansi Dewantara — Merawat Gagasan, Menggerakkan Perubahan, Merayakan Karya". Filosofi utama ("Nyalakan Karya, Satukan Arah"): (1) Menghidupkan kembali nilai ajaran Ki Hadjar Dewantara (Ing Ngarsa Sung Tuladha, Ing Madya Mangun Karsa, Tut Wuri Handayani); (2) Mendorong kolaborasi lintas fakultas & himpunan; (3) Menyediakan ruang ekspresi intelektual, seni, dan kreativitas; (4) Mewujudkan transparansi serta akuntabilitas program kerja BEM UST; (5) Mengangkat citra positif UST di ruang publik. Agenda inti: Dewantara Public Forum, Tamansiswa Heritage Expo (10 booth: Pojok Sejarah UST, Booth MENLU/Dewa Connect, MENPORA, KASTRAT, Advokasi, MENDAGRI, Kolaborasi UKM, Pameran Karya Mahasiswa, Pojok Baca & Interaktif, Booth Sponsor/Dewa Berbagi), Dewantara Achievement Awards, Ormawa Performance & Showcase, serta Dewantara Celebration.',
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
        { start: '07:00', end: '07:30', track: 'All Area', location: 'Seluruh Zona Venue UST', title: '1-2. Kedatangan Panitia, Briefing Awal & Pengecekan Venue', description: 'Absensi panitia inti & divisi, pembagian HT, sterilisasi Auditorium, Area Expo, dan Panggung Utama.', pic: 'Divisi Keamanan & Perlengkapan' },
        { start: '07:30', end: '08:00', track: 'All Area', location: 'Lobby Auditorium & Area Expo', title: '3-4. Pengecekan Audio, Lighting & Finalisasi Kesiapan Acara', description: 'Soundcheck Auditorium & Panggung Utama, cek LCD materi Public Forum, dan kesiapan 10 booth Expo.', pic: 'Divisi Acara & Perlengkapan' },
        { start: '08:00', end: '08:30', track: 'Lobby & Expo', location: 'Foyer Auditorium & Area Expo', title: '5-6. Registrasi Tamu Undangan/Peserta & Pembukaan 10 Booth Tamansiswa Expo', description: 'Scan QR check-in peserta serta pembukaan 10 booth: Pojok Sejarah UST, Booth 5 Kementerian, UKM, Karya Mahasiswa, Pojok Baca, Sponsor & Dewa Connect/Dewa Berbagi.', pic: 'Divisi Humas & Acara' },
        { start: '08:30', end: '09:00', track: 'Main Stage', location: 'Auditorium UST Yogyakarta', title: '7-9. Opening Ceremony (Pembukaan MC, Indonesia Raya, Hymne UST & Laporan Ketua Panitia)', description: 'Pembukaan resmi DEMAFEST 2026 oleh MC, menyanyikan Indonesia Raya & Mars/Hymne UST, dan laporan Ketua Panitia Bestan Dhya Ul Haq.', pic: 'Bestan Dhya Ul Haq & Divisi Acara' },
        { start: '09:00', end: '09:30', track: 'Main Stage', location: 'Auditorium UST Yogyakarta', title: '10-12. Sambutan Ketua BEM, Pimpinan Universitas & Peresmian Tamansiswa Heritage Expo', description: 'Sambutan resmi Ketua BEM UST & Pimpinan Rektorat dilanjutkan seremoni pembukaan pameran sejarah & proker kementerian.', pic: 'Panitia Inti' },
        { start: '09:30', end: '10:30', track: 'Auditorium', location: 'Auditorium UST Yogyakarta', title: '13-15. Dewantara Public Forum Sesi I (Moderator & Narasumber I Pendidikan Merdeka)', description: 'Pengantar moderator (09:30), paparan Narasumber I mengenai relevansi pemikiran Ki Hadjar Dewantara & Pendidikan Merdeka (09:50–10:30).', pic: 'Kementerian KASTRAT' },
        { start: '10:30', end: '11:30', track: 'Auditorium', location: 'Auditorium UST Yogyakarta', title: '16-18. Dewantara Public Forum Sesi II (Narasumber II, Tanya Jawab & Pleno Rekomendasi)', description: 'Paparan Narasumber II Mahasiswa Berdaya (10:30), diskusi interaktif audiens (11:00), dan penyerahan dokumen Suara Mahasiswa & rekomendasi KASTRAT.', pic: 'Kementerian KASTRAT & Advokasi' },
        { start: '11:30', end: '12:30', track: 'Area Expo', location: 'Area Expo & Masjid Kampus', title: '19. ISHOMA & Kunjungan Tamansiswa Heritage Expo', description: 'Istirahat, sholat, makan siang, serta kunjungan interaktif booth proker 5 kementerian & Dewa Connect.', pic: 'All Panitia' },
        { start: '12:30', end: '13:00', track: 'Auditorium', location: 'Auditorium UST Yogyakarta', title: '20. Pengantar & Pemutaran Profil Nominasi Dewantara Achievement Awards', description: 'Penayangan profil nominator mahasiswa dan ormawa berprestasi UST.', pic: 'Divisi Acara & PDD' },
        { start: '13:00', end: '14:00', track: 'Auditorium', location: 'Auditorium UST Yogyakarta', title: '21. Penganugerahan Dewantara Achievement Awards (6 Kategori)', description: 'Penyerahan trofi & piagam untuk 6 kategori: Akademik, Nonakademik, Olahraga, Seni, Kontribusi Mahasiswa, dan Ormawa Terinspiratif.', pic: 'Divisi Acara' },
        { start: '14:00', end: '15:30', track: 'Panggung Utama', location: 'Panggung Utama Kampus Pusat UST', title: '22-23. Ormawa Performance & Showcase Sesi I (UKM Seni, Musik & Tari)', description: 'Pembukaan showcase (14:00), penampilan UKM Seni (14:15), Musik Mahasiswa (14:35), dan Seni Tari Tradisional/Kontemporer (14:55).', pic: 'Kementerian MENDAGRI' },
        { start: '15:30', end: '16:00', track: 'Area Expo', location: 'Area Expo & Panggung Utama', title: '24. Break Sore & Kunjungan Expo', description: 'Persiapan teknis penampilan sore & penjurian karya di Area Expo.', pic: 'Divisi Perlengkapan' },
        { start: '16:00', end: '17:30', track: 'Panggung Utama', location: 'Panggung Utama Kampus Pusat UST', title: '25. Ormawa Performance & Showcase Sesi II (Teater, Musik, Ormawa & Kolaborasi)', description: 'Penampilan Teater (16:00), Musik (16:20), Parade Organisasi (16:40), dan Kolaborasi Akbar Seluruh Ormawa UST (17:00).', pic: 'Kementerian MENDAGRI' },
        { start: '17:30', end: '18:30', track: 'All Area', location: 'Kampus Pusat UST', title: '26. ISHOMA Malam & Persiapan Dewantara Celebration', description: 'Istirahat maghrib, tata ulang tata cahaya panggung malam & briefing penutupan.', pic: 'All Panitia' },
        { start: '18:30', end: '20:30', track: 'Panggung Utama', location: 'Panggung Utama Kampus Pusat UST', title: '27. Closing Ceremony & Dewantara Celebration (Malam Puncak)', description: 'Penutupan formal DEMAFEST 2026 (18:30) disambung konser hiburan malam puncak & apresiasi kolaborasi mahasiswa (19:00–20:30).', pic: 'Divisi Acara & PDD' },
        { start: '20:30', end: '21:00', track: 'All Area', location: 'Kampus Pusat UST', title: '28. Foto Bersama, Dokumentasi Akhir & Pembongkaran Expo', description: 'Dokumentasi seluruh panitia, pengisi acara, pengecekan inventaris venue, dan pembersihan area.', pic: 'Divisi PDD & Perlengkapan' }
      ]
    },
    {
      id: 'evt-demafest-dewa-connect',
      parent_event_id: 'evt-demafest-2026',
      theme_color: '#1e3a8a',
      title: 'Pre-Event MENLU: Dewa Connect — Building Bridges, Expanding Horizons',
      slug: 'demafest-pre-event-dewa-connect',
      category_id: 'cat-4',
      category: 'Bisnis & Karir',
      description:
        'Program kerja Kementerian Luar Negeri (MENLU) BEM UST: Kunjungan / studi banding dengan BEM universitas mitra untuk bertukar gagasan tata kelola organisasi, strategi advokasi mahasiswa, pengelolaan program kerja, serta pengembangan relasi antarlembaga (termasuk inisiatif jejaring Dewa Berbagi / Dewa Connect).',
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
        { start: '07:00', end: '08:00', track: 'Delegasi', title: 'Persiapan dan keberangkatan', description: 'Briefing delegasi BEM UST', pic: 'MENLU' },
        { start: '08:00', end: '09:00', track: 'Transit', title: 'Perjalanan menuju kampus mitra', description: 'Koordinasi kedatangan', pic: 'MENLU' },
        { start: '09:00', end: '09:30', track: 'Aula Mitra', title: 'Penyambutan dan pembukaan', description: 'Sambutan BEM UST & BEM Mitra', pic: 'MENLU' },
        { start: '09:30', end: '10:00', track: 'Aula Mitra', title: 'Presentasi profil organisasi', description: 'Pengenalan struktur & visi misi', pic: 'MENLU' },
        { start: '10:00', end: '11:30', track: 'Forum Diskusi', title: 'Forum diskusi dan sharing', description: 'Tata kelola organisasi & advokasi mahasiswa', pic: 'MENLU' },
        { start: '11:30', end: '12:30', track: 'Istirahat', title: 'ISHOMA', description: 'Istirahat & makan siang bersama', pic: 'Panitia' },
        { start: '12:30', end: '13:30', track: 'Forum Diskusi', title: 'Diskusi program unggulan', description: 'Relasi antarlembaga & inovasi proker', pic: 'MENLU' },
        { start: '13:30', end: '14:00', track: 'Aula Mitra', title: 'Penyerahan cenderamata', description: 'Plakat resmi BEM UST', pic: 'Humas & MENLU' },
        { start: '14:00', end: '15:00', track: 'Aula Mitra', title: 'Dokumentasi & penutupan', description: 'Penyusunan notulensi & kepulangan', pic: 'PDD & MENLU' }
      ]
    },
    {
      id: 'evt-demafest-badminton',
      parent_event_id: 'evt-demafest-2026',
      theme_color: '#1e3a8a',
      title: 'Pre-Event MENPORA: Dewantara Badminton Cup',
      slug: 'demafest-pre-event-dewantara-badminton-cup',
      category_id: 'cat-5',
      category: 'Komunitas & Sosial',
      description:
        'Program kerja Kementerian Pemuda dan Olahraga (MENPORA) BEM UST dengan tema "One Court, One Spirit, One Victory". Turnamen badminton antarmahasiswa UST dalam 3 kategori resmi: Ganda Putra, Ganda Putri, dan Ganda Campuran (sistem gugur).',
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
        { start: '07:00', end: '08:00', track: 'GOR Utama', title: 'Registrasi peserta turnamen', description: 'Verifikasi tim Ganda Putra, Ganda Putri & Ganda Campuran', pic: 'MENPORA' },
        { start: '08:00', end: '08:20', track: 'GOR Utama', title: 'Pembukaan', description: 'Pembukaan resmi Dewantara Badminton Cup', pic: 'MENPORA' },
        { start: '08:20', end: '08:40', track: 'GOR Utama', title: 'Technical meeting singkat', description: 'Sistem gugur & pembagian lapangan (Court 1-3)', pic: 'Wasit & MENPORA' },
        { start: '08:40', end: '12:00', track: 'Court 1-3', title: 'Babak penyisihan', description: 'Pertandingan paralel Ganda Putra, Ganda Putri & Ganda Campuran', pic: 'MENPORA' },
        { start: '12:00', end: '13:00', track: 'Istirahat', title: 'ISHOMA', description: 'Istirahat siang', pic: 'Panitia' },
        { start: '13:00', end: '15:00', track: 'Court 1-2', title: 'Babak Semifinal', description: 'Penentuan finalis terbaik tiap kategori ganda', pic: 'MENPORA' },
        { start: '15:00', end: '16:30', track: 'Court 1', title: 'Babak Final', description: 'Perebutan Juara 1, 2, dan 3 semua kategori ganda', pic: 'MENPORA' },
        { start: '16:30', end: '17:00', track: 'GOR Utama', title: 'Penyerahan hadiah dan penutupan', description: 'Apresiasi juara & dokumentasi kompetisi', pic: 'PDD & MENPORA' }
      ]
    },
    {
      id: 'evt-demafest-critical-space',
      parent_event_id: 'evt-demafest-2026',
      theme_color: '#1e3a8a',
      title: 'Pre-Event KASTRAT: Dewantara Critical Space',
      slug: 'demafest-pre-event-dewantara-critical-space',
      category_id: 'cat-3',
      category: 'Workshop & Edukasi',
      description:
        'Program kerja Kementerian Kajian dan Strategi (KASTRAT): Forum kajian & diskusi kritis bertema "Mahasiswa sebagai Subjek Kritis dalam Mengawal Kebijakan Publik". Fokus 4 topik kajian: (1) Akses & keadilan pendidikan tinggi; (2) Demokrasi & partisipasi mahasiswa di kampus; (3) Relevansi pemikiran Ki Hadjar Dewantara pada isu kontemporer; (4) Kebijakan sosial yang berdampak pada generasi muda.',
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
        { start: '13:00', end: '13:30', track: 'Foyer Ruang Diskusi', title: 'Registrasi peserta diskusi', description: 'Pendataan peserta forum kajian & pembagian kelompok topik 1–4', pic: 'KASTRAT' },
        { start: '13:30', end: '13:45', track: 'Ruang Diskusi', title: 'Pembukaan', description: 'Pengantar tema Mahasiswa sebagai Subjek Kritis', pic: 'KASTRAT' },
        { start: '13:45', end: '14:15', track: 'Ruang Diskusi', title: 'Pemaparan isu & pengantar kajian', description: 'Bedah kebijakan publik, keadilan pendidikan, demokrasi kampus & pemikiran Ki Hadjar Dewantara', pic: 'KASTRAT' },
        { start: '14:15', end: '15:15', track: 'Kelompok 1–4', title: 'Diskusi kelompok terarah (4 Topik)', description: 'Topik 1: Akses pendidikan tinggi; Topik 2: Demokrasi kampus; Topik 3: Relevansi ajaran Ki Hadjar Dewantara; Topik 4: Kebijakan sosial generasi muda', pic: 'Moderator' },
        { start: '15:15', end: '15:45', track: 'Ruang Diskusi', title: 'Presentasi hasil kajian', description: 'Pemaparan rekomendasi tiap kelompok topik 1–4', pic: 'KASTRAT' },
        { start: '15:45', end: '16:15', track: 'Ruang Diskusi', title: 'Tanggapan & penyusunan rekomendasi', description: 'Finalisasi naskah kajian untuk forum DEMAFEST 10 Des', pic: 'KASTRAT' },
        { start: '16:15', end: '16:30', track: 'Ruang Diskusi', title: 'Penutupan', description: 'Dokumentasi hasil kajian', pic: 'PDD' }
      ]
    },
    {
      id: 'evt-demafest-suara-mahasiswa',
      parent_event_id: 'evt-demafest-2026',
      theme_color: '#1e3a8a',
      title: 'Pre-Event Advokasi: Suara Mahasiswa — Posko Aspirasi UST',
      slug: 'demafest-pre-event-suara-mahasiswa',
      category_id: 'cat-5',
      category: 'Komunitas & Sosial',
      description:
        'Program kerja Kementerian Advokasi bertema "Mendengar Aspirasi, Mengawal Hak, Mewujudkan Keadilan". Membuka posko aspirasi 3 hari (3–5 Desember 2026), survei permasalahan mahasiswa (akademik, fasilitas, layanan kampus, UKT/kesejahteraan), konsultasi & pendampingan, hingga penyusunan dokumen aspirasi untuk disampaikan di Public Forum 10 Desember 2026.',
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
        { date: '2026-12-03', start: '09:00', end: '10:00', track: 'Hari 1 — Pembukaan Posko', title: 'Hari 1: Persiapan & Pembukaan Posko Aspirasi', description: 'Penataan meja konsultasi, formulir survei digital, dan seremoni pembukaan layanan aspirasi akademik & nonakademik.', pic: 'Advokasi' },
        { date: '2026-12-03', start: '10:00', end: '15:30', track: 'Hari 1 — Posko Utama', title: 'Hari 1: Pengumpulan Aspirasi & Pengaduan Awal', description: 'Penerimaan aduan langsung mahasiswa terkait fasilitas kampus & layanan akademik.', pic: 'Advokasi' },
        { date: '2026-12-04', start: '09:00', end: '12:00', track: 'Hari 2 — Student Center', title: 'Hari 2: Survei Masalah Mahasiswa & Konsultasi Hak Akademik', description: 'Penyebaran survei aspirasi mahasiswa dan pendampingan advokasi kesejahteraan/UKT.', pic: 'Advokasi' },
        { date: '2026-12-04', start: '13:00', end: '15:30', track: 'Hari 2 — Student Center', title: 'Hari 2: Klasifikasi Isu Prioritas Fakultas', description: 'Pemetaan aduan berdasarkan kategori akademik, fasilitas, dan tata kelola layanan.', pic: 'Advokasi' },
        { date: '2026-12-05', start: '09:00', end: '12:00', track: 'Hari 3 — Pleno Advokasi', title: 'Hari 3: Konsolidasi & Pendampingan Kasus Lanjutan', description: 'Verifikasi akhir data pengaduan mahasiswa sebelum penutupan posko.', pic: 'Advokasi' },
        { date: '2026-12-05', start: '13:00', end: '15:30', track: 'Hari 3 — Pleno Advokasi', title: 'Hari 3: Penyusunan Laporan Aspirasi & Publikasi Hasil Awal', description: 'Kompilasi Naskah Suara Mahasiswa untuk disampaikan di Dewantara Public Forum 10 Des.', pic: 'PDD & Advokasi' }
      ]
    },
    {
      id: 'evt-demafest-leadership-forum',
      parent_event_id: 'evt-demafest-2026',
      theme_color: '#1e3a8a',
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
        { start: '08:00', end: '08:30', track: 'Auditorium', title: 'Registrasi pengurus ormawa', description: 'Pendataan perwakilan BEM, HMJ & UKM UST', pic: 'MENDAGRI' },
        { start: '08:30', end: '08:45', track: 'Auditorium', title: 'Pembukaan', description: 'Sambutan penguatan solidaritas ormawa', pic: 'MENDAGRI' },
        { start: '08:45', end: '09:30', track: 'Auditorium', title: 'Materi kepemimpinan organisasi', description: 'Sesi kepemimpinan Tamansiswa', pic: 'MENDAGRI' },
        { start: '09:30', end: '10:15', track: 'Auditorium', title: 'Materi tata kelola organisasi', description: 'Best practice manajemen ormawa & kolaborasi', pic: 'MENDAGRI' },
        { start: '10:15', end: '10:30', track: 'Istirahat', title: 'Istirahat', description: 'Coffee break singkat', pic: 'Panitia' },
        { start: '10:30', end: '11:30', track: 'Ruang Ormawa', title: 'Forum diskusi antarlembaga', description: 'Penyelarasan program kerja BEM, HMJ & UKM', pic: 'MENDAGRI' },
        { start: '11:30', end: '12:00', track: 'Ruang Ormawa', title: 'Penyusunan komitmen kolaborasi', description: 'Persiapan Ormawa Performance & Showcase 10 Des', pic: 'MENDAGRI' },
        { start: '12:00', end: '12:15', track: 'Auditorium', title: 'Penutupan', description: 'Foto bersama pimpinan ormawa UST', pic: 'PDD' }
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
        parent_event_id: evtDef.parent_event_id,
        theme_color: evtDef.theme_color,
        category_id: evtDef.category_id,
        category: evtDef.category,
        title: evtDef.title,
        description: evtDef.description,
        location_name: evtDef.location_name,
        address: evtDef.address,
        start_at: evtDef.start_at,
        end_at: evtDef.end_at,
        capacity: evtDef.capacity,
        status: evtDef.status,
        publication_status: evtDef.publication_status,
        is_featured: evtDef.is_featured,
        enabled_modules: ALL_MODULES,
        speakers: evtDef.speakers,
        created_by: bestanId
      },
      create: {
        id: evtDef.id,
        organization_id: orgId,
        parent_event_id: evtDef.parent_event_id,
        theme_color: evtDef.theme_color,
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
        price_snapshot_idr: 96750,
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
    const fallbackDate = evtDef.start_at.slice(0, 10)
    for (const [idx, sch] of (evtDef.schedules as any[]).entries()) {
      const schId = `sch-${evtDef.id}-${idx + 1}`
      const dateStr = sch.date || fallbackDate
      const locStr = sch.location || evtDef.location_name
      await prisma.eventSchedule.upsert({
        where: { id: schId },
        update: {
          title: sch.title,
          description: sch.description,
          date: dateStr,
          track: sch.track || null,
          location: locStr,
          start_time: sch.start,
          end_time: sch.end,
          pic: sch.pic,
          sort_order: idx
        },
        create: {
          id: schId,
          event_id: evtDef.id,
          title: sch.title,
          description: sch.description,
          track: sch.track || null,
          date: dateStr,
          start_time: sch.start,
          end_time: sch.end,
          location: locStr,
          pic: sch.pic,
          visibility: 'public',
          sort_order: idx
        }
      })
    }

    // Default ticket tier per event (except Badminton Cup which uses the 3 Ganda categories below)
    if (evtDef.id !== 'evt-demafest-badminton') {
      const freeTktId = `tkt-free-${evtDef.id}`
      await prisma.ticketType.upsert({
        where: { id: freeTktId },
        update: {
          category: evtDef.id === 'evt-demafest-2026' ? 'Mahasiswa UST' : 'Peserta Umum'
        },
        create: {
          id: freeTktId,
          event_id: evtDef.id,
          category: evtDef.id === 'evt-demafest-2026' ? 'Mahasiswa UST' : 'Peserta Umum',
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
  }

  // Additional public ticket tier on DEMAFEST Main Event
  await prisma.ticketType.upsert({
    where: { id: 'tkt-umum-evt-demafest-2026' },
    update: { category: 'Umum & Tamu' },
    create: {
      id: 'tkt-umum-evt-demafest-2026',
      event_id: 'evt-demafest-2026',
      category: 'Umum & Tamu',
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

  // 3 Badminton Cup Double Categories (Section 6.2 plan.docx)
  const badmintonTiers = [
    { id: 'tkt-badminton-ganda-putra', category: 'Ganda Putra', name: 'Pendaftaran Tim Ganda Putra', description: 'Kategori Turnamen Badminton Ganda Putra antarmahasiswa UST (sistem gugur).', quantity: 40 },
    { id: 'tkt-badminton-ganda-putri', category: 'Ganda Putri', name: 'Pendaftaran Tim Ganda Putri', description: 'Kategori Turnamen Badminton Ganda Putri antarmahasiswa UST (sistem gugur).', quantity: 40 },
    { id: 'tkt-badminton-ganda-campuran', category: 'Ganda Campuran', name: 'Pendaftaran Tim Ganda Campuran', description: 'Kategori Turnamen Badminton Ganda Campuran antarmahasiswa UST (sistem gugur).', quantity: 40 }
  ]
  for (const bt of badmintonTiers) {
    await prisma.ticketType.upsert({
      where: { id: bt.id },
      update: { category: bt.category, name: bt.name, description: bt.description },
      create: {
        id: bt.id,
        event_id: 'evt-demafest-badminton',
        category: bt.category,
        name: bt.name,
        description: bt.description,
        price: 0,
        currency: 'IDR',
        quantity: bt.quantity,
        sold_quantity: 0,
        min_per_order: 1,
        max_per_order: 2,
        status: 'On Sale'
      }
    })
  }

  // Active 4-question Survey on Pre-Event Suara Mahasiswa
  await prisma.eventSurvey.upsert({
    where: { id: 'srv-demafest-suara' },
    update: {
      is_active: true,
      questions: [
        { id: 'q1', question: 'Fakultas / Program Studi Anda di UST', question_type: 'text', options: [] },
        { id: 'q2', question: 'Kategori isu prioritas yang perlu dikawal BEM UST', question_type: 'multiple_choice', options: ['Layanan Akademik & KRS', 'Fasilitas Kampus & Lab', 'UKT & Kesejahteraan Mahasiswa', 'Kebijakan Kemahasiswaan & Ormawa'] },
        { id: 'q3', question: 'Tingkat kepuasan layanan fasilitas kampus saat ini (1-5)', question_type: 'rating', options: [] },
        { id: 'q4', question: 'Aspirasi atau usulan konkret untuk Dewantara Public Forum', question_type: 'text', options: [] }
      ]
    },
    create: {
      id: 'srv-demafest-suara',
      event_id: 'evt-demafest-suara-mahasiswa',
      title: 'Survei & Penjaringan Aspirasi Suara Mahasiswa UST 2026',
      description: 'Masukan mahasiswa akan dirangkum dan disampaikan langsung dalam Dewantara Public Forum (10 Desember 2026).',
      questions: [
        { id: 'q1', question: 'Fakultas / Program Studi Anda di UST', question_type: 'text', options: [] },
        { id: 'q2', question: 'Kategori isu prioritas yang perlu dikawal BEM UST', question_type: 'multiple_choice', options: ['Layanan Akademik & KRS', 'Fasilitas Kampus & Lab', 'UKT & Kesejahteraan Mahasiswa', 'Kebijakan Kemahasiswaan & Ormawa'] },
        { id: 'q3', question: 'Tingkat kepuasan layanan fasilitas kampus saat ini (1-5)', question_type: 'rating', options: [] },
        { id: 'q4', question: 'Aspirasi atau usulan konkret untuk Dewantara Public Forum', question_type: 'text', options: [] }
      ],
      is_active: true,
      responses: []
    }
  })

  // 5. Hierarchical Timeline Checkpoints & Sub-tasks for Main Event & Pre-Events (Section 4, 5 & 9 of plan.docx)
  const mainId = 'evt-demafest-2026'
  const tasksData = [
    // Week 1 Group
    { id: 'df-grp-w1', event_id: mainId, parent_id: null, is_group: true, title: 'Minggu 1 (18–22 Nov): Fondasi Kegiatan & Publikasi Awal', phase: 'Pre-Event', assigned_to: 'Bestan Dhya Ul Haq', priority: 'High', status: 'In Progress', start_date: '2026-11-18', due_at: '2026-11-22', progress: 40 },
    { id: 'df-t1', event_id: mainId, parent_id: 'df-grp-w1', is_group: false, title: 'Finalisasi konsep, identitas visual (Navy Blue & Gold) & persetujuan proker', phase: 'Pre-Event', assigned_to: 'Divisi Acara & PDD', priority: 'High', status: 'Done', start_date: '2026-11-18', due_at: '2026-11-19', progress: 100 },
    { id: 'df-t2', event_id: mainId, parent_id: 'df-grp-w1', is_group: false, title: 'Penyusunan Master RAB 5 Divisi, proposal & surat perizinan kampus', phase: 'Pre-Event', assigned_to: 'Bendahara & Humas', priority: 'High', status: 'In Progress', start_date: '2026-11-18', due_at: '2026-11-21', progress: 50 },
    { id: 'df-t3', event_id: mainId, parent_id: 'df-grp-w1', is_group: false, title: 'Rapat Koordinasi I (20 Nov) & Rilis Teaser Resmi DEMAFEST', phase: 'Marketing', assigned_to: 'Divisi PDD', priority: 'High', status: 'To Do', start_date: '2026-11-20', due_at: '2026-11-20', progress: 0 },
    { id: 'df-t4', event_id: mainId, parent_id: 'df-grp-w1', is_group: false, title: 'Rapat Teknis I, Rilis Poster Resmi & Pemesanan venue/perlengkapan', phase: 'Production', assigned_to: 'Divisi Perlengkapan & PDD', priority: 'Medium', status: 'To Do', start_date: '2026-11-22', due_at: '2026-11-22', progress: 0 },

    // Week 2 Group
    { id: 'df-grp-w2', event_id: mainId, parent_id: null, is_group: true, title: 'Minggu 2 (23–29 Nov): Open Reg, Dewa Connect & Badminton Cup', phase: 'Pre-Event', assigned_to: 'MENLU & MENPORA', priority: 'High', status: 'To Do', start_date: '2026-11-23', due_at: '2026-11-29', progress: 0 },
    { id: 'df-t5', event_id: mainId, parent_id: 'df-grp-w2', is_group: false, title: 'Open Registration DEMAFEST, Pengumuman Lomba & Rakor II–III (23–26 Nov)', phase: 'Marketing', assigned_to: 'Divisi Humas & PDD', priority: 'High', status: 'To Do', start_date: '2026-11-23', due_at: '2026-11-26', progress: 0 },
    { id: 'df-t6', event_id: mainId, parent_id: 'df-grp-w2', is_group: false, title: 'Pelaksanaan Pre-Event Dewa Connect (MENLU), Technical Meeting Lomba & Rilis Line-up Narasumber/Guest Star', phase: 'Event Day', assigned_to: 'Kementerian MENLU & Acara', priority: 'High', status: 'To Do', start_date: '2026-11-27', due_at: '2026-11-28', progress: 0 },
    { id: 'df-t7', event_id: mainId, parent_id: 'df-grp-w2', is_group: false, title: 'Pelaksanaan Dewantara Badminton Cup (MENPORA) & Rapat Evaluasi I (29 Nov)', phase: 'Event Day', assigned_to: 'Kementerian MENPORA', priority: 'High', status: 'To Do', start_date: '2026-11-29', due_at: '2026-11-29', progress: 0 },

    // Week 3 Group
    { id: 'df-grp-w3', event_id: mainId, parent_id: null, is_group: true, title: 'Minggu 3 (30 Nov–6 Des): Critical Space, Suara Mahasiswa & Leadership Forum', phase: 'Production', assigned_to: 'KASTRAT, Advokasi & MENDAGRI', priority: 'High', status: 'To Do', start_date: '2026-11-30', due_at: '2026-12-06', progress: 0 },
    { id: 'df-t8', event_id: mainId, parent_id: 'df-grp-w3', is_group: false, title: 'Publikasi Tamansiswa Expo (1 Des), Achievement Awards (2 Des) & Critical Space', phase: 'Marketing', assigned_to: 'KASTRAT & PDD', priority: 'Medium', status: 'To Do', start_date: '2026-12-01', due_at: '2026-12-02', progress: 0 },
    { id: 'df-t9', event_id: mainId, parent_id: 'df-grp-w3', is_group: false, title: 'Posko Aspirasi Suara Mahasiswa (3–5 Des), Countdown H-7 & Rapat Koordinasi V (4 Des)', phase: 'Production', assigned_to: 'Kementerian Advokasi & PDD', priority: 'Medium', status: 'To Do', start_date: '2026-12-03', due_at: '2026-12-05', progress: 0 },
    { id: 'df-t10', event_id: mainId, parent_id: 'df-grp-w3', is_group: false, title: 'Pelaksanaan Dewantara Leadership Forum (MENDAGRI) & Rapat Teknis II (6 Des)', phase: 'Production', assigned_to: 'Kementerian MENDAGRI', priority: 'High', status: 'To Do', start_date: '2026-12-06', due_at: '2026-12-06', progress: 0 },

    // Week 4 Group
    { id: 'df-grp-w4', event_id: mainId, parent_id: null, is_group: true, title: 'Minggu 4 (7–15 Des): Gladi Bersih, Main Event & Evaluasi LPJ', phase: 'Event Day', assigned_to: 'Seluruh Panitia DEMAFEST', priority: 'High', status: 'To Do', start_date: '2026-12-07', due_at: '2026-12-15', progress: 0 },
    { id: 'df-t11', event_id: mainId, parent_id: 'df-grp-w4', is_group: false, title: 'Rekapitulasi hasil seluruh proker kementerian & Countdown H-3 (7 Des)', phase: 'Marketing', assigned_to: 'Seluruh Kementerian', priority: 'High', status: 'To Do', start_date: '2026-12-07', due_at: '2026-12-07', progress: 0 },
    { id: 'df-t12', event_id: mainId, parent_id: 'df-grp-w4', is_group: false, title: 'Gladi bersih teknis, Rapat Final (8 Des), Setup Venue & Briefing Akhir (9 Des)', phase: 'Production', assigned_to: 'Perlengkapan, Keamanan & Acara', priority: 'High', status: 'To Do', start_date: '2026-12-08', due_at: '2026-12-09', progress: 0 },
    { id: 'df-t13', event_id: mainId, parent_id: 'df-grp-w4', is_group: false, title: 'Puncak DEMAFEST Main Event & Live Report (10 Des)', phase: 'Event Day', assigned_to: 'Bestan Dhya Ul Haq & PDD', priority: 'High', status: 'To Do', start_date: '2026-12-10', due_at: '2026-12-10', progress: 0 },
    { id: 'df-t14', event_id: mainId, parent_id: 'df-grp-w4', is_group: false, title: 'Rapat Evaluasi Akhir, Penyusunan LPJ Resmi & Rilis Aftermovie (12–15 Des)', phase: 'Post-Event', assigned_to: 'Panitia Inti & Divisi PDD', priority: 'High', status: 'To Do', start_date: '2026-12-12', due_at: '2026-12-15', progress: 0 },

    // Pre-Event operational tasks on child events
    { id: 'df-pre-t1', event_id: 'evt-demafest-dewa-connect', parent_id: null, is_group: false, title: 'Konfirmasi delegasi & pengiriman surat permohonan studi banding BEM Mitra', phase: 'Pre-Event', assigned_to: 'MENLU BEM UST', priority: 'High', status: 'In Progress', start_date: '2026-11-20', due_at: '2026-11-26', progress: 60 },
    { id: 'df-pre-t2', event_id: 'evt-demafest-badminton', parent_id: null, is_group: false, title: 'Technical Meeting Turnamen & penyusunan bagan Ganda Putra/Putri/Campuran', phase: 'Pre-Event', assigned_to: 'MENPORA BEM UST', priority: 'High', status: 'To Do', start_date: '2026-11-25', due_at: '2026-11-28', progress: 0 },
    { id: 'df-pre-t3', event_id: 'evt-demafest-critical-space', parent_id: null, is_group: false, title: 'Kurasi 4 isu kebijakan & penyusunan TOR diskusi Critical Space', phase: 'Pre-Event', assigned_to: 'KASTRAT BEM UST', priority: 'High', status: 'To Do', start_date: '2026-11-26', due_at: '2026-12-01', progress: 0 },
    { id: 'df-pre-t4', event_id: 'evt-demafest-suara-mahasiswa', parent_id: null, is_group: false, title: 'Setup Posko Aspirasi Student Center & publikasi kuesioner Suara Mahasiswa', phase: 'Pre-Event', assigned_to: 'Kementerian Advokasi', priority: 'High', status: 'To Do', start_date: '2026-11-30', due_at: '2026-12-02', progress: 0 },
    { id: 'df-pre-t5', event_id: 'evt-demafest-leadership-forum', parent_id: null, is_group: false, title: 'Undangan delegasi pengurus BEM/HMJ/UKM & modul kepemimpinan Tamansiswa', phase: 'Pre-Event', assigned_to: 'MENDAGRI BEM UST', priority: 'High', status: 'To Do', start_date: '2026-12-01', due_at: '2026-12-05', progress: 0 }
  ]

  for (const t of tasksData) {
    await prisma.eventTask.upsert({
      where: { id: t.id },
      update: { title: t.title, phase: t.phase, start_date: t.start_date, due_at: t.due_at },
      create: {
        id: t.id,
        event_id: t.event_id,
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

  // 6. 5 Divisi Kepanitiaan + Bendahara Pusat (Team Members for Main Event)
  const divisionLeads = [
    { id: 'tm-df-bendahara', name: 'Bendahara Pusat DEMAFEST', email: 'bendahara@bemust.id', role: 'Manager', department: 'Keuangan & RAB Panitia Inti', permissions: ['View Event', 'View Finance', 'Manage Tickets'] },
    { id: 'tm-df-acara', name: 'Koordinator Divisi Acara', email: 'acara@bemust.id', role: 'Manager', department: 'Divisi Acara (Konsep, Rundown, MC, Narasumber)', permissions: ['View Event', 'Edit Event', 'Manage Timeline', 'View Participants'] },
    { id: 'tm-df-humas', name: 'Koordinator Divisi Humas', email: 'humas@bemust.id', role: 'Manager', department: 'Divisi Humas (Undangan, Rektorat, Sponsor, Medpart)', permissions: ['View Event', 'Manage Timeline', 'View Participants', 'Manage Tickets'] },
    { id: 'tm-df-perkap', name: 'Koordinator Divisi Perlengkapan', email: 'perlengkapan@bemust.id', role: 'Staff', department: 'Divisi Perlengkapan (Panggung, Sound, Tenda Expo)', permissions: ['View Event', 'Manage Timeline'] },
    { id: 'tm-df-keamanan', name: 'Koordinator Divisi Keamanan', email: 'keamanan@bemust.id', role: 'Staff', department: 'Divisi Keamanan (Akses, Parkir, Massa, P3K)', permissions: ['View Event', 'Manage Check-in'] },
    { id: 'tm-df-pdd', name: 'Koordinator Divisi PDD', email: 'pdd@bemust.id', role: 'Manager', department: 'Divisi PDD (Branding, Poster, Dokumentasi, Aftermovie)', permissions: ['View Event', 'Edit Event', 'Manage Timeline'] }
  ]

  for (const dm of divisionLeads) {
    await prisma.teamMember.upsert({
      where: { id: dm.id },
      update: { permissions: dm.permissions },
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

  // 7. Finance Budget, RAB Categories (Section 8 of plan.docx), Pre-Event Budgets, Vendors & Documents
  await prisma.eventBudget.upsert({
    where: { event_id: mainId },
    update: { amount: 25000000 },
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
    { id: 'df-exp-5', category: 'Divisi PDD', description: 'Desain identitas visual Navy Blue & Gold, cetak poster/banner, ID card & produksi aftermovie', amount: 2500000, date: '2026-11-22' },
    { id: 'df-exp-7', category: 'Dana Cadangan (10%)', description: 'Alokasi dana cadangan 10% total kebutuhan inti untuk mitigasi darurat operasional', amount: 1850000, date: '2026-11-22' },
    { id: 'df-exp-6', category: 'Pre-Event 5 Kementerian', description: 'Subsidi induk untuk 5 Pre-Event (Dewa Connect, Badminton Cup, Critical Space, Suara Mahasiswa, Leadership Forum)', amount: 4000000, date: '2026-11-27' }
  ]

  for (const exp of rabExpenses) {
    await prisma.financeExpense.upsert({
      where: { id: exp.id },
      update: { category: exp.category, description: exp.description, amount: exp.amount },
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

  // Separate budgets for each Pre-Event workspace
  const preEventBudgets = [
    { event_id: 'evt-demafest-dewa-connect', amount: 800000, label: 'Alokasi Studi Banding MENLU' },
    { event_id: 'evt-demafest-badminton', amount: 1200000, label: 'Alokasi Turnamen MENPORA (Sewa Lapangan, Shuttlecock & Trofi)' },
    { event_id: 'evt-demafest-critical-space', amount: 600000, label: 'Alokasi Forum Kajian KASTRAT' },
    { event_id: 'evt-demafest-suara-mahasiswa', amount: 600000, label: 'Alokasi Posko Aspirasi Advokasi 3 Hari' },
    { event_id: 'evt-demafest-leadership-forum', amount: 800000, label: 'Alokasi Kepemimpinan MENDAGRI' }
  ]
  for (const pb of preEventBudgets) {
    await prisma.eventBudget.upsert({
      where: { event_id: pb.event_id },
      update: { amount: pb.amount },
      create: { event_id: pb.event_id, amount: pb.amount }
    })
    await prisma.financeIncome.upsert({
      where: { id: `df-inc-${pb.event_id}` },
      update: { amount: pb.amount },
      create: {
        id: `df-inc-${pb.event_id}`,
        event_id: pb.event_id,
        category: 'Subsidi Induk DEMAFEST',
        description: pb.label,
        amount: pb.amount,
        date: '2026-11-20',
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

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const { PrismaClient } = await import('@prisma/client')
  const standalonePrisma = new PrismaClient()
  seedDemafestPlan(standalonePrisma)
    .then((res) => {
      console.log(`DEMAFEST 2026 seed selesai untuk ${res.email} (${res.eventIds.length} events).`)
    })
    .catch((err) => {
      console.error('Seed DEMAFEST gagal:', err)
      process.exitCode = 1
    })
    .finally(() => standalonePrisma.$disconnect())
}
