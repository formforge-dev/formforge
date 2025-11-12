import { NextResponse } from 'next/server'
import { Anthropic } from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'

// @ts-ignore — CJS import for fontkit
const fontkit = require('fontkit')

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    console.log('🟡 Upload received')

    const data = await req.formData()
    const sourceFile = data.get('source') as File
    const targetFile = data.get('target') as File

    if (!sourceFile || !targetFile) {
      return NextResponse.json({ error: 'Missing files' }, { status: 400 })
    }

    // 🧠 Claude extraction
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    })

    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Extract structured text from this PDF (truncated to 5k chars):\n\n${await sourceFile.text()}`,
        },
      ],
    })

    let extracted = ''
    const content = msg.content?.[0]
    if (content && content.type === 'text') {
      extracted = content.text
    } else {
      extracted = 'No text returned from Claude.'
    }

    console.log('✅ Extraction complete')

    // 📝 Create a PDF safely with fontkit registered
    const pdfDoc = await PDFDocument.create()
    pdfDoc.registerFontkit(fontkit) // ✅ register fontkit before fonts

    const page = pdfDoc.addPage([500, 400])
    page.drawText('Claude Extracted Content:\n\n' + extracted.slice(0, 500), {
      x: 40,
      y: 350,
      size: 12,
    })

    const pdfBytes = await pdfDoc.save()
    const buffer = Buffer.from(pdfBytes)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="filled.pdf"',
      },
    })
  } catch (err: any) {
    console.error('🔥 API error in /api/fill:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
