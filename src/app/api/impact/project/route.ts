import { NextRequest, NextResponse } from 'next/server';
import { getProjectImpacts } from '@/lib/impact-engine';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: projectId' },
        { status: 400 }
      );
    }

    const impacts = getProjectImpacts(projectId);

    // Split into impacts where project is source vs target
    const asSource = impacts.filter(i => i.sourceProjectId === projectId);
    const asTarget = impacts.filter(i => i.targetProjectId === projectId);

    return NextResponse.json({
      projectId,
      impacts,
      asSource,
      asTarget,
      total: impacts.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
