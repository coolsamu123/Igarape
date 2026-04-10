import { NextRequest, NextResponse } from 'next/server';
import { getGoalsList, getGoalsExportCsv, getGoalsStatus, runGoalsAnalysis, runSingleGoalAnalysis, initGoalsSchema } from '@/lib/goals-analyzer';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'status') {
    return NextResponse.json(getGoalsStatus());
  }

  if (action === 'export') {
    const csv = getGoalsExportCsv();
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="project_goals.csv"',
      },
    });
  }

  // Default: list goals with optional filters
  initGoalsSchema();
  const region = searchParams.get('region') || undefined;
  const gate = searchParams.get('gate') || undefined;
  const status = searchParams.get('status') || undefined;

  const goals = getGoalsList({ region, gate, status });
  return NextResponse.json({ goals, total: goals.length });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'start';

    const status = getGoalsStatus();
    if (status.isRunning) {
      return NextResponse.json({ error: 'Analysis is already running' }, { status: 409 });
    }

    if (action === 'start_single') {
      if (!body.projectId) {
        return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
      }

      runSingleGoalAnalysis(body.projectId).catch(err => {
        console.error('Single goals analysis failed:', err);
      });

      return NextResponse.json({ message: 'Single analysis started', status: getGoalsStatus() });
    }

    // Default action: start full analysis
    runGoalsAnalysis().catch(err => {
      console.error('Goals analysis failed:', err);
    });

    return NextResponse.json({ message: 'Analysis started', status: getGoalsStatus() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
