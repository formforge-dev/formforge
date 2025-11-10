import { NextResponse } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { pdf } from 'pdf-parse'

// POST /api/fill
export async function POST(req: Request) {
  try {
    // 1️⃣ Get uploaded file
    const formData = await req.formData();
    const source = formData.get('source') as File | null;
    if (!source) {
      return NextResponse.json({ error: 'No source PDF uploaded' }, { status: 400 });
    }

    // 2️⃣ Extract text from the PDF
    const buffer = Buffer.from(await source.arrayBuffer());
    const pdfData = await pdf(buffer);
    const text = pdfData.text?.trim();
    if (!text) throw new Error('No text extracted from PDF');

    // 3️⃣ Send text to Claude for structured JSON extraction
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Extract structured JSON data from this text:\n\n${text.slice(0, 5000)}`,
        },
      ],
    });

    // 4️⃣ Extract text safely from Claude’s structured content
    const extracted = (msg.content?.[0] as any)?.text || 'No content returned'
      msg.content?.[0]?.type === 'text'
        ? msg.content[0].text
        : (msg.content?.[0] as any)?.text || 'No content returned';

    console.log('✅ Extraction complete');
    return NextResponse.json({ extracted });

  } catch (error: any) {
    console.error('❌ API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Unknown extraction error' },
      { status: 500 }
    );
  }
}
