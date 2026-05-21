import { NextRequest, NextResponse } from 'next/server';
import {
  runSyncAll,
  requestStopSyncAll,
  resetSyncAllState,
  isSyncAllRunning,
  getSyncAllState,
} from '@/lib/drive-sync-all';

// POST          → start a Sync-all run (fire-and-forget, status flows via SSE).
// DELETE        → request stop; in-flight files finish, the rest is marked skipped.
// DELETE ?force → hard reset, used to unstick a crashed run.
// GET           → snapshot, used for debugging or initial render before SSE catches up.

export async function POST() {
  if (isSyncAllRunning()) {
    return NextResponse.json(
      { error: 'Sync all is already running', state: getSyncAllState() },
      { status: 409 },
    );
  }
  runSyncAll().catch(err => {
    // Log but don't throw — the runner mutates its module state to reflect
    // failure, and the SSE will surface it to the client.
    console.error('[sync-all] runSyncAll threw:', err);
  });
  return NextResponse.json({ ok: true, state: getSyncAllState() });
}

export async function DELETE(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('force') === '1';
  if (force) {
    resetSyncAllState();
    return NextResponse.json({ ok: true, reset: true, state: getSyncAllState() });
  }
  const { stopped } = requestStopSyncAll();
  return NextResponse.json({ ok: true, stopped, state: getSyncAllState() });
}

export async function GET() {
  return NextResponse.json(getSyncAllState());
}
