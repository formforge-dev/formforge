import { NextResponse } from "next/server";
import { Anthropic } from "@anthropic-ai/sdk";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs"; // required for pdf-lib + Vercel

// Claude client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(req: Request) {
  try {
    console.log("🟡 /api/fill called...");

    // Parse uploaded files
    const form = await req.formData();
    const source = form.get("source") as File | null;
    const target = form.get("target") as File | null;

    if (!source || !target) {
      return NextResponse.json(
        { error: "Missing source or target file." },
        { status: 400 }
      );
    }

    console.log(
      `📥 Received -> Source: ${source.name}, Target: ${target.name}`
    );

    // -------- STEP 1: Extract text from source PDF --------
    const sourceText = await source.text(); // rough text extraction

    console.log("📤 Sending extraction request to Claude...");

    const ai = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929", // recommended stable model
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: `
You are FormForge AI.

Extract structured JSON from the following document text.

Return ONLY valid JSON, matching this format exactly:

{
  "fields": {
     "full_name": "",
     "address": "",
     "phone": "",
     ...
  }
}

Extract as many fields as possible.
Document text begins below:

${sourceText.slice(0, 7000)}
        `,
        },
      ],
    });

    // Extract AI text safely
    let extracted = "";
    const block = ai.content[0];

    if (block.type === "text") {
      extracted = block.text;
    } else {
      throw new Error("Claude returned unexpected content format.");
    }

    console.log("🧠 Claude extracted JSON:", extracted.slice(0, 200));

    // Parse JSON cleanly
    const cleaned = extracted.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.fields) {
      throw new Error("Extracted JSON missing `fields` property.");
    }

    // -------- STEP 2: Fill Target PDF --------
    console.log("📄 Loading target PDF...");
    const targetBytes = new Uint8Array(await target.arrayBuffer());
    const pdfDoc = await PDFDocument.load(targetBytes);

    // Use built-in Helvetica font -> avoids all fontkit issues
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const firstPage = pages[0];

    let y = 750; // text starting vertical position

    firstPage.drawText("FormForge AI Auto-Filled Data:", {
      x: 40,
      y,
      size: 14,
      font,
      color: rgb(0.2, 0.6, 1),
    });

    y -= 30;

    // Write each field one per line
    for (const [key, value] of Object.entries(parsed.fields)) {
      firstPage.drawText(`${key}: ${value}`, {
        x: 40,
        y,
        size: 10,
        font,
        color: rgb(1, 1, 1),
      });
      y -= 20;
      if (y < 40) break; // prevent overflow
    }

    console.log("✍️ PDF writing complete.");

    const filledPdfBytes = await pdfDoc.save();
    const fileBuffer = Buffer.from(filledPdfBytes);

    console.log("✅ PDF ready — returning file.");

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="formforge_filled.pdf"',
      },
    });
  } catch (err: any) {
    console.error("🔥 /api/fill error:", err);
    return NextResponse.json(
      {
        error: err.message || "Internal server error",
      },
      { status: 500 }
    );
  }
}
