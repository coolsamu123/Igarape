'use client';

import { useState, useEffect } from 'react';

const QUERIES = {
  drive: `/* 
 * STEP 1: DRIVE SYNC ENGINE
 * ---------------------------------------------------------
 * This query runs first to find all projects that have 
 * linked Google Drive folders. It searches across multiple
 * URL columns (link_folder, link_positions, link_cioo).
 */
SELECT DISTINCT 
  p.project_id, 
  p.name,
  p.link_folder, 
  p.link_positions, 
  p.link_cioo
FROM projects p
WHERE p.link_folder LIKE '%drive.google.com%'
   OR p.link_positions LIKE '%drive.google.com%'
   OR p.link_cioo LIKE '%drive.google.com%';

/* 
 * After downloading the files via the Google Drive API,
 * we cache the extracted text directly into the DB to 
 * save time on future runs.
 */
INSERT OR REPLACE INTO documents_cache (
  url,           -- The origin G-Drive folder/file URL
  content_text,  -- The raw extracted text (PDF/DOCX/XLSX)
  content_type,  -- Mime type
  fetch_status   -- 'success' or 'error'
) VALUES (?, ?, ?, 'success');`,

  goals: `/* 
 * STEP 2: GOALS EXTRACTOR (AI)
 * ---------------------------------------------------------
 * First, we fetch the previously cached text for the project 
 * by joining the documents_cache with the projects table.
 */
SELECT 
  dc.url, 
  dc.content_text, 
  dc.fetch_status 
FROM documents_cache dc
INNER JOIN projects p ON (
  p.link_folder = dc.url OR 
  p.link_positions = dc.url OR 
  p.link_cioo = dc.url
)
WHERE p.project_id = ? AND dc.fetch_status = 'success';

/* 
 * After sending the text + metadata to Gemini 2.5 Pro, 
 * we save the structured insights back into project_goals.
 */
INSERT INTO project_goals (
  project_id, project_name, region, gate, month_folder,
  digital_technologies, change_management, security_impacts,
  regional_impacts, ia_embedded, gio_sl_dds_impacts,
  dds_gio_workload, business_apps_cis,
  raw_gemini_response, source_files, status, error_message
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
ON CONFLICT(project_id) DO UPDATE SET
  digital_technologies = excluded.digital_technologies,
  gio_sl_dds_impacts = excluded.gio_sl_dds_impacts,
  status = excluded.status,
  analyzed_at = datetime('now');`,

  impact: `/* 
 * STEP 3: IMPACT ANALYSIS ENGINE
 * ---------------------------------------------------------
 * We fetch all projects that were successfully analyzed by 
 * the Goals Extractor. We LEFT JOIN the core projects table 
 * to pull in budgetary data and division (DDS) info.
 */
SELECT 
  g.id as goal_id, g.project_id, g.project_name, g.region, 
  g.gate as goal_gate, g.digital_technologies, 
  g.change_management, g.security_impacts, 
  g.gio_sl_dds_impacts, g.dds_gio_workload, g.business_apps_cis,
  p.dds, p.decision, p.cost_keur, p.description, p.remarks
FROM project_goals g
LEFT JOIN projects p ON g.project_id = p.project_id
WHERE g.project_id != '' AND g.status = 'success'
ORDER BY g.project_id, p.review_date DESC;

/* 
 * Gemini evaluates the enriched data in batches and returns
 * a directional graph of impacts. These are saved here:
 */
INSERT OR REPLACE INTO projects_impact (
  source_project_id, 
  target_project_id, 
  impact_type, 
  direction, 
  severity, 
  explanation, 
  batch_id, 
  gio_services
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
};

// Helper to colorize SQL simply
function colorizeSql(sql: string) {
  return sql.split('\n').map((line, i) => {
    // Comment lines
    if (line.trim().startsWith('/*') || line.trim().startsWith('*') || line.trim().startsWith('--')) {
      return <div key={i} className="text-gray-500 italic">{line}</div>;
    }
    
    // Highlight keywords
    const keywords = ['SELECT', 'DISTINCT', 'FROM', 'WHERE', 'LIKE', 'OR', 'AND', 'INSERT', 'INTO', 'REPLACE', 'VALUES', 'INNER', 'JOIN', 'ON', 'CONFLICT', 'DO', 'UPDATE', 'SET', 'LEFT', 'ORDER', 'BY', 'DESC', 'ASC'];
    
    let formatted = line;
    keywords.forEach(kw => {
      const regex = new RegExp(`\\b${kw}\\b`, 'g');
      formatted = formatted.replace(regex, `<span class="text-purple-400 font-semibold">${kw}</span>`);
    });

    // Highlight strings
    formatted = formatted.replace(/'[^']*'/g, match => `<span class="text-green-400">${match}</span>`);

    return <div key={i} dangerouslySetInnerHTML={{ __html: formatted || '&nbsp;' }} />;
  });
}

export default function ArchFlowView() {
  const [prompts, setPrompts] = useState({ goalsPrompt: '', impactPrompt: '' });
  const [isEditingGoals, setIsEditingGoals] = useState(false);
  const [isEditingImpact, setIsEditingImpact] = useState(false);
  const [activeQuery, setActiveQuery] = useState<'drive' | 'goals' | 'impact' | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch('/api/prompts')
      .then(res => res.json())
      .then(data => setPrompts(data))
      .catch(err => console.error('Failed to load prompts:', err));
  }, []);

  const handleSave = async (type: 'goals' | 'impact') => {
    setIsSaving(true);
    try {
      await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prompts),
      });
      if (type === 'goals') setIsEditingGoals(false);
      if (type === 'impact') setIsEditingImpact(false);
    } catch (err) {
      console.error('Failed to save prompt:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-[#0a0e1a] p-8 text-gray-200">
      <div className="max-w-5xl mx-auto">
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-bold text-white mb-4">CIOO Intelligence Pipeline Architecture</h1>
          <p className="text-gray-400">
            A comprehensive overview of how data flows from external systems, gets analyzed by AI, and produces portfolio insights.
          </p>
        </div>

        {/* Outer container for the flow */}
        <div className="relative flex flex-col items-center gap-6">

          {/* Flow Step 1: Data Sources */}
          <div className="flex w-full gap-8 justify-center z-10 relative">
            
            {/* Google Drive Source */}
            <div className="w-1/3 bg-gray-800/50 border border-blue-500/30 rounded-xl p-5 shadow-lg relative">
              <div className="flex items-center gap-3 mb-3 border-b border-gray-700 pb-3">
                <span className="text-2xl">☁️</span>
                <h3 className="font-semibold text-blue-400 text-lg">Google Drive</h3>
              </div>
              <div className="space-y-2 text-sm text-gray-300">
                <p><strong>From where:</strong> Specified G-Drive folders and shared drives.</p>
                <p><strong>Content:</strong> Gate presentations, meeting minutes, architecture diagrams (.docx, .pdf, .xlsx, .txt).</p>
              </div>
              {/* Arrow pointing down */}
              <div className="absolute -bottom-6 left-1/2 -ml-px w-0.5 h-6 bg-blue-500/50" />
            </div>

            {/* ServiceNow Source */}
            <div className="w-1/3 bg-gray-800/50 border border-purple-500/30 rounded-xl p-5 shadow-lg relative">
              <div className="flex items-center gap-3 mb-3 border-b border-gray-700 pb-3">
                <span className="text-2xl">📊</span>
                <h3 className="font-semibold text-purple-400 text-lg">ServiceNow</h3>
              </div>
              <div className="space-y-2 text-sm text-gray-300">
                <p><strong>From where:</strong> ServiceNow portfolio exports (CSV format).</p>
                <p><strong>Content:</strong> Core project metadata, budgets, gate status, ownership, and basic descriptions.</p>
              </div>
            </div>

          </div>

          {/* Flow Step 2: Drive Sync */}
          <div className="w-2/3 bg-[#0d1117] border border-blue-500/50 rounded-xl p-6 shadow-xl z-10 relative">
            <div className="absolute top-0 left-1/4 w-0.5 h-6 bg-blue-500/50 -mt-6" />
            
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xl bg-blue-900/50 p-2 rounded-lg">🔄</span>
              <h2 className="text-xl font-bold text-blue-300">1. Drive Sync Engine</h2>
            </div>
            
            <div className="grid grid-cols-2 gap-6 text-sm">
              <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                <h4 className="font-semibold text-gray-200 mb-2">How it works</h4>
                <ul className="list-disc pl-4 space-y-1 text-gray-400 mb-3">
                  <li>Authenticates via Google Service Account.</li>
                  <li>Recursively scans folders matching Project IDs (e.g., PRJ001234).</li>
                  <li>Downloads supported file formats locally to the filesystem.</li>
                  <li>Updates the SQLite <code className="text-blue-300 bg-blue-900/30 px-1 rounded">documents_cache</code> table.</li>
                </ul>
              </div>
              <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                <h4 className="font-semibold text-gray-200 mb-2">Data Output</h4>
                <p className="text-gray-400 mb-2">Local File System (<code className="text-pink-300">data/drive/...</code>)</p>
                <p className="text-gray-400 mb-3">SQLite Database (<code className="text-pink-300">cioo.db</code>)</p>
              </div>
            </div>

            <div className="flex justify-center mt-4">
              <button 
                onClick={() => setActiveQuery(activeQuery === 'drive' ? null : 'drive')}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-blue-900/40 hover:bg-blue-800/60 border border-blue-500/50 text-blue-300 transition-colors"
              >
                {activeQuery === 'drive' ? 'Hide Queries' : 'Check Full Queries'}
              </button>
            </div>

            {activeQuery === 'drive' && (
              <div className="mt-4 animate-fade-in bg-[#0a0e1a] p-4 rounded-lg border border-gray-700">
                <div className="font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                  {colorizeSql(QUERIES.drive)}
                </div>
              </div>
            )}
            
            <div className="absolute -bottom-8 left-1/2 -ml-px w-0.5 h-8 bg-gradient-to-b from-blue-500/50 to-green-500/50" />
          </div>

          {/* Arrow connecting ServiceNow to Goals Extractor */}
          <div className="absolute top-[180px] right-1/4 w-0.5 h-[230px] bg-purple-500/50 z-0" />
          <div className="absolute top-[410px] right-1/4 w-[25%] h-0.5 bg-gradient-to-r from-green-500/50 to-purple-500/50 z-0" />

          {/* Flow Step 3: Goals Extractor */}
          <div className="w-2/3 bg-[#0d1117] border border-green-500/50 rounded-xl p-6 shadow-xl mt-4 z-10 relative">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <span className="text-xl bg-green-900/50 p-2 rounded-lg">🧠</span>
                <h2 className="text-xl font-bold text-green-300">2. Goals Extractor (AI)</h2>
              </div>
              <button 
                onClick={() => setIsEditingGoals(!isEditingGoals)}
                className="px-3 py-1 text-xs font-medium rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 transition-colors"
              >
                {isEditingGoals ? 'Cancel Edit' : 'Edit Prompt'}
              </button>
            </div>
            
            {!isEditingGoals ? (
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                  <h4 className="font-semibold text-gray-200 mb-2">How it works</h4>
                  <ul className="list-disc pl-4 space-y-1 text-gray-400 mb-3">
                    <li>Parses text from downloaded PDFs, DOCX, XLSX files using specialized extractors.</li>
                    <li>Combines file content with ServiceNow CSV metadata.</li>
                    <li>Prompts <strong>Gemini 2.0 Flash</strong> to extract deep insights.</li>
                  </ul>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                  <h4 className="font-semibold text-gray-200 mb-2">Data Output</h4>
                  <p className="text-gray-400 mb-2">Structured AI insights stored in SQLite.</p>
                  <p className="text-gray-400 mb-3">Table: <code className="text-pink-300 bg-pink-900/30 px-1 rounded">project_goals</code></p>
                </div>
              </div>
            ) : (
              <div className="mt-4 transition-all duration-300">
                <div className="mb-2 text-xs text-gray-400 flex justify-between">
                  <span>System Prompt (Gemini 2.5 Pro)</span>
                  <span className="text-green-400">Variables: {'{{PROJECT_INFO}}'}, {'{{DOCUMENT_TEXT}}'}</span>
                </div>
                <textarea
                  value={prompts.goalsPrompt}
                  onChange={(e) => setPrompts({ ...prompts, goalsPrompt: e.target.value })}
                  className="w-full h-80 bg-[#0a0e1a] text-green-300 font-mono text-xs p-4 rounded-lg border border-green-500/30 focus:border-green-500 focus:outline-none resize-y"
                  spellCheck={false}
                />
                <div className="flex justify-end mt-3">
                  <button
                    onClick={() => handleSave('goals')}
                    disabled={isSaving}
                    className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-md shadow-lg transition-colors disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save Prompt'}
                  </button>
                </div>
              </div>
            )}

            {!isEditingGoals && (
              <>
                <div className="flex justify-center mt-4">
                  <button 
                    onClick={() => setActiveQuery(activeQuery === 'goals' ? null : 'goals')}
                    className="px-4 py-1.5 text-xs font-semibold rounded bg-green-900/40 hover:bg-green-800/60 border border-green-500/50 text-green-300 transition-colors"
                  >
                    {activeQuery === 'goals' ? 'Hide Queries' : 'Check Full Queries'}
                  </button>
                </div>
                {activeQuery === 'goals' && (
                  <div className="mt-4 animate-fade-in bg-[#0a0e1a] p-4 rounded-lg border border-gray-700">
                    <div className="font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                      {colorizeSql(QUERIES.goals)}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="absolute -bottom-8 left-1/2 -ml-px w-0.5 h-8 bg-gradient-to-b from-green-500/50 to-orange-500/50" />
          </div>

          {/* Flow Step 4: Impact Analysis */}
          <div className="w-2/3 bg-[#0d1117] border border-orange-500/50 rounded-xl p-6 shadow-xl mt-4 z-10 relative mb-12">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <span className="text-xl bg-orange-900/50 p-2 rounded-lg">🕸️</span>
                <h2 className="text-xl font-bold text-orange-300">3. Impact Analysis Engine</h2>
              </div>
              <button 
                onClick={() => setIsEditingImpact(!isEditingImpact)}
                className="px-3 py-1 text-xs font-medium rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 transition-colors"
              >
                {isEditingImpact ? 'Cancel Edit' : 'Edit Prompt'}
              </button>
            </div>
            
            {!isEditingImpact ? (
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                  <h4 className="font-semibold text-gray-200 mb-2">How it works</h4>
                  <ul className="list-disc pl-4 space-y-1 text-gray-400 mb-3">
                    <li>Reads the enriched <code className="text-pink-300">project_goals</code> and <code className="text-pink-300">projects</code> tables.</li>
                    <li>Groups projects by Division (DDS) and cross-DDS top spenders into batches.</li>
                    <li>Prompts <strong>Gemini 2.0 Flash</strong> to identify overlapping technologies, shared infrastructure, and timeline blockers.</li>
                  </ul>
                </div>
                <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                  <h4 className="font-semibold text-gray-200 mb-2">Data Output</h4>
                  <p className="text-gray-400 mb-2">Directional graph edges representing dependencies.</p>
                  <p className="text-gray-400 mb-3">Table: <code className="text-pink-300 bg-pink-900/30 px-1 rounded">projects_impact</code></p>
                </div>
              </div>
            ) : (
              <div className="mt-4 transition-all duration-300">
                <div className="mb-2 text-xs text-gray-400 flex justify-between">
                  <span>System Prompt (Gemini 2.0 Flash)</span>
                  <span className="text-orange-400">Variables: {'{{PROJECTS_LIST}}'}</span>
                </div>
                <textarea
                  value={prompts.impactPrompt}
                  onChange={(e) => setPrompts({ ...prompts, impactPrompt: e.target.value })}
                  className="w-full h-80 bg-[#0a0e1a] text-orange-300 font-mono text-xs p-4 rounded-lg border border-orange-500/30 focus:border-orange-500 focus:outline-none resize-y"
                  spellCheck={false}
                />
                <div className="flex justify-end mt-3">
                  <button
                    onClick={() => handleSave('impact')}
                    disabled={isSaving}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-semibold rounded-md shadow-lg transition-colors disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : 'Save Prompt'}
                  </button>
                </div>
              </div>
            )}

            {!isEditingImpact && (
              <>
                <div className="flex justify-center mt-4">
                  <button 
                    onClick={() => setActiveQuery(activeQuery === 'impact' ? null : 'impact')}
                    className="px-4 py-1.5 text-xs font-semibold rounded bg-orange-900/40 hover:bg-orange-800/60 border border-orange-500/50 text-orange-300 transition-colors"
                  >
                    {activeQuery === 'impact' ? 'Hide Queries' : 'Check Full Queries'}
                  </button>
                </div>
                {activeQuery === 'impact' && (
                  <div className="mt-4 animate-fade-in bg-[#0a0e1a] p-4 rounded-lg border border-gray-700">
                    <div className="font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                      {colorizeSql(QUERIES.impact)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
