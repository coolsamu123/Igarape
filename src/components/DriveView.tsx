'use client';

import { useState, useEffect } from 'react';
import { useProjectContext } from '@/context/ProjectContext';

const SCHEDULE_PRESETS: { label: string; cron: string }[] = [
  { label: 'Every 5 minutes',   cron: '*/5 * * * *' },
  { label: 'Every 10 minutes',  cron: '*/10 * * * *' },
  { label: 'Every 15 minutes',  cron: '*/15 * * * *' },
  { label: 'Every 30 minutes',  cron: '*/30 * * * *' },
  { label: 'Every hour',        cron: '0 * * * *' },
  { label: 'Every 2 hours',     cron: '0 */2 * * *' },
  { label: 'Every 4 hours',     cron: '0 */4 * * *' },
  { label: 'Every 6 hours',     cron: '0 */6 * * *' },
  { label: '3× per day (06h, 14h, 22h)', cron: '0 6,14,22 * * *' },
  { label: 'Once per day at midnight',   cron: '0 0 * * *' },
];

export default function DriveView() {
  const { projects, refreshProjects } = useProjectContext();
  
  const [driveStatus, setDriveStatus] = useState<{
    isRunning: boolean;
    totalUrls: number;
    processedUrls: number;
    totalFiles: number;
    downloadedFiles: number;
    skippedFiles: number;
    errors: string[];
    currentProject: string;
  } | null>(null);

  const [newProjectUrl, setNewProjectUrl] = useState('');
  const [addingState, setAddingState] = useState<'idle' | 'adding' | 'success' | 'error'>('idle');
  const [addResult, setAddResult] = useState('');

  const [assocSearch, setAssocSearch] = useState('');
  const [assocUrl, setAssocUrl] = useState('');
  const [assocState, setAssocState] = useState<'idle' | 'adding' | 'success' | 'error'>('idle');
  const [assocResult, setAssocResult] = useState('');
  
  // Filter state for the list
  type BottomTab = 'projects-db' | 'goals-db' | 'join' | 'drive-urls';
  const [bottomTab, setBottomTab] = useState<BottomTab>('projects-db');

  // Drive URLs tab — one row per project, with discovered Drive folder link.
  interface DriveUrlRow {
    projectId: string;
    name: string;
    linkFolder: string;
    linkPositions: string;
    linkCIOO: string;
    filesDownloaded: number;
  }
  const [driveUrlsRows, setDriveUrlsRows] = useState<DriveUrlRow[] | null>(null);
  const [driveUrlsLoading, setDriveUrlsLoading] = useState(false);
  const [driveUrlsError, setDriveUrlsError] = useState<string | null>(null);
  const [driveUrlsFilter, setDriveUrlsFilter] = useState<'all' | 'with' | 'without'>('all');
  const [driveUrlsSearch, setDriveUrlsSearch] = useState('');

  // Excel (CIOO) upload state
  const [xlsxUploading, setXlsxUploading] = useState(false);
  const [xlsxResult, setXlsxResult] = useState('');

  // Raw projects DB state
  const [projectsRows, setProjectsRows] = useState<Record<string, unknown>[] | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  // Joined view state (projects ⨝ project_goals)
  const [joinRows, setJoinRows] = useState<Record<string, unknown>[] | null>(null);
  const [joinColumns, setJoinColumns] = useState<string[]>([]);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinMeta, setJoinMeta] = useState<{ rowCount: number; groupedRowCount: number; generatedAt: string } | null>(null);

  // Watched roots (auto-discovery) state
  interface WatchRoot {
    id: number;
    url: string;
    label: string;
    enabled: boolean;
    addedAt: string;
    lastRunAt: string | null;
    lastRunStatus: string | null;
    lastRunError: string;
    addedCount: number;
  }
  interface LastAutoRun {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    trigger: string;
    newProjects: number;
    goalsAdded: number;
    impactsAdded: number;
    errors: string[];
    status: string;
  }
  interface CycleProgress {
    currentStage: 'idle' | 'discover' | 'download' | 'goals' | 'impact' | 'finishing';
    currentRoot: string;
    drive: { isRunning: boolean; phase: string; totalUrls: number; processedUrls: number; totalFiles: number; downloadedFiles: number; skippedFiles: number; currentProject: string };
    goals: { isRunning: boolean; totalProjects: number; processedProjects: number; successCount: number; errorCount: number; currentProject: string };
    impact: { isRunning: boolean; totalProjects: number; totalBatches: number; completedBatches: number; totalImpacts: number; currentBatchDDS: string };
  }
  const [watchRoots, setWatchRoots] = useState<WatchRoot[]>([]);
  const [lastAutoRun, setLastAutoRun] = useState<LastAutoRun | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [cycleProgress, setCycleProgress] = useState<CycleProgress | null>(null);
  const [newWatchUrl, setNewWatchUrl] = useState('');
  const [newWatchLabel, setNewWatchLabel] = useState('');
  const [watchAddState, setWatchAddState] = useState<'idle' | 'adding' | 'error'>('idle');
  const [watchAddError, setWatchAddError] = useState('');

  // Phase 3 stats
  interface TodayStats {
    date: string;
    total: number;
    cap: number;
    remaining: number;
    byContext: Record<string, number>;
    byProvider: Record<string, number>;
    errors: number;
  }
  interface RecentRun {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    trigger: string;
    status: string;
    newProjects: number;
    goalsAdded: number;
    impactsAdded: number;
    errorCount: number;
  }
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);

  // Schedule editor state
  interface EffectiveSchedules {
    full: { cron: string; source: 'db' | 'env' | 'default' };
    goalsOnly: { cron: string; source: 'db' | 'env' } | null;
    schedulerEnabled: boolean;
  }
  const [schedules, setSchedules] = useState<EffectiveSchedules | null>(null);
  const [fullCronInput, setFullCronInput] = useState('');
  const [scheduleAdvanced, setScheduleAdvanced] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleSaved, setScheduleSaved] = useState(false);

  // Raw project_goals state
  const [goalsDbRows, setGoalsDbRows] = useState<Record<string, unknown>[] | null>(null);
  const [goalsDbLoading, setGoalsDbLoading] = useState(false);
  const [goalsDbError, setGoalsDbError] = useState<string | null>(null);

  const loadDriveStatus = async () => {
    try {
      const res = await fetch('/api/drive');
      const data = await res.json();
      if (data.status) setDriveStatus(data.status);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadDriveStatus();
  }, []);

  const loadAutoDiscovery = async () => {
    try {
      const res = await fetch('/api/auto-discovery');
      const data = await res.json();
      if (data.roots) setWatchRoots(data.roots);
      setLastAutoRun(data.lastRun || null);
      setAutoRunning(!!data.isRunning);
      setCycleProgress(data.progress || null);
    } catch { /* ignore */ }
  };

  const loadAutoStats = async () => {
    try {
      const res = await fetch('/api/auto-discovery/stats');
      const data = await res.json();
      if (data.today) setTodayStats(data.today);
      if (data.recentRuns) setRecentRuns(data.recentRuns);
    } catch { /* ignore */ }
  };

  const loadSchedules = async () => {
    try {
      const res = await fetch('/api/auto-discovery/schedule');
      const data = await res.json();
      setSchedules(data);
      if (data?.full?.cron) {
        setFullCronInput(data.full.cron);
        // If the current cron doesn't match any preset, default the editor to advanced mode
        // so the user can see what's actually in effect.
        if (!SCHEDULE_PRESETS.some(p => p.cron === data.full.cron)) {
          setScheduleAdvanced(true);
        }
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadAutoDiscovery();
    loadAutoStats();
    loadSchedules();
  }, []);

  const handleSaveSchedule = async () => {
    if (!fullCronInput.trim()) return;
    setScheduleSaving(true);
    setScheduleError('');
    setScheduleSaved(false);
    try {
      const res = await fetch('/api/auto-discovery/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullCron: fullCronInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setSchedules(data);
      setScheduleSaved(true);
      setTimeout(() => setScheduleSaved(false), 3000);
    } catch (err: unknown) {
      setScheduleError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleResetSchedule = async () => {
    setScheduleSaving(true);
    setScheduleError('');
    try {
      const res = await fetch('/api/auto-discovery/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullCron: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      setSchedules(data);
      setFullCronInput(data?.full?.cron || '');
      setScheduleSaved(true);
      setTimeout(() => setScheduleSaved(false), 3000);
    } catch (err: unknown) {
      setScheduleError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setScheduleSaving(false);
    }
  };

  // Poll auto-discovery status while a cycle is running. Stage details refresh
  // fast (2s) so the user can see goals/impact counters tick; project list and
  // aggregate stats refresh on a slower beat to avoid hammering the DB.
  useEffect(() => {
    if (!autoRunning) return;
    const fast = setInterval(loadAutoDiscovery, 2000);
    const slow = setInterval(() => {
      loadAutoStats();
      refreshProjects();
    }, 8000);
    return () => { clearInterval(fast); clearInterval(slow); };
  }, [autoRunning, refreshProjects]);

  const handleAddWatchRoot = async () => {
    if (!newWatchUrl.trim()) return;
    setWatchAddState('adding');
    setWatchAddError('');
    try {
      const res = await fetch('/api/auto-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newWatchUrl.trim(), label: newWatchLabel.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setWatchRoots(data.roots || []);
      setNewWatchUrl('');
      setNewWatchLabel('');
      setWatchAddState('idle');
    } catch (err: unknown) {
      setWatchAddState('error');
      setWatchAddError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleDeleteWatchRoot = async (id: number) => {
    if (!confirm('Remove this watched root? Manual discovery still works.')) return;
    try {
      const res = await fetch(`/api/auto-discovery?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.roots) setWatchRoots(data.roots);
    } catch { /* ignore */ }
  };

  const handleToggleWatchRoot = async (id: number, enabled: boolean) => {
    try {
      const res = await fetch('/api/auto-discovery/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      });
      const data = await res.json();
      if (data.roots) setWatchRoots(data.roots);
    } catch { /* ignore */ }
  };

  const handleRunCycleNow = async (mode: 'full' | 'goals-only' = 'full') => {
    try {
      const res = await fetch('/api/auto-discovery/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.status === 409) {
        // already running
      }
      setAutoRunning(true);
      setTimeout(() => {
        loadAutoDiscovery();
        loadAutoStats();
      }, 500);
    } catch { /* ignore */ }
  };

  // Poll while running
  useEffect(() => {
    if (!driveStatus?.isRunning) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/drive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status' }),
        });
        const data = await res.json();
        if (data.status) {
          setDriveStatus(data.status);
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [driveStatus?.isRunning]);

  const handleExtractEverything = async () => {
    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const data = await res.json();
      if (data.status) setDriveStatus(data.status);
    } catch { /* ignore */ }
  };

  const handleAddProject = async () => {
    if (!newProjectUrl.trim()) return;
    setAddingState('adding');
    setAddResult('');
    
    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover', url: newProjectUrl.trim() }),
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);

      const added: { projectId: string; name: string }[] = data.added || [];
      setAddingState('success');
      if (added.length === 0) {
        setAddResult('No new project folders found at that link. Make sure the folder name contains "PRJ" and is shared with the service account.');
      } else if (added.length === 1) {
        setAddResult(`Successfully discovered ${added[0].projectId}: ${added[0].name}. Starting download...`);
      } else {
        const preview = added.slice(0, 3).map(a => a.projectId).join(', ');
        const tail = added.length > 3 ? `, +${added.length - 3} more` : '';
        setAddResult(`Discovered ${added.length} projects (${preview}${tail}). Starting download...`);
      }
      setNewProjectUrl('');
      refreshProjects();
      
      // Auto-update status since download might have started
      setTimeout(loadDriveStatus, 1000);
      setTimeout(() => setAddingState('idle'), 5000);
    } catch (e: unknown) {
      setAddingState('error');
      setAddResult(e instanceof Error ? e.message : 'Failed to add project');
    }
  };

  
  const handleAssociateFile = async (projectId: string) => {
    if (!assocUrl.trim()) return;
    setAssocState('adding');
    setAssocResult('');
    
    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_link', projectId, url: assocUrl.trim() }),
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);
      
      setAssocState('success');
      setAssocResult(`Link successfully added to ${projectId}. Downloading...`);
      setAssocUrl('');
      setAssocSearch('');
      refreshProjects();
      
      setTimeout(loadDriveStatus, 1000);
      setTimeout(() => setAssocState('idle'), 5000);
    } catch (e: unknown) {
      setAssocState('error');
      setAssocResult(e instanceof Error ? e.message : 'Failed to add link');
    }
  };

  const handleXlsxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setXlsxUploading(true);
    setXlsxResult('Uploading and parsing...');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/projects/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setXlsxResult(`Success: parsed ${data.count} projects from ${file.name}.`);
      refreshProjects();
      // refresh projects-db tab if visible
      if (bottomTab === 'projects-db') loadProjectsRaw();
    } catch (err: unknown) {
      setXlsxResult(`Error: ${err instanceof Error ? err.message : 'Upload failed'}`);
    } finally {
      setXlsxUploading(false);
      e.target.value = '';
    }
  };

  const loadProjectsRaw = async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const res = await fetch('/api/projects?mode=raw');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setProjectsRows(data.projects || []);
    } catch (e: unknown) {
      setProjectsError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setProjectsLoading(false);
    }
  };

  const loadJoinPreview = async () => {
    setJoinLoading(true);
    setJoinError(null);
    try {
      const res = await fetch('/api/impact/preview');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      setJoinRows(data.rows || []);
      setJoinColumns(data.columns || []);
      setJoinMeta({
        rowCount: data.rowCount,
        groupedRowCount: data.groupedRowCount,
        generatedAt: data.generatedAt,
      });
    } catch (e: unknown) {
      setJoinError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setJoinLoading(false);
    }
  };

  const loadDriveUrls = async () => {
    setDriveUrlsLoading(true);
    setDriveUrlsError(null);
    try {
      const res = await fetch('/api/projects?mode=raw');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      // The projects table has one row per review batch; dedupe by projectId,
      // keeping the most recently reviewed entry's links.
      const byId = new Map<string, DriveUrlRow>();
      for (const p of (data.projects || []) as Array<Record<string, unknown>>) {
        const id = String(p.projectId || '');
        if (!id) continue;
        if (!byId.has(id)) {
          byId.set(id, {
            projectId: id,
            name: String(p.name || ''),
            linkFolder: String(p.linkFolder || ''),
            linkPositions: String(p.linkPositions || ''),
            linkCIOO: String(p.linkCIOO || ''),
            filesDownloaded: Number(p.filesDownloaded || 0),
          });
        }
      }
      setDriveUrlsRows(Array.from(byId.values()).sort((a, b) => a.projectId.localeCompare(b.projectId)));
    } catch (e: unknown) {
      setDriveUrlsError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setDriveUrlsLoading(false);
    }
  };

  const loadGoalsRaw = async () => {
    setGoalsDbLoading(true);
    setGoalsDbError(null);
    try {
      const res = await fetch('/api/goals');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setGoalsDbRows(data.goals || []);
    } catch (e: unknown) {
      setGoalsDbError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setGoalsDbLoading(false);
    }
  };

  // Lazy-load tab content
  useEffect(() => {
    if (bottomTab === 'projects-db' && projectsRows === null && !projectsLoading) {
      loadProjectsRaw();
    }
    if (bottomTab === 'goals-db' && goalsDbRows === null && !goalsDbLoading) {
      loadGoalsRaw();
    }
    if (bottomTab === 'join' && joinRows === null && !joinLoading) {
      loadJoinPreview();
    }
    if (bottomTab === 'drive-urls' && driveUrlsRows === null && !driveUrlsLoading) {
      loadDriveUrls();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomTab]);

  const assocProjectMatch = assocSearch.trim().length >= 3 
    ? projects.find(p => p.projectId.toLowerCase().includes(assocSearch.toLowerCase()) || p.name.toLowerCase().includes(assocSearch.toLowerCase()))
    : null;


  return (
    <div className="flex-1 overflow-auto p-6 bg-[#0a0e1a] animate-fadeIn">
      {/* Top Banner & Main Actions */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
              ☁️ Google Drive Sync
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Connect Google Drive folders to download project files locally. These files are used for deep AI analysis (Impact & Goals).
            </p>
          </div>
          <button
            onClick={handleExtractEverything}
            disabled={driveStatus?.isRunning}
            className="px-5 py-2.5 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {driveStatus?.isRunning ? 'Running...' : 'Extract Everything'}
          </button>
        </div>

        {/* Progress Bar */}
        {driveStatus?.isRunning && (
          <div className="bg-gray-950 rounded-lg p-4 border border-gray-800">
            <div className="flex justify-between mb-2">
              <span className="text-sm text-gray-400">Downloading...</span>
              <span className="text-sm text-blue-400 font-medium">
                {driveStatus.processedUrls} / {driveStatus.totalUrls} URLs
              </span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-2">
              <div 
                className="h-full bg-gradient-to-r from-blue-600 to-purple-600 transition-all duration-300"
                style={{ width: `${driveStatus.totalUrls > 0 ? (driveStatus.processedUrls / driveStatus.totalUrls) * 100 : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>{driveStatus.currentProject}</span>
              <span>{driveStatus.downloadedFiles} files downloaded</span>
            </div>
            
            {/* Errors */}
            {driveStatus.errors.length > 0 && (
              <div className="mt-3 text-xs text-red-400 max-h-20 overflow-y-auto">
                {driveStatus.errors.slice(-3).map((err, i) => (
                  <div key={i}>{err}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Watched Drive Roots (auto-discovery) */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-md font-bold text-gray-200">Watched Drive Roots</h3>
            <p className="text-xs text-gray-500 mt-1">
              Persisted Drive folders re-scanned periodically by the scheduler. When new <code className="text-gray-300">PRJ*</code> folders appear,
              the full pipeline runs end-to-end (download → goals → impact). Use the buttons to trigger a cycle on demand.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => handleRunCycleNow('goals-only')}
              disabled={autoRunning}
              title="Discover + Download + Goals (skip Impact)"
              className="px-4 py-2 rounded-lg bg-gray-700 text-white text-sm font-semibold hover:bg-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Goals only
            </button>
            <button
              onClick={() => handleRunCycleNow('full')}
              disabled={autoRunning}
              className="px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {autoRunning ? 'Running cycle…' : 'Run Full Cycle'}
            </button>
          </div>
        </div>

        {/* Today's LLM stats */}
        {todayStats && (
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Today&apos;s LLM Usage ({todayStats.date})
              </div>
              <div className="text-xs text-gray-400">
                <span className={`font-mono ${
                  todayStats.remaining === 0 ? 'text-red-400' :
                  todayStats.remaining < todayStats.cap * 0.2 ? 'text-yellow-400' :
                  'text-gray-200'
                }`}>{todayStats.total}</span>
                <span className="text-gray-500"> / {todayStats.cap}</span>
                <span className="ml-2 text-gray-500">({todayStats.remaining} remaining)</span>
                {todayStats.errors > 0 && (
                  <span className="ml-2 text-red-400">{todayStats.errors} errors</span>
                )}
              </div>
            </div>
            {/* progress bar */}
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mb-2">
              <div
                className={`h-full transition-all ${
                  todayStats.remaining === 0 ? 'bg-red-500' :
                  todayStats.remaining < todayStats.cap * 0.2 ? 'bg-yellow-500' :
                  'bg-blue-500'
                }`}
                style={{ width: `${Math.min(100, (todayStats.total / Math.max(1, todayStats.cap)) * 100)}%` }}
              />
            </div>
            {/* breakdown */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
              {Object.entries(todayStats.byContext).length > 0 && (
                <div>
                  <span className="text-gray-600">By context:</span>{' '}
                  {Object.entries(todayStats.byContext).map(([k, v]) => (
                    <span key={k} className="ml-1 text-gray-300">{k}=<span className="font-mono">{v}</span></span>
                  ))}
                </div>
              )}
              {Object.entries(todayStats.byProvider).length > 0 && (
                <div>
                  <span className="text-gray-600">By provider:</span>{' '}
                  {Object.entries(todayStats.byProvider).map(([k, v]) => (
                    <span key={k} className="ml-1 text-gray-300">{k}=<span className="font-mono">{v}</span></span>
                  ))}
                </div>
              )}
            </div>
            {todayStats.remaining === 0 && (
              <div className="mt-2 text-[11px] text-red-400">
                Daily cap reached. Cycles will skip LLM stages until tomorrow.
                Override with <code className="text-gray-300">STROM_LLM_DAILY_CAP</code>.
              </div>
            )}
          </div>
        )}

        {/* Schedule editor */}
        <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Discovery Schedule
            </div>
            <div className="flex items-center gap-3">
              {schedules && (
                <div className="text-[11px] text-gray-500">
                  source: <span className="text-gray-300">{schedules.full.source}</span>
                  {!schedules.schedulerEnabled && (
                    <span className="ml-2 text-yellow-400">(scheduler disabled by env)</span>
                  )}
                </div>
              )}
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={scheduleAdvanced}
                  onChange={e => setScheduleAdvanced(e.target.checked)}
                  className="cursor-pointer"
                />
                Advanced (cron)
              </label>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            {scheduleAdvanced ? (
              <input
                type="text"
                value={fullCronInput}
                onChange={e => setFullCronInput(e.target.value)}
                placeholder="*/10 * * * *"
                className="flex-1 min-w-[200px] bg-gray-900 border border-gray-800 text-gray-200 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors"
              />
            ) : (
              <select
                value={SCHEDULE_PRESETS.some(p => p.cron === fullCronInput) ? fullCronInput : ''}
                onChange={e => setFullCronInput(e.target.value)}
                className="flex-1 min-w-[240px] bg-gray-900 border border-gray-800 text-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
              >
                {!SCHEDULE_PRESETS.some(p => p.cron === fullCronInput) && (
                  <option value="" disabled>
                    Custom: {fullCronInput} — switch to Advanced to edit
                  </option>
                )}
                {SCHEDULE_PRESETS.map(p => (
                  <option key={p.cron} value={p.cron}>{p.label}</option>
                ))}
              </select>
            )}
            <button
              onClick={handleSaveSchedule}
              disabled={scheduleSaving || !fullCronInput.trim() || fullCronInput === schedules?.full.cron}
              className="px-4 py-1.5 rounded bg-blue-700 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {scheduleSaving ? 'Saving…' : 'Apply'}
            </button>
            {schedules?.full.source !== 'default' && (
              <button
                onClick={handleResetSchedule}
                disabled={scheduleSaving}
                className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-xs font-medium border border-gray-700 hover:bg-gray-700 transition-colors disabled:opacity-40"
                title="Clear DB override and use env/default"
              >
                Reset
              </button>
            )}
          </div>

          <div className="mt-2 text-[11px] text-gray-500">
            {scheduleAdvanced ? (
              <>
                Cron format: <code className="text-gray-400">minute hour day-of-month month day-of-week</code>.
                {' '}Saving applies immediately, no server restart needed.
              </>
            ) : (
              <>Saving applies immediately, no server restart needed. Toggle <strong className="text-gray-300">Advanced</strong> for raw cron expressions.</>
            )}
          </div>
          {scheduleError && (
            <div className="mt-2 text-[11px] text-red-400">{scheduleError}</div>
          )}
          {scheduleSaved && (
            <div className="mt-2 text-[11px] text-green-400">Schedule applied and rescheduled.</div>
          )}
        </div>

        {/* Live cycle progress (only while running) */}
        {autoRunning && cycleProgress && (() => {
          const stages: { key: CycleProgress['currentStage']; label: string }[] = [
            { key: 'discover',  label: 'Discover'  },
            { key: 'download',  label: 'Download'  },
            { key: 'goals',     label: 'Goals'     },
            { key: 'impact',    label: 'Impact'    },
          ];
          const stageOrder: Record<CycleProgress['currentStage'], number> = {
            idle: -1, discover: 0, download: 1, goals: 2, impact: 3, finishing: 4,
          };
          const activeIdx = stageOrder[cycleProgress.currentStage] ?? -1;
          const { drive, goals, impact, currentRoot, currentStage } = cycleProgress;
          const drivePct = drive.totalFiles > 0
            ? Math.min(100, ((drive.downloadedFiles + drive.skippedFiles) / drive.totalFiles) * 100)
            : 0;
          const goalsPct = goals.totalProjects > 0
            ? Math.min(100, (goals.processedProjects / goals.totalProjects) * 100)
            : 0;
          const impactPct = impact.totalBatches > 0
            ? Math.min(100, (impact.completedBatches / impact.totalBatches) * 100)
            : 0;
          return (
            <div className="bg-gray-950 border border-blue-900/50 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                <span className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">
                  Cycle in progress
                </span>
                <span className="text-[11px] text-gray-500">
                  → stage: <span className="text-gray-200 font-medium capitalize">{currentStage}</span>
                  {currentRoot && <span className="ml-2 text-gray-400">({currentRoot})</span>}
                </span>
              </div>

              {/* Stage strip */}
              <div className="flex items-center gap-1 mb-3">
                {stages.map((s, i) => {
                  const state =
                    i < activeIdx ? 'done' :
                    i === activeIdx ? 'active' :
                    'pending';
                  return (
                    <div key={s.key} className="flex-1 flex items-center gap-1">
                      <div className={`flex-1 h-1.5 rounded-full ${
                        state === 'done'   ? 'bg-green-500' :
                        state === 'active' ? 'bg-blue-500 animate-pulse' :
                                             'bg-gray-800'
                      }`} />
                      <span className={`text-[10px] font-medium whitespace-nowrap px-1 ${
                        state === 'done'   ? 'text-green-400' :
                        state === 'active' ? 'text-blue-300' :
                                             'text-gray-600'
                      }`}>
                        {state === 'done' ? '✓ ' : ''}{s.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Per-stage detail rows */}
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between text-gray-400">
                  <span className="w-20 text-gray-500">Download</span>
                  <span className="flex-1 mx-2">
                    <div className="h-1 bg-gray-800 rounded overflow-hidden">
                      <div className="h-full bg-blue-600 transition-all" style={{ width: `${drivePct}%` }} />
                    </div>
                  </span>
                  <span className="font-mono text-gray-300 tabular-nums">
                    {drive.downloadedFiles + drive.skippedFiles}/{drive.totalFiles || '?'} files
                    {drive.totalUrls > 0 && <span className="text-gray-500"> · {drive.processedUrls}/{drive.totalUrls} urls</span>}
                  </span>
                </div>
                <div className="flex items-center justify-between text-gray-400">
                  <span className="w-20 text-gray-500">Goals</span>
                  <span className="flex-1 mx-2">
                    <div className="h-1 bg-gray-800 rounded overflow-hidden">
                      <div className="h-full bg-blue-600 transition-all" style={{ width: `${goalsPct}%` }} />
                    </div>
                  </span>
                  <span className="font-mono text-gray-300 tabular-nums">
                    {goals.processedProjects}/{goals.totalProjects || '?'}
                    {goals.errorCount > 0 && <span className="text-red-400"> · {goals.errorCount} err</span>}
                  </span>
                </div>
                {goals.isRunning && goals.currentProject && (
                  <div className="text-gray-500 text-[10px] pl-20 ml-2 truncate" title={goals.currentProject}>
                    → {goals.currentProject}
                  </div>
                )}
                <div className="flex items-center justify-between text-gray-400">
                  <span className="w-20 text-gray-500">Impact</span>
                  <span className="flex-1 mx-2">
                    <div className="h-1 bg-gray-800 rounded overflow-hidden">
                      <div className="h-full bg-blue-600 transition-all" style={{ width: `${impactPct}%` }} />
                    </div>
                  </span>
                  <span className="font-mono text-gray-300 tabular-nums">
                    {impact.completedBatches}/{impact.totalBatches || '?'} batches
                    {impact.currentBatchDDS && <span className="text-gray-500"> · {impact.currentBatchDDS}</span>}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Last run summary */}
        {lastAutoRun && (
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 mb-4 text-xs text-gray-400">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>Last cycle: <span className="text-gray-300">{new Date(lastAutoRun.startedAt).toLocaleString()}</span></span>
              <span>Trigger: <span className="text-gray-300">{lastAutoRun.trigger}</span></span>
              <span>Status:
                <span className={`ml-1 ${
                  lastAutoRun.status === 'success' ? 'text-green-400' :
                  lastAutoRun.status === 'error' ? 'text-red-400' :
                  lastAutoRun.status === 'partial' ? 'text-yellow-400' :
                  'text-blue-400'
                }`}>{lastAutoRun.status}</span>
              </span>
              <span>New projects: <span className="text-gray-300 font-mono">{lastAutoRun.newProjects}</span></span>
              <span>Goals added: <span className="text-gray-300 font-mono">{lastAutoRun.goalsAdded}</span></span>
              <span>Impacts added: <span className="text-gray-300 font-mono">{lastAutoRun.impactsAdded}</span></span>
            </div>
            {lastAutoRun.errors.length > 0 && (
              <div className="mt-2 text-red-400">
                {lastAutoRun.errors.slice(0, 3).map((e, i) => <div key={i}>• {e}</div>)}
                {lastAutoRun.errors.length > 3 && (
                  <div className="text-gray-500">+{lastAutoRun.errors.length - 3} more</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Recent cycles (compact log) */}
        {recentRuns.length > 0 && (
          <details className="mb-4">
            <summary className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold cursor-pointer hover:text-gray-300 select-none">
              Last {recentRuns.length} cycles
            </summary>
            <div className="mt-2 bg-gray-950 border border-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-gray-900 text-gray-500 uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Started</th>
                    <th className="px-2 py-1.5 text-left font-medium">Trig</th>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    <th className="px-2 py-1.5 text-right font-medium">New</th>
                    <th className="px-2 py-1.5 text-right font-medium">Goals</th>
                    <th className="px-2 py-1.5 text-right font-medium">Impacts</th>
                    <th className="px-2 py-1.5 text-right font-medium">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {recentRuns.map(r => (
                    <tr key={r.id} className="hover:bg-gray-800/30">
                      <td className="px-2 py-1.5 text-gray-300 font-mono">
                        {new Date(r.startedAt).toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5 text-gray-400">{r.trigger}</td>
                      <td className="px-2 py-1.5">
                        <span className={
                          r.status === 'success' ? 'text-green-400' :
                          r.status === 'error' ? 'text-red-400' :
                          r.status === 'partial' ? 'text-yellow-400' :
                          'text-blue-400'
                        }>{r.status}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300">{r.newProjects}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300">{r.goalsAdded}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300">{r.impactsAdded}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300">{r.errorCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {/* Roots table */}
        <div className="space-y-2 mb-4">
          {watchRoots.length === 0 ? (
            <div className="text-xs text-gray-500 italic">No watched roots yet. Add one below.</div>
          ) : (
            watchRoots.map(r => (
              <div key={r.id} className="bg-gray-950 border border-gray-800 rounded-lg p-3 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={e => handleToggleWatchRoot(r.id, e.target.checked)}
                  className="cursor-pointer"
                  title={r.enabled ? 'Disable' : 'Enable'}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 font-medium truncate">
                    {r.label || <span className="text-gray-500 italic">(no label)</span>}
                  </div>
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] text-blue-400 hover:underline font-mono truncate block max-w-full"
                    title={r.url}>
                    {r.url}
                  </a>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    Added projects: <span className="text-gray-400 font-mono">{r.addedCount}</span>
                    {' · '}Last:{' '}
                    {r.lastRunAt ? (
                      <>
                        <span className="text-gray-400">{new Date(r.lastRunAt).toLocaleString()}</span>
                        {r.lastRunStatus && (
                          <span className={`ml-1 ${
                            r.lastRunStatus === 'success' ? 'text-green-400' : 'text-red-400'
                          }`}>({r.lastRunStatus})</span>
                        )}
                      </>
                    ) : <span className="text-gray-600">never</span>}
                  </div>
                  {r.lastRunError && (
                    <div className="text-[11px] text-red-400 mt-0.5 truncate" title={r.lastRunError}>
                      {r.lastRunError}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteWatchRoot(r.id)}
                  className="px-2 py-1 text-xs rounded bg-red-900/30 text-red-400 border border-red-800 hover:bg-red-900/50 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add new root */}
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Label (optional)"
            value={newWatchLabel}
            onChange={e => setNewWatchLabel(e.target.value)}
            className="w-48 bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
          <input
            type="text"
            placeholder="https://drive.google.com/drive/folders/..."
            value={newWatchUrl}
            onChange={e => setNewWatchUrl(e.target.value)}
            className="flex-1 min-w-[280px] bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={handleAddWatchRoot}
            disabled={!newWatchUrl.trim() || watchAddState === 'adding'}
            className="px-5 py-2 rounded-lg bg-purple-700 text-white text-sm font-semibold hover:bg-purple-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {watchAddState === 'adding' ? 'Adding…' : 'Watch Root'}
          </button>
        </div>
        {watchAddState === 'error' && (
          <div className="mt-2 text-xs text-red-400">{watchAddError}</div>
        )}
      </div>

      {/* Add New Project Section */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <h3 className="text-md font-bold text-gray-200 mb-2">Discover New Project</h3>
        <p className="text-xs text-gray-500 mb-4">
          Paste a Google Drive link. The engine will scan subfolders to find the actual project folder (must contain &quot;PRJ&quot; in its name) and add it to the database automatically.
        </p>
        
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="https://drive.google.com/drive/folders/..."
            value={newProjectUrl}
            onChange={e => setNewProjectUrl(e.target.value)}
            className="flex-1 bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={handleAddProject}
            disabled={!newProjectUrl.trim() || addingState === 'adding' || driveStatus?.isRunning}
            className="px-6 py-2 rounded-lg bg-purple-700 text-white text-sm font-semibold hover:bg-purple-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {addingState === 'adding' ? 'Scanning...' : 'Add & Download'}
          </button>
        </div>
        
        {addingState === 'success' && (
          <div className="mt-3 text-sm text-green-400 bg-green-900/20 px-3 py-2 rounded border border-green-900/50">
            {addResult}
          </div>
        )}
        {addingState === 'error' && (
          <div className="mt-3 text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-900/50">
            {addResult}
          </div>
        )}
      </div>

      
      {/* Associate File to Project */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <h3 className="text-md font-bold text-gray-200 mb-2">Associate Link to Existing Project</h3>
        <p className="text-xs text-gray-500 mb-4">
          Search for an existing project and paste a Google Drive file or folder link to associate it manually.
        </p>
        
        <div className="flex gap-3 flex-wrap items-center">
          <input
            type="text"
            placeholder="Search project (e.g. PRJ46228TR)"
            value={assocSearch}
            onChange={e => setAssocSearch(e.target.value)}
            className="w-64 bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
          <input
            type="text"
            placeholder="https://drive.google.com/..."
            value={assocUrl}
            onChange={e => setAssocUrl(e.target.value)}
            className="flex-1 bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={() => assocProjectMatch && handleAssociateFile(assocProjectMatch.projectId)}
            disabled={!assocUrl.trim() || !assocProjectMatch || assocState === 'adding' || driveStatus?.isRunning}
            className="px-6 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {assocState === 'adding' ? 'Adding...' : 'Add File Link'}
          </button>
        </div>
        
        {assocSearch.trim().length > 0 && !assocProjectMatch && (
          <div className="mt-2 text-xs text-red-400">No project found matching &quot;{assocSearch}&quot;</div>
        )}
        
        {assocProjectMatch && (
          <div className="mt-2 text-xs text-blue-400 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            Selected: <span className="font-mono text-gray-300">{assocProjectMatch.projectId}</span> - <span className="text-gray-300">{assocProjectMatch.name}</span>
          </div>
        )}
        
        {assocState === 'success' && (
          <div className="mt-3 text-sm text-green-400 bg-green-900/20 px-3 py-2 rounded border border-green-900/50">
            {assocResult}
          </div>
        )}
        {assocState === 'error' && (
          <div className="mt-3 text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-900/50">
            {assocResult}
          </div>
        )}
      </div>

      {/* Upload CIOO Excel */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <h3 className="text-md font-bold text-gray-200 mb-2">Upload CIOO Excel (.xlsx)</h3>
        <p className="text-xs text-gray-500 mb-4">
          Upload the master <strong className="text-gray-300">0_CIOO Forecast.xlsx</strong> file to populate the base project metadata
          (DDS, gate, cost, dates, decisions). Replaces all existing projects.
        </p>

        <label
          className={`inline-block px-5 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold transition-colors ${
            xlsxUploading ? 'opacity-50 cursor-default' : 'hover:bg-blue-600 cursor-pointer'
          }`}
        >
          {xlsxUploading ? 'Uploading...' : 'Upload Excel File'}
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={xlsxUploading}
            onChange={handleXlsxUpload}
          />
        </label>

        {xlsxResult && (
          <div
            className={`mt-3 text-sm px-3 py-2 rounded border ${
              xlsxResult.startsWith('Error')
                ? 'text-red-400 bg-red-900/20 border-red-900/50'
                : xlsxResult.startsWith('Success')
                ? 'text-green-400 bg-green-900/20 border-green-900/50'
                : 'text-blue-400 bg-blue-900/20 border-blue-900/50'
            }`}
          >
            {xlsxResult}
          </div>
        )}
      </div>

      {/* Projects List */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 pt-4 border-b border-gray-800 bg-gray-800/50">
          <div className="flex gap-1">
            <button
              onClick={() => setBottomTab('projects-db')}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
                bottomTab === 'projects-db'
                  ? 'bg-gray-900 text-gray-100 border border-gray-800 border-b-transparent'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Projects DB{projectsRows ? ` (${projectsRows.length})` : ''}
            </button>
            <button
              onClick={() => setBottomTab('goals-db')}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
                bottomTab === 'goals-db'
                  ? 'bg-gray-900 text-gray-100 border border-gray-800 border-b-transparent'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Project Goals{goalsDbRows ? ` (${goalsDbRows.length})` : ''}
            </button>
            <button
              onClick={() => setBottomTab('join')}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
                bottomTab === 'join'
                  ? 'bg-gray-900 text-gray-100 border border-gray-800 border-b-transparent'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Joined View{joinMeta ? ` (${joinMeta.groupedRowCount})` : ''}
            </button>
            <button
              onClick={() => setBottomTab('drive-urls')}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
                bottomTab === 'drive-urls'
                  ? 'bg-gray-900 text-gray-100 border border-gray-800 border-b-transparent'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Drive URLs{driveUrlsRows ? ` (${driveUrlsRows.length})` : ''}
            </button>
          </div>
        </div>
        
        {bottomTab === 'goals-db' && (
          <div>
            <div className="px-5 py-3 border-b border-gray-800 bg-gray-800/30 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                Raw rows from the <code className="text-gray-300">project_goals</code> table (populated by the Goals Extractor).
              </div>
              <button
                onClick={loadGoalsRaw}
                disabled={goalsDbLoading}
                className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-xs font-medium hover:bg-gray-700 transition-colors border border-gray-700 disabled:opacity-40"
              >
                {goalsDbLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {goalsDbError && (
              <div className="m-5 text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-900/50">
                {goalsDbError}
              </div>
            )}

            <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
              {goalsDbLoading && goalsDbRows === null ? (
                <div className="px-5 py-12 text-center text-gray-500 text-sm">Loading...</div>
              ) : !goalsDbRows || goalsDbRows.length === 0 ? (
                <div className="px-5 py-12 text-center text-gray-500 text-sm">
                  No rows. Run the Goals Extractor to populate <code className="text-gray-300">project_goals</code>.
                </div>
              ) : (
                <table className="text-left text-xs border-collapse" style={{ minWidth: 'max-content' }}>
                  <thead className="bg-gray-900 text-gray-400 uppercase border-b border-gray-800 sticky top-0 z-10">
                    <tr>
                      {Object.keys(goalsDbRows[0]).map(col => (
                        <th key={col} className="px-3 py-2 font-medium whitespace-nowrap border-r border-gray-800 last:border-r-0" title={col}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {goalsDbRows.slice(0, 500).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                        {Object.keys(goalsDbRows[0]).map(col => {
                          const val = row[col];
                          const display = val === null || val === undefined
                            ? ''
                            : typeof val === 'object' ? JSON.stringify(val) : String(val);
                          return (
                            <td
                              key={col}
                              className="px-3 py-2 text-gray-300 whitespace-nowrap border-r border-gray-800 last:border-r-0 max-w-[320px] overflow-hidden text-ellipsis"
                              title={display}
                            >
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {goalsDbRows && goalsDbRows.length > 500 && (
                <div className="px-5 py-2 text-xs text-gray-500 border-t border-gray-800 bg-gray-900/50">
                  Showing first 500 of {goalsDbRows.length} rows.
                </div>
              )}
            </div>
          </div>
        )}

        {bottomTab === 'projects-db' && (
          <div>
            <div className="px-5 py-3 border-b border-gray-800 bg-gray-800/30 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                Raw rows from the <code className="text-gray-300">projects</code> table (populated by the CIOO Excel upload).
              </div>
              <button
                onClick={loadProjectsRaw}
                disabled={projectsLoading}
                className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-xs font-medium hover:bg-gray-700 transition-colors border border-gray-700 disabled:opacity-40"
              >
                {projectsLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {projectsError && (
              <div className="m-5 text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-900/50">
                {projectsError}
              </div>
            )}

            <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
              {projectsLoading && projectsRows === null ? (
                <div className="px-5 py-12 text-center text-gray-500 text-sm">Loading...</div>
              ) : !projectsRows || projectsRows.length === 0 ? (
                <div className="px-5 py-12 text-center text-gray-500 text-sm">
                  No rows. Upload a CIOO Excel above to populate the projects table.
                </div>
              ) : (
                <table className="text-left text-xs border-collapse" style={{ minWidth: 'max-content' }}>
                  <thead className="bg-gray-900 text-gray-400 uppercase border-b border-gray-800 sticky top-0 z-10">
                    <tr>
                      {Object.keys(projectsRows[0]).map(col => (
                        <th key={col} className="px-3 py-2 font-medium whitespace-nowrap border-r border-gray-800 last:border-r-0" title={col}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {projectsRows.slice(0, 500).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                        {Object.keys(projectsRows[0]).map(col => {
                          const val = row[col];
                          const display = val === null || val === undefined
                            ? ''
                            : typeof val === 'object' ? JSON.stringify(val) : String(val);
                          return (
                            <td
                              key={col}
                              className="px-3 py-2 text-gray-300 whitespace-nowrap border-r border-gray-800 last:border-r-0 max-w-[320px] overflow-hidden text-ellipsis"
                              title={display}
                            >
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {projectsRows && projectsRows.length > 500 && (
                <div className="px-5 py-2 text-xs text-gray-500 border-t border-gray-800 bg-gray-900/50">
                  Showing first 500 of {projectsRows.length} rows.
                </div>
              )}
            </div>
          </div>
        )}

        {bottomTab === 'join' && (
          <div>
            <div className="px-5 py-3 border-b border-gray-800 bg-gray-800/30 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                <code className="text-gray-300">project_goals</code> ⨝ <code className="text-gray-300">projects</code> — the dataset the Impact engine analyzes.
                {joinMeta && (
                  <span className="ml-2 text-gray-400">
                    {joinMeta.groupedRowCount} unique projects · {joinMeta.rowCount} raw rows · generated {new Date(joinMeta.generatedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <button
                onClick={loadJoinPreview}
                disabled={joinLoading}
                className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-xs font-medium hover:bg-gray-700 transition-colors border border-gray-700 disabled:opacity-40"
              >
                {joinLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {joinError && (
              <div className="m-5 text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-900/50">
                {joinError}
              </div>
            )}

            <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
              {joinLoading && joinRows === null ? (
                <div className="px-5 py-12 text-center text-gray-500 text-sm">Loading...</div>
              ) : !joinRows || joinRows.length === 0 ? (
                <div className="px-5 py-12 text-center text-gray-500 text-sm">
                  No joined rows. Run the Goals Extractor first to populate <code className="text-gray-300">project_goals</code>.
                </div>
              ) : (
                <table className="text-left text-xs border-collapse" style={{ minWidth: 'max-content' }}>
                  <thead className="bg-gray-900 text-gray-400 uppercase border-b border-gray-800 sticky top-0 z-10">
                    <tr>
                      {joinColumns.map(col => (
                        <th key={col} className="px-3 py-2 font-medium whitespace-nowrap border-r border-gray-800 last:border-r-0" title={col}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {joinRows.slice(0, 500).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                        {joinColumns.map(col => {
                          const val = row[col];
                          const display = val === null || val === undefined
                            ? ''
                            : typeof val === 'object' ? JSON.stringify(val) : String(val);
                          return (
                            <td
                              key={col}
                              className="px-3 py-2 text-gray-300 whitespace-nowrap border-r border-gray-800 last:border-r-0 max-w-[320px] overflow-hidden text-ellipsis"
                              title={display}
                            >
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {joinRows && joinRows.length > 500 && (
                <div className="px-5 py-2 text-xs text-gray-500 border-t border-gray-800 bg-gray-900/50">
                  Showing first 500 of {joinRows.length} rows.
                </div>
              )}
            </div>
          </div>
        )}

        {bottomTab === 'drive-urls' && (() => {
          const all = driveUrlsRows || [];
          const q = driveUrlsSearch.trim().toLowerCase();
          const filtered = all.filter(r => {
            if (driveUrlsFilter === 'with' && !r.linkFolder) return false;
            if (driveUrlsFilter === 'without' && r.linkFolder) return false;
            if (q && !r.projectId.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
            return true;
          });
          const withFolderCount = all.filter(r => r.linkFolder).length;
          return (
            <div>
              <div className="px-5 py-3 border-b border-gray-800 bg-gray-800/30 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-gray-500">
                  Discovered Google Drive folder per project. Auto-discovery populates <code className="text-gray-300">link_folder</code> when a folder named like <code className="text-gray-300">PRJ…</code> is found inside a watched root.
                  {driveUrlsRows && (
                    <span className="ml-2 text-gray-400">
                      {withFolderCount}/{all.length} have a folder
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Filter by ID or name…"
                    value={driveUrlsSearch}
                    onChange={e => setDriveUrlsSearch(e.target.value)}
                    className="w-56 bg-gray-950 border border-gray-800 text-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                  />
                  <select
                    value={driveUrlsFilter}
                    onChange={e => setDriveUrlsFilter(e.target.value as 'all' | 'with' | 'without')}
                    className="bg-gray-950 border border-gray-800 text-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="all">All</option>
                    <option value="with">With folder</option>
                    <option value="without">Missing folder</option>
                  </select>
                  <button
                    onClick={loadDriveUrls}
                    disabled={driveUrlsLoading}
                    className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-xs font-medium hover:bg-gray-700 transition-colors border border-gray-700 disabled:opacity-40"
                  >
                    {driveUrlsLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
              </div>

              {driveUrlsError && (
                <div className="m-5 text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-900/50">
                  {driveUrlsError}
                </div>
              )}

              <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
                {driveUrlsLoading && driveUrlsRows === null ? (
                  <div className="px-5 py-12 text-center text-gray-500 text-sm">Loading...</div>
                ) : filtered.length === 0 ? (
                  <div className="px-5 py-12 text-center text-gray-500 text-sm">
                    {all.length === 0
                      ? 'No projects yet. Add a watched root above to discover them.'
                      : 'No matches.'}
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-900 text-gray-400 uppercase border-b border-gray-800 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 font-medium whitespace-nowrap border-r border-gray-800">Project ID</th>
                        <th className="px-3 py-2 font-medium border-r border-gray-800">Name</th>
                        <th className="px-3 py-2 font-medium border-r border-gray-800">GDrive URL</th>
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Files</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {filtered.map(r => (
                        <tr key={r.projectId} className="hover:bg-gray-800/30 transition-colors">
                          <td className="px-3 py-2 font-mono text-gray-300 whitespace-nowrap border-r border-gray-800">
                            {r.projectId}
                          </td>
                          <td className="px-3 py-2 text-gray-300 border-r border-gray-800 max-w-[280px] truncate" title={r.name}>
                            {r.name}
                          </td>
                          <td className="px-3 py-2 border-r border-gray-800">
                            {r.linkFolder ? (
                              <a
                                href={r.linkFolder}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[11px] text-blue-400 hover:text-blue-300 hover:underline break-all"
                                title={r.linkFolder}
                              >
                                {r.linkFolder}
                              </a>
                            ) : (
                              <span className="text-gray-600 italic">— not discovered —</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-gray-300 whitespace-nowrap">
                            {r.filesDownloaded}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
