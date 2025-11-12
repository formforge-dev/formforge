import { NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fontkit from 'fontkit';

export const runtime = 'nodejs'; // ✅ force Node runtime, not Edge

export async function POST(req: Request) {
  try {
    console.log('🟡 Upload received at /api/fillpdf');

    const data = await req.formData();
    const targetFile = data.get('target') as File;
    const mappingRaw = data.get('mapping') as string;

    if (!targetFile || !mappingRaw) {
      return NextResponse.json({ error: 'Missing target file or mapping' }, { status: 400 });
    }

    const mapping = JSON.parse(mappingRaw);
    console.log('🧠 Parsed mapping keys:', Object.keys(mapping));

    // --- Load and prepare the target PDF ---
    const targetBytes = await targetFile.arrayBuffer();
    const pdfDoc = await PDFDocument.load(targetBytes);
    pdfDoc.registerFontkit(fontkit); // ✅ Unicode-safe font registration

    // Load a font (Roboto supports Unicode)
    const fontBytes = await fetch(
      'https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Regular.ttf'
    ).then((r) => r.arrayBuffer());
    const customFont = await pdfDoc.embedFont(fontBytes);

    const form = pdfDoc.getForm();

    // --- Fill in each field from mapping ---
    Object.entries(mapping).forEach(([key, value]) => {
      try {
        const field = form.getFieldMaybe(key);
        if (field) {
          if (typeof value === 'string' || typeof value === 'number') {
            form.getTextField(key).setText(String(value));
          }
        } else {
          console.warn(`⚠️ Field not found in PDF: ${key}`);
        }
      } catch (err) {
        console.warn(`⚠️ Could not set field ${key}:`, err);
      }
    });

    // --- Flatten the form (make filled values permanent) ---
    form.flatten();

    // --- Add footer / watermark ---
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width } = lastPage.getSize();
    lastPage.drawText('Filled with FormForge ⚡', {
      x: width - 180,
      y: 30,
      size: 10,
      font: customFont,
      color: rgb(0.5, 0.5, 0.5),
    });

    // --- Save and return the filled PDF ---
    const filledBytes = await pdfDoc.save();
    const buffer = Buffer.from(filledBytes);

    console.log('✅ Returning filled PDF');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="filled.pdf"',
      },
    });
  } catch (err: any) {
    console.error('🔥 API error in /api/fillpdf:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
