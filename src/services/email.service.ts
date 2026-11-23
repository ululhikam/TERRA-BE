import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import { env } from '../config/env.js'
import { store } from '../repositories/store.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../utils/response.js'
import {
  buildTicketQrPayload,
  createEmailPreviewToken,
  createQrDownloadToken,
  fetchEventLogoBadgeBuffer,
  generateBrandedQrBuffer,
  resolveEventBranding
} from '../utils/qrcode.js'
import { generateTicketsQrPdfBuffer } from './pdf.service.js'

const isResendConfigured = Boolean(
  env.resendApiKey &&
    !env.resendApiKey.includes('your-') &&
    !env.resendApiKey.includes('re_xxx')
)

const isSmtpConfigured = Boolean(env.smtpHost && env.smtpUser && env.smtpPass)

const resend = isResendConfigured ? new Resend(env.resendApiKey) : null

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function getEmailConfigStatus() {
  return {
    configured: isResendConfigured || isSmtpConfigured,
    provider: isResendConfigured ? 'resend' : isSmtpConfigured ? 'smtp' : 'local-outbox',
    from: isResendConfigured ? env.resendFromEmail : env.smtpFrom
  }
}

export function mapResendAttachments(attachments = []) {
  return (attachments || []).map((att) => ({
    filename: att.filename,
    content: att.content,
    ...(att.contentType ? { contentType: att.contentType } : {}),
    ...(att.contentId || att.cid ? { contentId: att.contentId || att.cid } : {})
  }))
}

function formatEmailEventDate(value) {
  if (!value || value === '-') return 'Akan Diumumkan'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  try {
    return (
      new Intl.DateTimeFormat('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
      }).format(d) + ' WIB'
    )
  } catch {
    return String(value)
  }
}

export async function sendEmail({ to, subject, html, attachments = [] }) {
  if (resend && isResendConfigured) {
    try {
      const payload: Record<string, any> = {
        from: env.resendFromEmail,
        to: Array.isArray(to) ? to : [to],
        subject,
        html
      }
      if (attachments.length) {
        payload.attachments = mapResendAttachments(attachments)
      }
      const { data, error } = await resend.emails.send(payload as any)

      if (error) {
        return {
          sent: false,
          skipped: false,
          provider: 'resend',
          reason: error.message || 'Gagal mengirim email via Resend.'
        }
      }

      return {
        sent: true,
        provider: 'resend',
        id: data?.id || null
      }
    } catch (err) {
      return {
        sent: false,
        skipped: false,
        provider: 'resend',
        reason: err?.message || 'Terjadi kesalahan saat memanggil Resend API.'
      }
    }
  }

  if (isSmtpConfigured) {
    try {
      const transporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        auth: { user: env.smtpUser, pass: env.smtpPass }
      })

      const info = await transporter.sendMail({
        from: env.smtpFrom,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html,
        attachments
      })

      return {
        sent: true,
        provider: 'smtp',
        id: info?.messageId || null
      }
    } catch (err) {
      return {
        sent: false,
        skipped: false,
        provider: 'smtp',
        reason: err?.message || 'Gagal mengirim email via SMTP.'
      }
    }
  }

  return {
    sent: false,
    skipped: true,
    provider: 'local-outbox',
    reason: 'RESEND_API_KEY / SMTP belum dikonfigurasi di .env backend.'
  }
}

