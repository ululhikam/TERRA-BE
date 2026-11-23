import PDFDocument from 'pdfkit'
import { buildTicketQrPayload, generateTicketQrBuffer } from '../utils/qrcode.js'

/**
 * Generate a clean, printable PDF buffer containing the QR Code(s) for purchased tickets.
 */
export async function generateTicketsQrPdfBuffer({ tickets, order = null, event = null }) {
  const list = Array.isArray(tickets) ? tickets : [tickets].filter(Boolean)
  if (!list.length) {
    throw new Error('Tidak ada tiket untuk dicetak ke PDF QR.')
  }

  const qrBuffers = await Promise.all(
    list.map((ticket) => {
      const payload = ticket.qr_payload || buildTicketQrPayload(ticket.ticket_code, ticket.event_id, '')
      return generateTicketQrBuffer(payload, { width: 360, margin: 2 })
    })
  )

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A5',
      margin: 36,
      info: {
        Title: `TERRA QR Ticket - ${order?.order_number || list[0].ticket_code}`,
        Author: 'TERRA Ticketing Platform'
      }
    })

    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    list.forEach((ticket, index) => {
      if (index > 0) doc.addPage()

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
      const centerX = doc.page.margins.left + pageWidth / 2

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#0f172a')
        .text('TERRA E-TICKET QR', { align: 'center' })

      doc.moveDown(0.5)

      doc
        .font('Helvetica-Bold')
        .fontSize(15)
        .fillColor('#000000')
        .text(ticket.event_title || event?.title || 'Event TERRA', { align: 'center' })

      doc.moveDown(0.25)

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#475569')
        .text(`${ticket.ticket_type || 'Ticket'}  •  ${ticket.participant_name || 'Peserta'}`, { align: 'center' })

      doc.moveDown(1)

      const qrSize = 210
      const qrX = centerX - qrSize / 2
      const qrY = doc.y

      doc
        .roundedRect(qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 14)
        .lineWidth(1.5)
        .strokeColor('#000000')
        .fillAndStroke('#ffffff', '#000000')

      doc.image(qrBuffers[index], qrX, qrY, { width: qrSize, height: qrSize })

      doc.y = qrY + qrSize + 24

      doc
        .font('Courier-Bold')
        .fontSize(13)
        .fillColor('#000000')
        .text(ticket.ticket_code, { align: 'center' })

      doc.moveDown(0.4)

      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#64748b')
        .text(`Order Ref: ${ticket.order_number || order?.order_number || '-'}`, { align: 'center' })

      if (ticket.location || event?.location_name) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#64748b')
          .text(ticket.location || event?.location_name, { align: 'center' })
      }

      doc.moveDown(1)
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#94a3b8')
        .text('Tunjukkan QR Code ini kepada panitia saat check-in di gate event.', { align: 'center' })
    })

    doc.end()
  })
}
