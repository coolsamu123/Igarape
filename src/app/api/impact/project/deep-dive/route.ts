import { NextRequest, NextResponse } from 'next/server';
import { getOrGenerateDeepDive, listDeepDivesForProject, type DeepDiveKind } from '@/lib/deep-dive-engine';

// POST — get-or-generate a single deep dive.
// Body: { projectId: string, kind: 'gio' | 'dds', target: string }
// Returns the cached or freshly-generated deep dive.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { projectId?: string; kind?: string; target?: string };
    const { projectId, kind, target } = body;

    if (!projectId || !kind || !target) {
      return NextResponse.json(
        { error: 'Missing required fields: projectId, kind, target' },
        { status: 400 }
      );
    }
    if (kind !== 'gio' && kind !== 'dds') {
      return NextResponse.json(
        { error: `Invalid kind "${kind}". Must be "gio" or "dds".` },
        { status: 400 }
      );
    }

    const result = await getOrGenerateDeepDive({
      projectId,
      kind: kind as DeepDiveKind,
      target,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — list all cached deep dives for a project (no LLM call).
// Query: ?projectId=PRJ...

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'Missing required query: projectId' }, { status: 400 });
    }
    const items = listDeepDivesForProject(projectId);
    return NextResponse.json({ items });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
