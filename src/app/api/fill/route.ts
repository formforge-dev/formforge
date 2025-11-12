export const runtime = 'nodejs'; // ✅ required so it runs on Node (not Edge)

import { NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
// ✅ Fix for Turbopack + CommonJS fontkit
import * as fontkit from 'fontkit';

import { Anthropic } from '@anthropic-ai/sdk';

export async function POST(req: Request) {
  try {
    console.log('📥 Upload received at /api/fill');
    const data = await req.formData();

    const sourceFile = data.get('source') as File;
    const targetFile = data.get('target') as File;

    if (!sourceFile || !targetFile) {
      return NextResponse.json(
        { error: 'Missing source or target file.' },
        { status: 400 }
      );
    }

    // --- Claude Extraction Phase ---
    console.log('🧠 Sending source PDF to Claude for data extraction...');
    const sourceBytes = Buffer.from(await sourceFile.arrayBuffer());
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const extractionPrompt = `
You are an AI document extraction engine.
Extract all the structured form data and key-value text from the uploaded PDF in clean JSON.
Keep key names descriptive and preserve all numeric/textual values.
Return only JSON, no explanation.
`;

    const extractResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: sourceBytes.toString('base64'),
              },
            },
            { type: 'text', text: extractionPrompt },
          ],
        },
      ],
    });

    // ✅ Safely find the first text block (ignores "thinking" or other block types)
const textBlock = (extractResponse.content as any[]).find(
  (b) => b.type === 'text' && typeof b.text === 'string'
);
const extractedText = textBlock ? textBlock.text.trim() : '';
    if (!extractedText) {
      throw new Error('Claude did not return structured extraction output.');
    }

    console.log('✅ Extraction complete — first 200 chars:');
    console.log(extractedText.slice(0, 200));

    // --- Parse extracted JSON safely ---
    const mapping = JSON.parse(
      extractedText.replace(/```json|```/g, '').trim()
    );

    // --- Load and fill the target PDF ---
    const targetBytes = Buffer.from(await targetFile.arrayBuffer());
    const pdfDoc = await PDFDocument.load(targetBytes);

    // ✅ Register fontkit for Unicode-safe embedding
    pdfDoc.registerFontkit(fontkit);

    // Try to load a built-in standard font for fallback
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const page = pages[0];
    const { width, height } = page.getSize();

    // --- Draw text data (demo: draw top-left key-value pairs) ---
    let y = height - 50;
    Object.entries(mapping).forEach(([key, value]) => {
      if (typeof value === 'string') {
        page.drawText(`${key}: ${value}`, {
          x: 50,
          y,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
        y -= 15;
      }
    });

    // --- Save new filled PDF ---
    const filledBytes = await pdfDoc.save();

   console.log('💾 PDF successfully filled — returning file.');
return new NextResponse(Buffer.from(filledBytes), {
  status: 200,
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="filled_${targetFile.name}"`,
  },
});
  } catch (err: any) {
    console.error('❌ API error in /api/fill:', err);
    return NextResponse.json(
      { error: err.message || 'Unexpected server error' },
      { status: 500 }
    );
  }
}
