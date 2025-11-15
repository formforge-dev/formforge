import { NextResponse } from "next/server";
import { Anthropic } from "@anthropic-ai/sdk";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";

// Anthropic client (your key MUST be set in Vercel or .env.local)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Helper: convert File → Base64
async function fileToBase64(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return buffer.toString("base64");
}

export async function POST(req: Request) {
  try {
    console.log("🟡 /api/fill called...");

    // Read submitted FormData
    const formData = await req.formData();
    const source = formData.get("source") as File | null;
    const target = formData.get("target") as File | null;

    if (!source || !target) {
      return NextResponse.json(
        { error: "Missing source or target file." },
        { status: 400 }
      );
    }

    console.log(`📥 Received → Source: ${source.name}, Target: ${target.name}`);

    // Convert both files to Base64 for Claude Vision
    console.log("📤 Converting PDFs to Base64…");
    const sourceBase64 = await fileToBase64(source);
    const targetBase64 = await fileToBase64(target);

    // ============================
    //   STEP 1 — Claude Extraction
    // ============================

    console.log("🧠 Sending Vision request to Claude…");

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929", // YOUR AVAILABLE VISION MODEL
      max_tokens: 4000,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
You are FormForge AI.

1. Analyze the SOURCE document.
2. Extract structured fields: names, addresses, IDs, tax data, etc.
3. Analyze the TARGET form PDF — extract every field name.
4. Produce JSON ONLY:

{
  "fields": { ...extractedValues },
  "mappings": {
     "pdfFieldName": "field_key"
  }
}

NO explanation. ONLY JSON.
              `,
            },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: sourceBase64,
              },
            },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: targetBase64,
              },
            },
          ],
        },
      ],
    });

    const block = aiResponse.content[0];
    if (block.type !== "text") {
      throw new Error("Claude returned unexpected format (not text).");
    }

    const raw = block.text.replace(/```json|```/g, "").trim();
    console.log("🧠 Claude JSON (truncated):", raw.slice(0, 200));

    const parsed = JSON.parse(raw);
    const fields = parsed.fields || {};
    const mappings = parsed.mappings || {};

    console.log("📦 Extracted fields:", Object.keys(fields));
    console.log("📦 Mappings:", mappings);

    // ============================
    //   STEP 2 — Fill Target PDF
    // ============================

    console.log("📄 Loading target PDF…");
    const pdfBytes = Buffer.from(targetBase64, "base64");
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const pdfForm = pdfDoc.getForm();
    const pdfFields = pdfForm.getFields();
    const fieldNames = pdfFields.map((f) => f.getName());

    console.log("🧾 Detected PDF fields:", fieldNames);

    let formFieldsFound = fieldNames.length > 0;

    // Try structured form filling
    if (formFieldsFound) {
      console.log("✍️ Filling AcroForm fields…");

      for (const pdfFieldName of fieldNames) {
        const sourceKey = mappings[pdfFieldName];
        if (!sourceKey) continue;

        const value = fields[sourceKey];
        if (!value) continue;

        try {
          const textField = pdfForm.getTextField(pdfFieldName);
          textField.setText(String(value));
        } catch {
          console.log(`⚠️ Could not fill field: ${pdfFieldName}`);
        }
      }
    }

    // Fallback for scanned / non-fillable PDFs
    if (!formFieldsFound) {
      console.log("⚠️ No fillable fields. Drawing text fallback…");

      const pages = pdfDoc.getPages();
      const page = pages[0];
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      let y = 750;

      page.drawText("Auto-filled by FormForge:", {
        x: 40,
        y,
        size: 14,
        color: rgb(0.2, 0.6, 1),
        font,
      });

      y -= 30;

      for (const [key, value] of Object.entries(fields)) {
        page.drawText(`${key}: ${value}`, {
          x: 40,
          y,
          size: 10,
          color: rgb(1, 1, 1),
          font,
        });
        y -= 16;
        if (y < 40) break;
      }
    }

    // Save and send back PDF
    console.log("💾 Saving final PDF…");
    // >>> DEBUG TEST: Draw bright red text at top-left corner <<<
const pages = pdfDoc.getPages();
const page = pages[0]; // force first page

page.drawText("DEBUG TEST TEXT", {
  x: 20,
  y: page.getHeight() - 40, // top-left
  size: 28,
  color: rgb(1, 0, 0), // bright red
});
console.log("🔍 DEBUG TEXT DRAWN ON PAGE");
    const finalBytes = await pdfDoc.save();
    const buffer = Buffer.from(finalBytes);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="filled_${target.name}"`,
      },
    });

  } catch (err: any) {
    console.error("🔥 /api/fill ERROR:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
