import { Resend } from 'resend'
import { env } from '../config/env.js'

const isResendConfigured = Boolean(
  env.resendApiKey &&
    !env.resendApiKey.includes('your-') &&
    !env.resendApiKey.includes('re_xxx')
)

const resend = isResendConfigured ? new Resend(env.resendApiKey) : null

export function getEmailConfigStatus() {
  return {
    configured: isResendConfigured,
    from: env.resendFromEmail
  }
}

export async function sendEmail({ to, subject, html }) {
  if (!resend || !isResendConfigured) {
    return {
      sent: false,
      skipped: true,
      reason: 'RESEND_API_KEY belum dikonfigurasi di .env backend.'
    }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: env.resendFromEmail,
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    })

    if (error) {
      return {
        sent: false,
        skipped: false,
        reason: error.message || 'Gagal mengirim email via Resend.'
      }
    }

    return {
      sent: true,
      id: data?.id || null
    }
  } catch (err) {
    return {
      sent: false,
      skipped: false,
      reason: err?.message || 'Terjadi kesalahan saat memanggil Resend API.'
    }
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
        `<span style="display:inline-block;margin:3px 4px 3px 0;padding:4px 10px;border:1px solid #000;border-radius:999px;background:#72a5e4;color:#000;font-size:11px;font-weight:700;">${p}</span>`
    )
    .join('')

  const html = `
  <div style="font-family:Inter,Arial,sans-serif;background:#fafaf9;padding:32px 16px;color:#111;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:2px solid #000;border-radius:20px;overflow:hidden;box-shadow:5px 5px 0 #000;">
      <div style="background:#72a5e4;padding:20px 24px;border-bottom:2px solid #000;">
        <div style="font-size:20px;font-weight:900;letter-spacing:-0.02em;">TERRA</div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">Undangan Kepanitiaan Event</div>
      </div>
      <div style="padding:24px;space-y:16px;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 12px;">Halo <strong>${inviteeName || to}</strong>,</p>
        <p style="margin:0 0 16px;"><strong>${inviterName || 'Organizer'}</strong> mengundang Anda untuk bergabung sebagai tim pengelola event:</p>
        <div style="background:#fafaf9;border:1px solid #000;border-radius:14px;padding:16px;margin-bottom:16px;">
          <div style="font-size:16px;font-weight:800;margin-bottom:6px;">${eventTitle}</div>
          <div style="font-size:12px;color:#334155;">Peran: <strong>${role}</strong> • Divisi: <strong>${department}</strong></div>
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
        <p style="font-size:11px;color:#64748b;margin:0;word-break:break-all;">Atau buka tautan ini di browser: ${inviteUrl}</p>
      </div>
    </div>
  </div>`

  return sendEmail({
    to,
    subject: `Undangan Tim Event: ${eventTitle} (${role}) — TERRA`,
    html
  })
}

export async function sendTicketOrderEmail({
  to,
  customerName,
  eventTitle,
  eventDate,
  location,
  orderNumber,
  tickets = []
}) {
  const ticketsHtml = tickets
    .map(
      (t) =>
        `<div style="border:1px dashed #000;border-radius:12px;padding:12px;margin-bottom:8px;background:#fafaf9;">
          <div style="font-weight:800;font-size:13px;">${t.ticket_type || 'Tiket Event'}</div>
          <div style="font-family:monospace;font-size:14px;font-weight:900;color:#000;margin-top:4px;">${t.ticket_code}</div>
        </div>`
    )
    .join('')

  const html = `
  <div style="font-family:Inter,Arial,sans-serif;background:#fafaf9;padding:32px 16px;color:#111;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:2px solid #000;border-radius:20px;overflow:hidden;box-shadow:5px 5px 0 #000;">
      <div style="background:#72a5e4;padding:20px 24px;border-bottom:2px solid #000;">
        <div style="font-size:20px;font-weight:900;">TERRA E-TICKET</div>
        <div style="font-size:11px;font-weight:700;margin-top:4px;">Order #${orderNumber}</div>
      </div>
      <div style="padding:24px;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 12px;">Halo <strong>${customerName}</strong>, pesanan tiket Anda telah terbit!</p>
        <div style="margin-bottom:16px;font-size:13px;">
          <div><strong>Acara:</strong> ${eventTitle}</div>
          <div><strong>Jadwal:</strong> ${eventDate}</div>
          <div><strong>Lokasi:</strong> ${location}</div>
        </div>
        ${ticketsHtml}
        <p style="font-size:12px;color:#475569;margin-top:16px;">Tunjukkan QR Code di halaman <strong>Tiket Saya</strong> saat check-in di lokasi acara.</p>
      </div>
    </div>
  </div>`

  return sendEmail({
    to,
    subject: `E-Ticket Anda: ${eventTitle} (${orderNumber}) — TERRA`,
    html
  })
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
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-top:4px;">${purpose}</div>
      </div>
      <div style="padding:24px;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 12px;">Halo <strong>${fullName || to}</strong>,</p>
        <p style="margin:0 0 16px;">Gunakan kode OTP berikut untuk memverifikasi alamat email akun TERRA Anda:</p>
        <div style="text-align:center;margin:20px 0;padding:18px;border:2px dashed #000;border-radius:16px;background:#fafaf9;">
          <span style="font-family:monospace;font-size:32px;font-weight:900;letter-spacing:8px;color:#000;">${otpCode}</span>
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
