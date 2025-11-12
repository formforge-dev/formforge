import { NextResponse } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const runtime = 'nodejs'; // Must be Node, not Edge

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(req: Request) {
  try {
    console.log('🟡 Upload received at /api/fill');

    const data = await req.formData();
    const sourceFile = data.get('source') as File | null;

    if (!sourceFile) {
      console.error('❌ Missing source file');
      return NextResponse.json({ error: 'Missing source file' }, { status: 400 });
    }

    console.log('📁 Source file received:', sourceFile.name);

    const sourceText = await sourceFile.text();
    const truncated = sourceText.slice(0, 5000);

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

    console.log('🧠 Claude response received');

    // Safely get Claude output
    let extracted = '';
    try {
      const content = msg.content?.[0];
      if (content && content.type === 'text') {
        extracted = content.text;
      } else if (Array.isArray(msg.content)) {
        extracted = msg.content.map((c: any) => c.text || '').join('\n');
      } else {
        extracted = 'No text returned from Claude.';
      }
    } catch (err) {
      console.error('❌ Failed to extract text from Claude:', err);
      extracted = 'Extraction error';
    }

    console.log('✅ Extraction complete — first 200 chars:\n', extracted.slice(0, 200));

    // 🧹 Sanitize text to remove problematic Unicode
    const cleanText = extracted.replace(/[^\x00-\x7F]/g, ''); // remove non-ASCII chars

    // 📝 Create a simple PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const { height } = page.getSize();

    page.drawText('Claude Extracted Content:', {
      x: 40,
      y: height - 60,
      size: 14,
      font,
      color: rgb(0.2, 0.6, 1),
    });

    page.drawText(cleanText.slice(0, 1000), {
      x: 40,
      y: height - 100,
      size: 11,
      font,
      color: rgb(1, 1, 1),
      lineHeight: 14,
    });

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);

    console.log('📄 Returning extracted PDF to client');

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
