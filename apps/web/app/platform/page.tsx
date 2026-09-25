// by nichxbt
'use client';

import React, { useState, useEffect } from 'react';
import { Globe, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

interface Platform {
  id: string;
  name: string;
  status: 'supported' | 'partial' | 'coming_soon' | 'deprecated';
  features: string[];
  icon: string;
}

const PLATFORMS: Platform[] = [
  { id: 'x', name: 'X / Twitter', status: 'supported', features: ['Scraping', 'Posting', 'DMs', 'Analytics', 'Graph'], icon: '𝕏' },
  { id: 'threads', name: 'Threads', status: 'supported', features: ['Scraping', 'Posting'], icon: '🧵' },
  { id: 'instagram', name: 'Instagram', status: 'partial', features: ['Scraping', 'Analytics'], icon: '📸' },
  { id: 'facebook', name: 'Facebook', status: 'partial', features: ['Scraping', 'Groups'], icon: '📘' },
  { id: 'linkedin', name: 'LinkedIn', status: 'supported', features: ['Scraping', 'Posting', 'B2B Leads'], icon: '💼' },
  { id: 'tiktok', name: 'TikTok', status: 'partial', features: ['Scraping', 'Analytics'], icon: '🎵' },
  { id: 'youtube', name: 'YouTube', status: 'supported', features: ['Scraping', 'Analytics', 'Comments'], icon: '▶️' },
  { id: 'reddit', name: 'Reddit', status: 'supported', features: ['Scraping', 'Posting', 'Monitoring'], icon: '🤖' },
  { id: 'bluesky', name: 'Bluesky', status: 'supported', features: ['Scraping', 'Posting'], icon: '🦋' },
  { id: 'mastodon', name: 'Mastodon', status: 'supported', features: ['Scraping', 'Posting'], icon: '🐘' },
  { id: 'telegram', name: 'Telegram', status: 'partial', features: ['Scraping', 'Monitoring'], icon: '✈️' },
  { id: 'discord', name: 'Discord', status: 'coming_soon', features: ['Monitoring'], icon: '💬' },
  { id: 'pumpfun', name: 'Pump.fun', status: 'supported', features: ['Scraping', 'Livestreams', 'Chat Stream', 'Auth'], icon: '🎰' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  supported: { label: 'Supported', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400', icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" /> },
  partial: { label: 'Partial', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400', icon: <Clock className="w-4 h-4 text-amber-500" /> },
  coming_soon: { label: 'Coming Soon', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400', icon: <Clock className="w-4 h-4 text-blue-500" /> },
  deprecated: { label: 'Deprecated', color: 'bg-slate-100 text-slate-500 dark:bg-slate-800', icon: <XCircle className="w-4 h-4 text-slate-400" /> },
};

export default function PlatformPage() {
  const [platforms, setPlatforms] = useState<Platform[]>(PLATFORMS);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'supported' | 'partial' | 'coming_soon'>('all');

  const fetchPlatforms = async () => {
    setIsLoading(true);
    try {
      const res = await api<{ platforms?: Platform[] }>('GET', '/api/platforms');
      if (res.ok && 'data' in res && res.data?.platforms) setPlatforms(res.data.platforms);
    } catch { /* keep seeded */ } finally { setIsLoading(false); }
  };

  useEffect(() => { fetchPlatforms(); }, []);

  const filtered = filter === 'all' ? platforms : platforms.filter((p) => p.status === filter);
  const counts = { all: platforms.length, supported: platforms.filter((p) => p.status === 'supported').length, partial: platforms.filter((p) => p.status === 'partial').length, coming_soon: platforms.filter((p) => p.status === 'coming_soon').length };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600">
              <Globe className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Platform Coverage</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Supported platforms, features, and coverage status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
            {(['all', 'supported', 'partial', 'coming_soon'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg transition-all capitalize ${filter === f ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>
                {f === 'coming_soon' ? 'Soon' : f} ({counts[f]})
              </button>
            ))}
          </div>
          <button onClick={fetchPlatforms} disabled={isLoading} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((p) => (
          <div key={p.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">{p.icon}</span>
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{p.name}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CONFIG[p.status].color}`}>
                {STATUS_CONFIG[p.status].label}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {p.features.map((f) => (
                <span key={f} className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{f}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
