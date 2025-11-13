// src/app/api/fill/route.ts
import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "edge"; // Vercel-compatible, faster

export async function POST(req: Request) {
  try {
    console.log("📥 Upload received at /api/fill");

    const form = await req.formData();
    const sourceFile = form.get("source") as File | null;
    const targetFile = form.get("target") as File | null;

    if (!sourceFile || !targetFile) {
      return NextResponse.json(
        { error: "Missing source or target file." },
        { status: 400 }
      );
    }

    // ---- 1. Convert PDF files to Uint8Array for Claude ----
    const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());

    console.log("📄 Source PDF loaded, sending to Claude…");

    // ---- 2. Claude extraction ----
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const extractionPrompt = `
You are an AI document extraction engine.
Extract ALL structured key/value text from the uploaded PDF.
Return ONLY valid JSON. No explanations.
`;

    const extractResponse = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: sourceBytes,           // Uint8Array works for Claude
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

    console.log("🤖 Claude raw response:", extractResponse);

    // ---- 3. Find the JSON block ----
    const textBlock = extractResponse.content.find(
      (c) => c.type === "text"
    ) as { type: "text"; text: string } | undefined;

    if (!textBlock) {
      throw new Error("Claude did not return text output.");
    }

    let extractedText = textBlock.text.trim();
    extractedText = extractedText.replace(/```json|```/g, "");

    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(extractedText);
    } catch (err) {
      console.error("❌ JSON parse error:", extractedText);
      throw new Error("Claude returned invalid JSON.");
    }

    console.log("✅ Extracted mapping:", mapping);

    // ---- 4. Load the target PDF ----
    const targetBytes = new Uint8Array(await targetFile.arrayBuffer());
    const pdfDoc = await PDFDocument.load(targetBytes);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const page = pages[0];

    // Demo draw text (top-left)
    let y = page.getHeight() - 50;

    Object.entries(mapping).forEach(([key, value]) => {
      page.drawText(`${key}: ${value}`, {
        x: 50,
        y,
        size: 12,
        color: rgb(0, 0, 0),
        font,
      });
      y -= 20;
    });

    // ---- 5. Save filled PDF ----
    const finalBytes = await pdfDoc.save();
    const finalBuffer = Buffer.from(finalBytes);

    console.log("📤 Returning filled PDF");

    return new NextResponse(finalBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="filled_${targetFile.name}"`,
      },
    });
  } catch (err: any) {
    console.error("❌ API Error:", err);
    return NextResponse.json(
      { error: err.message || "Unexpected server error" },
      { status: 500 }
    );
  }
}