export async function sendTeamInviteEmail({
  to,
  inviteeName,
  inviterName,
  eventTitle,
  role,
  department,
  permissions = [],
  inviteUrl
}) {
  const permsHtml = (permissions || [])
    .map(
      (p) =>
        `<span style="display:inline-block;margin:3px 4px 3px 0;padding:4px 10px;border:1px solid #000;border-radius:999px;background:#72a5e4;color:#000;font-size:11px;font-weight:700;">${escapeHtml(p)}</span>`
    )
    .join('')

  const html = `
  <div style="font-family:Inter,Arial,sans-serif;background:#fafaf9;padding:32px 16px;color:#111;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:2px solid #000;border-radius:20px;overflow:hidden;box-shadow:5px 5px 0 #000;">
      <div style="background:#72a5e4;padding:20px 24px;border-bottom:2px solid #000;">
        <div style="font-size:20px;font-weight:900;letter-spacing:-0.02em;">TERRA</div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">Undangan Kepanitiaan Event</div>
      </div>
      <div style="padding:24px;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 12px;">Halo <strong>${escapeHtml(inviteeName || to)}</strong>,</p>
        <p style="margin:0 0 16px;"><strong>${escapeHtml(inviterName || 'Organizer')}</strong> mengundang Anda untuk bergabung sebagai tim pengelola event:</p>
        <div style="background:#fafaf9;border:1px solid #000;border-radius:14px;padding:16px;margin-bottom:16px;">
          <div style="font-size:16px;font-weight:800;margin-bottom:6px;">${escapeHtml(eventTitle)}</div>
          <div style="font-size:12px;color:#334155;">Peran: <strong>${escapeHtml(role)}</strong> • Divisi: <strong>${escapeHtml(department)}</strong></div>
          <div style="margin-top:10px;">
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#64748b;margin-bottom:6px;">Hak Akses yang Diberikan Organizer:</div>
            ${permsHtml || '<span style="font-size:12px;">View Event</span>'}
          </div>
        </div>
        <div style="text-align:center;margin:24px 0;">
          <a href="${inviteUrl}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 28px;border-radius:999px;">
            Terima Undangan &amp; Masuk Workspace &rarr;
          </a>
        </div>
        <p style="font-size:11px;color:#64748b;margin:0;word-break:break-all;">Atau buka tautan ini di browser: ${escapeHtml(inviteUrl)}</p>
      </div>
    </div>
  </div>`

  return sendEmail({
    to,
    subject: `Undangan Tim Event: ${eventTitle} (${role}) — TERRA`,
    html
  })
}

