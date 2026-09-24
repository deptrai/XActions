'use client';

// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Story 48.5 — Fleet Account Manager (/accounts)
 *
 * Account pool list with add/remove and health-check trigger:
 *  - Table: username (accountId), platform, health status, warmup score, last active
 *  - Add account: registers new scraper account IDs into the platform pool
 *  - Remove account: marks account unavailable in the pool (soft removal)
 *  - Health check: triggers an account health probe through the orchestrator
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
  Users,
  RefreshCw,
  UserPlus,
  UserMinus,
  Stethoscope,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Bell,
  X,
  ShieldAlert,
  Moon,
  Flame,
  Globe,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getRealtimeClient, type RealtimeStatus, type SystemHealthData } from '@/lib/realtime';

// ==========================================
// Types & Interfaces
// ==========================================

export interface AccountRow {
  id: string;
  platform: string;
  username: string;
  status: 'active' | 'hibernating' | 'rate_limited' | 'unavailable';
  warmupScore: number;
  lastActive: string;
  reason?: string;
  velocity?: number;
  assignedProxy?: string;
  healthScore: number;
  circuitState: 'closed' | 'open' | 'half-open';
}

export interface AdminAccountsResponse {
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
    warmupScore?: number;
    lastActive?: string;
  }>;
}

// ==========================================
// Seed Data (401 / offline fallback)
// ==========================================

const INITIAL_ACCOUNTS: AccountRow[] = [
  { id: 'acc-1', platform: 'twitter', username: '@bot_feeder_01', status: 'active', warmupScore: 92, lastActive: '4s ago', velocity: 42, assignedProxy: '103.152.220.14', healthScore: 94, circuitState: 'closed' },
  { id: 'acc-2', platform: 'twitter', username: '@signal_hound_9', status: 'hibernating', warmupScore: 68, lastActive: '2m ago', reason: '429 Rate Limited by X', velocity: 0, assignedProxy: '14.225.210.89', healthScore: 68, circuitState: 'open' },
  { id: 'acc-3', platform: 'threads', username: '@threads_watcher', status: 'active', warmupScore: 98, lastActive: '11s ago', velocity: 28, assignedProxy: '118.69.135.24', healthScore: 98, circuitState: 'closed' },
  { id: 'acc-4', platform: 'tiktok', username: '@tok_miner_alpha', status: 'rate_limited', warmupScore: 45, lastActive: '25m ago', reason: 'Challenge Flow Triggered', velocity: 0, assignedProxy: '171.244.33.102', healthScore: 45, circuitState: 'half-open' },
  { id: 'acc-5', platform: 'facebook', username: '@fb_crawl_ops', status: 'active', warmupScore: 81, lastActive: '1m ago', velocity: 12, assignedProxy: '45.118.144.12', healthScore: 88, circuitState: 'closed' },
];

const PLATFORM_OPTIONS = ['twitter', 'threads', 'tiktok', 'facebook', 'bluesky'] as const;

// ==========================================
// Helpers
// ==========================================

function normalizeAccount(raw: NonNullable<AdminAccountsResponse['accounts']>[number]): AccountRow {
  return {
    id: raw.accountId,
    platform: raw.platform,
    username: raw.accountId,
    status:
      raw.status === 'hibernating' || raw.status === 'active' || raw.status === 'unavailable'
        ? raw.status
        : 'rate_limited',
    warmupScore: typeof raw.warmupScore === 'number' ? raw.warmupScore : (typeof raw.healthScore === 'number' ? raw.healthScore : 75),
    lastActive: raw.lastActive || (raw.remainingTimeMs && raw.remainingTimeMs > 0 ? 'cooling' : 'recent'),
    reason: raw.reason,
    velocity: raw.velocity,
    assignedProxy: raw.assignedProxy,
    healthScore: typeof raw.healthScore === 'number' ? raw.healthScore : 75,
    circuitState:
      raw.circuitState === 'open' || raw.circuitState === 'half-open' ? raw.circuitState : 'closed',
  };
}

function warmupTone(score: number): string {
  if (score >= 80) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  if (score >= 55) return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';
}

// ==========================================
// Main Component
// ==========================================

