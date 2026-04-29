import { NextRequest, NextResponse } from 'next/server';
import { runAutoDiscoveryCycle, isAutoCycleRunning, type CycleMode } from '@/lib/auto-pipeline';

export async function POST(request: NextRequest) {
  if (isAutoCycleRunning()) {
    return NextResponse.json({ error: 'Already running' }, { status: 409 });
  }

  let mode: CycleMode = 'full';
  try {
    const body = await request.json().catch(() => null) as { mode?: string } | null;
    if (body?.mode === 'goals-only') mode = 'goals-only';
  } catch { /* ignore */ }

  // Fire-and-forget. Client polls GET /api/auto-discovery for progress.
  runAutoDiscoveryCycle('manual', mode).catch(err => {
    console.error('[auto] manual cycle failed:', err);
  });

  return NextResponse.json({ success: true, message: `Cycle started (${mode})`, mode });
}
