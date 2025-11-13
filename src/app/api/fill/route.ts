// src/app/api/fill/route.ts
export const runtime = 'nodejs';         // ✅ ensure Node runtime (needed for Buffer, pdf-lib)
export const dynamic = 'force-dynamic';  // ✅ don't prerender this route

import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as fontkit from 'fontkit';
import Anthropic from '@anthropic-ai/sdk';

// ---- Types ----

type LayoutField = {
  key: string;
  page: number;
  x: number;
  y: number;
  font_size?: number;
  max_width?: number;
};

type LayoutResponse = {
  fields: LayoutField[];
};

// ---- Helper: get first text block from Claude ----
function getFirstTextBlock(content: any[]): string {
  const block = content.find(
    (b: any) => b.type === 'text' && typeof b.text === 'string',
  );
  return (block?.text || '').trim();
}

// ---- Main handler ----
export async function POST(req: Request) {
  try {
    console.log('📥 Upload received at /api/fill');

    const data = await req.formData();

    const sourceEntry = data.get('source');
    const targetEntry = data.get('target');

    if (!(sourceEntry instanceof File) || !(targetEntry instanceof File)) {
      console.error('❌ Missing source or target file.');
      return NextResponse.json(
        { error: 'Both source and target PDF files are required.' },
        { status: 400 },
      );
    }

    const sourceFile = sourceEntry;
    const targetFile = targetEntry;

    const sourceBytes = Buffer.from(await sourceFile.arrayBuffer());
    const targetBytes = Buffer.from(await targetFile.arrayBuffer());

    // ---- Validate env ----
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('❌ Missing ANTHROPIC_API_KEY env var.');
      return NextResponse.json(
        { error: 'Server misconfigured: missing Anthropic API key.' },
        { status: 500 },
      );
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const modelId =
      process.env.CLAUDE_MODEL_ID || 'claude-sonnet-4-5-20250929';

    // ============================================================
    // 1. EXTRACT STRUCTURED DATA FROM SOURCE PDF
    // ============================================================
    console.log('📤 Sending source PDF to Claude for data extraction…');

    const extractionPrompt = `
You are an AI document extraction engine.

TASK:
- Read the attached SOURCE PDF.
- Extract all structured form data, key-value pairs, and important metadata.
- Use concise, machine-friendly JSON keys (snake_case).
- Include everything that might be needed to fill a blank version of this form.
- Return ONLY valid JSON. No backticks, no comments, no explanation.

RESPONSE FORMAT EXAMPLE:
{
  "full_name": "John Doe",
  "date_of_birth": "1990-01-01",
  "address_line_1": "123 Main St",
  "city": "New York",
  "state": "NY",
  "postal_code": "10001"
}
    `.trim();

    const extractResponse: any = await anthropic.messages.create(
      {
        model: modelId,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: sourceBytes,
                media_type: 'application/pdf',
              },
              {
                type: 'text',
                text: extractionPrompt,
              },
            ],
          },
        ],
      } as any, // 👈 relax TS typing for document input
    );

    const extractedText = getFirstTextBlock(extractResponse.content);

    if (!extractedText) {
      console.error('❌ Claude did not return extraction text.');
      return NextResponse.json(
        { error: 'Claude did not return structured extraction output.' },
        { status: 500 },
      );
    }

    console.log('✅ Extraction complete – first 200 chars:\n', extractedText.slice(0, 200));

    // Parse JSON safely
    let mapping: Record<string, unknown>;
    try {
      const cleaned = extractedText.replace(/```json|```/g, '').trim();
      mapping = JSON.parse(cleaned);
    } catch (err) {
      console.error('❌ Failed to parse extraction JSON:', err);
      return NextResponse.json(
        { error: 'Failed to parse extracted JSON from Claude.' },
        { status: 500 },
      );
    }

    // ============================================================
    // 2. ASK CLAUDE FOR SMART FIELD PLACEMENT ON TARGET PDF
    // ============================================================
    console.log('📤 Sending TARGET PDF + mapping to Claude for smart field placement…');

    const layoutPrompt = `
You are a PDF form layout engine.

You are given:
1) A BLANK TARGET FORM PDF (attached as a document).
2) A JSON object of extracted data from a source form.

Your job:
- Decide where each JSON field should be written on the TARGET form.
- Use the visual layout, labels, and existing lines/boxes.
- Match JSON keys to the most appropriate label/field on the target.

IMPORTANT:
- Coordinates are in PDF points.
- Origin (0,0) is at the BOTTOM-LEFT of the page.
- Pages are 1-indexed (first page is page 1).
- Use reasonable font sizes (9–12) that fit neatly in boxes.
- "max_width" is optional, but helpful for long text.

OUTPUT:
Return ONLY valid JSON in this exact shape:

{
  "fields": [
    {
      "key": "<exact JSON key from the data>",
      "page": 1,
      "x": 120,
      "y": 540,
      "font_size": 10,
      "max_width": 200
    }
  ]
}

Rules:
- Only include keys you can confidently place next to a label.
- Prefer left-aligned text inside or just right of the label/box.
- Do NOT include any explanation text – ONLY the JSON object.

Here is the form data to place:

${JSON.stringify(mapping, null, 2)}
    `.trim();

    const layoutResponse: any = await anthropic.messages.create(
      {
        model: modelId,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: targetBytes,
                media_type: 'application/pdf',
              },
              {
                type: 'text',
                text: layoutPrompt,
              },
            ],
          },
        ],
      } as any,
    );

    const layoutText = getFirstTextBlock(layoutResponse.content);
    console.log(
      '📐 Raw layout JSON (first 200 chars):\n',
      layoutText.slice(0, 200),
    );

    let layout: LayoutResponse | null = null;

    try {
      const cleaned = layoutText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed && Array.isArray(parsed.fields)) {
        layout = parsed as LayoutResponse;
      } else {
        console.warn('⚠️ Layout JSON missing "fields" array, will fall back to simple layout.');
      }
    } catch (err) {
      console.warn('⚠️ Failed to parse layout JSON, will fall back to simple layout.', err);
    }

    // ============================================================
    // 3. LOAD TARGET PDF & EMBED FONT
    // ============================================================
    const pdfDoc = await PDFDocument.load(targetBytes);
    // Register fontkit for potential Unicode support (if you later embed custom fonts)
    (pdfDoc as any).registerFontkit(fontkit);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    // ============================================================
    // 4. DRAW TEXT USING SMART LAYOUT (or fallback)
    // ============================================================
    if (layout && layout.fields.length > 0) {
      console.log(`🧠 Using smart layout for ${layout.fields.length} fields…`);

      for (const field of layout.fields) {
        const value = mapping[field.key];
        if (value === undefined || value === null) continue;

        const pageIndex = Math.max(0, Math.min(pages.length - 1, (field.page || 1) - 1));
        const page = pages[pageIndex];

        const text = String(value);
        const fontSize = field.font_size ?? 10;

        page.drawText(text, {
          x: field.x,
          y: field.y,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          maxWidth: field.max_width,
        });
      }
    } else {
      console.log('🔁 Falling back to simple top-left key/value layout…');

      // Simple fallback: first page, vertical list
      const page = pages[0];
      const { width, height } = page.getSize();

      let x = 50;
      let y = height - 60;
      const lineHeight = 14;
      const fontSize = 10;

      Object.entries(mapping).forEach(([key, value]) => {
        const text = `${key}: ${String(value)}`;

        if (y < 40) {
          // stop drawing if we run off the page
          return;
        }

        page.drawText(text, {
          x,
          y,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          maxWidth: width - 100,
        });

        y -= lineHeight;
      });
    }

    // ============================================================
    // 5. RETURN FILLED PDF
    // ============================================================
    const filledBytes = await pdfDoc.save();
    console.log('✅ PDF successfully filled — returning file.');

    return new NextResponse(Buffer.from(filledBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="filled_${targetFile.name}"`,
      },
    });
  } catch (err: any) {
    console.error('💥 API error in /api/fill:', err);
    return NextResponse.json(
      { error: err?.message || 'Unexpected server error' },
      { status: 500 },
    );
  }
}
