/*
 * Builds an .xlsx test plan for the GIO-2026 portfolio so the team can
 * validate the impact analyses produced by the application.
 *
 * Layout:
 *   - Sheet "Per-Impact Validation"  : one row per generated impact relationship
 *   - Sheet "Per-Project Summary"    : one row per project, overall score
 *   - Sheet "Scoring Rubric"         : detailed 0–10 bands with examples
 *   - Sheet "Legend"                 : column descriptions + allowed values
 *
 * Output: /opt/strom/data/GIO_2026_Impact_Validation.xlsx
 */

const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const path = require('path');

const DB_PATH = '/opt/strom/data/cioo.db';
const OUT_PATH = '/opt/strom/data/GIO_2026_Impact_Validation.xlsx';

const db = new Database(DB_PATH, { readonly: true });

// ─── 1. Load GIO-2026 projects ──────────────────────────────────────────────

const projectRows = db.prepare(`
  SELECT project_id, name, dds, gate, review_date,
         description, remarks, cost_keur
  FROM projects
  WHERE dds = 'GIO' AND substr(review_date, 1, 4) = '2026'
  GROUP BY project_id
  ORDER BY review_date DESC, project_id
`).all();

// ─── 2. Load impacts for those projects ─────────────────────────────────────

const placeholders = projectRows.map(() => '?').join(',');
const impactRows = db.prepare(`
  SELECT id, source_project_id, target_project_id, impact_type, direction,
         severity, explanation, gio_services, dds_entities, created_at
  FROM projects_impact
  WHERE source_project_id IN (${placeholders})
  ORDER BY source_project_id,
           CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
`).all(...projectRows.map(p => p.project_id));

const parseArr = (raw) => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
};

const targetLabel = (targetId) => {
  if (targetId === 'GIO_SERVICES') return 'GIO Services (cross-cutting)';
  if (targetId === 'DDS_IMPACTS')  return 'DDS Entities (cross-cutting)';
  return targetId;
};

const projectName = new Map(projectRows.map(p => [p.project_id, p.name]));
const projectMeta = new Map(projectRows.map(p => [p.project_id, p]));

// ─── 3. Build "Per-Impact Validation" sheet ─────────────────────────────────

const perImpactHeaders = [
  // Context (read-only — pre-populated)
  'Project ID',
  'Project Name',
  'DDS',
  'Gate',
  'Review Date',
  'Impact #',
  'Target',
  'Impact Type',
  'Direction',
  'Severity (AI)',
  'GIO Services Touched',
  'DDS Entities Touched',
  'Reasoning (AI)',
  // To be filled by the reviewer
  'Reviewer',
  'Confidence (0–10)',
  'Verdict',
  'Suggested Severity (if different)',
  'Missing impacts / Comments',
];

const perImpactRows = [perImpactHeaders];

// Group impacts by project; emit a placeholder row for projects with zero impacts.
const impactsByProject = new Map();
for (const imp of impactRows) {
  if (!impactsByProject.has(imp.source_project_id)) impactsByProject.set(imp.source_project_id, []);
  impactsByProject.get(imp.source_project_id).push(imp);
}

for (const p of projectRows) {
  const list = impactsByProject.get(p.project_id) || [];
  if (list.length === 0) {
    perImpactRows.push([
      p.project_id, p.name, p.dds, p.gate, p.review_date,
      0,
      '(no impacts generated)',
      '', '', '', '', '',
      'The application generated no impact relationships for this project. Flag any impact the team believes should have been detected, in "Missing impacts / Comments".',
      '', '', '', '', '',
    ]);
    continue;
  }
  list.forEach((imp, idx) => {
    perImpactRows.push([
      p.project_id, p.name, p.dds, p.gate, p.review_date,
      idx + 1,
      targetLabel(imp.target_project_id) + (
        imp.target_project_id !== 'GIO_SERVICES' && imp.target_project_id !== 'DDS_IMPACTS' && projectName.has(imp.target_project_id)
          ? ` — ${projectName.get(imp.target_project_id)}`
          : ''
      ),
      imp.impact_type,
      imp.direction,
      imp.severity,
      parseArr(imp.gio_services).join(', '),
      parseArr(imp.dds_entities).join(', '),
      imp.explanation,
      '', '', '', '', '',
    ]);
  });
}

