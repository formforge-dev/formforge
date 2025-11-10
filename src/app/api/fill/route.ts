import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  console.log('API /api/fill route triggered');

  try {
    // dynamically import pdf2json for ESM safety
    const { default: PDFParser } = await import('pdf2json');
    const formData = await req.formData();
    const source = formData.get('source') as File;

    if (!source) throw new Error('No file uploaded');

    console.log('File name:', source.name);
    console.log('File size:', source.size);

    const buffer = Buffer.from(await source.arrayBuffer());
    const pdfParser = new PDFParser();

    const text = await new Promise<string>((resolve, reject) => {
      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        let fullText = '';
        pdfData.Pages.forEach((page: any) => {
          page.Texts.forEach((item: any) => {
            fullText += decodeURIComponent(item.R[0].T) + ' ';
          });
        });
        resolve(fullText);
      });

      pdfParser.on('pdfParser_dataError', (err: any) =>
        reject(new Error('PDF parse error: ' + err.message))
      );

      pdfParser.parseBuffer(buffer);
    });

    if (!text.trim()) throw new Error('No text extracted from PDF');

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [
        {
          role: 'user',
          content: `Extract structured JSON data from this text:\n\n${text.slice(
            0,
            5000
          )}`,
        },
      ],
    });

    const extracted = msg.content?.[0]?.text || 'No content returned';
    console.log('✅ Extraction complete');
    return NextResponse.json({ extracted });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
