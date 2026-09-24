'use client';

import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';

export function BackendStatus() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      const start = performance.now();
      try {
        const result = await api('GET', '/api/health');
        const elapsed = Math.round(performance.now() - start);
        if (mounted) {
          setOnline(result.ok);
          setLatency(elapsed);
        }
      } catch {
        if (mounted) {
          setOnline(false);
          setLatency(null);
        }
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (online === null) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
        <Activity className="w-3.5 h-3.5 animate-pulse" />
        <span>Checking API...</span>
      </div>
    );
  }

  if (online) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
        <span className="font-medium">Backend Live</span>
        {latency !== null && <span className="opacity-70 text-[10px]">({latency}ms)</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50">
      <XCircle className="w-3.5 h-3.5 text-rose-500" />
      <span className="font-medium">Backend Offline</span>
    </div>
  );
}
