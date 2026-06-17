import { NextResponse } from 'next/server';
import { pingProvider } from '@/lib/llm';

export async function POST() {
  try {
    const { model, reply } = await pingProvider();
    return NextResponse.json({
      success: true,
      provider: 'gemini',
      model,
      message: `Connection successful. Gemini responded: "${reply}"`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `gemini test failed: ${message}`, provider: 'gemini' },
      { status: 500 }
    );
  }
}
