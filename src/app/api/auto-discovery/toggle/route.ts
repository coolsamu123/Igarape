import { NextRequest, NextResponse } from 'next/server';
import { setWatchRootEnabled, listWatchRoots } from '@/lib/auto-pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { id?: number; enabled?: boolean };
    if (typeof body.id !== 'number' || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Missing id or enabled' }, { status: 400 });
    }
    setWatchRootEnabled(body.id, body.enabled);
    return NextResponse.json({ success: true, roots: listWatchRoots() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
