import { NextResponse } from 'next/server'
import { Anthropic } from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(req: Request) {
  try {
    console.log('🟡 Upload received')

    // Parse uploaded form data
    const data = await req.formData()
    const sourceFile = data.get('source') as File
    const targetFile = data.get('target') as File

    if (!sourceFile || !targetFile) {
      return NextResponse.json({ error: 'Missing files' }, { status: 400 })
    }

    // 🧠 Ask Claude to extract structured content from the source file
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

    // ✅ Safely extract text content
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
      console.error('❌ Failed to extract text from Claude:', err)
      extracted = 'Extraction error'
    }

    console.log('✅ Extraction complete:', extracted.slice(0, 200))

    // 📝 Create a simple PDF to verify file download works
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([500, 400])
    page.drawText('Claude Extracted Content:\n\n' + extracted.slice(0, 500), {
      x: 40,
      y: 350,
      size: 12,
    })

    // Save and prepare the PDF for response
    const pdfBytes = await pdfDoc.save()
    const buffer = Buffer.from(pdfBytes) // ✅ Convert to valid response body

    console.log('📄 Returning PDF to client')

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="filled.pdf"',
      },
    })
  } catch (err: any) {
    console.error('🔥 API error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
