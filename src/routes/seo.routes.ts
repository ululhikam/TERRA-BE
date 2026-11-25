import { Router } from 'express'
import { CANONICAL_SITE_URL } from '../config/env.js'
import * as db from '../repositories/db.js'
import { asyncHandler } from '../utils/response.js'

const router = Router()

const DEFAULT_OG_IMAGE = `${CANONICAL_SITE_URL}/og-image.png`

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function serializeJsonLd(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c')
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function cleanPlainText(raw: unknown, maxLength = 160): string {
  const plain = String(raw ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`>~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return ''
  if (plain.length <= maxLength) return plain
  const sliced = plain.slice(0, maxLength - 1)
  const lastSpace = sliced.lastIndexOf(' ')
  return `${(lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced).trim()}…`
}

function resolvePublicImageUrl(candidate: unknown): string {
  const val = String(candidate || '').trim()
  if (/^https?:\/\//i.test(val)) return val
  if (val.startsWith('/')) return `${CANONICAL_SITE_URL}${val}`
  return DEFAULT_OG_IMAGE
}

function formatReadableDateId(value: unknown): string {
  if (!value) return ''
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return String(value)
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Jakarta'
    }).format(parsed)
  } catch {
    return String(value)
  }
}

function renderShareHtml({
  title,
  description,
  canonicalUrl,
  imageUrl,
  imageAlt,
  heading,
  ctaLabel,
  jsonLd
}: {
  title: string
  description: string
  canonicalUrl: string
  imageUrl: string
  imageAlt: string
  heading: string
  ctaLabel: string
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>
}) {
  const ldScript = jsonLd
    ? `\n    <script type="application/ld+json">${serializeJsonLd(jsonLd)}</script>`
    : ''

  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="id_ID" />
    <meta property="og:site_name" content="TERRA" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />${ldScript}
  </head>
  <body>
    <main>
      <h1>${escapeHtml(heading)}</h1>
      <p>${escapeHtml(description)}</p>
      <p><a href="${escapeHtml(canonicalUrl)}">${escapeHtml(ctaLabel)}</a></p>
    </main>
  </body>
</html>`
}

router.get(
  '/seo/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const [{ items: events }, organizers] = await Promise.all([
      db.listMarketplaceEvents({ page: 1, limit: 500, sort: 'upcoming' }),
      db.listMarketplaceOrganizers()
    ])

    const todayIso = new Date().toISOString()

    const staticUrls = [
      { loc: `${CANONICAL_SITE_URL}/`, lastmod: todayIso, changefreq: 'daily', priority: '1.0' },
      { loc: `${CANONICAL_SITE_URL}/events`, lastmod: todayIso, changefreq: 'hourly', priority: '0.9' },
      { loc: `${CANONICAL_SITE_URL}/pricing`, lastmod: todayIso, changefreq: 'weekly', priority: '0.8' },
      { loc: `${CANONICAL_SITE_URL}/organizer/register`, lastmod: todayIso, changefreq: 'monthly', priority: '0.7' },
      { loc: `${CANONICAL_SITE_URL}/register`, lastmod: todayIso, changefreq: 'monthly', priority: '0.6' },
      { loc: `${CANONICAL_SITE_URL}/login`, lastmod: todayIso, changefreq: 'monthly', priority: '0.5' }
    ]

    const seenLocs = new Set(staticUrls.map((u) => u.loc))
    const entries: string[] = staticUrls.map(
      (item) => `  <url>
    <loc>${escapeXml(item.loc)}</loc>
    <lastmod>${escapeXml(item.lastmod)}</lastmod>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`
    )

    for (const evt of events || []) {
      const slugOrId = evt?.slug || evt?.id
      if (!slugOrId) continue
      const loc = `${CANONICAL_SITE_URL}/events/${encodeURIComponent(String(slugOrId))}`
      if (seenLocs.has(loc)) continue
      seenLocs.add(loc)

      const lastmod =
        toIsoDate(evt.updated_at) ||
        toIsoDate(evt.published_at) ||
        toIsoDate(evt.created_at) ||
        todayIso
      const imageUrl = resolvePublicImageUrl(evt.poster_url || evt.banner_url)
      const imageBlock = imageUrl.startsWith('http')
        ? `\n    <image:image>\n      <image:loc>${escapeXml(imageUrl)}</image:loc>\n      <image:title>${escapeXml(evt.title || 'Event TERRA')}</image:title>\n    </image:image>`
        : ''

      entries.push(`  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.85</priority>${imageBlock}
  </url>`)
    }

    for (const org of organizers || []) {
      if (!org?.slug) continue
      const loc = `${CANONICAL_SITE_URL}/organizers/${encodeURIComponent(String(org.slug))}`
      if (seenLocs.has(loc)) continue
      seenLocs.add(loc)

      const lastmod = toIsoDate(org.updated_at) || toIsoDate(org.created_at) || todayIso
      entries.push(`  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`)
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join('\n')}
</urlset>`

    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=900, s-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).send(xml)
  })
)

router.get(
  '/seo/share/events/:slug',
  asyncHandler(async (req, res) => {
    try {
      const event = await db.getPublicEventBySlugOrId(req.params.slug)
      const slug = event.slug || req.params.slug
      const canonicalUrl = `${CANONICAL_SITE_URL}/events/${encodeURIComponent(String(slug))}`
      const imageUrl = resolvePublicImageUrl(event.poster_url || event.banner_url)
      const dateStr = formatReadableDateId(event.start_at || event.start_date)
      const locationLabel = event.location_name || (event.location_type === 'online' ? 'Online' : 'Indonesia')
      const summaryBase = cleanPlainText(event.description, 115)
      const metaSuffix = [dateStr, locationLabel].filter(Boolean).join(' • ')
      const description =
        cleanPlainText(
          `${summaryBase ? `${summaryBase} — ` : ''}${metaSuffix ? `${metaSuffix}. ` : ''}Pesan tiket resmi & QR Pass instan di TERRA.`,
          160
        ) || 'Dapatkan tiket event resmi & QR Pass instan di TERRA.'

      const attendanceMode =
        event.location_type === 'online'
          ? 'https://schema.org/OnlineEventAttendanceMode'
          : event.location_type === 'hybrid'
            ? 'https://schema.org/MixedEventAttendanceMode'
            : 'https://schema.org/OfflineEventAttendanceMode'

      const offlineLocation = {
        '@type': 'Place',
        name: event.location_name || 'Lokasi Event',
        address: {
          '@type': 'PostalAddress',
          streetAddress: event.address || event.location_name || 'Indonesia',
          addressCountry: 'ID'
        }
      }
      const virtualLocation = {
        '@type': 'VirtualLocation',
        url: event.online_url || canonicalUrl
      }

      const locationSchema =
        event.location_type === 'online'
          ? virtualLocation
          : event.location_type === 'hybrid'
            ? [offlineLocation, virtualLocation]
            : offlineLocation

      const ticketTypes = Array.isArray(event.ticket_types) ? event.ticket_types : []
      const offers =
        ticketTypes.length > 0
          ? ticketTypes.map((t: any) => ({
              '@type': 'Offer',
              name: t.name || 'Tiket Event',
              price: Number(t.price || 0),
              priceCurrency: 'IDR',
              availability:
                Number(t.quantity || 0) - Number(t.sold_quantity || 0) > 0
                  ? 'https://schema.org/InStock'
                  : 'https://schema.org/SoldOut',
              url: canonicalUrl
            }))
          : [
              {
                '@type': 'Offer',
                name: 'Tiket Masuk',
                price: 0,
                priceCurrency: 'IDR',
                availability: 'https://schema.org/InStock',
                url: canonicalUrl
              }
            ]

      const orgName = event.organization?.name || event.organization_name || 'TERRA Verified Organizer'
      const orgSlug = event.organization?.slug || event.organization_slug

      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: event.title,
        description,
        url: canonicalUrl,
        image: [imageUrl],
        startDate: event.start_at || event.start_date,
        endDate: event.end_at || event.end_date || event.start_at || event.start_date,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: attendanceMode,
        location: locationSchema,
        organizer: {
          '@type': 'Organization',
          name: orgName,
          ...(orgSlug ? { url: `${CANONICAL_SITE_URL}/organizers/${encodeURIComponent(String(orgSlug))}` } : {})
        },
        offers
      }

      const html = renderShareHtml({
        title: `${event.title} — Tiket & Jadwal Resmi | TERRA`,
        description,
        canonicalUrl,
        imageUrl,
        imageAlt: event.title,
        heading: event.title,
        ctaLabel: 'Beli Tiket & Lihat Detail Event di TERRA',
        jsonLd
      })

      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600')
      return res.status(200).send(html)
    } catch {
      const html = renderShareHtml({
        title: 'TERRA — Platform Tiket Event & Ekosistem Manajemen Kepanitiaan',
        description:
          'Temukan konser, festival kampus, seminar, dan workshop resmi dengan e-ticket QR instan di terra.concern.web.id.',
        canonicalUrl: `${CANONICAL_SITE_URL}/events`,
        imageUrl: DEFAULT_OG_IMAGE,
        imageAlt: 'TERRA Event Ecosystem',
        heading: 'Jelajahi Event di TERRA',
        ctaLabel: 'Lihat Semua Event di TERRA'
      })
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'public, max-age=60')
      return res.status(404).send(html)
    }
  })
)

router.get(
  '/seo/share/organizers/:slug',
  asyncHandler(async (req, res) => {
    try {
      const org = await db.getPublicOrganizerBySlug(req.params.slug)
      const slug = org.slug || req.params.slug
      const canonicalUrl = `${CANONICAL_SITE_URL}/organizers/${encodeURIComponent(String(slug))}`
      const imageUrl = resolvePublicImageUrl(org.logo_url || org.cover_url)
      const description =
        cleanPlainText(
          org.description || `Profil penyelenggara event terverifikasi ${org.name} dan daftar acara resmi di TERRA.`,
          160
        ) || `Profil penyelenggara event terverifikasi ${org.name} di TERRA.`

      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: org.name,
        description,
        url: canonicalUrl,
        logo: imageUrl
      }

      const html = renderShareHtml({
        title: `${org.name} — Event Organizer Terverifikasi | TERRA`,
        description,
        canonicalUrl,
        imageUrl,
        imageAlt: org.name,
        heading: org.name,
        ctaLabel: `Lihat Event oleh ${org.name} di TERRA`,
        jsonLd
      })

      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600')
      return res.status(200).send(html)
    } catch {
      const html = renderShareHtml({
        title: 'Organizer TERRA — Ekosistem Tiket & Manajemen Kepanitiaan',
        description: 'Jelajahi penyelenggara event kampus, konser, dan seminar terverifikasi di TERRA.',
        canonicalUrl: `${CANONICAL_SITE_URL}/events`,
        imageUrl: DEFAULT_OG_IMAGE,
        imageAlt: 'TERRA Verified Organizer',
        heading: 'Penyelenggara Event TERRA',
        ctaLabel: 'Jelajahi Event di TERRA'
      })
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'public, max-age=60')
      return res.status(404).send(html)
    }
  })
)

export default router
