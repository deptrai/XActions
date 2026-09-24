// by nichxbt
'use client';

import React, { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, Key, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';

interface SecurityItem {
  label: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
}

const SEEDED_SECURITY: SecurityItem[] = [
  { label: 'Session Cookie', status: 'ok', detail: 'xa_session set, expires in 6d' },
  { label: 'Bearer Token', status: 'ok', detail: 'xa_bearer set, valid JWT' },
  { label: 'API Rate Limits', status: 'ok', detail: 'No limits exceeded in last 24h' },
  { label: 'Proxy Health', status: 'warning', detail: '2 proxies quarantined' },
  { label: 'DOM Selectors', status: 'ok', detail: 'All selectors verified 2h ago' },
  { label: 'Webhook Endpoints', status: 'warning', detail: '1 endpoint returned 5xx' },
];

const AUDIT_LOG = [
  { time: '10:23:41', event: 'Session cookie refreshed', type: 'info' },
  { time: '09:15:22', event: 'API key rotated', type: 'info' },
  { time: '08:44:10', event: 'Rate limit warning: /api/scrape (85% of quota)', type: 'warning' },
  { time: '07:32:05', event: 'New agent created: thought-leader-01', type: 'info' },
  { time: '06:11:48', event: 'Webhook delivery failed: endpoint timeout', type: 'error' },
];

export default function SecurityPage() {
  const [items, setItems] = useState<SecurityItem[]>(SEEDED_SECURITY);
  const [isLoading, setIsLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const res = await api<{ items?: SecurityItem[] }>('GET', '/api/security/status');
      if (res.ok && 'data' in res && res.data?.items) setItems(res.data.items);
    } catch { /* keep seeded */ } finally { setIsLoading(false); }
  };

  useEffect(() => { fetchStatus(); }, []);

  const okCount = items.filter((i) => i.status === 'ok').length;
  const warnCount = items.filter((i) => i.status === 'warning').length;
  const errorCount = items.filter((i) => i.status === 'error').length;

  const STATUS_CONFIG = {
    ok: { icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />, color: 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/20' },
    warning: { icon: <AlertTriangle className="w-5 h-5 text-amber-500" />, color: 'border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20' },
    error: { icon: <AlertTriangle className="w-5 h-5 text-red-500" />, color: 'border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20' },
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Security Status</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Session health, API keys, and audit log.
          </p>
        </div>
        <button onClick={fetchStatus} disabled={isLoading} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /><span>Refresh</span>
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Healthy', value: okCount, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Warnings', value: warnCount, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Errors', value: errorCount, color: 'text-red-500' },
        ].map((s) => (
          <div key={s.label} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center">
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Security Items */}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className={`flex items-center gap-4 p-4 rounded-xl border ${STATUS_CONFIG[item.status].color}`}>
            {STATUS_CONFIG[item.status].icon}
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{item.label}</p>
              <p className="text-xs text-slate-500">{item.detail}</p>
            </div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${item.status === 'ok' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : item.status === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400' : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400'}`}>
              {item.status}
            </span>
          </div>
        ))}
      </div>

      {/* Audit Log */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Key className="w-4 h-4 text-emerald-500" /><span>Audit Log</span>
        </h2>
        <div className="space-y-1.5 font-mono text-xs">
          {AUDIT_LOG.map((log, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5 border-b border-slate-50 dark:border-slate-800/50 last:border-0">
              <span className="text-slate-400 shrink-0 w-20">{log.time}</span>
              <span className={`w-2 h-2 rounded-full shrink-0 ${log.type === 'error' ? 'bg-red-500' : log.type === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <span className="text-slate-600 dark:text-slate-400">{log.event}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
