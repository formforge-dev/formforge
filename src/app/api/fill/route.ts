import { NextResponse } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';

// ✅ Force Node.js runtime (important for Vercel)
export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(req: Request) {
  try {
    console.log('🟡 Upload received at /api/fill');

    // Parse uploaded form data
    const data = await req.formData();
    const sourceFile = data.get('source') as File | null;
    const targetFile = data.get('target') as File | null;

    if (!sourceFile) {
      return NextResponse.json({ error: 'Missing source file' }, { status: 400 });
    }
    if (!targetFile) {
      return NextResponse.json({ error: 'Missing target file' }, { status: 400 });
    }

    console.log('📁 Files received:', sourceFile.name, targetFile.name);

    // Read file text (truncate for Claude)
    const sourceText = await sourceFile.text();
    const truncated = sourceText.slice(0, 5000);

    // 🧠 Ask Claude to extract structured content
    console.log('🧠 Sending request to Claude API...');
    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Extract structured text or form data from this PDF content:\n\n${truncated}`,
        },
      ],
    });

    console.log('🧠 Claude response received');

    // ✅ Safely extract text
    const textBlock = msg.content?.[0];
    let extracted = '';

    if (textBlock?.type === 'text') {
      extracted = textBlock.text;
    } else if (Array.isArray(msg.content)) {
      extracted = msg.content.map((c: any) => c.text || '').join('\n');
    } else {
      console.warn('⚠️ Unexpected Claude response format:', msg);
      extracted = 'No text returned from Claude.';
    }

    console.log('✅ Extraction complete, first 200 chars:', extracted.slice(0, 200));

    // 📝 Generate PDF for response
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    page.drawText('Claude Extracted Content:\n\n' + extracted.slice(0, 800), {
      x: 40,
      y: 360,
      size: 11,
    });

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);

    console.log('📄 Returning filled PDF to client');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="filled.pdf"',
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
