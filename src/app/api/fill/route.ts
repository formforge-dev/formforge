import { NextResponse } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { PDFDocument, rgb } from 'pdf-lib';

export const runtime = 'nodejs'; // ✅ ensure Node runtime, not Edge

// Initialize Anthropic client once
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(req: Request) {
  try {
    console.log('🟡 Upload received at /api/fill');

    // --- Parse incoming form data ---
    const data = await req.formData();
    const sourceFile = data.get('source') as File;
    const targetFile = data.get('target') as File;

    if (!sourceFile || !targetFile) {
      return NextResponse.json({ error: 'Missing files' }, { status: 400 });
    }

    // --- Extract text from the uploaded source (text fallback) ---
    const sourceText = await sourceFile.text();
    console.log('📄 Source file size:', sourceText.length, 'chars');

    // --- Ask Claude to summarize / extract structured text ---
    const msg = await anthropic.messages.create({
      model: 'claude-4-sonnet-20241022', // ✅ Claude 4 Sonnet
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Extract structured text from this PDF content (max 5000 chars shown):\n\n${sourceText.slice(
            0,
            5000
          )}`,
        },
      ],
    });

    console.log('🧠 Claude response received');

    // --- Extract text from Claude response ---
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
      console.error('❌ Failed to parse Claude response:', err);
      extracted = 'Extraction error';
    }

    console.log('✅ Extracted text preview:', extracted.slice(0, 200));

    // --- Create a new PDF with Claude’s extracted content ---
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);

    // Load a font that supports Unicode (use built-in standard font fallback)
    const fontBytes = await fetch(
      'https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Regular.ttf'
    ).then((r) => r.arrayBuffer());
    const customFont = await pdfDoc.embedFont(fontBytes);

    const { width, height } = page.getSize();
    const wrappedText = extracted.slice(0, 1500); // limit text to fit
    page.drawText(`Claude Extracted Content:\n\n${wrappedText}`, {
      x: 40,
      y: height - 60,
      size: 12,
      font: customFont,
      color: rgb(0, 0, 0),
      lineHeight: 16,
    });

    // --- Finalize the PDF ---
    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);

    console.log('📦 Returning filled PDF to client');

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
