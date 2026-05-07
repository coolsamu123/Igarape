import { NextResponse } from 'next/server';
import { buildDrivePanelState } from '@/lib/drive-panel-state';

export async function GET() {
  try {
    return NextResponse.json(buildDrivePanelState());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
