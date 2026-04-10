import { NextRequest, NextResponse } from 'next/server';
import {
  runDriveDownload,
  runDriveDownloadSingle,
  discoverAndAddProjectFromDrive,
  getDriveStatus,
  getAllDocumentTexts,
  getProjectLocalPath,
} from '@/lib/drive-engine';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const status = getDriveStatus();
    const docs = getAllDocumentTexts();
    
    // Get all projects and resolve their local paths
    const db = getDb();
    const rows = db.prepare('SELECT project_id FROM projects').all() as { project_id: string }[];
    const localPaths: Record<string, string> = {};
    for (const row of rows) {
      const p = getProjectLocalPath(row.project_id);
      if (p) {
        localPaths[row.project_id] = p;
      }
    }

    return NextResponse.json({
      status,
      documentCount: docs.size,
      localPaths,
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

      runDriveDownload().catch((err) => {
        console.error('Drive download failed:', err);
      });

      return NextResponse.json({
        message: 'Drive download started',
        status: getDriveStatus(),
      });
    }

    if (action === 'start_single') {
      const status = getDriveStatus();
      if (status.isRunning) {
        return NextResponse.json(
          { error: 'Drive download is already running', status },
          { status: 409 }
        );
      }

      if (!body.projectId) {
        return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
      }

      runDriveDownloadSingle(body.projectId).catch((err) => {
        console.error('Single drive download failed:', err);
      });

      return NextResponse.json({
        message: 'Single project drive download started',
        status: getDriveStatus(),
      });
    }

    
    if (action === 'add_link') {
      if (!body.projectId || !body.url) {
        return NextResponse.json({ error: 'Missing projectId or url' }, { status: 400 });
      }

      const db = getDb();
      const row = db.prepare('SELECT link_folder FROM projects WHERE project_id = ?').get(body.projectId) as { link_folder: string } | undefined;
      
      if (!row) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      const newLinkFolder = row.link_folder ? `${row.link_folder} ${body.url}` : body.url;
      
      db.prepare('UPDATE projects SET link_folder = ? WHERE project_id = ?').run(newLinkFolder, body.projectId);

      // Trigger download for this project
      const status = getDriveStatus();
      if (!status.isRunning) {
        runDriveDownloadSingle(body.projectId).catch(() => {});
      }

      return NextResponse.json({ message: 'Link added successfully' });
    }

    if (action === 'discover') {
      if (!body.url) {
        return NextResponse.json({ error: 'Missing url' }, { status: 400 });
      }

      const project = await discoverAndAddProjectFromDrive(body.url);
      
      // Auto-start download for this newly discovered project
      const status = getDriveStatus();
      if (!status.isRunning && project) {
        runDriveDownloadSingle(project.projectId).catch((err) => {
           console.error('Auto download failed:', err);
        });
      }

      return NextResponse.json({
        message: 'Project discovered and added',
        project,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action.' },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
