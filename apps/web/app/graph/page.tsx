// by nichxbt
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Network, RefreshCw, ZoomIn, ZoomOut, Info } from 'lucide-react';
import { api } from '@/lib/api';

interface GraphNode {
  id: string;
  label: string;
  group: string;
  size: number;
  x?: number;
  y?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

const GROUP_COLORS: Record<string, string> = {
  influencer: '#6366f1',
  community: '#10b981',
  bridge: '#f59e0b',
  peripheral: '#64748b',
  seed: '#ef4444',
};

const SEEDED_NODES: GraphNode[] = [
  { id: 'seed', label: '@you', group: 'seed', size: 24 },
  { id: 'n1', label: '@crypto_whale', group: 'influencer', size: 18 },
  { id: 'n2', label: '@defi_analyst', group: 'influencer', size: 16 },
  { id: 'n3', label: '@tech_guru', group: 'community', size: 14 },
  { id: 'n4', label: '@ai_researcher', group: 'community', size: 14 },
  { id: 'n5', label: '@bridge_bot', group: 'bridge', size: 12 },
  { id: 'n6', label: '@news_feed', group: 'peripheral', size: 10 },
  { id: 'n7', label: '@meme_lord', group: 'peripheral', size: 10 },
  { id: 'n8', label: '@nft_collector', group: 'community', size: 12 },
  { id: 'n9', label: '@dao_voter', group: 'bridge', size: 11 },
  { id: 'n10', label: '@web3_dev', group: 'influencer', size: 15 },
];

const SEEDED_EDGES: GraphEdge[] = [
  { source: 'seed', target: 'n1', weight: 3 },
  { source: 'seed', target: 'n3', weight: 2 },
  { source: 'seed', target: 'n5', weight: 2 },
  { source: 'n1', target: 'n2', weight: 4 },
  { source: 'n1', target: 'n8', weight: 2 },
  { source: 'n2', target: 'n10', weight: 3 },
  { source: 'n3', target: 'n4', weight: 3 },
  { source: 'n3', target: 'n8', weight: 1 },
  { source: 'n5', target: 'n9', weight: 2 },
  { source: 'n5', target: 'n6', weight: 1 },
  { source: 'n4', target: 'n10', weight: 2 },
  { source: 'n7', target: 'n9', weight: 1 },
  { source: 'n8', target: 'n10', weight: 2 },
];

function layoutNodes(nodes: GraphNode[], width: number, height: number): GraphNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) * 0.7;
  return nodes.map((n, i) => {
    if (n.id === 'seed') return { ...n, x: cx, y: cy };
    const angle = (2 * Math.PI * (i - 1)) / (nodes.length - 1);
    const r = radius * (0.5 + 0.5 * Math.random());
    return { ...n, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}

export default function GraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>(SEEDED_EDGES);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState('');
  const WIDTH = 800;
  const HEIGHT = 560;

  useEffect(() => {
    setNodes(layoutNodes(SEEDED_NODES, WIDTH, HEIGHT));
  }, []);

  const handleBuild = async () => {
    if (!username.trim()) return;
    setIsLoading(true);
    try {
      const res = await api<{ id?: string; nodes?: GraphNode[]; edges?: GraphEdge[] }>(
        'POST',
        '/api/graph/build',
        { body: { username: username.trim(), depth: 2, maxNodes: 50 } }
      );
      if (res.ok && res.data?.nodes) {
        setNodes(layoutNodes(res.data.nodes, WIDTH, HEIGHT));
        if (res.data.edges) setEdges(res.data.edges);
      }
    } catch {
      // fallback to seeded
    } finally {
      setIsLoading(false);
    }
  };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600">
              <Network className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Social Graph
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Interactive network visualization — clusters, influencers, and bridge accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setZoom((z) => Math.min(z + 0.2, 3))} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={() => setZoom((z) => Math.max(z - 0.2, 0.4))} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400">
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Build Controls */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex gap-3">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleBuild()}
          placeholder="Enter @username to build graph..."
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          onClick={handleBuild}
          disabled={isLoading || !username.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm transition-colors disabled:opacity-60"
        >
          {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />}
          <span>{isLoading ? 'Building...' : 'Build Graph'}</span>
        </button>
      </div>

      {/* Graph Canvas */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
        >
          {/* Edges */}
          {edges.map((e, i) => {
            const src = nodeMap.get(e.source);
            const tgt = nodeMap.get(e.target);
            if (!src?.x || !src?.y || !tgt?.x || !tgt?.y) return null;
            return (
              <line
                key={i}
                x1={src.x}
                y1={src.y}
                x2={tgt.x}
                y2={tgt.y}
                stroke="#475569"
                strokeOpacity={0.4}
                strokeWidth={e.weight}
              />
            );
          })}
          {/* Nodes */}
          {nodes.map((n) => (
            <g key={n.id} onClick={() => setSelectedNode(n)} className="cursor-pointer">
              <circle
                cx={n.x}
                cy={n.y}
                r={n.size}
                fill={GROUP_COLORS[n.group] || '#64748b'}
                fillOpacity={0.85}
                stroke={selectedNode?.id === n.id ? '#fff' : 'transparent'}
                strokeWidth={3}
              />
              <text
                x={n.x}
                y={(n.y || 0) + n.size + 14}
                textAnchor="middle"
                className="fill-slate-700 dark:fill-slate-300"
                fontSize={10}
                fontFamily="monospace"
              >
                {n.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Legend + Selected Node */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Legend</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(GROUP_COLORS).map(([group, color]) => (
              <div key={group} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs text-slate-600 dark:text-slate-400 capitalize">{group}</span>
              </div>
            ))}
          </div>
        </div>
        {selectedNode && (
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-emerald-500" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Node Details</h3>
            </div>
            <p className="text-sm font-mono text-slate-700 dark:text-slate-300">{selectedNode.label}</p>
            <p className="text-xs text-slate-500 mt-1 capitalize">Group: {selectedNode.group} · Size: {selectedNode.size}</p>
          </div>
        )}
      </div>
    </div>
  );
}
