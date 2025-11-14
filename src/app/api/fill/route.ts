import { NextResponse } from "next/server";
import { Anthropic } from "@anthropic-ai/sdk";
import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "pdf-lib";

export const runtime = "nodejs"; // required for pdf-lib + Vercel

// Claude client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

type ExtractedFields = {
  fields: Record<string, string>;
};

type MappingResult = {
  mappings: Record<string, string | null>; // targetFieldName -> sourceFieldKey | null
};

// Utility: safely parse Claude JSON text
function parseClaudeJSON<T = any>(raw: string): T {
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(cleaned);
}

export async function POST(req: Request) {
  try {
    console.log("🟡 /api/fill called...");

    // -------- STEP 0: Parse uploaded files --------
    const formData = await req.formData();
    const source = formData.get("source") as File | null;
    const target = formData.get("target") as File | null;

    if (!source || !target) {
      return NextResponse.json(
        { error: "Missing source or target file." },
        { status: 400 },
      );
    }

    console.log(
      `📥 Received -> Source: ${source.name}, Target: ${target.name}`,
    );

    // -------- STEP 1: Extract text from source --------
    // For now we use source.text() as a rough text extraction.
    // Later you can upgrade this to use a proper PDF text parser or Claude Vision.
    const sourceText = await source.text();
    const truncatedText =
      sourceText.length > 12000
        ? sourceText.slice(0, 12000)
        : sourceText;

    console.log("📤 Sending extraction request to Claude...");

    // -------- STEP 2: Ask Claude to extract structured fields --------
    const extractResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929", // use your preferred model ID
      max_tokens: 3000,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `
You are FormForge AI, an expert paperwork assistant.

Task: 
Read the following document text and extract as many useful fields as possible
(name, address, phone, date of birth, passport number, etc.).

Return ONLY valid JSON in this exact structure (no extra keys, no comments):

{
  "fields": {
    "full_name": "John Doe",
    "date_of_birth": "1990-01-01",
    "address_line_1": "123 Example Street",
    "address_line_2": "Apt 4B",
    "city": "London",
    "state_or_region": "Greater London",
    "postal_code": "SW1A 1AA",
    "country": "United Kingdom",
    "phone_number": "+44 1234 567890",
    "email": "example@email.com",
    "passport_number": "123456789",
    "nationality": "British",
    "id_number": "",
    "tax_id": "",
    "employer_name": "",
    "job_title": "",
    "income": "",
    "marital_status": "",
    "spouse_name": "",
    "dependent_names": ""
  }
}

Rules:
- Only output valid JSON.
- If a field is unknown, use an empty string "".
- You may include additional keys inside "fields" if useful.
- Do NOT include any explanation text, only JSON.

Document text starts below:
---
${truncatedText}
---
        `.trim(),
        },
      ],
    });

    let extractText = "";
    const firstBlock = extractResponse.content[0];

    if (firstBlock.type === "text") {
      extractText = firstBlock.text;
    } else {
      throw new Error("Claude extraction returned unexpected content format.");
    }

    console.log("🧠 Claude extraction raw JSON (truncated):", extractText.slice(0, 200));

    const extracted = parseClaudeJSON<ExtractedFields>(extractText);

    if (!extracted.fields || typeof extracted.fields !== "object") {
      throw new Error("Extracted JSON missing valid `fields` object.");
    }

    const extractedFields = extracted.fields;
    console.log("📦 Extracted field keys:", Object.keys(extractedFields));

    // -------- STEP 3: Load target PDF & inspect form fields --------
    console.log("📄 Loading target PDF...");
    const targetBytes = new Uint8Array(await target.arrayBuffer());
    const pdfDoc = await PDFDocument.load(targetBytes);

    // Try to get form fields (AcroForm)
    let form;
    let formFields: { name: string; field: any }[] = [];

    try {
      form = pdfDoc.getForm();
      const rawFields = form.getFields();
      formFields = rawFields.map((f: any) => ({
        name: f.getName(),
        field: f,
      }));
    } catch (e) {
      console.warn("⚠️ No form fields found or getForm failed:", e);
      form = null;
      formFields = [];
    }

    const hasFormFields = formFields.length > 0;
    console.log(
      hasFormFields
        ? `🧾 Detected ${formFields.length} form fields in target PDF.`
        : "🧾 No form fields detected. Will use overlay fallback.",
    );

    // -------- STEP 4: If we have fields, ask Claude to map them --------
    let mapping: MappingResult | null = null;

    if (hasFormFields) {
      const targetFieldNames = formFields.map((f) => f.name).slice(0, 80); // avoid huge prompts

      console.log("📋 Target field names:", targetFieldNames);

      const mappingResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2000,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: `
You are FormForge AI.

We extracted the following source fields (key -> value):

${JSON.stringify(extractedFields, null, 2)}

We also detected these target PDF form field names:

${JSON.stringify(targetFieldNames, null, 2)}

Your job:
Map each target PDF form field name to the most appropriate source field key
from "fields". If you don't find a suitable source field, map it to null.

Return ONLY valid JSON with this exact shape:

{
  "mappings": {
    "TargetFieldName1": "source_field_key_or_null",
    "TargetFieldName2": null
  }
}

Rules:
- Use case-insensitive, fuzzy matching ("DOB" ~ "date_of_birth", etc.).
- Prefer semantic meaning, not exact string matches.
- If unsure, use null.
- No explanation text, only JSON.
          `.trim(),
          },
        ],
      });

      let mappingText = "";
      const mapBlock = mappingResponse.content[0];
      if (mapBlock.type === "text") {
        mappingText = mapBlock.text;
      } else {
        throw new Error("Claude mapping returned unexpected content format.");
      }

      console.log("🧠 Claude mapping JSON (truncated):", mappingText.slice(0, 200));

      mapping = parseClaudeJSON<MappingResult>(mappingText);
      if (!mapping.mappings || typeof mapping.mappings !== "object") {
        throw new Error("Mapping JSON missing valid `mappings` object.");
      }
    }

    // -------- STEP 5: Apply Hybrid Fill Strategy --------
    if (hasFormFields && mapping) {
      console.log("✍️ Filling detected form fields (Hybrid: form mode)...");

      for (const { name, field } of formFields) {
        const sourceKey =
          mapping.mappings[name] ?? null;

        if (!sourceKey) {
          continue;
        }

        const value = extractedFields[sourceKey];
        if (value == null || value === "") continue;

        const anyField = field as any;

        try {
          // Text fields
          if (typeof anyField.setText === "function") {
            anyField.setText(String(value));
          }
          // Checkboxes (simple heuristic)
          else if (
            typeof anyField.check === "function" ||
            typeof anyField.uncheck === "function"
          ) {
            const v = String(value).toLowerCase();
            const shouldCheck =
              v === "yes" ||
              v === "true" ||
              v === "y" ||
              v === "1" ||
              v === "checked";
            if (shouldCheck && typeof anyField.check === "function") {
              anyField.check();
            } else if (!shouldCheck && typeof anyField.uncheck === "function") {
              anyField.uncheck();
            }
          }
          // Dropdowns / option lists
          else if (typeof anyField.select === "function") {
            anyField.select(String(value));
          }

          console.log(`  ✅ Filled field "${name}" from "${sourceKey}" = ${value}`);
        } catch (fillErr: any) {
          console.warn(`  ⚠️ Failed to fill field "${name}":`, fillErr?.message || fillErr);
        }
      }
    } else {
      console.log("✍️ No fields to map. Using overlay mode on first page...");
      // FALLBACK: overlay text block on first page (your original behavior, slightly upgraded)
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];

      let y = 750;

      firstPage.drawText("FormForge AI Auto-Filled Data:", {
        x: 40,
        y,
        size: 14,
        font,
        color: rgb(0.2, 0.8, 1),
      });

      y -= 30;

      for (const [key, value] of Object.entries(extractedFields)) {
        if (!value) continue;

        firstPage.drawText(`${key}: ${value}`, {
          x: 40,
          y,
          size: 10,
          font,
          color: rgb(1, 1, 1),
        });

        y -= 18;
        if (y < 40) break;
      }
    }

    // -------- STEP 6: Finalize PDF & return --------
    console.log("💾 Saving filled PDF...");
    const filledPdfBytes = await pdfDoc.save();
    const fileBuffer = Buffer.from(filledPdfBytes);

    console.log("✅ PDF ready — returning file.");

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          'attachment; filename="formforge_filled.pdf"',
      },
    });
  } catch (err: any) {
    console.error("🔥 /api/fill error:", err);
    return NextResponse.json(
      {
        error: err?.message || "Internal server error",
      },
      { status: 500 },
    );
  }
}
