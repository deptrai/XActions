'use client';
/**
 * Story 50.5 — Public Actions Catalog (/actions)
 *
 * Browsable manifest of every (platform, action, syncCapable) triple
 * served by GET /api/actions (unauthenticated, cached).
 *
 * - Category-grouped platform cards with action counts + sync-capable counts
 * - Drill into platform → action list with requiredArgs + Try-it links
 * - Search filters platform name + action name + description
 * - Deep link: /actions?platform=reddit&action=search pre-opens the detail panel
 * - Status badges: stable / beta / coming_soon
 */

import React, { useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Activity,
  ArrowRight,
  Box,
  ChevronDown,
  ChevronUp,
  Code2,
  Layers,
  PlayCircle,
  Search,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';

interface ActionEntry {
  platform: string;
  action: string | null;
  category: string;
  description: string;
  requiredArgs: string[];
  optionalArgs?: string[];
  syncCapable: boolean;
  status: 'stable' | 'beta' | 'coming_soon';
  no_crawler?: boolean;
  outputType?: string;
  example?: Record<string, unknown>;
}

interface ActionsPayload {
  success: boolean;
  data: ActionEntry[];
  count: number;
  categories: string[];
}

const CATEGORY_META: Record<string, { icon: React.ReactNode; label: string }> = {
  social: { icon: <Activity size={14} />, label: 'Social' },
  crypto: { icon: <Zap size={14} />, label: 'Crypto' },
  ecom: { icon: <Box size={14} />, label: 'E-commerce' },
  procurement: { icon: <Layers size={14} />, label: 'Procurement' },
  recruitment: { icon: <UsersIcon />, label: 'Recruitment' },
  realestate: { icon: <Layers size={14} />, label: 'Real Estate' },
  legal: { icon: <Code2 size={14} />, label: 'Legal' },
  fnb: { icon: <Box size={14} />, label: 'F&B' },
  healthcare: { icon: <Activity size={14} />, label: 'Healthcare' },
  vehicles: { icon: <Box size={14} />, label: 'Vehicles' },
  unknown: { icon: <Box size={14} />, label: 'Other' },
};

function UsersIcon() { return <Layers size={14} />; }

const STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  stable: { bg: '#052e16', fg: '#4ade80', label: 'stable' },
  beta: { bg: '#1c1917', fg: '#fbbf24', label: 'beta' },
  coming_soon: { bg: '#1e1b4b', fg: '#a5b4fc', label: 'coming soon' },
};

