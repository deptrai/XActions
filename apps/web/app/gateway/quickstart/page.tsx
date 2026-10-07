'use client';
/**
 * Story 50.9 — Migration Quickstart (/gateway/quickstart)
 *
 * Interactive guide converting a legacy `medirusClient.ts` (queue+poll via
 * /api/ai/discovery/search) to the new `POST /api/platform/{platform}/scrape`
 * unified envelope contract.
 *
 * Flow:
 *   1. pick consumer type (anonymous / serviceKey / JWT / x402)
 *   2. pick platform + action (fed by GET /api/actions)
 *   3. paste existing client code → line-by-line diff highlighting
 *   4. "Try in playground" button — prefilled link
 */

import React, { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Code2, Play, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import Link from 'next/link';

interface ActionEntry {
  platform: string;
  action: string | null;
  category: string;
  requiredArgs: string[];
  syncCapable: boolean;
  status: string;
}

const CONSUMER_TYPES = [
  { id: 'service', label: 'Service key', header: 'Authorization: Bearer sk_<key>', hint: 'Named consumer, quota metered' },
  { id: 'jwt', label: 'User JWT', header: 'Authorization: Bearer <jwt>', hint: 'Dashboard login — internal, unmetered' },
  { id: 'x402', label: 'x402 payment', header: 'X-Payment: <payment-proof>', hint: 'Pay-per-call, quota bypass' },
  { id: 'anonymous', label: 'Anonymous', header: '(no auth)', hint: 'IP-bucketed 10 req/min' },
];

const CODE_PATTERNS = [
  { re: /sessionCookie|session=|Cookie:/i, note: 'Auth: replace sessionCookie with Bearer' },
  { re: /\/api\/ai\/discovery\/search/i, note: 'Route: swap to /api/platform/{platform}/scrape' },
  { re: /queueOp|operationId|queue.*poll|poll.*status/i, note: 'Async loop → use mode:sync (no poll needed for fast reads)' },
  { re: /action:.*'search'|action:.*"search"/i, note: 'Action stays — check syncCapable in /api/actions' },
];

function migrateSnippet(legacy: string, platform: string, action: string): { before: string; after: string } {
  const after = `await fetch(\`\${base}/api/platform/${platform}/scrape\`, {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${apiKey}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    action: '${action}',
    mode: 'sync',
    options: { /* args */ },
  }),
}).then(r => r.json());`;
  return { before: legacy, after };
}

function QuickstartInner() {
  const searchParams = useSearchParams();
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [consumer, setConsumer] = useState('service');
  const [platform, setPlatform] = useState(searchParams.get('platform') || 'reddit');
  const [action, setAction] = useState(searchParams.get('action') || 'search');
  const [legacy, setLegacy] = useState(`async searchReddit(query: string) {
  const res = await fetch(\`\${this.base}/api/ai/discovery/search\`, {
    method: 'POST',
    headers: { 'Cookie': \`session=\${this.sessionCookie}\` },
    body: JSON.stringify({ query }),
  });
  const { operationId } = await res.json();
  for (;;) {
    const op = await fetch(\`/api/ai/action/status/\${operationId}\`);
    const { status, result } = await op.json();
    if (status === 'completed') return result.posts;
    if (status === 'failed') throw new Error(result.error);
    await sleep(1500);
  }
}`);

  useEffect(() => {
    api<{ data: ActionEntry[] }>('GET', '/api/actions')
      .then((r) => {
        const list = (r as { data?: { data?: ActionEntry[] } }).data?.data;
        setActions(Array.isArray(list) ? list : []);
      })
      .catch(() => setActions([]));
  }, []);

  const platforms = useMemo(() => Array.from(new Set(actions.map(a => a.platform))).sort(), [actions]);
  const platformActions = useMemo(() => actions.filter(a => a.platform === platform && a.action), [actions, platform]);
  const actionMeta = useMemo(() => platformActions.find(a => a.action === action), [platformActions, action]);

  const migration = useMemo(() => migrateSnippet(legacy, platform, action), [legacy, platform, action]);
  const flaggedLines = useMemo(() => legacy.split('\n').map((line, i) => {
    const hit = CODE_PATTERNS.find(p => p.re.test(line));
    return { line, i, note: hit?.note };
  }), [legacy]);

  const playgroundHref = `/gateway?platform=${encodeURIComponent(platform)}&action=${encodeURIComponent(action)}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="text-amber-400" /> Migration Quickstart
          </h1>
          <p className="text-slate-400">
            Convert legacy queue+poll client calls to the unified scrape gateway.
            Same data. Fewer round-trips. Typed errors.
          </p>
        </header>

        <section className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-sm text-slate-400">Consumer type</label>
            <div className="flex flex-wrap gap-2">
              {CONSUMER_TYPES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setConsumer(c.id)}
                  className={`px-3 py-2 rounded-lg border text-sm ${consumer === c.id ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-slate-500">
              <div className="font-mono bg-slate-900 p-2 rounded">{CONSUMER_TYPES.find(c => c.id === consumer)?.header}</div>
              <div className="mt-1">{CONSUMER_TYPES.find(c => c.id === consumer)?.hint}</div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm text-slate-400">Platform + action</label>
            <div className="flex gap-2">
              <select value={platform} onChange={e => setPlatform(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm">
                {platforms.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={action} onChange={e => setAction(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm flex-1">
                {platformActions.map(a => <option key={a.action!} value={a.action!}>{a.action} {a.syncCapable ? '⚡' : ''}</option>)}
              </select>
            </div>
            {actionMeta && (
              <div className="text-xs text-slate-500">
                requiredArgs: <code className="bg-slate-900 px-1 rounded">{actionMeta.requiredArgs.join(', ') || 'none'}</code>
                {' • '}status: <span className={actionMeta.status === 'stable' ? 'text-emerald-400' : 'text-amber-400'}>{actionMeta.status}</span>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <label className="text-sm text-slate-400 flex items-center gap-2">
            <Code2 size={14} /> Paste your legacy client code
          </label>
          <textarea
            value={legacy}
            onChange={e => setLegacy(e.target.value)}
            rows={12}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 font-mono text-xs text-slate-200 focus:border-sky-500 outline-none"
            spellCheck={false}
          />
          <div className="text-xs space-y-1">
            {flaggedLines.map(f => f.note && (
              <div key={f.i} className="text-amber-400">line {f.i + 1}: {f.note}</div>
            ))}
          </div>
        </section>

        <section className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs uppercase text-slate-500 mb-2">Before</div>
            <pre className="bg-slate-900 border border-slate-800 rounded-lg p-4 text-xs text-slate-300 overflow-x-auto min-h-[200px]">{migration.before}</pre>
          </div>
          <div>
            <div className="text-xs uppercase text-emerald-500 mb-2">After</div>
            <pre className="bg-emerald-950/30 border border-emerald-900 rounded-lg p-4 text-xs text-slate-100 overflow-x-auto min-h-[200px]">{migration.after}</pre>
          </div>
        </section>

        <section className="flex items-center gap-4 pt-4 border-t border-slate-800">
          <Link href={playgroundHref} className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium">
            <Play size={14} /> Try in playground
          </Link>
          <Link href="/actions" className="inline-flex items-center gap-2 px-4 py-2 border border-slate-700 hover:border-slate-500 rounded-lg text-sm">
            Browse actions catalog <ArrowRight size={14} />
          </Link>
          <Link href="/gateway/monitor" className="inline-flex items-center gap-2 px-4 py-2 border border-slate-700 hover:border-slate-500 rounded-lg text-sm">
            Gateway monitor
          </Link>
        </section>
      </div>
    </div>
  );
}

export default function QuickstartPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 text-slate-100 p-8">Loading…</div>}>
      <QuickstartInner />
    </Suspense>
  );
}