// ─── 4. Build "Per-Project Summary" sheet ───────────────────────────────────

const perProjectHeaders = [
  'Project ID',
  'Project Name',
  'DDS',
  'Gate',
  'Review Date',
  'Impacts: total',
  'Impacts: high',
  'Impacts: medium',
  'Impacts: low',
  'Touches GIO Services?',
  'Touches DDS Entities?',
  'Reviewer',
  'Overall Confidence (0–10)',
  'Coverage Verdict',
  'Reasoning Verdict',
  'Comments',
];

const perProjectRows = [perProjectHeaders];

for (const p of projectRows) {
  const list = impactsByProject.get(p.project_id) || [];
  const sev = { high: 0, medium: 0, low: 0 };
  let touchesGio = false, touchesDds = false;
  for (const imp of list) {
    if (sev[imp.severity] !== undefined) sev[imp.severity]++;
    if (imp.target_project_id === 'GIO_SERVICES' || parseArr(imp.gio_services).length) touchesGio = true;
    if (imp.target_project_id === 'DDS_IMPACTS'  || parseArr(imp.dds_entities).length)  touchesDds = true;
  }
  perProjectRows.push([
    p.project_id, p.name, p.dds, p.gate, p.review_date,
    list.length,
    sev.high, sev.medium, sev.low,
    touchesGio ? 'Yes' : 'No',
    touchesDds ? 'Yes' : 'No',
    '', '', '', '', '',
  ]);
}

// ─── 5. Build "Scoring Rubric" sheet ────────────────────────────────────────

const rubricRows = [
  ['Score', 'Band', 'What this score means', 'Symptoms that justify it', 'Recommended action'],

  ['0–2', 'Hallucinated',
    'The AI invented impacts, technologies, or reasoning that cannot be supported by the project documents.',
    [
      '• References projects, vendors, or systems that do not exist in the inputs.',
      '• Reasoning contradicts the source documents.',
      '• Impact relationships are pure fiction (e.g. claims a dependency on a system the project does not use).',
      '• Severity totally miscalibrated (high stamped on a no-touch case, or vice versa).',
    ].join('\n'),
    'Discard the impact. Re-run the analysis after the underlying Goals extraction is corrected. Flag the case to the platform team.',
  ],

  ['2–4', 'Poor',
    'The AI captured something real but the result is materially wrong and would mislead an executive.',
    [
      '• Wrong impact type (e.g. "blocks" when the projects are unrelated).',
      '• Reasoning is generic boilerplate ("both projects use cloud") without grounding in the specific docs.',
      '• Misses an obvious dependency a human reviewer spots in 30 seconds.',
      '• Severity off by two levels (high vs low).',
    ].join('\n'),
    'Reject and rewrite. Note the missing dependency in "Missing impacts" so the prompt or Goals fields can be improved.',
  ],

  ['4–6', 'Acceptable but needs work',
    'Partially useful. Direction is right; details are wrong, vague, or incomplete.',
    [
      '• Impact direction correct, but reasoning skips the "why".',
      '• Severity off by one level (high vs medium, or medium vs low).',
      '• Misses 1–2 secondary touchpoints that would matter to the GIO service line owner.',
      '• Reasoning cites a real Goals field but misinterprets it.',
    ].join('\n'),
    'Use with corrections. Update the suggested severity and write a clearer reasoning in comments. Useful as a draft.',
  ],

  ['6–8', 'Good',
    'The result is correct in substance and would be defensible in a review meeting with light editing.',
    [
      '• Impact relationship matches the team\'s mental model.',
      '• Reasoning is grounded in the project description / remarks / Goals fields.',
      '• Severity is calibrated within one notch of what the team would assign.',
      '• At most one minor inaccuracy (e.g. wrong vendor name) that does not change the conclusion.',
    ].join('\n'),
    'Approve with minor edits. Suggested as-is for the gate review pack.',
  ],

  ['8–10', 'Excellent',
    'Production-quality. The AI surfaced an impact the reviewer agrees with fully, with reasoning grounded in evidence.',
    [
      '• Identifies the right target (project / GIO service / DDS entity).',
      '• Reasoning cites specific document content or Goals fields the reviewer can verify.',
      '• Severity matches the reviewer\'s judgement.',
      '• No missing critical touchpoints; nothing to add.',
      '• A 10 means the reviewer would publish this as-is in an executive deck.',
    ].join('\n'),
    'Approve unchanged. Cite as a positive example when the platform team tunes prompts.',
  ],
];

