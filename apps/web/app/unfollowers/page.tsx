// by nichxbt
'use client';

import React, { useState } from 'react';
import { UserMinus, RefreshCw, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { api } from '@/lib/api';

interface Unfollower {
  id: string;
  handle: string;
  displayName: string;
  followedAt: string;
  unfollowedAt: string;
  followers: number;
  verified: boolean;
  mutual: boolean;
}

const SEEDED: Unfollower[] = [
  { id: 'u1', handle: '@crypto_bro_99', displayName: 'Crypto Bro', followedAt: '3mo ago', unfollowedAt: '2d ago', followers: 1240, verified: false, mutual: true },
  { id: 'u2', handle: '@tech_news_daily', displayName: 'Tech News Daily', followedAt: '6mo ago', unfollowedAt: '1w ago', followers: 45200, verified: true, mutual: false },
  { id: 'u3', handle: '@nft_collector_x', displayName: 'NFT Collector', followedAt: '1y ago', unfollowedAt: '3d ago', followers: 890, verified: false, mutual: true },
  { id: 'u4', handle: '@startup_guru', displayName: 'Startup Guru', followedAt: '8mo ago', unfollowedAt: '5d ago', followers: 12400, verified: true, mutual: false },
];

export default function UnfollowersPage() {
  const [unfollowers, setUnfollowers] = useState<Unfollower[]>(SEEDED);
  const [isLoading, setIsLoading] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'mutual' | 'verified'>('all');

  const fetchUnfollowers = async () => {
    setIsLoading(true);
    try {
      const res = await api<{ unfollowers?: Unfollower[] }>('GET', '/api/unfollowers');
      if (res.ok && 'data' in res && res.data?.unfollowers) setUnfollowers(res.data.unfollowers);
    } catch { /* keep seeded */ } finally { setIsLoading(false); }
  };

  const removeUnfollower = async (id: string) => {
    setRemoved((prev) => new Set(prev).add(id));
    await api('POST', '/api/unfollowers/remove', { body: { id } }).catch(() => {});
  };

  const exportCSV = () => {
    const rows = ['handle,displayName,followedAt,unfollowedAt,followers,verified,mutual'];
    unfollowers.forEach((u) => rows.push(`${u.handle},${u.displayName},${u.followedAt},${u.unfollowedAt},${u.followers},${u.verified},${u.mutual}`));
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'unfollowers.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filtered = unfollowers.filter((u) => {
    if (filter === 'mutual') return u.mutual;
    if (filter === 'verified') return u.verified;
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950/60 text-red-600">
              <UserMinus className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Unfollowers</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Accounts that unfollowed you — track and manage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">
            <Download className="w-4 h-4" /><span>Export CSV</span>
          </button>
          <button onClick={fetchUnfollowers} disabled={isLoading} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Unfollowers', value: unfollowers.length },
          { label: 'Mutual (you still follow)', value: unfollowers.filter((u) => u.mutual).length },
          { label: 'Verified Accounts', value: unfollowers.filter((u) => u.verified).length },
        ].map((s) => (
          <div key={s.label} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center">
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{s.value}</p>
            <p className="text-xs text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit text-xs font-semibold">
        {(['all', 'mutual', 'verified'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg transition-all capitalize ${filter === f ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>{f}</button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.map((u) => (
          <div key={u.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${removed.has(u.id) ? 'opacity-40 border-slate-100 dark:border-slate-800/50' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'}`}>
            <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300 shrink-0">
              {u.displayName.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{u.displayName}</span>
                {u.verified && <span className="text-blue-500 text-xs">✓</span>}
                {u.mutual && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">mutual</span>}
              </div>
              <p className="text-xs text-slate-500">{u.handle} · {u.followers.toLocaleString()} followers</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-slate-500">Unfollowed {u.unfollowedAt}</p>
              <p className="text-xs text-slate-400">Followed {u.followedAt}</p>
            </div>
            {!removed.has(u.id) && (
              <button onClick={() => removeUnfollower(u.id)} className="px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-100">
                Unfollow Back
              </button>
            )}
            {removed.has(u.id) && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
          </div>
        ))}
      </div>
    </div>
  );
}
