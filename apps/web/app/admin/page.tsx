'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Server,
  Radio,
  Coins,
  Cpu,
  RefreshCw,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Layers,
  Search,
} from 'lucide-react';
import { api } from '@/lib/api';

interface Checkpoint {
  id: string;
  crawler: string;
  target: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  itemsScraped: number;
  lastActive: string;
}

interface ProxyNode {
  id: string;
  ip: string;
  protocol: string;
  status: 'healthy' | 'quarantined' | 'cooldown';
  latency: number;
  successRate: number;
}

const INITIAL_CHECKPOINTS: Checkpoint[] = [
  { id: 'cp-8412', crawler: 'twitter-hybrid', target: '@elonmusk', status: 'running', itemsScraped: 12450, lastActive: '2s ago' },
  { id: 'cp-8413', crawler: 'facebook-marketplace', target: 'Hanoi Real Estate', status: 'paused', itemsScraped: 4320, lastActive: '5m ago' },
  { id: 'cp-8414', crawler: 'threads-graphql', target: '#buildinpublic', status: 'completed', itemsScraped: 8500, lastActive: '12m ago' },
  { id: 'cp-8415', crawler: 'tiktok-video', target: '@ai_trends', status: 'failed', itemsScraped: 310, lastActive: '25m ago' },
];

