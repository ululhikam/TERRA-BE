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
  generateTicketQrBuffer,
  generateTicketQrDataUrl
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

export async function sendEmail({ to, subject, html, attachments = [] }) {
  if (resend && isResendConfigured) {
    try {
      const payload = {
        from: env.resendFromEmail,
        to: Array.isArray(to) ? to : [to],
        subject,
        html
      }
      if (attachments.length) {
        payload.attachments = attachments.map((att) => ({
          filename: att.filename,
          content: att.content
        }))
      }
      const { data, error } = await resend.emails.send(payload)

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

function buildTicketQrEmailHtml({
  customerName,
  eventTitle,
  orderNumber,
  tickets,
  qrImages,
  orderPdfUrl,
  useCidImages
}) {
  const cardsHtml = tickets
    .map((ticket, idx) => {
      const imgSrc = useCidImages ? `cid:${qrImages[idx].cid}` : qrImages[idx].dataUrl
      const ticketToken = createQrDownloadToken(ticket.id)
      const ticketPdfUrl = `${env.appBaseUrl}/api/v1/tickets/${encodeURIComponent(ticket.id)}/qr-pdf?token=${ticketToken}`

      return `
        <div style="margin: 18px 0; padding: 20px; border: 2px solid #000000; border-radius: 16px; background: #ffffff; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; margin-bottom: 6px;">
            ${escapeHtml(ticket.ticket_type || 'Tiket Event')}
          </div>
          <div style="font-size: 15px; font-weight: 700; color: #000000; margin-bottom: 14px;">
            ${escapeHtml(ticket.participant_name || customerName || 'Peserta')}
          </div>
          <img
            src="${imgSrc}"
            alt="QR Code ${escapeHtml(ticket.ticket_code)}"
            width="200"
            height="200"
            style="display: block; margin: 0 auto 12px; border: 1px solid #cbd5e1; border-radius: 12px; padding: 8px; background: #ffffff;"
          />
          <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; font-weight: 700; color: #000000; margin-bottom: 12px;">
            ${escapeHtml(ticket.ticket_code)}
          </div>
          <a
            href="${ticketPdfUrl}"
            style="display: inline-block; padding: 9px 18px; border: 1.5px solid #000000; border-radius: 9999px; background: #72a5e4; color: #000000; font-size: 12px; font-weight: 700; text-decoration: none;"
          >
            Download PDF QR Tiket Ini
          </a>
        </div>
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
<body style="margin: 0; padding: 24px; background: #fafaf9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 2px solid #000000; border-radius: 20px; padding: 28px; box-shadow: 5px 5px 0 #000000;">
    <div style="display: inline-block; padding: 4px 12px; border: 1.5px solid #000000; border-radius: 9999px; background: #72a5e4; font-size: 11px; font-weight: 700; color: #000000; margin-bottom: 12px;">
      TERRA E-TICKET QR
    </div>
    <h1 style="margin: 0 0 6px; font-size: 22px; line-height: 1.3; color: #000000;">
      ${escapeHtml(eventTitle || tickets[0]?.event_title || 'Event TERRA')}
    </h1>
    <p style="margin: 0 0 18px; font-size: 13px; color: #475569;">
      Order Ref: <strong>${escapeHtml(orderNumber)}</strong> • Tunjukkan QR Code di bawah saat check-in di gate.
    </p>

    ${cardsHtml}

    <div style="margin-top: 20px; padding-top: 16px; border-top: 1px dashed #cbd5e1; text-align: center;">
      ${
        orderPdfUrl
          ? `<a
        href="${orderPdfUrl}"
        style="display: inline-block; padding: 12px 24px; border-radius: 9999px; background: #000000; color: #ffffff; font-size: 13px; font-weight: 700; text-decoration: none;"
      >
        Download Semua QR (PDF)
      </a>`
          : ''
      }
      <p style="margin: 12px 0 0; font-size: 11px; color: #64748b;">
        File PDF QR juga terlampir langsung pada email ini.
      </p>
    </div>
  </div>
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
  orderId,
  orderNumber,
  tickets = []
}) {
  if (!to || !tickets.length) {
    return { sent: false, skipped: true, reason: 'Recipient email atau tiket kosong.' }
  }

  const orderToken = orderId ? createQrDownloadToken(orderId) : null
  const orderPdfUrl = orderId
    ? `${env.appBaseUrl}/api/v1/orders/${encodeURIComponent(orderId)}/qr-pdf?token=${orderToken}`
    : ''

  const qrImages = await Promise.all(
    tickets.map(async (ticket) => {
      const payload = ticket.qr_payload || buildTicketQrPayload(ticket.ticket_code, ticket.event_id, '')
      const [buffer, dataUrl] = await Promise.all([
        generateTicketQrBuffer(payload, { width: 300, margin: 2 }),
        generateTicketQrDataUrl(payload, { width: 300, margin: 2 })
      ])
      return {
        ticketId: ticket.id,
        ticketCode: ticket.ticket_code,
        cid: `qr-${ticket.id}@terra.id`,
        buffer,
        dataUrl
      }
    })
  )

  const pdfBuffer = await generateTicketsQrPdfBuffer({
    tickets,
    order: { id: orderId, order_number: orderNumber },
    event: { title: eventTitle, start_at: eventDate, location_name: location }
  })

  const previewHtml = buildTicketQrEmailHtml({
    customerName,
    eventTitle,
    orderNumber,
    tickets,
    qrImages,
    orderPdfUrl,
    useCidImages: false
  })

  const emailId = `eml-${Date.now()}`
  const previewToken = createEmailPreviewToken(emailId)
  const subject = `[TERRA] QR Tiket Anda: ${eventTitle} (${orderNumber})`
  const previewUrl = `${env.appBaseUrl}/api/v1/emails/${emailId}/preview?token=${previewToken}`
  const pdfFilename = `tiket-qr-${orderNumber}.pdf`

  const delivery = await sendEmail({
    to,
    subject,
    html: isSmtpConfigured && !isResendConfigured
      ? buildTicketQrEmailHtml({
          customerName,
          eventTitle,
          orderNumber,
          tickets,
          qrImages,
          orderPdfUrl,
          useCidImages: true
        })
      : previewHtml,
    attachments: [
      ...(isSmtpConfigured && !isResendConfigured
        ? qrImages.map((qr) => ({
            filename: `qr-${qr.ticketCode}.png`,
            content: qr.buffer,
            cid: qr.cid
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
