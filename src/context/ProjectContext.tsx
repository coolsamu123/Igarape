'use client';

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { ProjectSummary, SimilarityLink, FilterState, ViewType, AnalysisResult } from '@/lib/types';
import { buildSimilarityLinks } from '@/lib/similarity';

interface ProjectContextType {
  // Data
  projects: ProjectSummary[];
  links: SimilarityLink[];
  stats: Record<string, unknown> | null;
  isLoading: boolean;
  error: string | null;

  // UI State
  view: ViewType;
  setView: (v: ViewType) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  threshold: number;
  setThreshold: (t: number) => void;
  filters: FilterState;
  setFilters: (f: FilterState) => void;

  // Filtered data
  filtered: ProjectSummary[];

  // Actions
  uploadFile: (file: File) => Promise<{ count: number; errors: string[] }>;
  refreshProjects: () => Promise<void>;
  analyzeProjects: (projects: ProjectSummary[], type: 'pairwise' | 'cluster') => Promise<AnalysisResult>;
  analyzeWithDocs: (projects: ProjectSummary[], urls: string[]) => Promise<AnalysisResult>;

  // Analysis cache
  analysisResults: Map<string, AnalysisResult>;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<ViewType>('detail');
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.15);
  const [filters, setFilters] = useState<FilterState>({
    dds: 'All',
    gate: 'All',
    decision: 'All',
    yearFrom: null,
    yearTo: null,
    search: '',
  });
  const [analysisResults, setAnalysisResults] = useState<Map<string, AnalysisResult>>(new Map());

  const filtered = useMemo(() => {
    return projects.filter(p => {
      if (filters.dds !== 'All' && p.dds !== filters.dds) return false;
      if (filters.gate !== 'All' && p.currentGate !== filters.gate) return false;
      if (filters.decision !== 'All' && p.latestDecision !== filters.decision) return false;
      if (filters.yearFrom) {
        const year = parseInt(p.lastReviewDate?.slice(0, 4));
        if (!year || year < filters.yearFrom) return false;
      }
      if (filters.yearTo) {
        const year = parseInt(p.lastReviewDate?.slice(0, 4));
        if (!year || year > filters.yearTo) return false;
      }
      if (filters.search) {
        const s = filters.search.toLowerCase();
        const match = p.name.toLowerCase().includes(s) ||
          p.projectId.toLowerCase().includes(s) ||
          p.description.toLowerCase().includes(s) ||
          p.remarks.toLowerCase().includes(s);
        if (!match) return false;
      }
      return true;
    });
  }, [projects, filters]);

  const links = useMemo(() => {
    // Limit to 200 projects for performance in graph
    const subset = filtered.slice(0, 200);
    return buildSimilarityLinks(subset, threshold);
  }, [filtered, threshold]);

  const uploadFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/projects/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Refresh projects after upload
      await refreshProjectsInner();
      return { count: data.count, errors: data.errors || [] };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshProjectsInner = async () => {
    const res = await fetch('/api/projects');
    const data = await res.json();
    if (data.projects) {
      setProjects(data.projects);
      setStats(data.stats || null);
    }
  };

  const refreshProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await refreshProjectsInner();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load projects';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const analyzeProjects = useCallback(async (projectList: ProjectSummary[], type: 'pairwise' | 'cluster') => {
    const key = projectList.map(p => p.projectId).sort().join(',') + ':' + type;
    const cached = analysisResults.get(key);
    if (cached) return cached;

    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, projects: projectList }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    setAnalysisResults(prev => new Map(prev).set(key, data.analysis));
    return data.analysis as AnalysisResult;
  }, [analysisResults]);

  const analyzeWithDocs = useCallback(async (projectList: ProjectSummary[], urls: string[]) => {
    const res = await fetch('/api/analyze/document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects: projectList, urls }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.analysis as AnalysisResult;
  }, []);

  return (
    <ProjectContext.Provider value={{
      projects, links, stats, isLoading, error,
      view, setView, selected, setSelected, hovered, setHovered,
      threshold, setThreshold, filters, setFilters,
      filtered, uploadFile, refreshProjects,
      analyzeProjects, analyzeWithDocs, analysisResults,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider');
  return ctx;
}
