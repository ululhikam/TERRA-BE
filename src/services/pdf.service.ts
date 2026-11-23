import PDFDocument from 'pdfkit'
import {
  buildTicketQrPayload,
  fetchEventLogoBadgeBuffer,
  generateBrandedQrBuffer,
  resolveEventBranding
} from '../utils/qrcode.js'

function formatTicketDateTime(value) {
  if (!value || value === '-') return 'Akan Diumumkan'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  try {
    return (
      new Intl.DateTimeFormat('id-ID', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
      }).format(date) + ' WIB'
    )
  } catch {
    return String(value)
  }
}

/**
 * Generate a Neo-Brutalist boarding-pass PDF containing branded event-logo QR Code(s).
 */
export async function generateTicketsQrPdfBuffer({ tickets, order = null, event = null }: any): Promise<Buffer> {
  const list = Array.isArray(tickets) ? tickets : [tickets].filter(Boolean)
  if (!list.length) {
    throw new Error('Tidak ada tiket untuk dicetak ke PDF QR.')
  }

  const branding = resolveEventBranding(
    event || {
      title: list[0]?.event_title || 'Event TERRA',
      organization_name: list[0]?.organization_name
    }
  )

  const [eventLogoBuf, qrBuffers] = await Promise.all([
    fetchEventLogoBadgeBuffer(branding, { size: 96, borderWidth: 3 }),
    Promise.all(
      list.map((ticket) => {
        const payload =
          ticket.qr_payload || buildTicketQrPayload(ticket.ticket_code, ticket.event_id, '')
        return generateBrandedQrBuffer(payload, {
          width: 480,
          margin: 2,
          branding
        })
      })
    )
  ])

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A5',
      margin: 0,
      info: {
        Title: `TERRA E-Ticket QR - ${order?.order_number || list[0].ticket_code}`,
        Author: 'TERRA Ticketing Platform'
      }
    })

    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageW = doc.page.width
    const pageH = doc.page.height
    const cardX = 24
    const cardY = 22
    const cardW = pageW - cardX * 2 - 4
    const cardH = pageH - cardY * 2 - 4
    const radius = 16
    const bannerH = 108
    const tearY = cardY + 236
    const footerH = 38

    list.forEach((ticket, index) => {
      if (index > 0) doc.addPage()

      // Warm paper canvas
      doc.rect(0, 0, pageW, pageH).fill('#fafaf9')

      // Neo-brutalist offset shadow
      doc.roundedRect(cardX + 4, cardY + 4, cardW, cardH, radius).fill('#000000')

      // Card surface
      doc
        .roundedRect(cardX, cardY, cardW, cardH, radius)
        .lineWidth(2)
        .fillAndStroke('#ffffff', '#000000')

      // Clipped branded event header banner
      doc.save()
      doc.roundedRect(cardX, cardY, cardW, cardH, radius).clip()
      doc.rect(cardX, cardY, cardW, bannerH).fill(branding.themeColor)

      // Subtle decorative accent circles inside banner
      doc
        .circle(cardX + cardW - 20, cardY + 18, 46)
        .fillOpacity(0.12)
        .fill(branding.textColor)
      doc
        .circle(cardX + cardW - 64, cardY + bannerH - 6, 30)
        .fillOpacity(0.08)
        .fill(branding.textColor)
      doc.fillOpacity(1)

      // Bottom border line of header banner
      doc
        .moveTo(cardX, cardY + bannerH)
        .lineTo(cardX + cardW, cardY + bannerH)
        .lineWidth(1.8)
        .stroke('#000000')

      // Dark bottom footer strip inside clipped card
      const footerY = cardY + cardH - footerH
      doc.rect(cardX, footerY, cardW, footerH).fill('#0f172a')
      doc.restore()

      // Re-stroke card outer frame sharply on top
      doc
        .roundedRect(cardX, cardY, cardW, cardH, radius)
        .lineWidth(2)
        .stroke('#000000')

      // Event Logo badge (top-left of header)
      const logoSize = 46
      doc.image(eventLogoBuf, cardX + 16, cardY + 16, { width: logoSize, height: logoSize })

      // Official E-Ticket badge pill (top-right of header)
      const pillW = 92
      const pillH = 19
      const pillX = cardX + cardW - pillW - 14
      const pillY = cardY + 16
      doc
        .roundedRect(pillX, pillY, pillW, pillH, 9.5)
        .lineWidth(1.2)
        .fillAndStroke('#ffffff', '#000000')
      doc
        .font('Helvetica-Bold')
        .fontSize(7.2)
        .fillColor('#000000')
        .text('OFFICIAL E-TICKET', pillX, pillY + 5.5, { width: pillW, align: 'center' })

      // Organizer name & Event title in header
      const textX = cardX + 74
      doc
        .font('Helvetica-Bold')
        .fontSize(7.8)
        .fillColor(branding.textColor)
        .text(branding.orgName.toUpperCase(), textX, cardY + 18, {
          width: pillX - textX - 8,
          ellipsis: true,
          lineBreak: false
        })

      doc
        .font('Helvetica-Bold')
        .fontSize(12.5)
        .fillColor(branding.textColor)
        .text(ticket.event_title || branding.title, textX, cardY + 34, {
          width: cardW - 90,
          height: 56,
          ellipsis: true
        })

      // Structured 2-column Ticket Metadata Grid
      const colLeftX = cardX + 18
      const colRightX = cardX + cardW / 2 + 8
      const colW = cardW / 2 - 26

      const row1Y = cardY + bannerH + 14
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor('#64748b')
        .text('PESERTA', colLeftX, row1Y)
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#0f172a')
        .text(ticket.participant_name || 'Peserta TERRA', colLeftX, row1Y + 10, {
          width: colW,
          ellipsis: true,
          lineBreak: false
        })

      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor('#64748b')
        .text('KATEGORI TIKET', colRightX, row1Y)
      doc
        .roundedRect(colRightX, row1Y + 9, colW, 18, 5)
        .lineWidth(1)
        .fillAndStroke('#e0edff', '#0f172a')
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor('#0f172a')
        .text(ticket.ticket_type || 'Regular', colRightX + 6, row1Y + 14, {
          width: colW - 12,
          ellipsis: true,
          lineBreak: false
        })

      const row2Y = row1Y + 38
      const dateStr = formatTicketDateTime(ticket.event_date || event?.start_at || event?.start_date)
      const locStr = ticket.location || event?.location_name || event?.venue_name || 'Venue Acara'

      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor('#64748b')
        .text('TANGGAL & WAKTU', colLeftX, row2Y)
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor('#0f172a')
        .text(dateStr, colLeftX, row2Y + 10, { width: colW, height: 22, ellipsis: true })

      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor('#64748b')
        .text('LOKASI / VENUE', colRightX, row2Y)
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor('#0f172a')
        .text(locStr, colRightX, row2Y + 10, { width: colW, height: 22, ellipsis: true })

      const row3Y = row2Y + 38
      const statusText = String(ticket.status || 'Active').toUpperCase()
      const statusBg = statusText === 'ACTIVE' ? '#d1fae5' : statusText === 'PENDING' ? '#fef3c7' : '#e2e8f0'

      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor('#64748b')
        .text('ORDER REFERENCE', colLeftX, row3Y)
      doc
        .font('Courier-Bold')
        .fontSize(9)
        .fillColor('#0f172a')
        .text(ticket.order_number || order?.order_number || '-', colLeftX, row3Y + 10, {
          width: colW,
          ellipsis: true,
          lineBreak: false
        })

      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor('#64748b')
        .text('STATUS TIKET', colRightX, row3Y)
      doc
        .roundedRect(colRightX, row3Y + 9, 84, 16, 8)
        .lineWidth(1)
        .fillAndStroke(statusBg, '#000000')
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor('#000000')
        .text(statusText, colRightX, row3Y + 13.5, { width: 84, align: 'center' })

      // Perforated boarding-pass tear divider with side notches
      doc.save()
      doc
        .moveTo(cardX + 12, tearY)
        .lineTo(cardX + cardW - 12, tearY)
        .dash(5, { space: 4 })
        .lineWidth(1.2)
        .strokeColor('#94a3b8')
        .stroke()
      doc.restore()

      // Left notch
      doc.save()
      doc.rect(cardX - 12, tearY - 11, 24, 22).clip()
      doc.circle(cardX, tearY, 9).lineWidth(2).fillAndStroke('#fafaf9', '#000000')
      doc.restore()
      doc.rect(cardX - 10, tearY - 10, 10, 20).fill('#fafaf9')

      // Right notch
      doc.save()
      doc.rect(cardX + cardW - 12, tearY - 11, 24, 22).clip()
      doc.circle(cardX + cardW, tearY, 9).lineWidth(2).fillAndStroke('#fafaf9', '#000000')
      doc.restore()
      doc.rect(cardX + cardW + 1, tearY - 10, 10, 20).fill('#fafaf9')

      // Hero QR Container Panel
      const panelX = cardX + 34
      const panelY = tearY + 14
      const panelW = cardW - 68
      const panelH = 228
      doc
        .roundedRect(panelX, panelY, panelW, panelH, 14)
        .lineWidth(1.5)
        .fillAndStroke('#f8fafc', '#cbd5e1')

      // Corner bracket accents in event theme color
      const cornerLen = 14
      doc.save().lineWidth(3).strokeColor(branding.themeColor)
      // Top-left
      doc.moveTo(panelX + 10, panelY + 10 + cornerLen).lineTo(panelX + 10, panelY + 10).lineTo(panelX + 10 + cornerLen, panelY + 10).stroke()
      // Top-right
      doc.moveTo(panelX + panelW - 10 - cornerLen, panelY + 10).lineTo(panelX + panelW - 10, panelY + 10).lineTo(panelX + panelW - 10, panelY + 10 + cornerLen).stroke()
      // Bottom-left
      doc.moveTo(panelX + 10, panelY + panelH - 10 - cornerLen).lineTo(panelX + 10, panelY + panelH - 10).lineTo(panelX + 10 + cornerLen, panelY + panelH - 10).stroke()
      // Bottom-right
      doc.moveTo(panelX + panelW - 10 - cornerLen, panelY + panelH - 10).lineTo(panelX + panelW - 10, panelY + panelH - 10).lineTo(panelX + panelW - 10, panelY + panelH - 10 - cornerLen).stroke()
      doc.restore()

      // Branded Center-Logo QR Image
      const qrSize = 166
      const qrX = cardX + (cardW - qrSize) / 2
      const qrY = panelY + 14
      doc
        .roundedRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12, 10)
        .lineWidth(1.2)
        .fillAndStroke('#ffffff', '#000000')
      doc.image(qrBuffers[index], qrX, qrY, { width: qrSize, height: qrSize })

      // Ticket code badge below QR
      const codePillW = 196
      const codePillX = cardX + (cardW - codePillW) / 2
      const codePillY = qrY + qrSize + 12
      doc
        .roundedRect(codePillX, codePillY, codePillW, 24, 12)
        .lineWidth(1.5)
        .fillAndStroke('#ffffff', '#000000')
      doc
        .font('Courier-Bold')
        .fontSize(11)
        .fillColor('#000000')
        .text(ticket.ticket_code, codePillX, codePillY + 6.5, { width: codePillW, align: 'center' })

      if (list.length > 1) {
        doc
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor('#475569')
          .text(`Tiket ${index + 1} dari ${list.length}`, cardX, panelY + panelH + 6, {
            width: cardW,
            align: 'center'
          })
      }

      // Dark Footer Bar
      const fY = cardY + cardH - footerH
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#e2e8f0')
        .text('Pindai QR ini saat check-in di gate event', cardX + 16, fY + 14, {
          width: cardW - 110,
          lineBreak: false
        })

      doc
        .roundedRect(cardX + cardW - 76, fY + 9, 60, 20, 10)
        .fill('#72a5e4')
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor('#000000')
        .text('TERRA', cardX + cardW - 76, fY + 15, { width: 60, align: 'center' })
    })

    doc.end()
  })
}