// ─── 6. Build "Legend" sheet ────────────────────────────────────────────────

const legendRows = [
  ['Column', 'Sheet', 'Description', 'Allowed values'],

  ['Project ID',                   'Per-Impact Validation, Per-Project Summary', 'CIOO project identifier (PRJ…).', '(read-only)'],
  ['Project Name',                 'Per-Impact Validation, Per-Project Summary', 'Short project name from the CIOO sheet.', '(read-only)'],
  ['DDS',                          'Per-Impact Validation, Per-Project Summary', 'Owning DDS. All rows in this file are "GIO".', '(read-only)'],
  ['Gate',                         'Per-Impact Validation, Per-Project Summary', 'Current gate of the project at the latest review.', '(read-only)'],
  ['Review Date',                  'Per-Impact Validation, Per-Project Summary', 'Date of the latest CIOO review.', '(read-only)'],

  ['Impact #',                     'Per-Impact Validation', 'Sequential number within the project (1, 2, 3…). "0" marks a placeholder row when no impacts were generated.', '(read-only)'],
  ['Target',                       'Per-Impact Validation', 'The other side of the relationship: another project ID + name, or "GIO Services (cross-cutting)", or "DDS Entities (cross-cutting)".', '(read-only)'],
  ['Impact Type',                  'Per-Impact Validation', 'Category of the relationship the AI inferred.', 'technology_dependency, timeline_blocking, infrastructure_shared, security_dependency, regional_rollout, data_dependency, change_management, vendor_overlap'],
  ['Direction',                    'Per-Impact Validation', 'Directionality of the impact.', 'blocks, enables, feeds_data_to, competes_with, requires_coordination, supersedes'],
  ['Severity (AI)',                'Per-Impact Validation', 'Severity assigned by the AI.', 'high, medium, low'],
  ['GIO Services Touched',         'Per-Impact Validation', 'List of GIO Service Lines the AI flagged for this impact.', 'Subset of: Security & Compliance, Command Center, User Workplace, Site Infrastructure, Cloud Services'],
  ['DDS Entities Touched',         'Per-Impact Validation', 'List of DDS entities (regions / SBUs / app groups) the AI flagged.', 'Subset of the canonical DDS list (see Goals Extractor reference)'],
  ['Reasoning (AI)',               'Per-Impact Validation', 'Free-text justification produced by the model.', '(read-only)'],

  ['Reviewer',                     'Per-Impact Validation, Per-Project Summary', 'Name or initials of the team member who reviewed this row.', '(free text)'],
  ['Confidence (0–10)',            'Per-Impact Validation', 'Reviewer\'s overall confidence in this specific impact (target + type + direction + severity + reasoning, taken together). See the Scoring Rubric sheet for the band definitions.', 'Integer 0 to 10'],
  ['Verdict',                      'Per-Impact Validation', 'Single-word judgement of the impact relationship.', 'Correct, Partially correct, Wrong, Hallucinated, Missing context'],
  ['Suggested Severity (if different)', 'Per-Impact Validation', 'If the reviewer disagrees with the AI severity, leave the right value here. Empty = agree with the AI.', 'high, medium, low, or empty'],
  ['Missing impacts / Comments',   'Per-Impact Validation', 'Free-text. List impacts the AI failed to detect, document quotes that contradict the reasoning, or any nuance the team wants captured.', '(free text)'],

  ['Impacts: total',               'Per-Project Summary', 'Total number of impact rows generated by the AI for this project.', '(read-only)'],
  ['Impacts: high / medium / low', 'Per-Project Summary', 'Per-severity breakdown of the AI output for this project.', '(read-only)'],
  ['Touches GIO Services?',        'Per-Project Summary', 'Whether at least one impact links to a GIO Service Line.', '(read-only)'],
  ['Touches DDS Entities?',        'Per-Project Summary', 'Whether at least one impact links to a DDS entity.', '(read-only)'],
  ['Overall Confidence (0–10)',    'Per-Project Summary', 'Reviewer\'s aggregate confidence across all impacts for this project. Can differ from the average — penalises missing impacts and hallucinated impacts more than the per-row confidence does.', 'Integer 0 to 10'],
  ['Coverage Verdict',             'Per-Project Summary', 'Did the AI find ALL the impacts it should have found for this project?', 'Comprehensive, Partial, Sparse, Missed major impacts, Over-claimed'],
  ['Reasoning Verdict',            'Per-Project Summary', 'Across all rows, how well-grounded are the reasonings?', 'Solid, Mixed, Weak, Hallucinated'],
  ['Comments',                     'Per-Project Summary', 'Free-text overall feedback for the platform team.', '(free text)'],
];

