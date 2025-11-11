import { NextResponse } from 'next/server'
import { Anthropic } from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(req: Request) {
  try {
    console.log('🟡 Upload received')

    // Parse request
    const data = await req.formData()
    const sourceFile = data.get('source') as File
    const targetFile = data.get('target') as File

    if (!sourceFile || !targetFile) {
      return NextResponse.json({ error: 'Missing files' }, { status: 400 })
    }

    // Example Claude request
    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Extract structured text from this input (truncated to 5k chars):\n\n${await sourceFile.text()}`,
        },
      ],
    })

    console.log('🧠 Claude response received')

    // ✅ SAFE response handling (no const conflicts)
    let extracted = ''
    try {
      const content = msg.content?.[0]
      if (content && content.type === 'text') {
        extracted = content.text
      } else if (Array.isArray(content)) {
        extracted = content.map((c: any) => c.text || '').join('\n')
      } else {
        console.warn('⚠️ No text returned from Claude:', msg)
        extracted = 'No text returned from Claude.'
      }
    } catch (err) {
      console.error('❌ Failed to extract text:', err)
      extracted = 'Extraction error'
    }

    console.log('✅ Extraction complete:', extracted.slice(0, 200))

    // ✅ Create a simple PDF for now (to verify download works)
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([500, 400])
    page.drawText('Claude Extracted Content:\n\n' + extracted.slice(0, 500), {
      x: 40,
      y: 350,
      size: 12,
    })
    const pdfBytes = await pdfDoc.save()

    console.log('📄 Returning PDF to client')

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="filled.pdf"',
      },
    })
  } catch (err: any) {
    console.error('🔥 API error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
