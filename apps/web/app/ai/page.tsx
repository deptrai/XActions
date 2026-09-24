// by nichxbt
'use client';

import React, { useState, useEffect } from 'react';
import { Brain, Cpu, Zap, TrendingUp, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface ModelStatus {
  id: string;
  name: string;
  provider: string;
  status: 'online' | 'offline' | 'degraded';
  latency: number;
  requests24h: number;
  cost24h: string;
}

const SEEDED_MODELS: ModelStatus[] = [
  { id: 'm1', name: 'Claude Opus 5', provider: 'Anthropic', status: 'online', latency: 1240, requests24h: 847, cost24h: '$12.40' },
  { id: 'm2', name: 'Claude Haiku 4.5', provider: 'Anthropic', status: 'online', latency: 320, requests24h: 2341, cost24h: '$3.80' },
  { id: 'm3', name: 'GPT-4o', provider: 'OpenAI', status: 'online', latency: 890, requests24h: 412, cost24h: '$8.20' },
  { id: 'm4', name: 'Llama 3.3 70B', provider: 'Local', status: 'degraded', latency: 4200, requests24h: 89, cost24h: '$0.00' },
];

const RECENT_GENERATIONS = [
  { id: 'g1', prompt: 'Write a hook for AI productivity thread', model: 'Claude Opus 5', output: 'Nobody is talking about...', tokens: 847, time: '2m ago' },
  { id: 'g2', prompt: 'Classify this follower list', model: 'Claude Haiku 4.5', output: 'Categories: tech(45%), crypto(32%)...', tokens: 312, time: '8m ago' },
  { id: 'g3', prompt: 'Generate DM sequence for B2B leads', model: 'GPT-4o', output: 'Hi [name], noticed your work on...', tokens: 1204, time: '15m ago' },
];

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  online: { color: 'text-emerald-500', icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" /> },
  offline: { color: 'text-slate-400', icon: <XCircle className="w-4 h-4 text-slate-400" /> },
  degraded: { color: 'text-amber-500', icon: <CheckCircle2 className="w-4 h-4 text-amber-500" /> },
};

export default function AiPage() {
  const [models, setModels] = useState<ModelStatus[]>(SEEDED_MODELS);
  const [isLoading, setIsLoading] = useState(false);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const res = await api<{ models?: ModelStatus[] }>('GET', '/api/ai/status');
      if (res.ok && 'data' in res && res.data?.models) setModels(res.data.models);
    } catch { /* keep seeded */ } finally { setIsLoading(false); }
  };

  useEffect(() => { fetchStatus(); }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600">
              <Brain className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">AI Dashboard</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Model status, usage stats, and recent generations.
          </p>
        </div>
        <button onClick={fetchStatus} disabled={isLoading} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /><span>Refresh</span>
        </button>
      </div>

      {/* Model Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {models.map((m) => (
          <div key={m.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-purple-500" />
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{m.name}</span>
              </div>
              {STATUS_CONFIG[m.status].icon}
            </div>
            <p className="text-xs text-slate-500">{m.provider}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><p className="text-slate-400">Latency</p><p className="font-bold text-slate-700 dark:text-slate-300">{m.latency}ms</p></div>
              <div><p className="text-slate-400">Requests/24h</p><p className="font-bold text-slate-700 dark:text-slate-300">{m.requests24h.toLocaleString()}</p></div>
              <div className="col-span-2"><p className="text-slate-400">Cost/24h</p><p className="font-bold text-slate-700 dark:text-slate-300">{m.cost24h}</p></div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Generations */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Zap className="w-4 h-4 text-purple-500" /><span>Recent Generations</span>
        </h2>
        <div className="space-y-2">
          {RECENT_GENERATIONS.map((g) => (
            <div key={g.id} className="flex items-start gap-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{g.prompt}</p>
                <p className="text-xs text-slate-400 mt-0.5 truncate italic">{g.output}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{g.model}</p>
                <p className="text-xs text-slate-400">{g.tokens} tokens · {g.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
