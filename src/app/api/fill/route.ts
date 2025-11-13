import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as fontkit from "fontkit";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: Request) {
  try {
    console.log("📩 Upload received at /api/fill");

    const form = await req.formData();
    const sourceFile = form.get("source") as File | null;
    const targetFile = form.get("target") as File | null;

    if (!sourceFile || !targetFile) {
      return NextResponse.json(
        { error: "Missing source or target file." },
        { status: 400 }
      );
    }

    // ---- Convert source PDF to Base64 (Claude requires Base64) ----
    const sourceArray = new Uint8Array(await sourceFile.arrayBuffer());
    const sourceBase64 = Buffer.from(sourceArray).toString("base64");

    // ---- Claude Extraction ----
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const extractionPrompt = `
You are an AI that extracts structured form data from uploaded PDFs.
Return ONLY valid JSON. No explanations.
`;

    console.log("📤 Sending PDF to Claude…");

    const extractResponse = await client.messages.create({
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
            },
          ],
        },
      ],
    });

   // ---- Extract JSON safely ----
const textBlock = extractResponse.content.find(
  (b: any) => b.type === "text"
);

if (!textBlock || textBlock.type !== "text") {
  throw new Error("Claude returned no text block.");
}

const extractedText = textBlock.text.trim();

// Remove ```json fences if present
const cleanJSON = extractedText.replace(/```json|```/g, "").trim();

let mapping: Record<string, any> = {};
try {
  mapping = JSON.parse(cleanJSON);
} catch (err) {
  console.error("❌ JSON parse error:", err);
  throw new Error("Claude returned invalid JSON.");
}

    console.log("✅ Extracted mapping:", mapping);

    // ---- Load target PDF ----
    const targetArray = new Uint8Array(await targetFile.arrayBuffer());
    const pdfDoc = await PDFDocument.load(targetArray);

    pdfDoc.registerFontkit(fontkit);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const page = pages[0];
    let y = page.getHeight() - 50;

    Object.entries(mapping).forEach(([key, value]) => {
      if (typeof value === "string") {
        page.drawText(`${key}: ${value}`, {
          x: 50,
          y,
          size: 12,
          font: helvetica,
          color: rgb(0, 0, 0),
        });
        y -= 20;
      }
    });

    // ---- Export final PDF ----
    const finalBytes = await pdfDoc.save();
    const finalBuffer = Buffer.from(finalBytes);

    return new NextResponse(finalBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="filled_${targetFile.name}"`,
      },
    });
  } catch (err: any) {
    console.error("❌ /api/fill error", err);
    return NextResponse.json(
      { error: err.message || "Unexpected server error" },
      { status: 500 }
    );
  }
}
