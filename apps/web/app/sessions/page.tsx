'use client';

// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Story 48.5 — Account Sessions & Hibernation Manager (/sessions)
 *
 * Per-account session state:
 *  - Expiry countdown per account (derived from hibernatingUntil / remainingTimeMs)
 *  - Hibernation status badge (Expired, Hibernating, Active, Standby)
 *  - Actions: wake, probe, rotate
 *
 * Invariants:
 * - 'use client' component
 * - All API requests route via api() helper to /api/* BFF proxy (no raw fetch)
 * - Realtime via lib/realtime.ts with polling fallback
 * - Hand-rolled Tailwind CSS + Lucide React (no shadcn/radix)
 * - 401 / offline → seeded data with inline notice
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Timer,
  RefreshCw,
  Moon,
  Sun,
  Stethoscope,
  RotateCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Bell,
  X,
  Hourglass,
  Activity,
  Layers,
  Shield,
  Clock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getRealtimeClient, type RealtimeStatus, type SystemHealthData } from '@/lib/realtime';

// ==========================================
// Types & Interfaces
// ==========================================

export interface AccountSessionRow {
  id: string;
  platform: string;
  username: string;
  status: 'active' | 'hibernating' | 'expired' | 'standby';
  hibernatingUntil?: number | null;
  remainingSeconds: number;
  reason?: string;
  velocity?: number;
  assignedProxy?: string;
  healthScore: number;
  circuitState: 'closed' | 'open' | 'half-open';
  lastProbe?: string;
}

export interface AdminAccountsSessionResponse {
  total?: number;
  accounts?: Array<{
    platform: string;
    accountId: string;
    status?: string;
    hibernatingUntil?: number | null;
    remainingTimeMs?: number;
    reason?: string;
    velocity?: number;
    assignedProxy?: string;
    healthScore?: number;
    circuitState?: string;
  }>;
}

// ==========================================
// Seed Data (offline / 401 fallback)
// ==========================================

const INITIAL_SESSIONS: AccountSessionRow[] = [
  {
    id: 'acc-1',
    platform: 'twitter',
    username: '@bot_feeder_01',
    status: 'active',
    remainingSeconds: 0,
    velocity: 42,
    assignedProxy: '103.152.220.14:8000',
    healthScore: 94,
    circuitState: 'closed',
    lastProbe: '1m ago',
  },
  {
    id: 'acc-2',
    platform: 'twitter',
    username: '@signal_hound_9',
    status: 'hibernating',
    remainingSeconds: 384,
    reason: '429 Rate Limited by X',
    velocity: 0,
    assignedProxy: '14.225.210.89:3128',
    healthScore: 68,
    circuitState: 'open',
    lastProbe: '4m ago',
  },
  {
    id: 'acc-3',
    platform: 'threads',
    username: '@threads_watcher',
    status: 'active',
    remainingSeconds: 0,
    velocity: 28,
    assignedProxy: '118.69.135.24:8080',
    healthScore: 98,
    circuitState: 'closed',
    lastProbe: '30s ago',
  },
  {
    id: 'acc-4',
    platform: 'tiktok',
    username: '@tok_miner_alpha',
    status: 'expired',
    remainingSeconds: 0,
    reason: 'Session TTL exceeded, re-auth required',
    velocity: 0,
    assignedProxy: '171.244.33.102:1080',
    healthScore: 45,
    circuitState: 'open',
    lastProbe: '18m ago',
  },
  {
    id: 'acc-5',
    platform: 'facebook',
    username: '@fb_crawl_ops',
    status: 'hibernating',
    remainingSeconds: 85,
    reason: 'Inter-batch cooldown pause',
    velocity: 0,
    assignedProxy: '45.118.144.12:8888',
    healthScore: 88,
    circuitState: 'closed',
    lastProbe: '2m ago',
  },
];

// ==========================================
// Helpers
// ==========================================

function normalizeSession(
  raw: NonNullable<AdminAccountsSessionResponse['accounts']>[number]
): AccountSessionRow {
  const remSec =
    typeof raw.remainingTimeMs === 'number'
      ? Math.max(0, Math.round(raw.remainingTimeMs / 1000))
      : 0;

  let computedStatus: AccountSessionRow['status'] = 'active';
  if (raw.status === 'hibernating' || remSec > 0) {
    computedStatus = 'hibernating';
  } else if (raw.status === 'expired' || (raw.healthScore !== undefined && raw.healthScore < 50 && raw.circuitState === 'open')) {
    computedStatus = 'expired';
  }

  return {
    id: raw.accountId,
    platform: raw.platform,
    username: raw.accountId,
    status: computedStatus,
    hibernatingUntil: raw.hibernatingUntil,
    remainingSeconds: remSec,
    reason: raw.reason,
    velocity: raw.velocity,
    assignedProxy: raw.assignedProxy,
    healthScore: typeof raw.healthScore === 'number' ? raw.healthScore : 75,
    circuitState:
      raw.circuitState === 'open' || raw.circuitState === 'half-open' ? raw.circuitState : 'closed',
    lastProbe: 'recent',
  };
}

function formatCountdown(sec: number): string {
  if (sec <= 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ==========================================
// Main Component
// ==========================================

export default function AccountSessionsPage() {
  const [sessions, setSessions] = useState<AccountSessionRow[]>(INITIAL_SESSIONS);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disconnected');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Toast Helper
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  }, []);

  // Countdown timer: tick every second for active cooldown countdowns
  useEffect(() => {
    const timer = setInterval(() => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.remainingSeconds > 0) {
            const nextSec = s.remainingSeconds - 1;
            return {
              ...s,
              remainingSeconds: nextSec,
              status: nextSec === 0 && s.status === 'hibernating' ? 'active' : s.status,
            };
          }
          return s;
        })
      );
    }, 1000);
    return () => clearInterval(timer);
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

  // Fetch session & account hibernation state from BFF
  const fetchSessions = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Primary: account state which holds hibernation timer & proxy binding
      const res = await api<AdminAccountsSessionResponse>('GET', '/api/admin/accounts');
      if (res.ok && res.data?.accounts && Array.isArray(res.data.accounts) && res.data.accounts.length > 0) {
        setSessions(res.data.accounts.map(normalizeSession));
      } else if (res.status === 401) {
        showToast('Authentication required for live sessions. Showing seed data.', 'info');
      }

      // Secondary: attempt spec-named /api/admin/sessions if available
      try {
        const sessRes = await api<{ sessions?: AccountSessionRow[] }>('GET', '/api/admin/sessions');
        if (sessRes.ok && sessRes.data?.sessions && Array.isArray(sessRes.data.sessions)) {
          setSessions(sessRes.data.sessions);
        }
      } catch {
        // Optional endpoint — fallback gracefully
      }
    } catch {
      // Graceful offline fallback
      showToast('Backend unreachable. Showing seed data.', 'info');
    } finally {
      setIsRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Realtime health updates pulse
  useEffect(() => {
    const client = getRealtimeClient({ autoConnect: true });
    const unsubscribeHealth = client.subscribe<SystemHealthData>('health:update', () => {
      fetchSessions();
    });
    return () => {
      unsubscribeHealth();
    };
  }, [fetchSessions]);

  // ==========================================
  // Wake Action
  // ==========================================

  const handleWake = async (row: AccountSessionRow) => {
    setBusyId(row.id);
    const previous = [...sessions];
    setSessions((prev) =>
      prev.map((s) =>
        s.id === row.id
          ? { ...s, status: 'active', remainingSeconds: 0, circuitState: 'closed', reason: undefined }
          : s
      )
    );

    try {
      const res = await api('POST', '/api/admin/accounts/wake', {
        body: { accountId: row.id, platform: row.platform },
      });
      if (res.ok) {
        showToast(`Account ${row.username} manually awakened from hibernation.`, 'success');
      } else if (res.status === 409) {
        showToast(`Account ${row.username} is already active (not hibernating).`, 'info');
      } else {
        setSessions(previous);
        showToast(`Wake failed: ${res.error?.message || 'Server error'}`, 'error');
      }
    } catch {
      showToast(`Wake command applied locally for ${row.username}.`, 'info');
    } finally {
      setBusyId(null);
    }
  };

  // ==========================================
  // Probe Action (health check)
  // ==========================================

  const handleProbe = async (row: AccountSessionRow) => {
    setBusyId(row.id);
    try {
      const res = await api<{ healthScore?: number; circuitState?: string }>(
        'POST',
        '/api/admin/accounts/probe',
        { body: { accountId: row.id, platform: row.platform } }
      );
      if (res.ok) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === row.id
              ? {
                  ...s,
                  healthScore: typeof res.data?.healthScore === 'number' ? res.data.healthScore : s.healthScore,
                  circuitState:
                    res.data?.circuitState === 'open' || res.data?.circuitState === 'half-open'
                      ? res.data.circuitState
                      : 'closed',
                  lastProbe: 'just now',
                }
              : s
          )
        );
        showToast(`Probe successful: ${row.username} health confirmed.`, 'success');
      } else {
        showToast(`Probe failed for ${row.username}: ${res.error?.message || 'Server error'}`, 'error');
      }
    } catch {
      showToast(`Probe test pinged for ${row.username}.`, 'info');
    } finally {
      setBusyId(null);
    }
  };

  // ==========================================
  // Rotate Action (assign new proxy)
  // ==========================================

  const handleRotate = async (row: AccountSessionRow) => {
    setBusyId(row.id);
    try {
      const res = await api<{ nextAccountId?: string; assignedProxy?: string }>(
        'POST',
        '/api/admin/accounts/rotate',
        { body: { accountId: row.id, platform: row.platform } }
      );
      if (res.ok) {
        const newProxy = res.data?.assignedProxy || 'rotated:new-exit';
        setSessions((prev) =>
          prev.map((s) =>
            s.id === row.id
              ? { ...s, assignedProxy: newProxy, status: 'active', remainingSeconds: 0 }
              : s
          )
        );
        showToast(`Rotated session credentials and proxy for ${row.username}.`, 'success');
      } else {
        showToast(`Rotate failed for ${row.username}: ${res.error?.message || 'Server error'}`, 'error');
      }
    } catch {
      showToast(`Rotated proxy assignment for ${row.username} (offline demo).`, 'info');
    } finally {
      setBusyId(null);
    }
  };

  // ==========================================
  // Filtering
  // ==========================================

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const matchPlatform = platformFilter === 'all' || s.platform === platformFilter;
      const matchStatus = statusFilter === 'all' || s.status === statusFilter;
      return matchPlatform && matchStatus;
    });
  }, [sessions, platformFilter, statusFilter]);

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
              <Timer className="w-7 h-7 text-indigo-500" />
              Account Sessions & Hibernation
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
              Fleet State
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Per-account session expiry countdowns, hibernation circuit state, and operator recovery controls.
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
            onClick={fetchSessions}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync Sessions</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active Sessions', value: sessions.filter((s) => s.status === 'active').length, color: 'text-emerald-500', icon: Sun },
          { label: 'Hibernating', value: sessions.filter((s) => s.status === 'hibernating').length, color: 'text-amber-500', icon: Moon },
          { label: 'Expired', value: sessions.filter((s) => s.status === 'expired').length, color: 'text-rose-500', icon: Hourglass },
          { label: 'Total Tracked', value: sessions.length, color: 'text-blue-500', icon: Layers },
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

      {/* Filter Toolbar + Session State Table */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-500" />
              Per-Account Session Expiry & Hibernation Table
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live countdown to automatic recovery, assigned proxy node, and operator actions (Wake / Probe / Rotate).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
            >
              <option value="all">All Platforms</option>
              <option value="twitter">Twitter</option>
              <option value="threads">Threads</option>
              <option value="tiktok">TikTok</option>
              <option value="facebook">Facebook</option>
              <option value="bluesky">Bluesky</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="hibernating">Hibernating</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
              <tr>
                <th className="py-2.5 px-3">Platform</th>
                <th className="py-2.5 px-3">Account</th>
                <th className="py-2.5 px-3">Session Status</th>
                <th className="py-2.5 px-3">Expiry Countdown</th>
                <th className="py-2.5 px-3">Assigned Proxy</th>
                <th className="py-2.5 px-3">Circuit State</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredSessions.map((sess) => (
                <tr key={`${sess.platform}:${sess.id}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="py-2.5 px-3 font-semibold uppercase text-slate-700 dark:text-slate-300">
                    {sess.platform}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-medium text-slate-900 dark:text-white">
                    {sess.username}
                  </td>
                  <td className="py-2.5 px-3">
                    {sess.status === 'expired' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                        <XCircle className="w-3 h-3" />
                        Expired
                      </span>
                    ) : sess.status === 'hibernating' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        <Moon className="w-3 h-3" />
                        Hibernating
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        <CheckCircle2 className="w-3 h-3" />
                        Active
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono">
                    {sess.remainingSeconds > 0 ? (
                      <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                        <Clock className="w-3.5 h-3.5 animate-pulse" />
                        <span>{formatCountdown(sess.remainingSeconds)}</span>
                        {sess.reason && (
                          <span className="text-[10px] text-slate-400 font-normal truncate max-w-[140px]" title={sess.reason}>
                            ({sess.reason})
                          </span>
                        )}
                      </div>
                    ) : sess.status === 'expired' ? (
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">TTL Expired</span>
                    ) : (
                      <span className="text-slate-400">Ready</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                    {sess.assignedProxy || 'direct / unassigned'}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs">{sess.healthScore}/100</span>
                      <span
                        className={`text-[9px] font-mono px-1 py-0.5 rounded uppercase ${
                          sess.circuitState === 'closed'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {sess.circuitState}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleWake(sess)}
                        disabled={busyId === sess.id || sess.status === 'active'}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium disabled:opacity-40"
                      >
                        <Sun className="w-3 h-3 text-amber-500" />
                        Wake
                      </button>
                      <button
                        onClick={() => handleProbe(sess)}
                        disabled={busyId === sess.id}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 text-[11px] font-medium disabled:opacity-50"
                      >
                        <Stethoscope className="w-3 h-3" />
                        Probe
                      </button>
                      <button
                        onClick={() => handleRotate(sess)}
                        disabled={busyId === sess.id}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300 text-[11px] font-medium disabled:opacity-50"
                      >
                        <RotateCw className="w-3 h-3" />
                        Rotate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredSessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                    No account sessions match the selected filters.
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
