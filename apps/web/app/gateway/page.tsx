'use client';
/**
 * Story 50.5 — Public Scrape Gateway Playground (/gateway)
 *
 * Interactive caller for POST /api/platform/{platform}/scrape:
 * - platform + action selectors fed by GET /api/actions (syncCapable badge)
 * - mode radio (sync/async) with eligibility hint
 * - Bearer + X-Consumer-Id (observability hint only — UX-5) inputs
 * - options JSON editor
 * - send → unified envelope renderer (success/mode/metadata/stream/preview/data)
 * - error.kind color-coded badges; degrade banner on 202
 * - Copy-as-curl; recent calls log (localStorage, 20) with replay
 * - "Show me XACT_4029" button fills a request destined to hit the quota gate
 */

import React, { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Copy, PlayCircle, RotateCcw, Send, Zap } from 'lucide-react';
import { api } from '@/lib/api';

interface ActionEntry {
  platform: string;
  action: string | null;
  category: string;
  description: string;
  requiredArgs: string[];
  syncCapable: boolean;
  status: string;
  no_crawler?: boolean;
}

interface Manifest { success: boolean; data: ActionEntry[]; }

interface CallRecord {
  ts: number; platform: string; action: string; mode: string;
  status?: number; requestId?: string; ok?: boolean;
}

const KIND_COLORS: Record<string, string> = {
  consumer_quota: '#f59e0b',
  upstream_rate_limit: '#eab308',
  proxy_ip_block: '#ef4444',
  auth: '#a855f7',
  validation: '#3b82f6',
  upstream_error: '#f97316',
  internal: '#64748b',
};

const HISTORY_KEY = 'xactions_gateway_history';

