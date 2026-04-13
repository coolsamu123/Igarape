import { NextRequest, NextResponse } from 'next/server';
import { getImpactQueryPreview } from '@/lib/impact-engine';

export async function GET(request: NextRequest) {
  try {
    const mode = request.nextUrl.searchParams.get('mode') === 'grouped' ? 'grouped' : 'raw';
    const preview = getImpactQueryPreview(mode);
    return NextResponse.json({ success: true, ...preview });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}