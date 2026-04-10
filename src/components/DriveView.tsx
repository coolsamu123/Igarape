'use client';

import { useState, useEffect } from 'react';
import { useProjectContext } from '@/context/ProjectContext';

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

  const [localPaths, setLocalPaths] = useState<Record<string, string>>({});

  const [newProjectUrl, setNewProjectUrl] = useState('');
  const [addingState, setAddingState] = useState<'idle' | 'adding' | 'success' | 'error'>('idle');
  const [addResult, setAddResult] = useState('');

  const [assocSearch, setAssocSearch] = useState('');
  const [assocUrl, setAssocUrl] = useState('');
  const [assocState, setAssocState] = useState<'idle' | 'adding' | 'success' | 'error'>('idle');
  const [assocResult, setAssocResult] = useState('');
  
  // Filter state for the list
  const [filterText, setFilterText] = useState('');

  const loadDriveStatus = async () => {
    try {
      const res = await fetch('/api/drive');
      const data = await res.json();
      if (data.status) setDriveStatus(data.status);
      if (data.localPaths) setLocalPaths(data.localPaths);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadDriveStatus();
  }, []);

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

  const handleDownloadSingle = async (projectId: string) => {
    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start_single', projectId }),
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
      
      setAddingState('success');
      setAddResult(`Successfully discovered ${data.project.projectId}: ${data.project.name}. Starting download...`);
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

  
  const assocProjectMatch = assocSearch.trim().length >= 3 
    ? projects.find(p => p.projectId.toLowerCase().includes(assocSearch.toLowerCase()) || p.name.toLowerCase().includes(assocSearch.toLowerCase()))
    : null;

  // Only show projects that have a valid link, or that are currently selected in the UI if needed
  // For the list, let's sort by presence of a link
  const projectsWithLinks = projects.filter(p => 
    (p.linkFolder && p.linkFolder.includes('drive.google.com')) || 
    (p.linkPositions && p.linkPositions.includes('drive.google.com')) || 
    (p.linkCIOO && p.linkCIOO.includes('drive.google.com'))
  );

  const searchFilter = filterText.toLowerCase();
  const filteredProjectsWithLinks = projectsWithLinks.filter(p => {
    if (!searchFilter) return true;
    return p.projectId.toLowerCase().includes(searchFilter) ||
           p.name.toLowerCase().includes(searchFilter) ||
           (p.description && p.description.toLowerCase().includes(searchFilter));
  });

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

      {/* Projects List */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex flex-col gap-3 bg-gray-800/50">
          <div className="flex justify-between items-center">
            <h3 className="text-md font-bold text-gray-200">
              Projects with Drive Links ({filteredProjectsWithLinks.length})
            </h3>
          </div>
          <input
            type="text"
            placeholder="Filter by project ID, name, or description..."
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            className="w-full bg-gray-950 border border-gray-700 text-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-900/80 text-gray-400 text-xs uppercase border-b border-gray-800">
              <tr>
                <th className="px-5 py-3 font-medium">Project</th>
                <th className="px-5 py-3 font-medium">Drive Links</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filteredProjectsWithLinks.map(project => {
                                const links: { url: string }[] = [];
                [project.linkFolder, project.linkPositions, project.linkCIOO].forEach(field => {
                  if (field) {
                    field.split(/\s+/).forEach(url => {
                      if (url.includes('drive.google.com')) links.push({ url });
                    });
                  }
                });

                return (
                  <tr key={project.projectId} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-3 align-top">
                      <div className="font-mono text-xs text-blue-400 mb-0.5">{project.projectId}</div>
                      <div className="text-gray-200 font-medium">{project.name}</div>
                    </td>
                    <td className="px-5 py-3 align-top">
                                            <div className="flex flex-col gap-1.5">
                        {links.map((link, i) => (
                          <a 
                            key={i} 
                            href={link.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 hover:underline inline-flex items-center gap-1 max-w-[200px] truncate"
                            title={link.url}
                          >
                            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            {link.url}
                          </a>
                        ))}
                        {localPaths[project.projectId] && (
                          <div className="mt-1 pt-1 border-t border-gray-800">
                            <span className="text-[10px] text-gray-500 uppercase font-semibold">Local Copy:</span>
                            <div className="text-[11px] font-mono text-gray-400 mt-0.5 break-all pr-4" title={localPaths[project.projectId]}>
                              {localPaths[project.projectId]}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 align-top text-right">
                      <button
                        onClick={() => handleDownloadSingle(project.projectId)}
                        disabled={driveStatus?.isRunning}
                        className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-xs font-medium hover:bg-gray-700 transition-colors border border-gray-700 disabled:opacity-40"
                      >
                        Download files
                      </button>
                    </td>
                  </tr>
                );
              })}
              
              {filteredProjectsWithLinks.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-gray-500">
                    No projects found with Google Drive links.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
