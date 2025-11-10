import { NextResponse } from 'next/server'
import { Anthropic } from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'

// POST /api/fill
export async function POST(req: Request) {
  try {
    // ---- 1️⃣ Read uploaded file ----
    const formData = await req.formData()
    const source = formData.get('source') as File | null
    if (!source) return NextResponse.json({ error: 'No source PDF uploaded' }, { status: 400 })

    const buffer = Buffer.from(await source.arrayBuffer())

    // ---- 2️⃣ Extract text using pdf-lib ----
    const pdfDoc = await PDFDocument.load(buffer)
    const pages = pdfDoc.getPages()
    const text = pages.map((p) => p.getTextContent?.() ?? '').join('\n')

    if (!text.trim()) throw new Error('No text extracted from PDF')

    // ---- 3️⃣ Send text to Claude ----
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    })

    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Extract structured JSON data from this text:\n\n${text.slice(0, 5000)}`,
        },
      ],
    })

    // ---- 4️⃣ Extract text safely from Claude ----
    const extracted =
      (msg.content?.[0] as any)?.text || 'No content returned'

    console.log('✅ Extraction complete')
    return NextResponse.json({ extracted })
  } catch (error: any) {
    console.error('❌ API Error:', error)
    return NextResponse.json(
      { error: error.message || 'Unknown extraction error' },
      { status: 500 }
    )
  }
}
