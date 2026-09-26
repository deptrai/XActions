'use client';
/**
 * Story 50.4 — Public Scrape Gateway Observability Dashboard (/gateway/monitor)
 *
 * Operator view of the last-1000 gateway calls held in the server ring buffer:
 *   - traffic split (named / anonymous / x402 / internal)
 *   - 429 exhaustion rate + degrade-reason histogram (24h window of recent calls)
 *   - upstream health per platform (p50/p95/p99 latency, errorRate, last 429)
 *   - per-consumer usage (quota hotspots)
 *   - request-id trace lookup
 *
 * Backed by GET /api/admin/gateway/metrics + /api/admin/gateway/trace/:id
 * (requireAdminOrApiKey — session JWT or x-admin-key).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock,
  Gauge,
  KeyRound,
  PieChart,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';

/* ---------------------------------- types ---------------------------------- */

interface PlatformHealth {
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  last429: number | null;
}

interface ConsumerUsage {
  consumer_id: string;
  platform: string;
  action: string;
  totalCalls: number;
  count429: number;
}

interface RecentCall {
  timestamp: number;
  requestId: string;
  consumerId: string;
  consumerType: string;
  platform: string;
  action: string;
  mode: 'sync' | 'async';
  durationMs: number;
  status: number;
  degradedReason?: string;
  errorKind?: string;
}

interface GatewayMetrics {
  totalCalls: number;
  totalErrors: number;
  total429: number;
  degradeRate: number;
  degradeReasons: Record<'upstream_timeout' | 'cf_challenge' | 'upstream_rate_limit' | 'queue_fallback', number>;
  trafficSplit: { internal: number; named: number; anonymous: number; x402: number };
  upstreamHealth: Record<string, PlatformHealth>;
  consumerUsage: ConsumerUsage[];
  recentCalls: RecentCall[];
}

/* -------------------------------- helpers ---------------------------------- */

const DEGRADE_LABELS: Record<string, string> = {
  upstream_timeout: 'Upstream Timeout',
  cf_challenge: 'CF Challenge',
  upstream_rate_limit: 'Upstream Rate Limit',
  queue_fallback: 'Queue Fallback',
};

