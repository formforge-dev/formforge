// ======================================================
// /api/fill  —  Extract data from source PDF via Claude
//               AND fill the target PDF with extracted data
// ======================================================

export const runtime = 'nodejs'; // MUST run on Node, not Edge

import { NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fontkit from 'fontkit';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(req: Request) {
  try {
    console.log('📥 Upload received at /api/fill');

    //----------------------------------------------------------------------
    // 1️⃣ Read multipart form-data safely
    //----------------------------------------------------------------------
    const data = await req.formData();
    const sourceFile = data.get('source');
    const targetFile = data.get('target');

    // ✅ Type narrowing — fixes: "arrayBuffer does not exist on type"
    if (!(sourceFile instanceof File) || !(targetFile instanceof File)) {
      console.error('❌ Missing or invalid file inputs.');
      return NextResponse.json(
        { error: 'Both source and target must be valid uploaded files.' },
        { status: 400 }
      );
    }

    //----------------------------------------------------------------------
    // 2️⃣ Claude Extraction Phase
    //----------------------------------------------------------------------
    console.log('🧠 Sending source PDF to Claude for extraction...');

    const sourceBytes = Buffer.from(await sourceFile.arrayBuffer());
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const extractionPrompt = `
You are an AI document extraction engine.
Extract all structured form data and key–value text from the uploaded PDF in clean JSON.
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
            { type: 'document', source: sourceBytes, media_type: 'application/pdf' },
            { type: 'text', text: extractionPrompt }
          ]
        }
      ]
    });

    //----------------------------------------------------------------------
    // 3️⃣ Extract the JSON text block safely
    //----------------------------------------------------------------------
    const textBlock = (extractResponse.content as any[]).find(
      (b) => b.type === 'text' && typeof b.text === 'string'
    );

    const extractedText = textBlock?.text?.trim();
    if (!extractedText) {
      throw new Error('Claude did not return structured extraction output.');
    }

    console.log('🧠 Extraction finished. Sample:');
    console.log(extractedText.slice(0, 200));

    let mapping: Record<string, any> = {};

    try {
      mapping = JSON.parse(
        extractedText.replace(/```json|```/g, '').trim()
      );
    } catch (err) {
      throw new Error('Failed to parse Claude JSON output.');
    }

    //----------------------------------------------------------------------
    // 4️⃣ Fill the target PDF
    //----------------------------------------------------------------------
    console.log('✍️ Filling the target PDF...');

    const targetBytes = Buffer.from(await targetFile.arrayBuffer());
    const pdfDoc = await PDFDocument.load(targetBytes);

    // Register fontkit so Unicode fonts work
    pdfDoc.registerFontkit(fontkit);

    // Try built-in Helvetica
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const page = pages[0];
    const { width, height } = page.getSize();

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

    //----------------------------------------------------------------------
    // 5️⃣ Save & Send Back PDF
    //----------------------------------------------------------------------
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
    console.error('❌ API Error in /api/fill:', err);

    return NextResponse.json(
      { error: err.message || 'Unexpected server error' },
      { status: 500 }
    );
  }
}
