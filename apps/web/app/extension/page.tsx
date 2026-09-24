// by nichxbt
'use client';

import React, { useState } from 'react';
import { Puzzle, Download, CheckCircle2, XCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';

interface ExtStatus {
  installed: boolean;
  version?: string;
  permissions?: string[];
  lastSync?: string;
}

export default function ExtensionPage() {
  const [status, setStatus] = useState<ExtStatus>({ installed: false });
  const [isLoading, setIsLoading] = useState(false);

  const checkStatus = async () => {
    setIsLoading(true);
    try {
      const res = await api<ExtStatus>('GET', '/api/extension/status');
      if (res.ok && 'data' in res) setStatus(res.data as ExtStatus);
    } catch { /* keep state */ } finally { setIsLoading(false); }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-950/60 text-orange-600">
            <Puzzle className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Browser Extension</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          XActions Chrome/Edge extension — status and installation.
        </p>
      </div>

      {/* Status Card */}
      <div className={`p-5 rounded-xl border flex items-center gap-4 ${status.installed ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/40' : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50'}`}>
        {status.installed ? <CheckCircle2 className="w-8 h-8 text-emerald-500" /> : <XCircle className="w-8 h-8 text-slate-400" />}
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{status.installed ? `Installed v${status.version}` : 'Extension Not Detected'}</p>
          <p className="text-xs text-slate-500">{status.installed ? `Last sync: ${status.lastSync}` : 'Install the extension to enable browser automation features'}</p>
        </div>
        <button onClick={checkStatus} disabled={isLoading} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Install Guide */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Installation Guide</h2>
        <div className="space-y-3">
          {[
            { step: 1, text: 'Download the extension from the Chrome Web Store or load unpacked from extension/ directory' },
            { step: 2, text: 'Navigate to x.com and log in to your account' },
            { step: 3, text: 'Click the XActions extension icon and authenticate with your API key' },
            { step: 4, text: 'Extension will sync session cookies automatically' },
          ].map((s) => (
            <div key={s.step} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{s.step}</span>
              <p className="text-sm text-slate-600 dark:text-slate-400">{s.text}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-3 pt-2">
          <a href="https://chrome.google.com/webstore" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium">
            <Download className="w-4 h-4" /><span>Chrome Store</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">
            <span>Load Unpacked</span>
          </button>
        </div>
      </div>

      {/* Permissions */}
      {status.installed && status.permissions && (
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Granted Permissions</h3>
          <div className="flex flex-wrap gap-2">
            {status.permissions.map((p) => (
              <span key={p} className="text-xs px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-mono">{p}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
