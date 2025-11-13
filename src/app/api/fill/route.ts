export const runtime = "nodejs"; // Required for pdf-lib + Buffer

import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as fontkit from "fontkit";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: Request) {
  try {
    console.log("📥 Upload received at /api/fill");

    const data = await req.formData();
    const sourceFile = data.get("source") as File | null;
    const targetFile = data.get("target") as File | null;

    if (!sourceFile || !targetFile) {
      return NextResponse.json(
        { error: "Missing source or target file." },
        { status: 400 }
      );
    }

    // -----------------------------------------------------
    // 🟦 1. Convert uploaded source PDF to Uint8Array
    // -----------------------------------------------------
    const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());

    // -----------------------------------------------------
    // 🟦 2. Prepare Anthropic client
    // -----------------------------------------------------
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const extractionPrompt = `
You are an AI document extraction engine.
Extract all structured key–value text from the uploaded PDF.
Return ONLY valid JSON. No explanations.
`;

    // -----------------------------------------------------
    // 🟦 3. Send PDF → Claude (Sonnet 4, correct document block)
    // -----------------------------------------------------
    const extractResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: sourceBytes, // Uint8Array is valid for Claude-4
              media_type: "application/pdf",
            },
            {
              type: "text",
              text: extractionPrompt,
            },
          ],
        },
      ],
    });

    // -----------------------------------------------------
    // 🟦 4. Extract JSON text safely
    // -----------------------------------------------------
    const textBlock = (extractResponse.content as any[]).find(
      (c) => c.type === "text"
    );

    const extractedText = textBlock?.text?.trim() || "";

    if (!extractedText) {
      throw new Error("Claude returned no text content.");
    }

    console.log("✨ Extraction complete — first 200 chars:");
    console.log(extractedText.slice(0, 200));

    let mapping = {};

    try {
      mapping = JSON.parse(
        extractedText.replace(/```json|```/g, "").trim()
      );
    } catch (err) {
      console.error("❌ JSON parse failed:", err);
      throw new Error("Claude did not return valid JSON.");
    }

    // -----------------------------------------------------
    // 🟦 5. Load target PDF and fill it
    // -----------------------------------------------------
    const targetBytes = new Uint8Array(await targetFile.arrayBuffer());
    const pdfDoc = await PDFDocument.load(targetBytes);

    // Enable unicode fonts
    pdfDoc.registerFontkit(fontkit);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const page = pages[0];

    let y = page.getSize().height - 50;

    Object.entries(mapping).forEach(([key, value]) => {
      if (typeof value === "string") {
        page.drawText(`${key}: ${value}`, {
          x: 50,
          y,
          size: 11,
          font,
          color: rgb(0, 0, 0),
        });
        y -= 18;
      }
    });

    // -----------------------------------------------------
    // 🟦 6. Return filled PDF as download
    // -----------------------------------------------------
    const filledBytes = await pdfDoc.save();
    const bufferOut = Buffer.from(filledBytes);

    return new NextResponse(bufferOut, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="filled_${targetFile.name}"`,
      },
    });
  } catch (err: any) {
    console.error("🔥 API error in /api/fill:", err);
    return NextResponse.json(
      { error: err.message || "Unexpected server error" },
      { status: 500 }
    );
  }
}
