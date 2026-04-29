import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const SA_PATH = path.join(process.cwd(), 'data', 'service-account.json');
const DATA_DIR = path.dirname(SA_PATH);

interface ServiceAccountSummary {
  isConfigured: boolean;
  clientEmail?: string;
  projectId?: string;
  privateKeyId?: string;
  updatedAt?: string;
  error?: string;
}

function readSummary(): ServiceAccountSummary {
  if (!fs.existsSync(SA_PATH)) {
    return { isConfigured: false };
  }
  try {
    const raw = fs.readFileSync(SA_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as {
      type?: string;
      client_email?: string;
      project_id?: string;
      private_key_id?: string;
    };
    const stat = fs.statSync(SA_PATH);
    return {
      isConfigured: parsed.type === 'service_account' && !!parsed.client_email,
      clientEmail: parsed.client_email,
      projectId: parsed.project_id,
      privateKeyId: parsed.private_key_id
        ? parsed.private_key_id.slice(0, 6) + '…' + parsed.private_key_id.slice(-4)
        : undefined,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch (err) {
    return {
      isConfigured: false,
      error: err instanceof Error ? err.message : 'Invalid JSON',
    };
  }
}

function validateServiceAccount(parsed: unknown): {
  ok: boolean;
  reason?: string;
  clientEmail?: string;
  projectId?: string;
} {
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'Not a JSON object' };
  }
  const o = parsed as Record<string, unknown>;
  if (o.type !== 'service_account') {
    return { ok: false, reason: 'Field "type" must be "service_account"' };
  }
  if (typeof o.client_email !== 'string' || !o.client_email.includes('@')) {
    return { ok: false, reason: 'Field "client_email" missing or invalid' };
  }
  if (typeof o.private_key !== 'string' || !o.private_key.includes('PRIVATE KEY')) {
    return { ok: false, reason: 'Field "private_key" missing or invalid' };
  }
  return {
    ok: true,
    clientEmail: o.client_email,
    projectId: typeof o.project_id === 'string' ? o.project_id : undefined,
  };
}

export async function GET() {
  return NextResponse.json(readSummary());
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let rawText: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (file && typeof file !== 'string') {
        rawText = await (file as File).text();
      }
    } else if (contentType.includes('application/json')) {
      const body = await request.json() as { content?: string };
      if (typeof body.content === 'string') rawText = body.content;
    } else {
      rawText = await request.text();
    }

    if (!rawText || !rawText.trim()) {
      return NextResponse.json({ error: 'No content provided' }, { status: 400 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const validation = validateServiceAccount(parsed);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SA_PATH, rawText, { encoding: 'utf-8', mode: 0o600 });
    fs.chmodSync(SA_PATH, 0o600);

    return NextResponse.json({
      success: true,
      ...readSummary(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    if (fs.existsSync(SA_PATH)) {
      fs.unlinkSync(SA_PATH);
    }
    return NextResponse.json({ success: true, isConfigured: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
