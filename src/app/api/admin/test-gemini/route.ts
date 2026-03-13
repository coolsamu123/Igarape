import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return NextResponse.json(
        { error: 'No API key configured. Go to Admin > save your key first.' },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent(
      'Reply with exactly: "Gemini connection OK. Model: gemini-2.0-flash." Nothing else.'
    );
    const text = result.response.text().trim();

    return NextResponse.json({
      success: true,
      message: `Connection successful. Gemini responded: "${text}"`,
      model: 'gemini-2.0-flash',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Gemini test failed: ${message}` }, { status: 500 });
  }
}