export default function FleetAccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>(INITIAL_ACCOUNTS);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disconnected');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add-account form state
  const [newPlatform, setNewPlatform] = useState<string>('twitter');
  const [newAccountIds, setNewAccountIds] = useState('');
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

  // Fetch account pool from BFF
  const fetchAccounts = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await api<AdminAccountsResponse>('GET', '/api/admin/accounts');
      if (res.ok && res.data?.accounts && Array.isArray(res.data.accounts) && res.data.accounts.length > 0) {
        setAccounts(res.data.accounts.map(normalizeAccount));
      } else if (res.status === 401) {
        showToast('Authentication required for live accounts. Showing seed data.', 'info');
      }
    } catch {
      // Graceful offline fallback — keep seeded rows
      showToast('Backend unreachable. Showing seed data.', 'info');
    } finally {
      setIsRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Realtime health pulse re-syncs the pool between manual refreshes
  useEffect(() => {
    const client = getRealtimeClient({ autoConnect: true });
    const unsubscribeHealth = client.subscribe<SystemHealthData>('health:update', () => {
      fetchAccounts();
    });
    return () => {
      unsubscribeHealth();
    };
  }, [fetchAccounts]);

  // ==========================================
  // Add Account (register into platform pool)
  // ==========================================

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);

    const ids = newAccountIds
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      setInlineError('Enter at least one account handle or ID to register.');
      return;
    }

    setIsAdding(true);
    const optimistic: AccountRow = {
      id: ids[0],
      platform: newPlatform,
      username: ids[0],
      status: 'active',
      warmupScore: 50,
      lastActive: 'just added',
      healthScore: 75,
      circuitState: 'closed',
    };
    const previous = [...accounts];
    setAccounts((prev) => [optimistic, ...prev]);

    try {
      const res = await api('POST', '/api/proxies/accounts/register', {
        body: { platform: newPlatform, accountIds: ids },
      });
      if (res.ok) {
        showToast(`Registered ${ids.length} account(s) on ${newPlatform}.`, 'success');
        setNewAccountIds('');
        fetchAccounts();
      } else {
        setAccounts(previous);
        setInlineError(String(res.error?.message || 'Registration rejected by backend.'));
        showToast(`Failed to add account: ${String(res.error?.message || 'Server error')}`, 'error');
      }
    } catch {
      setAccounts(previous);
      setInlineError('Network error while registering account.');
      showToast('Network error while registering account.', 'error');
    } finally {
      setIsAdding(false);
    }
  };

  // ==========================================
  // Remove Account (mark unavailable — soft removal)
  // ==========================================

  const handleRemoveAccount = async (row: AccountRow) => {
    setBusyId(row.id);
    const previous = [...accounts];
    setAccounts((prev) => prev.map((a) => (a.id === row.id ? { ...a, status: 'unavailable' } : a)));

    try {
      const res = await api('POST', `/api/proxies/accounts/${encodeURIComponent(row.id)}/unavailable`, {
        body: { platform: row.platform },
      });
      if (res.ok) {
        showToast(`Account ${row.username} marked unavailable and pulled from rotation.`, 'success');
      } else {
        setAccounts(previous);
        showToast(`Failed to remove ${row.username}: ${res.error?.message || 'Server error'}`, 'error');
      }
    } catch {
      setAccounts(previous);
      showToast(`Network error removing ${row.username}.`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  // ==========================================
  // Health Check (probe)
  // ==========================================

  const handleHealthCheck = async (row: AccountRow) => {
    setBusyId(row.id);
    try {
      const res = await api<{ healthScore?: number; circuitState?: string }>(
        'POST',
        '/api/admin/accounts/probe',
        { body: { accountId: row.id, platform: row.platform } }
      );
      if (res.ok) {
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === row.id
              ? {
                  ...a,
                  healthScore: typeof res.data?.healthScore === 'number' ? res.data.healthScore : a.healthScore,
                  circuitState:
                    res.data?.circuitState === 'open' || res.data?.circuitState === 'half-open'
                      ? res.data.circuitState
                      : 'closed',
                  lastActive: 'checked just now',
                }
              : a
          )
        );
        showToast(`Health probe completed for ${row.username}.`, 'success');
      } else {
        showToast(`Health check failed for ${row.username}: ${res.error?.message || 'Server error'}`, 'error');
      }
    } catch {
      showToast(`Network error probing ${row.username}.`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  // ==========================================
  // Filtering
  // ==========================================

  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      const matchSearch =
        a.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.platform.toLowerCase().includes(searchQuery.toLowerCase());
      const matchPlatform = platformFilter === 'all' || a.platform === platformFilter;
      return matchSearch && matchPlatform;
    });
  }, [accounts, searchQuery, platformFilter]);

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
              <Users className="w-7 h-7 text-blue-500" />
              Fleet Account Manager
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
              Pool Ops
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Scraper account pool: health status, warmup score, last activity, registration and rotation.
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
            onClick={fetchAccounts}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync Pool</span>
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Pool Size', value: accounts.length, color: 'text-blue-500', icon: Users },
          { label: 'Active', value: accounts.filter((a) => a.status === 'active').length, color: 'text-emerald-500', icon: CheckCircle2 },
          { label: 'Hibernating', value: accounts.filter((a) => a.status === 'hibernating').length, color: 'text-amber-500', icon: Moon },
          { label: 'Unhealthy (<60)', value: accounts.filter((a) => a.healthScore < 60).length, color: 'text-rose-500', icon: ShieldAlert },
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

      {/* Add Account Form */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-emerald-500" />
            Register New Account(s)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Adds account handles into the platform scraper pool. Comma- or newline-separated for bulk add.
          </p>
        </div>

        <form onSubmit={handleAddAccount} className="flex flex-col sm:flex-row gap-3">
          <select
            value={newPlatform}
            onChange={(e) => setNewPlatform(e.target.value)}
            className="px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
          >
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newAccountIds}
            onChange={(e) => setNewAccountIds(e.target.value)}
            placeholder="@handle_one, @handle_two"
            className="flex-1 px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <button
            type="submit"
            disabled={isAdding}
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 shadow-sm"
          >
            <UserPlus className={`w-4 h-4 ${isAdding ? 'animate-pulse' : ''}`} />
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

      {/* Filter Toolbar + Accounts Table */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Globe className="w-5 h-5 text-indigo-500" />
              Account Pool & Health Table
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Warmup score, health probe state, circuit breaker state, and pool rotation controls.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search handle or platform..."
              className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 w-48"
            />
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
            >
              <option value="all">All Platforms</option>
              {PLATFORM_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
              <tr>
                <th className="py-2.5 px-3">Platform</th>
                <th className="py-2.5 px-3">Username</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Warmup Score</th>
                <th className="py-2.5 px-3">Last Active</th>
                <th className="py-2.5 px-3">Health & Circuit</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredAccounts.map((acc) => (
                <tr key={`${acc.platform}:${acc.id}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="py-2.5 px-3 font-semibold uppercase text-slate-700 dark:text-slate-300">
                    {acc.platform}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-medium text-slate-900 dark:text-white">
                    {acc.username}
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        acc.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : acc.status === 'hibernating'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      }`}
                    >
                      {acc.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            acc.warmupScore >= 80
                              ? 'bg-emerald-500'
                              : acc.warmupScore >= 55
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ width: `${Math.min(100, acc.warmupScore)}%` }}
                        />
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${warmupTone(acc.warmupScore)}`}
                      >
                        {acc.warmupScore}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                    {acc.lastActive}
                    {acc.reason && (
                      <span className="block text-[10px] text-slate-400" title={acc.reason}>
                        {acc.reason}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs">{acc.healthScore}/100</span>
                      <span
                        className={`text-[9px] font-mono px-1 py-0.5 rounded uppercase ${
                          acc.circuitState === 'closed'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {acc.circuitState}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleHealthCheck(acc)}
                        disabled={busyId === acc.id}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 text-[11px] font-medium disabled:opacity-50"
                      >
                        <Stethoscope className="w-3 h-3" />
                        Health Check
                      </button>
                      <button
                        onClick={() => handleRemoveAccount(acc)}
                        disabled={busyId === acc.id || acc.status === 'unavailable'}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[11px] font-medium disabled:opacity-40"
                      >
                        <UserMinus className="w-3 h-3" />
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredAccounts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                    No accounts match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer note */}
      <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
        <Flame className="w-3 h-3" />
        Warmup score reflects progressive ramp-up readiness; removal is a soft rotation pull (mark unavailable),
        accounts remain registered for audit.
      </p>
    </div>
  );
}
