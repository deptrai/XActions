'use client';

// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Story 48.5 — Proxy Pool Manager (/proxies)
 *
 * Proxy pool CRUD + health + rotation stats:
 *  - Add proxy URL(s) into the dual pool (realtime / bulk)
 *  - Health table: server, protocol, pool tier, status, latency, success rate
 *  - Rotation stats: healthy vs total, realtime/bulk split, quarantine state
 *  - Quarantine / release controls
 *
 * Invariants:
 * - 'use client' component
 * - All API requests route via api() helper to /api/* BFF proxy (no raw fetch)
 * - Realtime via lib/realtime.ts with polling fallback
 * - Hand-rolled Tailwind CSS + Lucide React (no shadcn/radix)
 * - Offline → seeded data; add errors surface inline
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Server,
  RefreshCw,
  Plus,
  ShieldOff,
  ShieldCheck,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Bell,
  X,
  Gauge,
  Layers,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getRealtimeClient, type RealtimeStatus, type SystemHealthData } from '@/lib/realtime';

// ==========================================
// Types & Interfaces
// ==========================================

export interface ProxyRow {
  id: string;
  server: string;
  protocol: string;
  pool: 'realtime' | 'bulk' | string;
  status: 'healthy' | 'quarantined';
  latency?: number;
  successRate?: number;
  quarantinedUntil?: number | null;
  failCount?: number;
}

export interface ProxyStats {
  healthyCount: number;
  totalCount: number;
  isAllQuarantined?: boolean;
}

// ==========================================
// Seed Data (offline fallback)
// ==========================================

const INITIAL_PROXIES: ProxyRow[] = [
  { id: 'px-1', server: '103.152.220.14:8000', protocol: 'SOCKS5', pool: 'realtime', status: 'healthy', latency: 45, successRate: 99.4 },
  { id: 'px-2', server: '14.225.210.89:3128', protocol: 'HTTP', pool: 'realtime', status: 'healthy', latency: 38, successRate: 98.8 },
  { id: 'px-3', server: '118.69.135.24:8080', protocol: 'HTTPS', pool: 'bulk', status: 'healthy', latency: 120, successRate: 85.2 },
  { id: 'px-4', server: '171.244.33.102:1080', protocol: 'SOCKS5', pool: 'bulk', status: 'quarantined', latency: 420, successRate: 42.1, failCount: 7 },
  { id: 'px-5', server: '45.118.144.12:8888', protocol: 'HTTP', pool: 'bulk', status: 'healthy', latency: 62, successRate: 97.5 },
];

// ==========================================
// Helpers
// ==========================================

function normalizeProxy(raw: Record<string, unknown>, index: number): ProxyRow {
  const server = (raw.server as string) || (raw.host as string) || `proxy-${index}`;
  return {
    id: ((raw.key as string) || server) as string,
    server,
    protocol: ((raw.protocol as string) || 'HTTP').toUpperCase(),
    pool: (raw.pool as string) || (raw.residential ? 'realtime' : 'bulk'),
    status: raw.isQuarantined || raw.status === 'quarantined' ? 'quarantined' : 'healthy',
    latency: typeof raw.latency === 'number' ? raw.latency : undefined,
    successRate: typeof raw.successRate === 'number' ? raw.successRate : undefined,
    quarantinedUntil: (raw.quarantinedUntil as number) || null,
    failCount: typeof raw.failCount === 'number' ? raw.failCount : undefined,
  };
}

function latencyTone(latency: number | undefined): string {
  if (latency === undefined) return 'text-slate-400';
  if (latency < 80) return 'text-emerald-600 dark:text-emerald-400';
  if (latency < 200) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

// ==========================================
// Main Component
// ==========================================

export default function ProxyPoolPage() {
  const [proxies, setProxies] = useState<ProxyRow[]>(INITIAL_PROXIES);
  const [stats, setStats] = useState<ProxyStats>({ healthyCount: 4, totalCount: 5 });
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disconnected');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Add-proxy form state
  const [newProxyUrl, setNewProxyUrl] = useState('');
  const [newProxyPool, setNewProxyPool] = useState<string>('bulk');
  const [isAdding, setIsAdding] = useState(false);

  // Toast Helper
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  }, []);

  // Realtime client binding (socket.io falls back to polling when unavailable)
  useEffect(() => {
    const client = getRealtimeClient({ autoConnect: true });
    setRealtimeStatus(client.getStatus());
    const unsubscribeStatus = client.onStatusChange((status) => {
      setRealtimeStatus(status);
    });
    return () => {
      unsubscribeStatus();
    };
  }, []);

  // Fetch proxy pool + health stats from BFF
  const fetchProxies = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Primary: admin proxy pool listing (detailed rows)
      const res = await api<{ proxies?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>>; healthyCount?: number; totalCount?: number }>(
        'GET',
        '/api/admin/proxies'
      );
      if (res.ok && res.data) {
        const list = res.data.proxies || res.data.items || null;
        if (Array.isArray(list) && list.length > 0) {
          setProxies(list.map(normalizeProxy));
        }
        if (typeof res.data.healthyCount === 'number' && typeof res.data.totalCount === 'number') {
          setStats({ healthyCount: res.data.healthyCount, totalCount: res.data.totalCount, isAllQuarantined: (res.data as Record<string, unknown>).isAllQuarantined as boolean | undefined });
        }
      }

      // Secondary: public pool health counters
      const stRes = await api<ProxyStats>('GET', '/api/proxies/status');
      if (stRes.ok && stRes.data && typeof stRes.data.healthyCount === 'number') {
        setStats((prev) => ({
          ...prev,
          healthyCount: stRes.data?.healthyCount ?? prev.healthyCount,
          totalCount: stRes.data?.totalCount ?? prev.totalCount,
          isAllQuarantined: stRes.data?.isAllQuarantined ?? prev.isAllQuarantined,
        }));
      }
    } catch {
      // Graceful offline fallback — keep seeded rows
      showToast('Backend unreachable. Showing seed data.', 'info');
    } finally {
      setIsRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchProxies();
  }, [fetchProxies]);

  // Realtime health pulse re-syncs pool stats between manual refreshes
  useEffect(() => {
    const client = getRealtimeClient({ autoConnect: true });
    const unsubscribeHealth = client.subscribe<SystemHealthData>('health:update', () => {
      fetchProxies();
    });
    return () => {
      unsubscribeHealth();
    };
  }, [fetchProxies]);

  // ==========================================
  // Add Proxy
  // ==========================================

  const handleAddProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);

    const urls = newProxyUrl
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      setInlineError('Enter at least one proxy URL (e.g. socks5://user:pass@host:port).');
      return;
    }

    setIsAdding(true);
    const optimistic: ProxyRow = {
      id: `pending-${Date.now()}`,
      server: urls[0].replace(/^[a-z0-9]+:\/\//i, ''),
      protocol: (urls[0].split('://')[0] || 'HTTP').toUpperCase(),
      pool: newProxyPool,
      status: 'healthy',
      latency: undefined,
      successRate: undefined,
    };

    const previous = [...proxies];
    setProxies((prev) => [optimistic, ...prev]);

    try {
      const res = await api('POST', '/api/proxies/add', { body: { proxies: urls } });
      if (res.ok) {
        showToast(`Added ${urls.length} proxy URL(s) to the ${newProxyPool} pool.`, 'success');
        setNewProxyUrl('');
        fetchProxies();
      } else {
        setProxies(previous);
        setInlineError(String(res.error?.message ?? '') || 'Proxy rejected by backend.');
        showToast(`Failed to add proxy: ${String(res.error?.message ?? 'Server error')}`, 'error');
      }
    } catch {
      setProxies(previous);
      setInlineError('Network error while adding proxy.');
      showToast('Network error while adding proxy.', 'error');
    } finally {
      setIsAdding(false);
    }
  };

  // ==========================================
  // Quarantine / Release
  // ==========================================

  const handleToggleQuarantine = async (row: ProxyRow) => {
    const isQuarantine = row.status !== 'quarantined';
    setBusyId(row.id);
    const previous = [...proxies];
    setProxies((prev) =>
      prev.map((p) => (p.id === row.id ? { ...p, status: isQuarantine ? 'quarantined' : 'healthy' } : p))
    );

    try {
      const endpoint = isQuarantine ? '/api/admin/proxies/quarantine' : '/api/admin/proxies/release';
      const res = await api('POST', endpoint, { body: { proxy: row.server, key: row.id } });
      if (res.ok) {
        showToast(`Proxy ${row.server} ${isQuarantine ? 'quarantined' : 'released back to pool'}.`, 'success');
        fetchProxies();
      } else {
        setProxies(previous);
        showToast(`Failed to update ${row.server}: ${String(res.error?.message ?? 'Server error')}`, 'error');
      }
    } catch {
      setProxies(previous);
      showToast(`Network error updating ${row.server}.`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  // ==========================================
  // Rotation Stats
  // ==========================================

  const rotationStats = useMemo(() => {
    const realtime = proxies.filter((p) => p.pool === 'realtime').length;
    const bulk = proxies.filter((p) => p.pool === 'bulk').length;
    const quarantined = proxies.filter((p) => p.status === 'quarantined').length;
    const withLatency = proxies.filter((p) => typeof p.latency === 'number') as Array<ProxyRow & { latency: number }>;
    const avgLatency =
      withLatency.length > 0
        ? Math.round(withLatency.reduce((sum, p) => sum + p.latency, 0) / withLatency.length)
        : null;
    return { realtime, bulk, quarantined, avgLatency, healthPct: stats.totalCount > 0 ? Math.round((stats.healthyCount / stats.totalCount) * 100) : 0 };
  }, [proxies, stats]);

  // ==========================================
  // Render
  // ==========================================

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl border text-sm font-medium transition-all duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-800'
              : toast.type === 'error'
              ? 'bg-rose-950/90 text-rose-200 border-rose-800'
              : 'bg-slate-900/95 text-slate-200 border-slate-700'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />}
          {toast.type === 'info' && <Bell className="w-5 h-5 text-blue-400 shrink-0" />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
              <Server className="w-7 h-7 text-emerald-500" />
              Proxy Pool Manager
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
              Infra
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Dual-pool proxy fleet: add nodes, monitor health metrics, quarantine bad exits.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-600 dark:text-slate-300">
            <span
              className={`w-2 h-2 rounded-full ${
                realtimeStatus === 'connected'
                  ? 'bg-emerald-500 animate-pulse'
                  : realtimeStatus === 'polling'
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
            />
            <span className="capitalize">{realtimeStatus}</span>
          </div>

          <button
            onClick={fetchProxies}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync Pool</span>
          </button>
        </div>
      </div>

      {/* Rotation Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Healthy', value: String(stats.healthyCount), color: 'text-emerald-500', icon: ShieldCheck },
          { label: 'Total Nodes', value: String(stats.totalCount), color: 'text-blue-500', icon: Server },
          { label: 'Quarantined', value: String(rotationStats.quarantined), color: 'text-rose-500', icon: ShieldOff },
          { label: 'Realtime Pool', value: String(rotationStats.realtime), color: 'text-purple-500', icon: Activity },
          { label: 'Bulk Pool', value: String(rotationStats.bulk), color: 'text-slate-500', icon: Layers },
          { label: 'Avg Latency', value: rotationStats.avgLatency !== null ? `${rotationStats.avgLatency}ms` : '—', color: 'text-amber-500', icon: Gauge },
        ].map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div
              key={i}
              className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm"
            >
              <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
                <Icon className="w-3.5 h-3.5" />
                {stat.label}
              </div>
              <div className={`mt-1.5 text-xl font-bold font-mono ${stat.color}`}>{stat.value}</div>
            </div>
          );
        })}
      </div>

      {/* Add Proxy Form */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Plus className="w-5 h-5 text-emerald-500" />
            Add Proxy URL(s)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Format: protocol://user:pass@host:port — comma- or newline-separated for bulk add.
          </p>
        </div>

        <form onSubmit={handleAddProxy} className="flex flex-col sm:flex-row gap-3">
          <select
            value={newProxyPool}
            onChange={(e) => setNewProxyPool(e.target.value)}
            className="px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
          >
            <option value="bulk">Bulk Pool</option>
            <option value="realtime">Realtime Pool</option>
          </select>
          <input
            type="text"
            value={newProxyUrl}
            onChange={(e) => setNewProxyUrl(e.target.value)}
            placeholder="socks5://user:pass@103.152.220.14:8000, http://45.118.144.12:8888"
            className="flex-1 px-3 py-2 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <button
            type="submit"
            disabled={isAdding}
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 shadow-sm"
          >
            <Plus className={`w-4 h-4 ${isAdding ? 'animate-pulse' : ''}`} />
            Add to Pool
          </button>
        </form>

        {inlineError && (
          <div className="px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <XCircle className="w-4 h-4 shrink-0" />
            {inlineError}
          </div>
        )}
      </div>

      {/* Proxy Health Table */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-500" />
              Proxy Pool & Health Table
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Exit nodes, protocol, dual-pool tier, measured latency, success rate, and quarantine controls.
              {rotationStats.healthPct > 0 && (
                <span className="ml-2 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {stats.healthyCount}/{stats.totalCount} healthy ({rotationStats.healthPct}%)
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
              <tr>
                <th className="py-2.5 px-3">Server</th>
                <th className="py-2.5 px-3">Protocol</th>
                <th className="py-2.5 px-3">Pool</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Latency</th>
                <th className="py-2.5 px-3">Success Rate</th>
                <th className="py-2.5 px-3">Failures</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {proxies.map((px) => (
                <tr key={px.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="py-2.5 px-3 font-mono font-medium text-slate-900 dark:text-white">
                    {px.server}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                    {px.protocol}
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        px.pool === 'realtime'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {px.pool}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        px.status === 'healthy'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      }`}
                    >
                      {px.status}
                    </span>
                  </td>
                  <td className={`py-2.5 px-3 font-mono ${latencyTone(px.latency)}`}>
                    {px.latency !== undefined ? `${px.latency}ms` : '—'}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {px.successRate !== undefined ? `${px.successRate}%` : '—'}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                    {px.failCount ?? 0}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => handleToggleQuarantine(px)}
                      disabled={busyId === px.id}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-50 ${
                        px.status === 'quarantined'
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                      }`}
                    >
                      {px.status === 'quarantined' ? 'Release' : 'Quarantine'}
                    </button>
                  </td>
                </tr>
              ))}
              {proxies.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                    No proxies registered. Add an exit node above.
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
