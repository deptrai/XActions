// by nichxbt
'use client';

import React, { useState } from 'react';
import { Facebook, RefreshCw, CheckCircle2, XCircle, Play, Settings } from 'lucide-react';
import { api } from '@/lib/api';

interface FBStatus {
  connected: boolean;
  account?: string;
  pages?: number;
  lastSync?: string;
}

const ACTIONS = [
  { id: 'scrape_feed', label: 'Scrape Feed', description: 'Extract posts from your feed' },
  { id: 'auto_like', label: 'Auto Like', description: 'Like posts matching criteria' },
  { id: 'group_post', label: 'Group Post', description: 'Post to joined groups' },
  { id: 'friend_analyze', label: 'Friend Analysis', description: 'Analyze friend network' },
];

export default function FacebookPage() {
  const [status, setStatus] = useState<FBStatus>({ connected: false });
  const [isLoading, setIsLoading] = useState(false);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, string>>({});

  const checkStatus = async () => {
    setIsLoading(true);
    try {
      const res = await api<FBStatus>('GET', '/api/facebook/status');
      if (res.ok && 'data' in res) setStatus(res.data as FBStatus);
    } catch { /* keep state */ } finally { setIsLoading(false); }
  };

  const runAction = async (actionId: string) => {
    setRunning((prev) => new Set(prev).add(actionId));
    try {
      const res = await api('POST', '/api/facebook/action', { body: { action: actionId } });
      setResults((prev) => ({ ...prev, [actionId]: res.ok ? '✅ Completed' : '⚠️ Queued (backend offline)' }));
    } catch {
      setResults((prev) => ({ ...prev, [actionId]: '❌ Failed' }));
    } finally {
      setRunning((prev) => { const s = new Set(prev); s.delete(actionId); return s; });
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600">
              <Facebook className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Facebook Automation</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Facebook scraping, posting, and automation controls.
          </p>
        </div>
        <button onClick={checkStatus} disabled={isLoading} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /><span>Check Status</span>
        </button>
      </div>

      {/* Connection Status */}
      <div className={`p-4 rounded-xl border flex items-center gap-3 ${status.connected ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/40' : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50'}`}>
        {status.connected ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <XCircle className="w-5 h-5 text-slate-400" />}
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{status.connected ? `Connected: ${status.account}` : 'Not Connected'}</p>
          <p className="text-xs text-slate-500">{status.connected ? `${status.pages} pages · Last sync: ${status.lastSync}` : 'Configure Facebook session to enable automation'}</p>
        </div>
        <button className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium">
          <Settings className="w-3.5 h-3.5" /><span>Configure</span>
        </button>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ACTIONS.map((action) => (
          <div key={action.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{action.label}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{action.description}</p>
            </div>
            {results[action.id] && (
              <p className="text-xs font-medium">{results[action.id]}</p>
            )}
            <button
              onClick={() => runAction(action.id)}
              disabled={running.has(action.id) || !status.connected}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {running.has(action.id) ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>{running.has(action.id) ? 'Running...' : 'Run'}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