function readHistory(): CallRecord[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function PlaygroundInner() {
  const searchParams = useSearchParams();
  const [manifest, setManifest] = useState<ActionEntry[]>([]);
  const [platform, setPlatform] = useState(searchParams.get('platform') || 'reddit');
  const [action, setAction] = useState(searchParams.get('action') || 'search');
  const [mode, setMode] = useState<'sync' | 'async'>('sync');
  const [bearer, setBearer] = useState('');
  const [consumerId, setConsumerId] = useState('');
  const [optionsText, setOptionsText] = useState('{\n  "query": "solana",\n  "limit": 5\n}');
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [response, setResponse] = useState<Record<string, unknown> | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [curlCopied, setCurlCopied] = useState(false);

  useEffect(() => {
    setHistory(readHistory());
    (async () => {
      const res = await api<Manifest>('GET', '/api/actions?detailLevel=summary');
      if (res.ok && res.data?.success) setManifest(res.data.data);
    })();
  }, []);

  const platforms = useMemo(() => {
    const set = new Set(manifest.map(a => a.platform));
    return [...set].sort();
  }, [manifest]);

  const actionsForPlatform = useMemo(
    () => manifest.filter(a => a.platform === platform && a.action),
    [manifest, platform],
  );

  const selectedAction = actionsForPlatform.find(a => a.action === action);

  const buildCurl = useCallback(() => {
    let opts: Record<string, unknown> = {};
    try { opts = JSON.parse(optionsText || '{}'); } catch { /* keep raw */ }
    const body = JSON.stringify({ action, mode, ...opts });
    const hdrs = ["-H 'Content-Type: application/json'"];
    if (bearer) hdrs.push(`-H 'Authorization: Bearer ${bearer}'`);
    if (consumerId) hdrs.push(`-H 'X-Consumer-Id: ${consumerId}'`);
    return `curl -X POST $LOCATION/api/platform/${platform}/scrape ${hdrs.join(' ')} -d '${body}'`;
  }, [platform, action, mode, optionsText, bearer, consumerId]);

  const send = useCallback(async () => {
    setOptionsError(null);
    let opts: Record<string, unknown> = {};
    try {
      opts = optionsText.trim() ? JSON.parse(optionsText) : {};
    } catch (e) {
      setOptionsError(e instanceof Error ? e.message : 'Invalid JSON');
      return;
    }
    setSending(true);
    setResponse(null);
    try {
      const headers: Record<string, string> = {};
      if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
      if (consumerId) headers['X-Consumer-Id'] = consumerId;
      const res = await api<Record<string, unknown>>('POST', `/api/platform/${platform}/scrape`, {
        headers,
        body: { action, mode, ...opts },
      });
      const body = res.ok ? res.data : (res as { error?: Record<string, unknown> }).error;
      setResponse(body ?? null);
      setStatusCode(res.status);
      const rec: CallRecord = {
        ts: Date.now(), platform, action, mode,
        status: res.status,
        requestId: (body as Record<string, any>)?.metadata?.request_id,
        ok: res.ok && (body as Record<string, any>)?.success !== false,
      };
      const next = [rec, ...readHistory()].slice(0, 20);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setHistory(next);
    } finally {
      setSending(false);
    }
  }, [platform, action, mode, optionsText, bearer, consumerId]);

  const fillQuotaDemo = useCallback(() => {
    setBearer('sk_invalid_demo_key');
    setConsumerId('demo');
    setPlatform('reddit');
    setAction('search');
    setMode('sync');
    setOptionsText('{\n  "query": "quota-demo"\n}');
  }, []);

  const replay = useCallback((rec: CallRecord) => {
    setPlatform(rec.platform);
    setAction(rec.action);
    setMode(rec.mode as 'sync' | 'async');
  }, []);

  const errorBody = response && (response as { error?: Record<string, unknown> }).error
    ? (response as { error?: Record<string, unknown> }).error
    : null;
  const kind = errorBody?.kind as string | undefined;
  const degradedReason = response?.degraded_reason as string | undefined;
  const metadata = response?.metadata as Record<string, unknown> | undefined;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a12', color: '#e2e8f0', padding: 24, fontFamily: 'system-ui' }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>
          <Send size={20} style={{ verticalAlign: -3, marginRight: 8, color: '#6366f1' }} />
          Gateway Playground
        </h1>
        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
          Call POST /api/platform/&#123;platform&#125;/scrape with the unified envelope. Browse the{' '}
          <a href="/actions" style={{ color: '#818cf8' }}>catalog</a> for required args.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* ── left: request builder ── */}
        <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8' }}>Request</h3>

          <label style={labelStyle}>Platform</label>
          <select value={platform} onChange={(e) => { setPlatform(e.target.value); setAction(''); }} style={inputStyle}>
            {platforms.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <label style={labelStyle}>Action {selectedAction?.syncCapable && <span style={{ color: '#4ade80', fontSize: 10 }}>⚡ sync-capable</span>}</label>
          <select value={action} onChange={(e) => setAction(e.target.value)} style={inputStyle}>
            <option value="">— select —</option>
            {actionsForPlatform.map(a => (
              <option key={a.action} value={a.action ?? ''}>{a.action}{a.syncCapable ? ' ⚡' : ''}</option>
            ))}
          </select>
          {selectedAction && (
            <div style={{ fontSize: 11, color: '#64748b', margin: '4px 0 8px' }}>
              {selectedAction.description}
              {selectedAction.requiredArgs?.length > 0 && (
                <> · required: {selectedAction.requiredArgs.join(', ')}</>
              )}
            </div>
          )}

          <label style={labelStyle}>Mode</label>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
            {(['sync', 'async'] as const).map(m => (
              <label key={m} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
                {m}
                {m === 'sync' && selectedAction && !selectedAction.syncCapable && (
                  <span style={{ fontSize: 10, color: '#f59e0b' }}>(degrades → 202)</span>
                )}
              </label>
            ))}
          </div>

          <label style={labelStyle}>Bearer token <span style={{ color: '#475569', fontSize: 10 }}>(JWT or service key — leave empty for anonymous free tier)</span></label>
          <input value={bearer} onChange={(e) => setBearer(e.target.value)} placeholder="sk_... or JWT" style={inputStyle} />

          <label style={labelStyle}>X-Consumer-Id <span title="Observability hint only — never authoritative for quota or billing (UX-5)" style={{ color: '#475569', fontSize: 10, cursor: 'help' }}>(hint only)</span></label>
          <input value={consumerId} onChange={(e) => setConsumerId(e.target.value)} placeholder="observability tag" style={inputStyle} />

          <label style={labelStyle}>Options JSON <span style={{ color: '#475569', fontSize: 10 }}>(merged into request body)</span></label>
          <textarea
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            rows={7}
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          />
          {optionsError && <div style={{ color: '#f97316', fontSize: 11, marginTop: 4 }}>⚠️ {optionsError}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={send} disabled={sending || !action} style={{ ...btnStyle, background: '#6366f1' }}>
              <PlayCircle size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{sending ? 'Sending…' : 'Send'}
            </button>
            <button onClick={() => { navigator.clipboard.writeText(buildCurl()); setCurlCopied(true); setTimeout(() => setCurlCopied(false), 1500); }} style={btnStyle}>
              <Copy size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{curlCopied ? 'Copied!' : 'Copy as curl'}
            </button>
            <button onClick={fillQuotaDemo} style={{ ...btnStyle, borderColor: '#f59e0b', color: '#f59e0b' }} title="Fill a request that hits the 429 consumer_quota path">
              <Zap size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Show me XACT_4029
            </button>
          </div>
        </div>

        {/* ── right: response + history ── */}
        <div>
          <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16, marginBottom: 12, minHeight: 200 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8' }}>
              Response {statusCode !== null && <span style={{ color: statusCode >= 400 ? '#f97316' : '#4ade80', marginLeft: 6 }}>{statusCode}</span>}
            </h3>

            {degradedReason && (
              <div style={{ background: '#3d2c04', border: '1px solid #f59e0b33', color: '#fbbf24', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 10 }}>
                ⚠️ Sync degraded — reason: <b>{degradedReason}</b>. Poll <code>{(response as any)?.statusUrl}</code> for the result.
              </div>
            )}

            {kind && (
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 10, background: KIND_COLORS[kind] + '22', color: KIND_COLORS[kind] || '#94a3b8', marginBottom: 10, display: 'inline-block' }}>
                kind: {kind}
              </span>
            )}

            {metadata && (
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontFamily: 'monospace' }}>
                request_id: {String(metadata.request_id || '—')} · mode: {String(response?.mode || '—')} · {typeof metadata.duration_ms === 'number' ? `${metadata.duration_ms}ms` : ''}
                {metadata.traceparent ? ` · traceparent: ${String(metadata.traceparent).slice(0, 32)}…` : ''}
              </div>
            )}

            <pre style={{ background: '#0a0a12', padding: 12, borderRadius: 8, fontSize: 11, overflowX: 'auto', maxHeight: 480, margin: 0 }}>
              {response ? JSON.stringify(response, null, 2) : '// send a request to see the unified envelope'}
            </pre>
          </div>

          <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <RotateCcw size={13} /> Recent Calls (local)
            </h3>
            {history.length === 0 && <div style={{ color: '#475569', fontSize: 12 }}>No calls yet.</div>}
            {history.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '4px 0', borderBottom: '1px solid #1f2937' }}>
                <span style={{ color: h.ok ? '#4ade80' : '#f97316', width: 32 }}>{h.status ?? '?'}</span>
                <span style={{ fontFamily: 'monospace' }}>{h.platform}:{h.action}</span>
                <span style={{ color: '#475569' }}>{h.mode}</span>
                <button onClick={() => replay(h)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #334155', color: '#818cf8', borderRadius: 4, padding: '1px 8px', cursor: 'pointer', fontSize: 10 }}>replay</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: '#94a3b8', margin: '10px 0 4px' };
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0a0a12', border: '1px solid #1f2937', borderRadius: 6,
  padding: '8px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box',
};
const btnStyle: React.CSSProperties = {
  background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1',
  padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
  display: 'inline-flex', alignItems: 'center',
};

export default function GatewayPlaygroundPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#64748b' }}>Loading…</div>}>
      <PlaygroundInner />
    </Suspense>
  );
}
