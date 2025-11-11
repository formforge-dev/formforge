import { NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export async function POST(req: Request) {
  try {
    const data = await req.formData()
    const target = data.get('target') as File
    const mapping = JSON.parse(data.get('mapping') as string)

    if (!target || !mapping) {
      return NextResponse.json({ error: 'Missing target or mapping' }, { status: 400 })
    }

    // Load target PDF
    const targetBytes = await target.arrayBuffer()
    const pdfDoc = await PDFDocument.load(targetBytes)
    const pages = pdfDoc.getPages()
    const firstPage = pages[0]

    // Add simple text overlay using mapping data
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    let y = 700

    for (const [key, value] of Object.entries(mapping)) {
      firstPage.drawText(`${key}: ${String(value)}`, {
        x: 50,
        y,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      })
      y -= 20
    }

    // Save and return the PDF
    const filledBytes = await pdfDoc.save()
    const buffer = Buffer.from(filledBytes)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="filled.pdf"',
      },
    })
  } catch (err: any) {
    console.error('❌ Error filling PDF:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
