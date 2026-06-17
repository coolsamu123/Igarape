import { NextRequest, NextResponse } from 'next/server';
import { getOrGenerateDeepDive, listDeepDivesForProject, type DeepDiveKind } from '@/lib/deep-dive-engine';

// POST — get-or-generate a single deep dive.
// Body: { projectId: string, kind: 'gio' | 'dds' | 'project', target: string }
// kind='project' narrates a project↔project edge — target is the other PRJ id.
// Returns the cached or freshly-generated deep dive.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { projectId?: string; kind?: string; target?: string; force?: boolean };
    const { projectId, kind, target, force } = body;

    if (!projectId || !kind || !target) {
      return NextResponse.json(
        { error: 'Missing required fields: projectId, kind, target' },
        { status: 400 }
      );
    }
    if (kind !== 'gio' && kind !== 'dds' && kind !== 'project') {
      return NextResponse.json(
        { error: `Invalid kind "${kind}". Must be "gio", "dds", or "project".` },
        { status: 400 }
      );
    }

    const result = await getOrGenerateDeepDive({
      projectId,
      kind: kind as DeepDiveKind,
      target,
      force: force === true,
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
