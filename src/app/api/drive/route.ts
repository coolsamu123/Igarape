import { NextRequest, NextResponse } from 'next/server';
import {
  runDriveDownload,
  getDriveStatus,
  getAllDocumentTexts,
} from '@/lib/drive-engine';

export async function GET() {
  try {
    const status = getDriveStatus();
    const docs = getAllDocumentTexts();

    return NextResponse.json({
      status,
      documentCount: docs.size,
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
      const status = getDriveStatus();
      return NextResponse.json({ status });
    }

    if (action === 'start') {
      const status = getDriveStatus();
      if (status.isRunning) {
        return NextResponse.json(
          { error: 'Drive download is already running', status },
          { status: 409 }
        );
      }

      // Fire and forget
      runDriveDownload().catch((err) => {
        console.error('Drive download failed:', err);
      });

      const newStatus = getDriveStatus();
      return NextResponse.json({
        message: 'Drive download started',
        status: newStatus,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "start" or "status".' },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