function CatalogInner() {
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<ActionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openPlatform, setOpenPlatform] = useState<string | null>(null);
  const [openAction, setOpenAction] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api<ActionsPayload>('GET', '/api/actions');
      if (cancelled) return;
      if (res.ok && res.data?.success) {
        setPayload(res.data);
        // Deep-link: ?platform=X&action=Y
        const p = searchParams.get('platform');
        const a = searchParams.get('action');
        if (p) setOpenPlatform(p);
        if (a) setOpenAction(a);
      } else if (!res.ok) {
        const rawErr = (res as { error?: unknown }).error;
        setError(typeof rawErr === 'object' && rawErr && 'message' in rawErr
          ? String((rawErr as { message?: unknown }).message)
          : `HTTP ${res.status}`);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [searchParams]);

  const grouped = useMemo(() => {
    if (!payload) return {} as Record<string, Map<string, ActionEntry[]>>;
    const byCat = new Map<string, Map<string, ActionEntry[]>>();
    const q = query.trim().toLowerCase();
    for (const a of payload.data) {
      if (q) {
        const hay = `${a.platform} ${a.action ?? ''} ${a.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (!byCat.has(a.category)) byCat.set(a.category, new Map());
      const platMap = byCat.get(a.category)!;
      if (!platMap.has(a.platform)) platMap.set(a.platform, []);
      platMap.get(a.platform)!.push(a);
    }
    return Object.fromEntries(byCat);
  }, [payload, query]);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a12', color: '#e2e8f0', padding: 24, fontFamily: 'system-ui' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 26 }}>
          <PlayCircle size={22} style={{ verticalAlign: -3, marginRight: 8, color: '#6366f1' }} />
          Public Actions Catalog
        </h1>
        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
          Every (platform, action, syncCapable) triple — no auth needed to browse. Open in the{' '}
          <Link href="/gateway" style={{ color: '#818cf8' }}>Gateway Playground</Link> to call.
        </p>
        <div style={{ position: 'relative', maxWidth: 480, marginTop: 14 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#475569' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by platform, action, or description…"
            style={{
              width: '100%', background: '#111827', border: '1px solid #1f2937', borderRadius: 8,
              padding: '9px 12px 9px 32px', color: '#e2e8f0', fontSize: 13,
            }}
          />
        </div>
      </header>

      {loading && <div style={{ color: '#64748b' }}>Loading manifest…</div>}
      {error && <div style={{ color: '#f97316', fontSize: 13 }}>⚠️ {error}</div>}

      {payload && Object.entries(grouped).map(([category, platMap]) => {
        const meta = CATEGORY_META[category] ?? CATEGORY_META.unknown;
        return (
          <section key={category} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 14, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              {meta.icon}{meta.label}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {[...platMap.entries()].map(([platform, actions]) => {
                const isOpen = openPlatform === platform;
                const syncCount = actions.filter(a => a.syncCapable).length;
                const status = actions[0]?.status ?? 'stable';
                const badge = STATUS_BADGE[status] ?? STATUS_BADGE.stable;
                return (
                  <div key={platform} style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, overflow: 'hidden' }}>
                    <button
                      onClick={() => setOpenPlatform(isOpen ? null : platform)}
                      style={{
                        width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                        padding: '12px 14px', cursor: 'pointer', color: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{platform}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {actions.filter(a => a.action).length} actions · {syncCount} sync-capable
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: badge.bg, color: badge.fg }}>{badge.label}</span>
                        {isOpen ? <ChevronUp size={14} color="#64748b" /> : <ChevronDown size={14} color="#64748b" />}
                      </div>
                    </button>
                    {isOpen && (
                      <div style={{ borderTop: '1px solid #1f2937', padding: '8px 0' }}>
                        {actions.filter(a => a.action).map((a) => {
                          const actOpen = openAction === a.action && openPlatform === platform;
                          return (
                            <div key={a.action} style={{ padding: '4px 14px' }}>
                              <button
                                onClick={() => setOpenAction(actOpen ? null : a.action)}
                                style={{
                                  background: 'transparent', border: 'none', color: 'inherit',
                                  cursor: 'pointer', width: '100%', textAlign: 'left', padding: '6px 0',
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                }}
                              >
                                <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{a.action}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {a.syncCapable && <span style={{ fontSize: 10, color: '#4ade80' }}>⚡sync</span>}
                                  <Link
                                    href={`/gateway?platform=${platform}&action=${a.action}`}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ fontSize: 11, color: '#818cf8', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 2 }}
                                  >
                                    Try it <ArrowRight size={10} />
                                  </Link>
                                </span>
                              </button>
                              {actOpen && (
                                <div style={{ fontSize: 12, color: '#94a3b8', padding: '4px 0 8px', borderTop: '1px dashed #1f2937' }}>
                                  <div>{a.description}</div>
                                  {a.requiredArgs.length > 0 && (
                                    <div style={{ marginTop: 4 }}>
                                      <span style={{ color: '#64748b' }}>required: </span>
                                      {a.requiredArgs.map(r => <code key={r} style={{ background: '#1f2937', padding: '1px 5px', borderRadius: 4, marginRight: 4, fontSize: 10 }}>{r}</code>)}
                                    </div>
                                  )}
                                  {a.outputType && <div style={{ marginTop: 4, color: '#64748b' }}>→ {a.outputType}</div>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function ActionsCatalogPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#64748b' }}>Loading…</div>}>
      <CatalogInner />
    </Suspense>
  );
}
