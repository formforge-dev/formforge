import { NextResponse } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';

// ✅ Ensure this route runs in Node.js (not Edge) — required for Anthropic + pdf-lib
export const runtime = 'nodejs';

// ✅ Initialize Anthropic client with your API key
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(req: Request) {
  try {
    console.log('🟡 Upload received at /api/fill');

    // Parse uploaded form data
    const data = await req.formData();
    const sourceFile = data.get('source') as File | null;

    if (!sourceFile) {
      console.error('❌ Missing source file');
      return NextResponse.json({ error: 'Missing source file' }, { status: 400 });
    }

    console.log('📁 Source file received:', sourceFile.name);

    // Read and truncate file text for Claude prompt
    const sourceText = await sourceFile.text();
    const truncated = sourceText.slice(0, 5000);

    // 🧠 Ask Claude to extract structured text or form data
    console.log('🧠 Sending request to Claude API...');
    const msg = await anthropic.messages.create({
      model: 'claude-4-sonnet-20250514',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Extract structured text or key-value data from this PDF content (up to 5,000 chars):\n\n${truncated}`,
        },
      ],
    });

    console.log('🧠 Claude response received successfully');

    // ✅ Safely parse response content
    let extracted = '';
    try {
      const content = msg.content?.[0];
      if (content && content.type === 'text') {
        extracted = content.text;
      } else if (Array.isArray(msg.content)) {
        extracted = msg.content.map((c: any) => c.text || '').join('\n');
      } else {
        console.warn('⚠️ Unexpected Claude response format:', msg);
        extracted = 'No text returned from Claude.';
      }
    } catch (err) {
      console.error('❌ Failed to extract text from Claude:', err);
      extracted = 'Extraction error';
    }

    console.log('✅ Extraction complete — first 200 chars:\n', extracted.slice(0, 200));

    // 📝 Generate a small PDF to verify output
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    page.drawText('Claude Extracted Content:\n\n' + extracted.slice(0, 800), {
      x: 40,
      y: 360,
      size: 11,
    });

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);

    console.log('📄 Returning extracted PDF to client');

    // ✅ Return the new PDF file
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="extracted.pdf"',
      },
    });
  } catch (err: any) {
    console.error('🔥 API error in /api/fill:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