export function buildTicketQrEmailHtml({
  customerName,
  eventTitle,
  eventDate = '',
  location = '',
  event = null,
  eventLogoSrc = '',
  orderNumber,
  tickets,
  qrImages,
  orderPdfUrl,
  useCidImages
}: any) {
  const branding = resolveEventBranding(
    event || {
      title: eventTitle || tickets[0]?.event_title || 'Event TERRA',
      organization_name: tickets[0]?.organization_name
    }
  )
  const displayTitle = eventTitle || branding.title || tickets[0]?.event_title || 'Event TERRA'
  const formattedDate = formatEmailEventDate(eventDate || event?.start_at || event?.start_date)
  const displayLocation = location || event?.location_name || event?.venue_name || 'Venue Event TERRA'

  const cardsHtml = tickets
    .map((ticket, idx) => {
      const qrInfo = qrImages[idx] || {}
      const imgSrc = useCidImages ? `cid:${qrInfo.cid}` : qrInfo.dataUrl
      const ticketToken = createQrDownloadToken(ticket.id)
      const ticketPdfUrl = `${env.appBaseUrl}/api/v1/tickets/${encodeURIComponent(ticket.id)}/qr-pdf?token=${ticketToken}`
      const ticketImgUrl =
        qrInfo.qrImageUrl ||
        `${env.appBaseUrl}/api/v1/tickets/${encodeURIComponent(ticket.id)}/qr-image?token=${ticketToken}`

      return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 18px 0; border: 2px solid #000000; border-radius: 16px; background: #ffffff; border-collapse: separate; overflow: hidden;">
          <tr>
            <td style="padding: 12px 18px; background: #fafaf9; border-bottom: 1.5px dashed #94a3b8;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="vertical-align: middle;">
                    <span style="display: inline-block; padding: 3px 10px; border: 1.5px solid #000000; border-radius: 9999px; background: #e0edff; font-size: 11px; font-weight: 800; color: #000000; text-transform: uppercase;">
                      ${escapeHtml(ticket.ticket_type || 'Tiket Event')}
                    </span>
                  </td>
                  <td align="right" style="vertical-align: middle; font-size: 11px; font-weight: 700; color: #475569;">
                    Tiket ${idx + 1} / ${tickets.length}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 22px 20px; text-align: center;">
              <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 4px;">
                NAMA PEMEGANG TIKET
              </div>
              <div style="font-size: 17px; font-weight: 800; color: #000000; margin-bottom: 16px;">
                ${escapeHtml(ticket.participant_name || customerName || 'Peserta')}
              </div>

              <div style="display: inline-block; padding: 12px; border: 2px solid #000000; border-radius: 16px; background: #f8fafc; margin-bottom: 14px;">
                <img
                  src="${imgSrc}"
                  alt="QR Code ${escapeHtml(ticket.ticket_code)}"
                  width="220"
                  height="220"
                  style="display: block; border-radius: 10px; background: #ffffff;"
                />
              </div>

              <div style="margin-bottom: 16px;">
                <span style="display: inline-block; padding: 6px 16px; border: 1.5px solid #000000; border-radius: 9999px; background: #ffffff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; font-weight: 800; color: #000000; letter-spacing: 0.05em;">
                  ${escapeHtml(ticket.ticket_code)}
                </span>
              </div>

              <div style="margin-bottom: 10px;">
                <a
                  href="${ticketPdfUrl}"
                  style="display: inline-block; padding: 10px 20px; border: 1.5px solid #000000; border-radius: 9999px; background: #72a5e4; color: #000000; font-size: 12px; font-weight: 800; text-decoration: none;"
                >
                  Download PDF E-Ticket
                </a>
              </div>
              <div>
                <a
                  href="${ticketImgUrl}"
                  style="font-size: 11px; font-weight: 700; color: #0f172a; text-decoration: underline;"
                >
                  Buka Gambar QR (PNG)
                </a>
              </div>
            </td>
          </tr>
        </table>
      `
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>E-Ticket QR Code - ${escapeHtml(orderNumber)}</title>
</head>
<body style="margin: 0; padding: 24px 14px; background: #fafaf9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; margin: 0 auto;">
    <tr>
      <td>
        <div style="background: #ffffff; border: 2px solid #000000; border-radius: 20px; overflow: hidden; box-shadow: 5px 5px 0 #000000;">
          <!-- Branded Event Header -->
          <div style="background: ${escapeHtml(branding.themeColor)}; color: ${escapeHtml(branding.textColor)}; padding: 22px 24px; border-bottom: 2px solid #000000;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="56" style="vertical-align: top; padding-right: 12px;">
                  ${
                    eventLogoSrc
                      ? `<img src="${eventLogoSrc}" alt="${escapeHtml(branding.orgName)}" width="48" height="48" style="display: block; border-radius: 12px; border: 1.5px solid #000000; background: #ffffff;" />`
                      : `<div style="width: 48px; height: 48px; border-radius: 12px; border: 1.5px solid #000000; background: #ffffff; color: #000000; font-size: 16px; font-weight: 900; line-height: 48px; text-align: center;">${escapeHtml(branding.initials)}</div>`
                  }
                </td>
                <td style="vertical-align: top;">
                  <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.9; margin-bottom: 4px;">
                    ${escapeHtml(branding.orgName)} • OFFICIAL E-TICKET
                  </div>
                  <h1 style="margin: 0; font-size: 20px; line-height: 1.25; font-weight: 800; color: ${escapeHtml(branding.textColor)};">
                    ${escapeHtml(displayTitle)}
                  </h1>
                </td>
              </tr>
            </table>
          </div>

          <!-- Body Content -->
          <div style="padding: 22px 24px;">
            <!-- Event Info Box -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #fafaf9; border: 1.5px solid #000000; border-radius: 14px; margin-bottom: 18px;">
              <tr>
                <td style="padding: 14px 16px; font-size: 12px; line-height: 1.6;">
                  <div style="margin-bottom: 6px;">
                    <span style="font-weight: 800; color: #475569;">WAKTU:</span>
                    <span style="font-weight: 700; color: #000000;"> ${escapeHtml(formattedDate)}</span>
                  </div>
                  <div style="margin-bottom: 6px;">
                    <span style="font-weight: 800; color: #475569;">LOKASI:</span>
                    <span style="font-weight: 700; color: #000000;"> ${escapeHtml(displayLocation)}</span>
                  </div>
                  <div>
                    <span style="font-weight: 800; color: #475569;">ORDER REF:</span>
                    <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 800; color: #000000;"> ${escapeHtml(orderNumber)}</span>
                  </div>
                </td>
              </tr>
            </table>

            <p style="margin: 0 0 8px; font-size: 13px; color: #334155;">
              Halo <strong>${escapeHtml(customerName || 'Peserta')}</strong>, berikut adalah E-Ticket QR resmi Anda. Tunjukkan QR Code di bawah saat check-in di gate acara:
            </p>

            ${cardsHtml}

            <div style="margin-top: 22px; padding-top: 18px; border-top: 1.5px dashed #cbd5e1; text-align: center;">
              ${
                orderPdfUrl
                  ? `<a
                href="${orderPdfUrl}"
                style="display: inline-block; padding: 12px 26px; border: 1.5px solid #000000; border-radius: 9999px; background: #000000; color: #ffffff; font-size: 13px; font-weight: 800; text-decoration: none;"
              >
                Download Semua E-Ticket (PDF)
              </a>`
                  : ''
              }
              <p style="margin: 12px 0 0; font-size: 11px; color: #64748b;">
                File PDF E-Ticket juga terlampir langsung pada email ini.
              </p>
            </div>
          </div>

          <!-- Dark Footer -->
          <div style="background: #0f172a; color: #e2e8f0; padding: 14px 24px; font-size: 11px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="left">Simpan e-ticket ini &bull; Validasi QR atomik saat gate masuk</td>
                <td align="right" style="font-weight: 900; color: #72a5e4; letter-spacing: 0.06em;">TERRA</td>
              </tr>
            </table>
          </div>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Send ticket purchase email with embedded QR Code(s), PDF QR attachment,
 * direct signed PDF QR download link, and local outbox preview support.
 */
export async function sendTicketOrderEmail({
  to,
  customerName,
  eventTitle,
  eventDate,
  location,
  event = null,
  orderId,
  orderNumber,
  tickets = []
}) {
  if (!to || !tickets.length) {
    return { sent: false, skipped: true, reason: 'Recipient email atau tiket kosong.' }
  }

  const resolvedEvent = event || {
    title: eventTitle || tickets[0]?.event_title || 'Event TERRA',
    start_at: eventDate,
    location_name: location,
    organization_name: tickets[0]?.organization_name
  }
  const branding = resolveEventBranding(resolvedEvent)

  const orderToken = orderId ? createQrDownloadToken(orderId) : null
  const orderPdfUrl = orderId
    ? `${env.appBaseUrl}/api/v1/orders/${encodeURIComponent(orderId)}/qr-pdf?token=${orderToken}`
    : ''

  const [eventLogoBuffer, qrImages] = await Promise.all([
    fetchEventLogoBadgeBuffer(branding, { size: 96, borderWidth: 3 }),
    Promise.all(
      tickets.map(async (ticket, idx) => {
        const payload = ticket.qr_payload || buildTicketQrPayload(ticket.ticket_code, ticket.event_id, '')
        const buffer = await generateBrandedQrBuffer(payload, {
          width: 360,
          margin: 2,
          branding
        })
        const dataUrl = buffer.length ? `data:image/png;base64,${buffer.toString('base64')}` : ''
        const safeId = String(ticket.id || idx).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
        const ticketToken = createQrDownloadToken(ticket.id)
        const qrImageUrl = `${env.appBaseUrl}/api/v1/tickets/${encodeURIComponent(ticket.id)}/qr-image?token=${ticketToken}`
        return {
          ticketId: ticket.id,
          ticketCode: ticket.ticket_code,
          cid: `qr-${idx + 1}-${safeId}`,
          qrImageUrl,
          buffer,
          dataUrl
        }
      })
    )
  ])

  const eventLogoDataUrl = eventLogoBuffer?.length
    ? `data:image/png;base64,${eventLogoBuffer.toString('base64')}`
    : ''
  const eventLogoCid = 'event-logo-badge'

  const pdfBuffer = await generateTicketsQrPdfBuffer({
    tickets,
    order: { id: orderId, order_number: orderNumber },
    event: resolvedEvent
  })

  const previewHtml = buildTicketQrEmailHtml({
    customerName,
    eventTitle: eventTitle || branding.title,
    eventDate,
    location,
    event: resolvedEvent,
    eventLogoSrc: eventLogoDataUrl,
    orderNumber,
    tickets,
    qrImages,
    orderPdfUrl,
    useCidImages: false
  })

  const emailId = `eml-${Date.now()}`
  const previewToken = createEmailPreviewToken(emailId)
  const subject = `[TERRA] E-Ticket QR: ${eventTitle || branding.title} (${orderNumber})`
  const previewUrl = `${env.appBaseUrl}/api/v1/emails/${emailId}/preview?token=${previewToken}`
  const pdfFilename = `tiket-qr-${orderNumber}.pdf`
  const canSendCidInline = isResendConfigured || isSmtpConfigured
  const deliveryHtml = canSendCidInline
    ? buildTicketQrEmailHtml({
        customerName,
        eventTitle: eventTitle || branding.title,
        eventDate,
        location,
        event: resolvedEvent,
        eventLogoSrc: eventLogoBuffer?.length ? `cid:${eventLogoCid}` : '',
        orderNumber,
        tickets,
        qrImages,
        orderPdfUrl,
        useCidImages: true
      })
    : previewHtml

  const delivery = await sendEmail({
    to,
    subject,
    html: deliveryHtml,
    attachments: [
      ...(canSendCidInline && eventLogoBuffer?.length
        ? [
            {
              filename: 'event-logo.png',
              content: eventLogoBuffer,
              contentType: 'image/png',
              cid: eventLogoCid,
              contentId: eventLogoCid
            }
          ]
        : []),
      ...(canSendCidInline
        ? qrImages.map((qr) => ({
            filename: `qr-${qr.ticketCode}.png`,
            content: qr.buffer,
            contentType: 'image/png',
            cid: qr.cid,
            contentId: qr.cid
          }))
        : []),
      {
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  })

  const mode = delivery.sent ? delivery.provider : 'local-outbox'
  const outboxEntry = {
    id: emailId,
    order_id: orderId || null,
    order_number: orderNumber,
    to,
    subject,
    html: previewHtml,
    pdf_filename: pdfFilename,
    pdf_download_url: orderPdfUrl,
    preview_url: previewUrl,
    mode,
    delivered_by_provider: Boolean(delivery.sent),
    sent_at: new Date().toISOString()
  }

  store.emailOutbox = [outboxEntry, ...(store.emailOutbox || [])].slice(0, 100)

  logger.info('Ticket QR email processed', {
    emailId,
    orderId,
    recipient: to,
    mode,
    previewUrl
  })

  return {
    sent: Boolean(delivery.sent || mode === 'local-outbox'),
    delivered_by_provider: Boolean(delivery.sent),
    id: emailId,
    provider_id: delivery.id || null,
    mode,
    recipient: to,
    subject,
    preview_url: previewUrl,
    pdf_download_url: orderPdfUrl,
    pdf_filename: pdfFilename
  }
}

export function getEmailPreviewById(emailId) {
  const email = (store.emailOutbox || []).find((e) => e.id === emailId)
  if (!email) {
    throw new AppError('Email pratinjau tidak ditemukan.', 404, 'EMAIL_NOT_FOUND')
  }
  return email
}

export function getEmailPreviewByOrderId(orderId) {
  const email = (store.emailOutbox || []).find((e) => e.order_id === orderId)
  if (!email) {
    throw new AppError('Email pratinjau untuk order ini belum tersedia.', 404, 'EMAIL_NOT_FOUND')
  }
  return email
}

export async function sendOtpEmail({
  to,
  fullName,
  otpCode,
  purpose = 'Verifikasi Email Akun TERRA'
}) {
  const html = `
  <div style="font-family:Inter,Arial,sans-serif;background:#fafaf9;padding:32px 16px;color:#111;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:2px solid #000;border-radius:20px;overflow:hidden;box-shadow:5px 5px 0 #000;">
      <div style="background:#72a5e4;padding:20px 24px;border-bottom:2px solid #000;">
        <div style="font-size:20px;font-weight:900;letter-spacing:-0.02em;">TERRA</div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">${escapeHtml(purpose)}</div>
      </div>
      <div style="padding:24px;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 12px;">Halo <strong>${escapeHtml(fullName || to)}</strong>,</p>
        <p style="margin:0 0 16px;">Gunakan kode OTP berikut untuk memverifikasi alamat email akun TERRA Anda:</p>
        <div style="text-align:center;margin:20px 0;padding:18px;border:2px dashed #000;border-radius:16px;background:#fafaf9;">
          <span style="font-family:monospace;font-size:32px;font-weight:900;letter-spacing:8px;color:#000;">${escapeHtml(otpCode)}</span>
        </div>
        <p style="font-size:12px;color:#475569;margin:0;">Kode ini berlaku selama <strong>10 menit</strong>. Demi keamanan akun Anda, jangan bagikan kode OTP ini kepada siapa pun.</p>
      </div>
    </div>
  </div>`

  return sendEmail({
    to,
    subject: `Kode OTP Verifikasi TERRA: ${otpCode}`,
    html
  })
}
