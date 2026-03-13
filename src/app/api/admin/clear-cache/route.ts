import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST() {
  try {
    const db = getDb();

    const analyses = (db.prepare('SELECT COUNT(*) as count FROM analysis_cache').get() as { count: number }).count;
    const documents = (db.prepare('SELECT COUNT(*) as count FROM documents_cache').get() as { count: number }).count;

    db.exec('DELETE FROM analysis_cache');
    db.exec('DELETE FROM documents_cache');

    return NextResponse.json({
      success: true,
      deletedAnalyses: analyses,
      deletedDocuments: documents,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
