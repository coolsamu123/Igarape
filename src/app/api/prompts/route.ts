import { NextResponse } from 'next/server';
import { getPrompts, savePrompts } from '@/lib/prompts';

export async function GET() {
  try {
    const prompts = getPrompts();
    return NextResponse.json(prompts);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    savePrompts(body);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
