'use client';

import { useState, useEffect, useRef } from 'react';
import type { ProjectSummary, SimilarityLink } from '@/lib/types';

interface Position {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function useForceLayout(
  nodes: ProjectSummary[],
  links: SimilarityLink[],
  width: number,
  height: number
) {
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const animRef = useRef<number>(0);
  const posRef = useRef<Record<string, Position>>({});

  useEffect(() => {
    if (!nodes.length || !width || !height) return;

    // Initialize positions in a circle
    const pos: Record<string, Position> = {};
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const r = Math.min(width, height) * 0.35;
      pos[n.projectId] = {
        x: width / 2 + r * Math.cos(angle),
        y: height / 2 + r * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });
    posRef.current = pos;

    let tick = 0;
    const simulate = () => {
      tick++;
      const p = posRef.current;
      const alpha = Math.max(0.001, 0.3 * Math.exp(-tick * 0.015));

      // Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const pa = p[a.projectId], pb = p[b.projectId];
          if (!pa || !pb) continue;
          const dx = pb.x - pa.x;
          const dy = pb.y - pa.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (3000 / (dist * dist)) * alpha;
          pa.vx -= (dx / dist) * force;
          pa.vy -= (dy / dist) * force;
          pb.vx += (dx / dist) * force;
          pb.vy += (dy / dist) * force;
        }
      }

      // Attraction along links
      for (const link of links) {
        const a = p[link.source], b = p[link.target];
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ideal = 120 + (1 - link.strength) * 200;
        const force = (dist - ideal) * 0.05 * alpha * link.strength;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }

      // Center gravity
      for (const n of nodes) {
        const np = p[n.projectId];
        if (!np) continue;
        np.vx += (width / 2 - np.x) * 0.01 * alpha;
        np.vy += (height / 2 - np.y) * 0.01 * alpha;
      }

      // Integrate + dampen + bound
      for (const n of nodes) {
        const np = p[n.projectId];
        if (!np) continue;
        np.vx *= 0.85;
        np.vy *= 0.85;
        np.x = Math.max(60, Math.min(width - 60, np.x + np.vx));
        np.y = Math.max(60, Math.min(height - 60, np.y + np.vy));
      }

      setPositions({ ...p });
      if (tick < 200) animRef.current = requestAnimationFrame(simulate);
    };

    animRef.current = requestAnimationFrame(simulate);
    return () => cancelAnimationFrame(animRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, links.length, width, height]);

  return positions;
}