const SPLIT_COLORS: Record<string, string> = {
  internal: '#22c55e',
  named: '#6366f1',
  anonymous: '#f59e0b',
  x402: '#a855f7',
};

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function pct(n: number, d: number): string {
  if (!d) return '0%';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function statusColor(status: number): string {
  if (status >= 500) return '#ef4444';
  if (status === 429) return '#f59e0b';
  if (status === 202) return '#38bdf8';
  if (status >= 400) return '#f97316';
  return '#22c55e';
}

/* ---------------------------------- page ----------------------------------- */

export default function GatewayMonitorPage() {
  const [data, setData] = useState<GatewayMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [traceQuery, setTraceQuery] = useState('');
  const [traceResult, setTraceResult] = useState<RecentCall | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ success: boolean; data: GatewayMetrics }>('GET', '/api/admin/gateway/metrics');
      if (res.ok && res.data?.success) {
        setData(res.data.data);
        setError(null);
      } else if (!res.ok) {
        const rawErr = (res as { error?: unknown }).error;
        const msg = typeof rawErr === 'string' ? rawErr
          : (rawErr && typeof rawErr === 'object' && 'message' in rawErr)
            ? String((rawErr as { message?: unknown }).message)
            : `HTTP ${res.status}`;
        setError(msg);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const lookupTrace = useCallback(async () => {
    const id = traceQuery.trim();
    if (!id) return;
    setTraceError(null);
    setTraceResult(null);
    const res = await api<{ success: boolean; data: RecentCall }>(
      'GET',
      `/api/admin/gateway/trace/${encodeURIComponent(id)}`,
    );
    if (res.ok && res.data?.success) {
      setTraceResult(res.data.data);
    } else if (res.status === 404) {
      setTraceError(`No call found for request_id "${id}"`);
    } else if (!res.ok) {
      const rawErr = (res as { error?: unknown }).error;
      const msg = typeof rawErr === 'string' ? rawErr
        : (rawErr && typeof rawErr === 'object' && 'message' in rawErr)
          ? String((rawErr as { message?: unknown }).message)
          : `HTTP ${res.status}`;
      setTraceError(msg);
    }
  }, [traceQuery]);

  const trafficEntries = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.trafficSplit).filter(([, v]) => v > 0);
  }, [data]);

  const degradeEntries = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.degradeReasons).filter(([, v]) => v > 0);
  }, [data]);

  const maxDegrade = useMemo(
    () => Math.max(1, ...Object.values(data?.degradeReasons ?? {})),
    [data],
  );

  const totalSplit = useMemo(
    () => Math.max(1, trafficEntries.reduce((a, [, v]) => a + v, 0)),
    [trafficEntries],
  );

  /* ------------------------------- render ---------------------------------- */

  return (
    <div style={{ padding: 24, minHeight: '100vh', background: '#0a0a12', color: '#e2e8f0', fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Gauge size={26} color="#6366f1" />
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Scrape Gateway Monitor</h1>
          <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
            Public gateway quotas, degrade reasons, upstream health — last 1000 calls
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
            background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1',
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
          }}
        >
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
        {lastRefresh && (
          <span style={{ fontSize: 11, color: '#475569' }}>last {lastRefresh.toLocaleTimeString()}</span>
        )}
      </header>

      {error && (
        <div style={{ background: '#3f1d1d', border: '1px solid #7f1d1d', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          ⚠️ {error} — the gateway metrics endpoint requires admin auth.
        </div>
      )}

      {data && (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { icon: <Activity size={18} color="#6366f1" />, label: 'Total Calls', value: data.totalCalls },
              { icon: <AlertTriangle size={18} color="#f59e0b" />, label: 'HTTP 429', value: data.total429, sub: pct(data.total429, data.totalCalls) },
              { icon: <Zap size={18} color="#38bdf8" />, label: 'Degrade Rate', value: `${(data.degradeRate * 100).toFixed(1)}%` },
              { icon: <Server size={18} color="#ef4444" />, label: 'Errors', value: data.totalErrors, sub: pct(data.totalErrors, data.totalCalls) },
            ].map((k) => (
              <div key={k.label} style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                  {k.icon}{k.label}
                </div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 11, color: '#475569' }}>{k.sub}</div>}
              </div>
            ))}
          </div>

          {/* Row: traffic split + degrade reasons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                <PieChart size={14} /> Traffic Split
              </h3>
              {trafficEntries.length === 0 && <div style={{ color: '#475569', fontSize: 13 }}>No calls yet.</div>}
              <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 10 }}>
                {trafficEntries.map(([k, v]) => (
                  <div key={k} style={{ width: `${(v / totalSplit) * 100}%`, background: SPLIT_COLORS[k] || '#475569' }} />
                ))}
              </div>
              {trafficEntries.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: SPLIT_COLORS[k] || '#475569', display: 'inline-block' }} />
                    {k}
                  </span>
                  <span style={{ color: '#94a3b8' }}>{v} · {pct(v, totalSplit)}</span>
                </div>
              ))}
            </div>

            <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                <BarChart3 size={14} /> Degrade Reasons
              </h3>
              {degradeEntries.length === 0 && <div style={{ color: '#475569', fontSize: 13 }}>No degrades recorded.</div>}
              {degradeEntries.map(([k, v]) => (
                <div key={k} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span>{DEGRADE_LABELS[k] || k}</span>
                    <span style={{ color: '#94a3b8' }}>{v}</span>
                  </div>
                  <div style={{ height: 6, background: '#1f2937', borderRadius: 3 }}>
                    <div style={{ width: `${(v / maxDegrade) * 100}%`, height: '100%', background: '#38bdf8', borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Upstream health table */}
          <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Server size={14} /> Upstream Health (per platform)
            </h3>
            {Object.keys(data.upstreamHealth).length === 0 && <div style={{ color: '#475569', fontSize: 13 }}>No upstream data.</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: '#475569', textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
                  <th style={{ padding: '6px 8px' }}>Platform</th>
                  <th style={{ padding: '6px 8px' }}>p50</th>
                  <th style={{ padding: '6px 8px' }}>p95</th>
                  <th style={{ padding: '6px 8px' }}>p99</th>
                  <th style={{ padding: '6px 8px' }}>Error Rate</th>
                  <th style={{ padding: '6px 8px' }}>Last 429</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.upstreamHealth).map(([plat, h]) => (
                  <tr key={plat} style={{ borderBottom: '1px solid #1f2937' }}>
                    <td style={{ padding: '8px', fontWeight: 600 }}>{plat}</td>
                    <td style={{ padding: '8px' }}>{fmtMs(h.p50)}</td>
                    <td style={{ padding: '8px' }}>{fmtMs(h.p95)}</td>
                    <td style={{ padding: '8px' }}>{fmtMs(h.p99)}</td>
                    <td style={{ padding: '8px', color: h.errorRate > 0.1 ? '#ef4444' : '#94a3b8' }}>{(h.errorRate * 100).toFixed(1)}%</td>
                    <td style={{ padding: '8px', color: '#64748b' }}>{h.last429 ? fmtTime(h.last429) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Consumer usage + trace lookup */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 12, marginBottom: 20 }}>
            <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} /> Consumer Usage (quota hotspots)
              </h3>
              {data.consumerUsage.length === 0 && <div style={{ color: '#475569', fontSize: 13 }}>No calls.</div>}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#475569', textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
                    <th style={{ padding: '6px 8px' }}>Consumer</th>
                    <th style={{ padding: '6px 8px' }}>Platform</th>
                    <th style={{ padding: '6px 8px' }}>Action</th>
                    <th style={{ padding: '6px 8px' }}>Calls</th>
                    <th style={{ padding: '6px 8px' }}>429s</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.consumerUsage]
                    .sort((a, b) => b.count429 - a.count429 || b.totalCalls - a.totalCalls)
                    .slice(0, 12)
                    .map((c, i) => (
                      <tr key={`${c.consumer_id}-${i}`} style={{ borderBottom: '1px solid #1f2937' }}>
                        <td style={{ padding: '8px', fontWeight: 600 }}>{c.consumer_id}</td>
                        <td style={{ padding: '8px' }}>{c.platform}</td>
                        <td style={{ padding: '8px' }}>{c.action}</td>
                        <td style={{ padding: '8px' }}>{c.totalCalls}</td>
                        <td style={{ padding: '8px', color: c.count429 > 0 ? '#f59e0b' : '#475569' }}>{c.count429}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Search size={14} /> Trace by Request ID
              </h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  value={traceQuery}
                  onChange={(e) => setTraceQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && lookupTrace()}
                  placeholder="req_... or X-Request-Id"
                  style={{
                    flex: 1, background: '#0a0a12', border: '1px solid #334155', borderRadius: 6,
                    padding: '8px 10px', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={lookupTrace}
                  style={{
                    background: '#6366f1', border: 'none', color: 'white',
                    padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                  }}
                >
                  Lookup
                </button>
              </div>
              {traceError && <div style={{ color: '#f97316', fontSize: 12, marginBottom: 8 }}>{traceError}</div>}
              {traceResult && (
                <div style={{ fontSize: 12, fontFamily: 'monospace', background: '#0a0a12', padding: 12, borderRadius: 6 }}>
                  <div><span style={{ color: '#64748b' }}>requestId:</span> {traceResult.requestId}</div>
                  <div><span style={{ color: '#64748b' }}>consumer:</span> {traceResult.consumerId} ({traceResult.consumerType})</div>
                  <div><span style={{ color: '#64748b' }}>target:</span> {traceResult.platform}:{traceResult.action}</div>
                  <div><span style={{ color: '#64748b' }}>mode:</span> {traceResult.mode}</div>
                  <div><span style={{ color: '#64748b' }}>status:</span> <span style={{ color: statusColor(traceResult.status) }}>{traceResult.status}</span></div>
                  <div><span style={{ color: '#64748b' }}>duration:</span> {fmtMs(traceResult.durationMs)}</div>
                  {traceResult.degradedReason && <div><span style={{ color: '#64748b' }}>degraded:</span> {traceResult.degradedReason}</div>}
                  {traceResult.errorKind && <div><span style={{ color: '#64748b' }}>error:</span> {traceResult.errorKind}</div>}
                  <div><span style={{ color: '#64748b' }}>time:</span> {fmtTime(traceResult.timestamp)}</div>
                </div>
              )}
            </div>
          </div>

          {/* Recent calls */}
          <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={14} /> Recent Calls (last 50)
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: '#475569', textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
                  <th style={{ padding: '6px 8px' }}>Time</th>
                  <th style={{ padding: '6px 8px' }}>Request ID</th>
                  <th style={{ padding: '6px 8px' }}>Consumer</th>
                  <th style={{ padding: '6px 8px' }}>Target</th>
                  <th style={{ padding: '6px 8px' }}>Mode</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.recentCalls.map((c, i) => (
                  <tr key={`${c.requestId}-${i}`} style={{ borderBottom: '1px solid #1f2937', cursor: 'pointer' }}
                      onClick={() => { setTraceQuery(c.requestId); lookupTrace(); }}>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{fmtTime(c.timestamp)}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 10 }}>{c.requestId.slice(0, 24)}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ color: SPLIT_COLORS[c.consumerType] || '#94a3b8' }}>{c.consumerId}</span>
                    </td>
                    <td style={{ padding: '6px 8px' }}>{c.platform}:{c.action}</td>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{c.mode}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ color: statusColor(c.status), fontWeight: 600 }}>{c.status}</span>
                    </td>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{fmtMs(c.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.recentCalls.length === 0 && <div style={{ color: '#475569', fontSize: 13 }}>No calls recorded yet.</div>}
          </div>
        </>
      )}
    </div>
  );
}