// ─── 7. Compose and write workbook ──────────────────────────────────────────

const wb = XLSX.utils.book_new();

const ws1 = XLSX.utils.aoa_to_sheet(perImpactRows);
// Column widths — make the read-only context narrower and the editable text columns wider.
ws1['!cols'] = [
  { wch: 12 }, { wch: 38 }, { wch:  8 }, { wch:  6 }, { wch: 12 },
  { wch:  8 }, { wch: 34 }, { wch: 22 }, { wch: 22 }, { wch: 12 },
  { wch: 30 }, { wch: 26 }, { wch: 70 },
  { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 26 }, { wch: 60 },
];
ws1['!freeze'] = { xSplit: 2, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, ws1, 'Per-Impact Validation');

const ws2 = XLSX.utils.aoa_to_sheet(perProjectRows);
ws2['!cols'] = [
  { wch: 12 }, { wch: 42 }, { wch:  8 }, { wch:  6 }, { wch: 12 },
  { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 },
  { wch: 18 }, { wch: 18 },
  { wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 60 },
];
ws2['!freeze'] = { xSplit: 2, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, ws2, 'Per-Project Summary');

const ws3 = XLSX.utils.aoa_to_sheet(rubricRows);
ws3['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 60 }, { wch: 70 }, { wch: 60 }];
// Wrap text in symptom / action columns by setting cell-level wrap on those rows.
for (let r = 1; r < rubricRows.length; r++) {
  for (let c = 2; c <= 4; c++) {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (ws3[addr]) ws3[addr].s = { alignment: { wrapText: true, vertical: 'top' } };
  }
}
XLSX.utils.book_append_sheet(wb, ws3, 'Scoring Rubric');

const ws4 = XLSX.utils.aoa_to_sheet(legendRows);
ws4['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 70 }, { wch: 60 }];
XLSX.utils.book_append_sheet(wb, ws4, 'Legend');

XLSX.writeFile(wb, OUT_PATH);

// ─── 8. Console summary ─────────────────────────────────────────────────────

console.log(`Wrote ${OUT_PATH}`);
console.log(`  Projects (GIO, 2026): ${projectRows.length}`);
console.log(`  Impact rows         : ${impactRows.length}`);
console.log(`  Per-Impact rows     : ${perImpactRows.length - 1}  (incl. placeholders for projects with 0 impacts)`);
console.log(`  Per-Project rows    : ${perProjectRows.length - 1}`);
console.log(`  Rubric bands        : ${rubricRows.length - 1}`);
console.log(`  Legend rows         : ${legendRows.length - 1}`);
