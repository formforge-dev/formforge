import { NextResponse } from 'next/server'
import { Anthropic } from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'

// POST /api/fill
export async function POST(req: Request) {
  try {
    // 1️⃣ Read uploaded file
    const formData = await req.formData()
    const source = formData.get('source') as File | null
    if (!source) {
      return NextResponse.json({ error: 'No source PDF uploaded' }, { status: 400 })
    }

    const buffer = Buffer.from(await source.arrayBuffer())

    // 2️⃣ Extract text using pdf-lib
    const pdfDoc = await PDFDocument.load(buffer)
    const pages = pdfDoc.getPages()
    let text = ''
    for (const page of pages) {
      const { width, height } = page.getSize()
      text += `\n\n[Page ${pages.indexOf(page) + 1} - ${width}x${height}]`
      // pdf-lib doesn’t have a native getTextContent method, so this is placeholder
      // You can use Claude later to extract data directly from the PDF buffer.
    }

    if (!text.trim()) throw new Error('No text extracted from PDF')

    // 3️⃣ Send text to Claude
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    })

   console.log("🧠 Claude response received");

let extracted = '';
try {
  const content = msg.content?.[0];
  if (content?.type === 'text') {
    extracted = content.text;
  } else if (Array.isArray(content)) {
    extracted = content.map((c: any) => c.text || '').join('\n');
  } else {
    console.warn("⚠️ Claude response had no text:", msg);
    extracted = 'No text returned from Claude.';
  }
} catch (err) {
  console.error("❌ Failed to extract text from Claude response:", err);
  extracted = 'Extraction error';
}

console.log("✅ Extraction complete:", extracted.slice(0, 200));
return NextResponse.json({ extracted });

    // 4️⃣ Extract text safely from Claude
    const extracted = (msg.content?.[0] as any)?.text || 'No content returned'

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
