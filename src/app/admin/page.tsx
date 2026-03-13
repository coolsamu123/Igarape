'use client';

import { useState, useEffect } from 'react';

export default function AdminPage() {
  const [apiKey, setApiKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState('');
  const [stats, setStats] = useState<{ analyses: number; documents: number } | null>(null);

  // Drive download state
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
  const [driveDocCount, setDriveDocCount] = useState(0);

  useEffect(() => {
    fetch('/api/admin/config')
      .then(r => r.json())
      .then(data => {
        setSavedKey(data.apiKeyMasked || '');
        setStats(data.stats || null);
      })
      .catch(() => {});

    // Fetch drive status
    fetch('/api/drive')
      .then(r => r.json())
      .then(data => {
        setDriveStatus(data.status || null);
        setDriveDocCount(data.documentCount || 0);
      })
      .catch(() => {});
  }, []);

  // Poll drive status while running
  useEffect(() => {
    if (!driveStatus?.isRunning) return;
    const interval = setInterval(() => {
      fetch('/api/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) })
        .then(r => r.json())
        .then(data => {
          setDriveStatus(data.status);
          if (!data.status.isRunning) {
            // Refresh doc count
            fetch('/api/drive').then(r => r.json()).then(d => setDriveDocCount(d.documentCount || 0)).catch(() => {});
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [driveStatus?.isRunning]);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setStatus('saving');
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedKey(data.apiKeyMasked);
      setApiKey('');
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (e: unknown) {
      setStatus('error');
      setTestResult(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const handleTest = async () => {
    setTestStatus('testing');
    setTestResult('');
    try {
      const res = await fetch('/api/admin/test-gemini', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTestStatus('success');
      setTestResult(data.message);
    } catch (e: unknown) {
      setTestStatus('error');
      setTestResult(e instanceof Error ? e.message : 'Test failed');
    }
  };

  const handleDriveDownload = async () => {
    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDriveStatus(data.status);
    } catch (e: unknown) {
      setTestResult(e instanceof Error ? e.message : 'Drive download failed');
    }
  };

  const handleClearCache = async () => {
    if (!confirm('Clear all Gemini analysis cache? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/admin/clear-cache', { method: 'POST' });
      const data = await res.json();
      setTestResult(`Cache cleared: ${data.deletedAnalyses} analyses, ${data.deletedDocuments} documents`);
      setStats({ analyses: 0, documents: 0 });
    } catch (e: unknown) {
      setTestResult(e instanceof Error ? e.message : 'Clear failed');
    }
  };

  const panelStyle: React.CSSProperties = {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: 12,
    padding: 24,
  };

  const inputStyle: React.CSSProperties = {
    background: '#1f2937',
    border: '1px solid #374151',
    color: '#e2e8f0',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 14,
    outline: 'none',
    flex: 1,
  };

  const btnPrimary: React.CSSProperties = {
    padding: '8px 20px',
    borderRadius: 6,
    border: 'none',
    background: '#1d4ed8',
    color: 'white',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  };

  const btnDanger: React.CSSProperties = {
    padding: '8px 20px',
    borderRadius: 6,
    border: '1px solid #7f1d1d',
    background: '#450a0a55',
    color: '#fca5a5',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  };

  const btnPurple: React.CSSProperties = {
    padding: '8px 20px',
    borderRadius: 6,
    border: 'none',
    background: '#6d28d9',
    color: 'white',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  };

  const chipStyle = (bg: string, color: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    background: bg,
    color: color,
    border: `1px solid ${color}33`,
  });

  return (
    <div style={{
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      background: '#0a0e1a',
      color: '#e2e8f0',
      minHeight: '100vh',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 24px',
        borderBottom: '1px solid #1f2937',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: '#0d1117',
      }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
          <div style={{
            width: 32, height: 32,
            background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16,
          }}>⬡</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>CIOO Project Intelligence</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Administration</div>
          </div>
        </a>
        <div style={{ flex: 1 }} />
        <a href="/" style={{
          padding: '6px 18px',
          borderRadius: 6,
          border: '1px solid #374151',
          color: '#94a3b8',
          fontSize: 13,
          fontWeight: 500,
          textDecoration: 'none',
        }}>
          Back to Dashboard
        </a>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Gemini API Configuration */}
        <div style={panelStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Gemini API Configuration</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
            Configure your Google Gemini API key to enable AI-powered project impact analysis.
          </div>

          {/* Status */}
          <div style={{ background: '#1f2937', borderRadius: 8, padding: 14, marginBottom: 20 }}>
            <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>CURRENT STATUS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: savedKey && savedKey !== 'Not configured' ? '#22c55e' : '#ef4444',
              }} />
              <span style={{ fontSize: 13, color: '#cbd5e1' }}>
                {savedKey && savedKey !== 'Not configured'
                  ? `API Key configured: ${savedKey}`
                  : 'No API key configured'}
              </span>
            </div>
          </div>

          {/* Input */}
          <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>API KEY</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="AIza..."
              style={inputStyle}
            />
            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || status === 'saving'}
              style={{ ...btnPrimary, opacity: !apiKey.trim() || status === 'saving' ? 0.4 : 1 }}
            >
              {status === 'saving' ? 'Saving...' : 'Save'}
            </button>
          </div>
          {status === 'saved' && (
            <div style={{ fontSize: 13, color: '#4ade80', marginBottom: 8 }}>API key saved successfully.</div>
          )}
          {status === 'error' && (
            <div style={{ fontSize: 13, color: '#f87171', marginBottom: 8 }}>{testResult}</div>
          )}
          <div style={{ fontSize: 12, color: '#475569' }}>
            Get your key at{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
              style={{ color: '#60a5fa', textDecoration: 'underline' }}>
              aistudio.google.com/apikey
            </a>
          </div>
        </div>

        {/* Test Connection */}
        <div style={panelStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Test Connection</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            Send a test prompt to verify your Gemini API key works.
          </div>
          <button onClick={handleTest} disabled={testStatus === 'testing'}
            style={{ ...btnPurple, opacity: testStatus === 'testing' ? 0.5 : 1 }}>
            {testStatus === 'testing' ? 'Testing...' : 'Test Gemini Connection'}
          </button>
          {testStatus === 'success' && (
            <div style={{ marginTop: 14, background: '#052e16', border: '1px solid #166534', borderRadius: 8, padding: 12, fontSize: 13, color: '#86efac' }}>
              {testResult}
            </div>
          )}
          {testStatus === 'error' && (
            <div style={{ marginTop: 14, background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: 12, fontSize: 13, color: '#fca5a5' }}>
              {testResult}
            </div>
          )}
        </div>

        {/* Cache */}
        <div style={panelStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Analysis Cache</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            Gemini results are cached to avoid repeated API calls.
          </div>
          {stats && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 10, color: '#475569' }}>Cached Analyses</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', fontFamily: "'DM Mono', monospace" }}>{stats.analyses}</div>
              </div>
              <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 10, color: '#475569' }}>Cached Documents</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', fontFamily: "'DM Mono', monospace" }}>{stats.documents}</div>
              </div>
            </div>
          )}
          <button onClick={handleClearCache} style={btnDanger}>Clear Cache</button>
        </div>

        {/* Google Drive */}
        <div style={panelStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Google Drive Documents</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            Download project files from Google Drive using the service account. Files are saved locally and their content is sent to Gemini during impact analysis.
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 10, color: '#475569' }}>Cached Documents</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', fontFamily: "'DM Mono', monospace" }}>{driveDocCount}</div>
            </div>
            {driveStatus && !driveStatus.isRunning && driveStatus.downloadedFiles > 0 && (
              <div style={{ background: '#1f2937', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 10, color: '#475569' }}>Last Run Files</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', fontFamily: "'DM Mono', monospace" }}>{driveStatus.downloadedFiles}</div>
              </div>
            )}
          </div>

          {/* Progress */}
          {driveStatus?.isRunning && (
            <div style={{ background: '#1f2937', borderRadius: 8, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Downloading...</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{driveStatus.processedUrls}/{driveStatus.totalUrls} URLs</span>
              </div>
              <div style={{ background: '#374151', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, #1d4ed8, #7c3aed)',
                  width: driveStatus.totalUrls > 0 ? `${(driveStatus.processedUrls / driveStatus.totalUrls * 100)}%` : '0%',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>{driveStatus.currentProject}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {driveStatus.downloadedFiles} downloaded, {driveStatus.skippedFiles} skipped
              </div>
            </div>
          )}

          {/* Errors */}
          {driveStatus && driveStatus.errors.length > 0 && !driveStatus.isRunning && (
            <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: 12, marginBottom: 16, maxHeight: 120, overflow: 'auto' }}>
              <div style={{ fontSize: 11, color: '#fca5a5', fontWeight: 700, marginBottom: 6 }}>{driveStatus.errors.length} errors</div>
              {driveStatus.errors.slice(0, 5).map((e, i) => (
                <div key={i} style={{ fontSize: 11, color: '#fca5a5', marginBottom: 2 }}>{e}</div>
              ))}
              {driveStatus.errors.length > 5 && (
                <div style={{ fontSize: 11, color: '#fca5a5' }}>...and {driveStatus.errors.length - 5} more</div>
              )}
            </div>
          )}

          <button
            onClick={handleDriveDownload}
            disabled={driveStatus?.isRunning}
            style={{ ...btnPrimary, opacity: driveStatus?.isRunning ? 0.4 : 1 }}
          >
            {driveStatus?.isRunning ? 'Downloading...' : 'Download Drive Files'}
          </button>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 10 }}>
            Requires <code style={{ color: '#94a3b8' }}>data/service-account.json</code> with Google Drive read access.
          </div>
        </div>

        {/* How it works */}
        <div style={panelStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 16 }}>How Impact Analysis Works</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#1f2937', borderRadius: 8, padding: 14 }}>
              <span style={chipStyle('#1e3a8a44', '#60a5fa')}>1. BATCH ANALYSIS</span>
              <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 10, lineHeight: 1.6 }}>
                Go to the <strong style={{ color: '#e2e8f0' }}>Impact</strong> tab and click <strong style={{ color: '#e2e8f0' }}>Start Full Analysis</strong>.
                Gemini analyzes all 822 projects in batches of ~22, grouped by DDS division, then cross-DDS.
              </p>
            </div>
            <div style={{ background: '#1f2937', borderRadius: 8, padding: 14 }}>
              <span style={chipStyle('#4a1d9644', '#c084fc')}>2. IMPACT DETECTION</span>
              <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 10, lineHeight: 1.6 }}>
                For each batch, Gemini identifies directed relationships: which project <strong style={{ color: '#e2e8f0' }}>blocks, enables, feeds data to, competes with, or requires coordination</strong> with another.
              </p>
            </div>
            <div style={{ background: '#1f2937', borderRadius: 8, padding: 14 }}>
              <span style={chipStyle('#052e1644', '#4ade80')}>3. DRIVE DOCUMENTS</span>
              <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 10, lineHeight: 1.6 }}>
                If you download Drive files first, their content is <strong style={{ color: '#e2e8f0' }}>automatically included</strong> in the Gemini prompts — giving the AI richer context about each project (documents, spreadsheets, presentations).
              </p>
            </div>
            <div style={{ background: '#1f2937', borderRadius: 8, padding: 14 }}>
              <span style={chipStyle('#431407', '#fb923c')}>4. CROSS-DDS</span>
              <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 10, lineHeight: 1.6 }}>
                After intra-DDS analysis, the engine takes the top projects from each division and analyzes
                <strong style={{ color: '#e2e8f0' }}> cross-organizational impacts</strong> — finding dependencies across Americas, APAC, EU, CF, etc.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