const INITIAL_PROXIES: ProxyNode[] = [
  { id: 'px-1', ip: '103.152.220.14', protocol: 'SOCKS5', status: 'healthy', latency: 45, successRate: 99.4 },
  { id: 'px-2', ip: '14.225.210.89', protocol: 'HTTP', status: 'healthy', latency: 38, successRate: 98.8 },
  { id: 'px-3', ip: '118.69.135.24', protocol: 'HTTPS', status: 'cooldown', latency: 120, successRate: 85.2 },
  { id: 'px-4', ip: '171.244.33.102', protocol: 'SOCKS5', status: 'quarantined', latency: 420, successRate: 42.1 },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'checkpoints' | 'proxies' | 'stream' | 'payments'>('checkpoints');
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(INITIAL_CHECKPOINTS);
  const [proxies, setProxies] = useState<ProxyNode[]>(INITIAL_PROXIES);
  const [search, setSearch] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchLiveStatus = async () => {
    setIsRefreshing(true);
    try {
      const res = await api<Checkpoint[]>('GET', '/api/checkpoints');
      if (res.ok && Array.isArray(res.data)) {
        setCheckpoints(res.data);
      }
    } catch {}
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleAction = async (id: string, action: 'resume' | 'pause' | 'retry') => {
    // Optimistic UI update
    setCheckpoints((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const nextStatus = action === 'pause' ? 'paused' : 'running';
          return { ...c, status: nextStatus };
        }
        return c;
      })
    );

    try {
      await api('POST', `/api/checkpoints/${encodeURIComponent(id)}/${action}`);
    } catch {}
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-600">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              System Admin & Infrastructure Control
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Realtime control plane for crawlers, proxy quarantine pool, operational checkpoints, and stream health.
          </p>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={fetchLiveStatus}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync Live Metrics</span>
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-xs font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab('checkpoints')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-all ${
            activeTab === 'checkpoints'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>Jobs & Checkpoints</span>
        </button>
        <button
          onClick={() => setActiveTab('proxies')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-all ${
            activeTab === 'proxies'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>Proxies & Accounts</span>
        </button>
        <button
          onClick={() => setActiveTab('stream')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-all ${
            activeTab === 'stream'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Radio className="w-4 h-4" />
          <span>Stream Metrics & Alerts</span>
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-all ${
            activeTab === 'payments'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Coins className="w-4 h-4" />
          <span>x402 Micropayments</span>
        </button>
      </div>

      {/* Tab 1: Jobs & Checkpoints */}
      {activeTab === 'checkpoints' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter crawler jobs..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <span className="text-xs text-slate-400 font-medium">{checkpoints.length} Active Tasks</span>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Task ID</th>
                  <th className="py-3 px-4">Crawler</th>
                  <th className="py-3 px-4">Target Query</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Scraped Items</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {checkpoints
                  .filter((c) => c.crawler.includes(search) || c.target.includes(search) || c.id.includes(search))
                  .map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">{item.id}</td>
                      <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-300">{item.crawler}</td>
                      <td className="py-3 px-4 text-slate-500 max-w-xs truncate">{item.target}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            item.status === 'running'
                              ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                              : item.status === 'paused'
                              ? 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400'
                              : item.status === 'failed'
                              ? 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono">{item.itemsScraped.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {item.status === 'running' ? (
                            <button
                              onClick={() => handleAction(item.id, 'pause')}
                              className="p-1 rounded text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                              title="Pause job"
                            >
                              <Pause className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAction(item.id, 'resume')}
                              className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                              title="Resume job"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleAction(item.id, 'retry')}
                            className="p-1 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                            title="Retry from checkpoint"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Proxies & Accounts */}
      {activeTab === 'proxies' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <span className="text-xs text-slate-400">Total IP Pool</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">2,450</p>
              <span className="text-[11px] text-emerald-600 flex items-center gap-1 mt-1 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" /> 98.2% Pool Health
              </span>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <span className="text-xs text-slate-400">Auto-Quarantine Threshold</span>
              <p className="text-2xl font-black text-amber-500 mt-1">3x 429 Errors</p>
              <span className="text-[11px] text-slate-400 mt-1 block">Cooldown: 15 minutes</span>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <span className="text-xs text-slate-400">Average Tunnel Latency</span>
              <p className="text-2xl font-black text-blue-500 mt-1">54 ms</p>
              <span className="text-[11px] text-slate-400 mt-1 block">TLS Spoofing: Active</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Node ID</th>
                  <th className="py-3 px-4">IP Address</th>
                  <th className="py-3 px-4">Protocol</th>
                  <th className="py-3 px-4">Health Status</th>
                  <th className="py-3 px-4">Latency</th>
                  <th className="py-3 px-4 text-right">Success Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {proxies.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold">{p.id}</td>
                    <td className="py-3 px-4 font-mono">{p.ip}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        {p.protocol}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          p.status === 'healthy'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                            : p.status === 'cooldown'
                            ? 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400'
                            : 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono">{p.latency}ms</td>
                    <td className="py-3 px-4 font-mono font-bold text-right">{p.successRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Stream Metrics & Alerts */}
      {activeTab === 'stream' && (
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Realtime Social Event Pipeline
              </h3>
              <p className="text-xs text-slate-500">
                Connected to Redis Stream <code className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">stream:social:raw_posts</code>
              </p>
            </div>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>Streaming Active</span>
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-400">Events / Sec</span>
              <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">48.2 eps</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-400">Redis Lag</span>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">0 ms</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-400">Active Alert Triggers</span>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">14 Rules</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-400">Dead Letter Queue</span>
              <p className="text-xl font-bold text-slate-600 dark:text-slate-400 mt-1">0 Items</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: x402 Micropayments */}
      {activeTab === 'payments' && (
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                x402 Protocol Settlement Ledger
              </h3>
              <p className="text-xs text-slate-500">
                Multi-chain settlement on Base (8453), Arbitrum, Optimism, Polygon
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              USDC Facilitator: Active
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-400">Total Volume Settled</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">$4,289.40</p>
              <span className="text-[11px] text-slate-500 mt-1 block">4,289,400 Micro-transactions</span>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-400">Gas Overhead</span>
              <p className="text-2xl font-black text-emerald-500 mt-1">&lt; $0.0001</p>
              <span className="text-[11px] text-slate-500 mt-1 block">Batched L2 execution</span>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-400">API Endpoint Price</span>
              <p className="text-2xl font-black text-purple-500 mt-1">$0.001</p>
              <span className="text-[11px] text-slate-500 mt-1 block">Per successful scrape</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
