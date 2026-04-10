import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const MAPPINGS_FILE = path.join(process.cwd(), 'data', 'service_mappings.json');

export async function GET() {
  try {
    let mappings: { domain: string; owner: string }[] = [];
    if (fs.existsSync(MAPPINGS_FILE)) {
      mappings = JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf-8'));
    }
    return NextResponse.json({ mappings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { mappings } = await request.json();
    
    if (!Array.isArray(mappings)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Ensure data dir exists
    const dir = path.dirname(MAPPINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(mappings, null, 2), 'utf-8');

    return NextResponse.json({ success: true, mappings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
