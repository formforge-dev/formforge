import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';

export const runtime = 'nodejs'; // Ensure it runs in Node, not Edge

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const target = formData.get('target') as File | null;
    const json = formData.get('data') as string | null;

    if (!target || !json) {
      return NextResponse.json(
        { error: 'Missing target PDF or data' },
        { status: 400 }
      );
    }

    // Parse JSON safely
    let data: Record<string, string>;
    try {
      data = JSON.parse(json);
    } catch (err) {
      return NextResponse.json(
        { error: 'Invalid JSON data' },
        { status: 400 }
      );
    }

    // Load and fill the PDF
    const pdfBytes = await target.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();

    // Try to fill matching fields
    const fields = form.getFields();
    fields.forEach((field) => {
      const name = field.getName();
      const value = data[name];
      if (value) {
        try {
          field.setText(value);
        } catch {
          console.warn(`Could not set field ${name}`);
        }
      }
    });

    const filledPdf = await pdfDoc.save();

    // Return the filled PDF as a response
    return new NextResponse(filledPdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=filled_form.pdf',
      },
    });
  } catch (error: any) {
    console.error('PDF Fill Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fill PDF' },
      { status: 500 }
    );
  }
}
