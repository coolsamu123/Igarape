import { NextRequest, NextResponse } from 'next/server';
import {
  runFullImpactAnalysis,
  getImpactStatus,
  getAllImpacts,
  clearAllImpacts,
} from '@/lib/impact-engine';

export async function GET() {
  try {
    const impacts = getAllImpacts();
    const status = getImpactStatus();

    // Compute stats
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byDirection: Record<string, number> = {};

    for (const imp of impacts) {
      bySeverity[imp.severity] = (bySeverity[imp.severity] || 0) + 1;
      byType[imp.impactType] = (byType[imp.impactType] || 0) + 1;
      byDirection[imp.direction] = (byDirection[imp.direction] || 0) + 1;
    }

    return NextResponse.json({
      impacts,
      stats: {
        total: impacts.length,
        bySeverity,
        byType,
        byDirection,
      },
      status,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'status') {
      const status = getImpactStatus();
      return NextResponse.json({ status });
    }

    if (action === 'clear') {
      const status = getImpactStatus();
      if (status.isRunning) {
        return NextResponse.json(
          { error: 'Cannot clear impacts while an analysis is running', status },
          { status: 409 }
        );
      }
      const deleted = clearAllImpacts();
      return NextResponse.json({
        message: `Cleared ${deleted} impacts`,
        deleted,
        status: getImpactStatus(),
      });
    }

    if (action === 'start') {
      const status = getImpactStatus();
      if (status.isRunning) {
        return NextResponse.json(
          { error: 'Analysis is already running', status },
          { status: 409 }
        );
      }

      // Fire and forget — runs in background
      runFullImpactAnalysis().catch((err) => {
        console.error('Impact analysis failed:', err);
      });

      // Return immediately with initial status
      const newStatus = getImpactStatus();
      return NextResponse.json({
        message: 'Impact analysis started',
        status: newStatus,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "start", "status", or "clear".' },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
