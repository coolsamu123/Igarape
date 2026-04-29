import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';

const ENV_PATH = path.join(process.cwd(), '.env.local');

type Provider = 'gemini' | 'deepseek';

const KEY_BY_PROVIDER: Record<Provider, string> = {
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

const PLACEHOLDER_KEYS = new Set([
  'your_gemini_api_key_here',
  'your_deepseek_api_key_here',
]);

function readEnvFile(): string {
  try {
    return fs.readFileSync(ENV_PATH, 'utf-8');
  } catch {
    return '';
  }
}

function readEnvVar(name: string): string {
  const content = readEnvFile();
  const match = content.match(new RegExp(`^${name}=(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

function writeEnvVar(name: string, value: string) {
  let content = readEnvFile();
  const re = new RegExp(`^${name}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, `${name}=${value}`);
  } else {
    content = (content.trim() + `\n${name}=${value}\n`).replace(/^\n+/, '');
  }
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
  process.env[name] = value;
}

function maskKey(key: string): string {
  if (!key || PLACEHOLDER_KEYS.has(key)) return 'Not configured';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function isConfigured(key: string): boolean {
  return !!key && !PLACEHOLDER_KEYS.has(key);
}

function readProvider(): Provider {
  const raw = (readEnvVar('LLM_PROVIDER') || process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  return raw === 'deepseek' ? 'deepseek' : 'gemini';
}

export async function GET() {
  const geminiKey = readEnvVar('GEMINI_API_KEY');
  const deepseekKey = readEnvVar('DEEPSEEK_API_KEY');
  const provider = readProvider();

  const db = getDb();
  const analyses = (db.prepare('SELECT COUNT(*) as count FROM analysis_cache').get() as { count: number }).count;
  const documents = (db.prepare('SELECT COUNT(*) as count FROM documents_cache').get() as { count: number }).count;

  const activeKey = provider === 'deepseek' ? deepseekKey : geminiKey;

  return NextResponse.json({
    provider,
    apiKeyMasked: maskKey(activeKey),
    isConfigured: isConfigured(activeKey),
    keys: {
      gemini: { masked: maskKey(geminiKey), isConfigured: isConfigured(geminiKey) },
      deepseek: { masked: maskKey(deepseekKey), isConfigured: isConfigured(deepseekKey) },
    },
    stats: { analyses, documents },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      apiKey?: string;
      provider?: string;
      targetProvider?: string;
    };

    // Provider switch
    if (typeof body.provider === 'string' && !body.apiKey) {
      const next = body.provider.toLowerCase();
      if (next !== 'gemini' && next !== 'deepseek') {
        return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
      }
      writeEnvVar('LLM_PROVIDER', next);
      return NextResponse.json({ success: true, provider: next });
    }

    // Key save
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 400 });
    }

    const target = (body.targetProvider || body.provider || readProvider()).toLowerCase();
    if (target !== 'gemini' && target !== 'deepseek') {
      return NextResponse.json({ error: 'Invalid target provider' }, { status: 400 });
    }

    const envName = KEY_BY_PROVIDER[target as Provider];
    writeEnvVar(envName, body.apiKey.trim());

    return NextResponse.json({
      success: true,
      provider: target,
      apiKeyMasked: maskKey(body.apiKey.trim()),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
