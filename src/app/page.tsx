'use client';

import { useEffect } from 'react';
import { useProjectContext } from '@/context/ProjectContext';
import Header from '@/components/Header';
import Toolbar from '@/components/Toolbar';
import Sidebar from '@/components/Sidebar';
import GraphView from '@/components/GraphView';
import MatrixView from '@/components/MatrixView';
import TimelineView from '@/components/TimelineView';
import DetailView from '@/components/DetailView';
import ImpactView from '@/components/ImpactView';
import FileUpload from '@/components/FileUpload';

export default function Home() {
  const { projects, view, refreshProjects, isLoading } = useProjectContext();

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Show upload screen if no projects loaded
  if (!isLoading && projects.length === 0) {
    return (
      <div className="min-h-screen flex flex-col bg-[#0a0e1a]">
        <Header />
        <FileUpload />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0e1a] overflow-hidden" style={{ height: '100vh' }}>
      <Header />
      <Toolbar />

      <div className="flex-1 flex overflow-hidden">
        {view === 'graph' && <GraphView />}
        {view === 'matrix' && <MatrixView />}
        {view === 'timeline' && <TimelineView />}
        {view === 'detail' && <DetailView />}
        {view === 'impact' && <ImpactView />}

        <Sidebar />
      </div>
    </div>
  );
}
