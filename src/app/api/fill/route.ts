import { NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
// fontkit has no default export — must use import * as fontkit
import * as fontkit from 'fontkit';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(req: Request) {
  try {
    console.log('📥 Upload received at /api/fill');

    const form = await req.formData();
    const sourceFile = form.get('source') as File | null;
    const targetFile = form.get('target') as File | null;

    if (!sourceFile || !targetFile) {
      return NextResponse.json(
        { error: 'Missing source or target file.' },
        { status: 400 }
      );
    }

    // ---- 1. Convert PDFs to base64 for Claude ----
    const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
    const targetBytes = new Uint8Array(await targetFile.arrayBuffer());

    const sourceBase64 = Buffer.from(sourceBytes).toString('base64');

    // ---- 2. Claude Extraction Phase ----
    console.log('🔍 Sending PDF to Claude for extraction...');

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const extractionPrompt = `
You are an AI document extraction engine.
Extract all structured key-value fields from the uploaded PDF.
Return ONLY valid JSON. No explanations.
    `.trim();

    const extractResponse = await anthropic.messages.create({
      model: "claude-sonnet-4.5-20250529",
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
                data: sourceBase64,
              },
            },
            { type: 'text', text: extractionPrompt },
          ],
        },
      ],
    });

    // ---- 3. Extract text block safely ----
    const textBlock = (extractResponse.content as any[]).find(
      (b) => b.type === 'text' && typeof b.text === 'string'
    );

    if (!textBlock) {
      throw new Error('Claude did not return text content.');
    }

    const extractedText = textBlock.text.trim();
    console.log('🧠 Claude extracted first 200 chars:', extractedText.slice(0, 200));

    // Parse JSON out of Claude’s response
    const cleaned = extractedText.replace(/```json|```/g, '').trim();
    const mapping = JSON.parse(cleaned);

    // ---- 4. Fill the target PDF ----
    console.log('✍️ Filling target PDF…');

    const pdfDoc = await PDFDocument.load(targetBytes);
    pdfDoc.registerFontkit(fontkit);

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const page = pages[0];

    let y = page.getHeight() - 50;

    Object.entries(mapping).forEach(([key, value]) => {
      page.drawText(`${key}: ${value}`, {
        x: 50,
        y,
        size: 12,
        font: helvetica,
        color: rgb(0, 0, 0),
      });
      y -= 16;
    });

    // ---- 5. Export final PDF ----
    const finalBytes = await pdfDoc.save();
    const finalBuffer = Buffer.from(finalBytes);

    console.log('✅ PDF filled successfully — returning file.');

    return new NextResponse(finalBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="filled_${targetFile.name}"`,
      },
    });
  } catch (err: any) {
    console.error('❌ API Error:', err);
    return NextResponse.json(
      { error: err.message || 'Unexpected server error' },
      { status: 500 }
    );
  }
}
