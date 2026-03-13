import { NextRequest, NextResponse } from 'next/server';
import { analyzePairwise, analyzeCluster } from '@/lib/gemini';
import type { ProjectSummary } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, projects } = body as {
      type: 'pairwise' | 'cluster';
      projects: ProjectSummary[];
    };

    if (!projects || projects.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 projects required for analysis' },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured. Add it to .env.local' },
        { status: 500 }
      );
    }

    let result;
    if (type === 'pairwise' && projects.length === 2) {
      result = await analyzePairwise(projects[0], projects[1]);
    } else {
      result = await analyzeCluster(projects);
    }

    return NextResponse.json({ analysis: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
