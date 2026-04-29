import { NextResponse } from 'next/server';
import { pingProvider, getActiveProvider } from '@/lib/llm';

export async function POST() {
  const provider = getActiveProvider();
  try {
    const { model, reply } = await pingProvider();
    const label = provider === 'deepseek' ? 'DeepSeek' : 'Gemini';
    return NextResponse.json({
      success: true,
      provider,
      model,
      message: `Connection successful. ${label} responded: "${reply}"`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `${provider} test failed: ${message}`, provider },
      { status: 500 }
    );
  }
}
