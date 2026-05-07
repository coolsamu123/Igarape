import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getProjectDocuments } from '@/lib/drive-engine';
import { getProjectImpacts, aggregateImpacts } from '@/lib/impact-engine';
import type { ProjectImpact } from '@/lib/types';

const DOC_EXCERPT_LEN = 800;

interface ProjectEvidence {
  project: {
    projectId: string;
    name: string;
    dds: string;
    currentGate: string;
    decision: string;
    decisionMode: string;
    description: string;
    remarks: string;
    qa: string;
    costKEur: number | null;
    reviewDate: string;
    participants: string;
    links: { folder: string; positions: string; cioo: string };
    history: Array<{ gate: string; decision: string; reviewDate: string }>;
  };
  goals: {
    digitalTechnologies: string;
    changeManagement: string;
    securityImpacts: string;
    regionalImpacts: string;
    iaEmbedded: string;
    gioSlDdsImpacts: string;
    ddsGioWorkload: string;
    businessAppsCis: string;
    region: string;
    monthFolder: string;
    analyzedAt: string;
    sourceFiles: string[];
    rawGeminiResponse: string;
    status: string;
  } | null;
  documents: Array<{
    url: string;
    contentType: string;
    fetchStatus: string;
    excerpt: string;
    fullLength: number;
  }>;
  impacts: {
    gio: ProjectImpact | null;
    dds: ProjectImpact | null;
  };
}

interface ProjectRow {
  project_id: string;
  name: string;
  dds: string;
  gate: string;
  decision: string;
  decision_mode: string;
  description: string;
  remarks: string;
  qa: string;
  cost_keur: number | null;
  review_date: string;
  participants: string;
  link_folder: string;
  link_positions: string;
  link_cioo: string;
}

interface GoalsRow {
  digital_technologies: string;
  change_management: string;
  security_impacts: string;
  regional_impacts: string;
  ia_embedded: string;
  gio_sl_dds_impacts: string;
  dds_gio_workload: string;
  business_apps_cis: string;
  region: string;
  month_folder: string;
  analyzed_at: string;
  source_files: string;
  raw_gemini_response: string;
  status: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'Missing required query parameter: projectId' }, { status: 400 });
    }

    const db = getDb();

    // 1) Latest project row (most recent review). Carry the rest separately.
    const latestRow = db.prepare(`
      SELECT project_id, name, dds, gate, decision, decision_mode, description, remarks, qa,
             cost_keur, review_date, participants, link_folder, link_positions, link_cioo
      FROM projects
      WHERE project_id = ?
      ORDER BY review_date DESC, id DESC
      LIMIT 1
    `).get(projectId) as ProjectRow | undefined;

    if (!latestRow) {
      return NextResponse.json({ error: `Project ${projectId} not found` }, { status: 404 });
    }

    // 2) History rows — all gate reviews for this project, newest first.
    const historyRows = db.prepare(`
      SELECT gate, decision, review_date FROM projects
      WHERE project_id = ?
      ORDER BY review_date DESC, id DESC
    `).all(projectId) as Array<{ gate: string; decision: string; review_date: string }>;

    // 3) Goals analysis (latest by analyzed_at).
    const goalsRow = db.prepare(`
      SELECT digital_technologies, change_management, security_impacts, regional_impacts,
             ia_embedded, gio_sl_dds_impacts, dds_gio_workload, business_apps_cis,
             region, month_folder, analyzed_at, source_files, raw_gemini_response, status
      FROM project_goals
      WHERE project_id = ?
      ORDER BY analyzed_at DESC
      LIMIT 1
    `).get(projectId) as GoalsRow | undefined;

    // 4) Documents (excerpts only)
    const docs = getProjectDocuments(projectId).map(d => ({
      url: d.url,
      contentType: '',
      fetchStatus: d.status,
      excerpt: (d.content || '').slice(0, DOC_EXCERPT_LEN),
      fullLength: (d.content || '').length,
    }));

    // 5) Impact rows aggregated for this project, split by kind
    const aggregated = aggregateImpacts(getProjectImpacts(projectId));
    const gio = aggregated.find(i =>
      i.targetProjectId === 'GIO_SERVICES' || i.sourceProjectId === 'GIO_SERVICES'
    ) ?? null;
    const dds = aggregated.find(i =>
      i.targetProjectId === 'DDS_IMPACTS' || i.sourceProjectId === 'DDS_IMPACTS'
    ) ?? null;

    let sourceFilesList: string[] = [];
    if (goalsRow?.source_files) {
      try { sourceFilesList = JSON.parse(goalsRow.source_files) as string[]; } catch { /* ignore */ }
    }

    const evidence: ProjectEvidence = {
      project: {
        projectId: latestRow.project_id,
        name: latestRow.name,
        dds: latestRow.dds || '',
        currentGate: latestRow.gate || '',
        decision: latestRow.decision || '',
        decisionMode: latestRow.decision_mode || '',
        description: latestRow.description || '',
        remarks: latestRow.remarks || '',
        qa: latestRow.qa || '',
        costKEur: latestRow.cost_keur,
        reviewDate: latestRow.review_date || '',
        participants: latestRow.participants || '',
        links: {
          folder: latestRow.link_folder || '',
          positions: latestRow.link_positions || '',
          cioo: latestRow.link_cioo || '',
        },
        history: historyRows.map(h => ({
          gate: h.gate || '',
          decision: h.decision || '',
          reviewDate: h.review_date || '',
        })),
      },
      goals: goalsRow ? {
        digitalTechnologies: goalsRow.digital_technologies || '',
        changeManagement: goalsRow.change_management || '',
        securityImpacts: goalsRow.security_impacts || '',
        regionalImpacts: goalsRow.regional_impacts || '',
        iaEmbedded: goalsRow.ia_embedded || '',
        gioSlDdsImpacts: goalsRow.gio_sl_dds_impacts || '',
        ddsGioWorkload: goalsRow.dds_gio_workload || '',
        businessAppsCis: goalsRow.business_apps_cis || '',
        region: goalsRow.region || '',
        monthFolder: goalsRow.month_folder || '',
        analyzedAt: goalsRow.analyzed_at || '',
        sourceFiles: sourceFilesList,
        rawGeminiResponse: goalsRow.raw_gemini_response || '',
        status: goalsRow.status || '',
      } : null,
      documents: docs,
      impacts: { gio, dds },
    };

    return NextResponse.json(evidence);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
