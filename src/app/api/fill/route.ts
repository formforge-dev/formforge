import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as fontkit from 'fontkit';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs'; // IMPORTANT for Vercel

export async function POST(req: Request) {
  try {
    console.log("📥 Upload received at /api/fill");

    const data = await req.formData();

    const sourceFile = data.get('source') as File | null;
    const targetFile = data.get('target') as File | null;

    if (!sourceFile || !targetFile) {
      return NextResponse.json(
        { error: 'Missing source or target file.' },
        { status: 400 }
      );
    }

    // --------------------------------------------------------------------
    // 1. Convert uploaded PDFs → ArrayBuffer → Base64 (Claude requires this)
    // --------------------------------------------------------------------
    const sourceBytes = await sourceFile.arrayBuffer();
    const targetBytes = await targetFile.arrayBuffer();

    const sourceBase64 = Buffer.from(sourceBytes).toString('base64');
    const targetBase64 = Buffer.from(targetBytes).toString('base64');

    // --------------------------------------------------------------------
    // 2. Ask Claude to extract JSON from the source PDF
    // --------------------------------------------------------------------
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const extractionPrompt = `
You are an AI document extraction engine.
Extract ALL structured key/value data from the uploaded PDF.
Return ONLY valid JSON. No explanations.
`;

    console.log("📤 Sending PDF → Claude Sonnet 4");

    const extractResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: sourceBase64,
              },
            },
            {
              type: "text",
              text: extractionPrompt,
            }
          ]
        }
      ]
    });

    // --------------------------------------------------------------------
    // 3. Find Claude's JSON text block
    // --------------------------------------------------------------------
    const textBlock = (extractResponse.content as any[]).find(
      (c) => c.type === "text"
    );

    if (!textBlock) {
      throw new Error("Claude did not return JSON text.");
    }

    const extractedJson = textBlock.text.trim();

    console.log("📄 Extracted JSON:", extractedJson.slice(0, 200));

    const mapping = JSON.parse(extractedJson);

    // --------------------------------------------------------------------
    // 4. Fill the target PDF
    // --------------------------------------------------------------------
    const pdfDoc = await PDFDocument.load(targetBytes);

    // register fontkit for unicode fonts
    pdfDoc.registerFontkit(fontkit);

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const page = pages[0];
    const { width, height } = page.getSize();

    let y = height - 40;

    Object.entries(mapping).forEach(([key, value]) => {
      if (typeof value === "string") {
        page.drawText(`${key}: ${value}`, {
          x: 40,
          y,
          size: 12,
          font: helvetica,
          color: rgb(0, 0, 0),
        });
        y -= 20;
      }
    });

    // save filled PDF
    const filledBytes = await pdfDoc.save();

    console.log("✅ PDF successfully filled — returning file.");

    return new NextResponse(Buffer.from(filledBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="filled_${targetFile.name}"`,
      },
    });

  } catch (err: any) {
    console.error("❌ API Error /api/fill:", err);
    return NextResponse.json(
      { error: err.message || "Unexpected server error" },
      { status: 500 }
    );
  }
}
