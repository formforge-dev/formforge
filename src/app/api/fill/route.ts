import { NextResponse } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export const runtime = 'nodejs'; // ensure Node runtime, not Edge

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(req: Request) {
  try {
    console.log('🟡 Upload received at /api/fill');

    const data = await req.formData();
    const sourceFile = data.get('source') as File | null;

    if (!sourceFile) {
      return NextResponse.json({ error: 'Missing source file' }, { status: 400 });
    }

    console.log('📁 Source file received:', sourceFile.name);

    const sourceText = await sourceFile.text();
    const truncated = sourceText.slice(0, 5000);

    console.log('🧠 Sending to Claude...');
    const msg = await anthropic.messages.create({
      model: 'claude-4-sonnet-20250514',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `Extract structured text or key-value data from this PDF content (up to 5,000 chars):\n\n${truncated}`,
        },
      ],
    });

    console.log('🧠 Claude response received');

    let extracted = '';
    const content = msg.content?.[0];
    if (content && content.type === 'text') {
      extracted = content.text;
    } else if (Array.isArray(msg.content)) {
      extracted = msg.content.map((c: any) => c.text || '').join('\n');
    } else {
      extracted = 'No text returned from Claude.';
    }

    console.log('✅ Extraction complete — first 200 chars:\n', extracted.slice(0, 200));

    // 🖋️ Fetch Unicode-safe NotoSans font
    console.log('🔤 Fetching Unicode font...');
    const fontUrl =
      'https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf';
    const fontBytes = await fetch(fontUrl).then((res) => res.arrayBuffer());

    // 📝 Create a PDF with Unicode-safe font
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit); // ✅ Register fontkit before embedding
    const notoFont = await pdfDoc.embedFont(fontBytes);
    const page = pdfDoc.addPage([600, 400]);
    const { height } = page.getSize();

    page.drawText('Claude Extracted Content:', {
      x: 40,
      y: height - 60,
      size: 14,
      font: notoFont,
      color: rgb(0.2, 0.6, 1),
    });

    page.drawText(extracted.slice(0, 1500), {
      x: 40,
      y: height - 100,
      size: 11,
      font: notoFont,
      color: rgb(1, 1, 1),
      lineHeight: 14,
    });

    const pdfBytesOut = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytesOut);

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
      { status: 500 },
    );
  }
}
