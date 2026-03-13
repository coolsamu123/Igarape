import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';

const ENV_PATH = path.join(process.cwd(), '.env.local');

function readEnvKey(): string {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    const match = content.match(/^GEMINI_API_KEY=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function maskKey(key: string): string {
  if (!key || key === 'your_gemini_api_key_here') return 'Not configured';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

export async function GET() {
  const key = readEnvKey();
  const db = getDb();
  const analyses = (db.prepare('SELECT COUNT(*) as count FROM analysis_cache').get() as { count: number }).count;
  const documents = (db.prepare('SELECT COUNT(*) as count FROM documents_cache').get() as { count: number }).count;

  return NextResponse.json({
    apiKeyMasked: maskKey(key),
    isConfigured: !!key && key !== 'your_gemini_api_key_here',
    stats: { analyses, documents },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json();

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 400 });
    }

    // Read existing .env.local or create new
    let content = '';
    try {
      content = fs.readFileSync(ENV_PATH, 'utf-8');
    } catch {
      content = '';
    }

    // Replace or add GEMINI_API_KEY
    if (content.match(/^GEMINI_API_KEY=/m)) {
      content = content.replace(/^GEMINI_API_KEY=.+$/m, `GEMINI_API_KEY=${apiKey}`);
    } else {
      content = content.trim() + `\nGEMINI_API_KEY=${apiKey}\n`;
    }

    fs.writeFileSync(ENV_PATH, content, 'utf-8');

    // Also set in process.env for immediate use (no restart needed)
    process.env.GEMINI_API_KEY = apiKey;

    return NextResponse.json({
      success: true,
      apiKeyMasked: maskKey(apiKey),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
