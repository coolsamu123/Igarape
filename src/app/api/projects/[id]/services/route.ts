import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    const projectId = params.id;
    const { services } = await request.json();

    if (!Array.isArray(services)) {
      return NextResponse.json({ error: 'Invalid services payload' }, { status: 400 });
    }

    const servicesJson = JSON.stringify(services);

    // Update all entries for this projectId (so history is consistent, or just update the latest)
    db.prepare('UPDATE projects SET services = ? WHERE project_id = ?').run(servicesJson, projectId);

    return NextResponse.json({ success: true, services });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
