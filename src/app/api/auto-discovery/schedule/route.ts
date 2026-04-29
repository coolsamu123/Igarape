import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveSchedules, updateFullCron, updateGoalsCron } from '@/lib/scheduler';

export async function GET() {
  return NextResponse.json(getEffectiveSchedules());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      fullCron?: string | null;
      goalsCron?: string | null;
    };

    let effective = getEffectiveSchedules();

    if (Object.prototype.hasOwnProperty.call(body, 'fullCron')) {
      effective = updateFullCron(body.fullCron === null ? null : (body.fullCron ?? null));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'goalsCron')) {
      effective = updateGoalsCron(body.goalsCron === null ? null : (body.goalsCron ?? null));
    }

    return NextResponse.json({ success: true, ...effective });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
