'use client';

import { useCallback, useMemo, useState } from 'react';
import ReactFlow, {
  Background, BackgroundVariant, Controls, MiniMap,
  type Edge, type Node, type NodeMouseHandler, MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import StageNode from './nodes/StageNode';
import { STAGES, EDGES, type StageDef } from './stages';

// Grid sizing — drives the vertical (top → down) layout.
const ROW_HEIGHT = 140;       // px between row centers
const COL_WIDTH  = 280;       // px between column centers
const GRID_LEFT  = 80;        // canvas padding before first column
const GRID_TOP   = 60;

function positionFor(stage: StageDef): { x: number; y: number } {
  return {
    x: GRID_LEFT + stage.col * COL_WIDTH,
    y: GRID_TOP + stage.row * ROW_HEIGHT,
  };
}

const NODE_TYPES = { stage: StageNode };

export default function ArchitectureCanvas({ selectedId, onSelect }: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const nodes: Node[] = useMemo(() => STAGES.map(s => ({
    id: s.id,
    type: 'stage',
    position: positionFor(s),
    data: {
      icon: s.icon,
      name: s.name,
      subtitle: s.subtitle,
      type: s.type,
      isHovered: hoveredId === s.id,
    },
    selected: selectedId === s.id,
    draggable: false,
  })), [hoveredId, selectedId]);

  const edges: Edge[] = useMemo(() => EDGES.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    labelStyle: { fill: '#94a3b8', fontSize: 10, fontWeight: 500 },
    labelBgStyle: { fill: '#0d1117', fillOpacity: 0.85 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
    style: {
      stroke: e.dashed ? '#475569' : '#64748b',
      strokeWidth: e.dashed ? 1 : 1.5,
      strokeDasharray: e.dashed ? '4 4' : undefined,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: e.dashed ? '#475569' : '#64748b', width: 14, height: 14 },
    type: 'default',
  })), []);

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    onSelect(node.id === selectedId ? null : node.id);
  }, [onSelect, selectedId]);

  return (
    <div className="h-full w-full bg-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={(_, n) => setHoveredId(n.id)}
        onNodeMouseLeave={() => setHoveredId(null)}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1f2937" />
        <Controls position="bottom-right" showInteractive={false} className="!bg-surface-1 !border-line-strong" />
        <MiniMap
          position="top-right"
          pannable zoomable
          maskColor="rgba(0,0,0,0.5)"
          nodeColor={n => {
            const stage = STAGES.find(s => s.id === n.id);
            if (!stage) return '#374151';
            const colors: Record<string, string> = {
              manual: '#3b82f6', drive: '#a855f7', hygiene: '#64748b', parse: '#64748b',
              llm: '#f97316', sanitize: '#10b981', aggregate: '#22c55e', store: '#06b6d4', external: '#a1a1aa',
            };
            return colors[stage.type] || '#374151';
          }}
          className="!bg-surface-1 !border-line-strong"
        />
      </ReactFlow>
    </div>
  );
}
