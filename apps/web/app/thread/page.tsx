// by nichxbt
'use client';

import React, { useState } from 'react';
import { Layers, RefreshCw, TrendingUp, MessageCircle, Heart, Repeat2, Eye } from 'lucide-react';
import { api } from '@/lib/api';

interface Thread {
  id: string;
  title: string;
  author: string;
  tweetCount: number;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  score: number;
  status: 'published' | 'draft' | 'scheduled';
  createdAt: string;
}

const SEEDED_THREADS: Thread[] = [
  { id: 't1', title: 'The AI shift nobody is talking about', author: '@you', tweetCount: 12, likes: 2847, reposts: 412, replies: 89, views: 48200, score: 94, status: 'published', createdAt: '2d ago' },
  { id: 't2', title: 'How I grew 0→100k in 90 days', author: '@you', tweetCount: 8, likes: 3421, reposts: 634, replies: 142, views: 61800, score: 92, status: 'published', createdAt: '5d ago' },
  { id: 't3', title: 'Stop doing cold outreach wrong', author: '@you', tweetCount: 6, likes: 1923, reposts: 287, replies: 64, views: 31400, score: 89, status: 'published', createdAt: '1w ago' },
  { id: 't4', title: 'The future of agent economies', author: '@you', tweetCount: 15, likes: 0, reposts: 0, replies: 0, views: 0, score: 0, status: 'draft', createdAt: 'Draft' },
  { id: 't5', title: 'X algorithm decoded (2026 edition)', author: '@you', tweetCount: 10, likes: 0, reposts: 0, replies: 0, views: 0, score: 0, status: 'scheduled', createdAt: 'Tomorrow 8AM' },
];

const STATUS_COLORS: Record<string, string> = {
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400',
};

export default function ThreadPage() {
  const [threads, setThreads] = useState<Thread[]>(SEEDED_THREADS);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'published' | 'draft' | 'scheduled'>('all');

  const fetchThreads = async () => {
    setIsLoading(true);
    try {
      const res = await api<{ threads?: Thread[] }>('GET', '/api/threads');
      if (res.ok && 'data' in res && res.data?.threads) setThreads(res.data.threads);
    } catch { /* keep seeded */ } finally { setIsLoading(false); }
  };

  const filtered = filter === 'all' ? threads : threads.filter((t) => t.status === filter);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-950/60 text-sky-600">
              <Layers className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Threads</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Thread performance, drafts, and scheduled posts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
            {(['all', 'published', 'draft', 'scheduled'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg transition-all capitalize ${filter === f ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>{f}</button>
            ))}
          </div>
          <button onClick={fetchThreads} disabled={isLoading} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((thread) => (
          <div key={thread.id} className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{thread.title}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[thread.status]}`}>{thread.status}</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{thread.author} · {thread.tweetCount} tweets · {thread.createdAt}</p>
              </div>
              {thread.status === 'published' && (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 shrink-0">
                  {thread.score}/100
                </span>
              )}
            </div>
            {thread.status === 'published' && (
              <div className="flex items-center gap-5 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{thread.likes.toLocaleString()}</span>
                <span className="flex items-center gap-1"><Repeat2 className="w-3.5 h-3.5" />{thread.reposts.toLocaleString()}</span>
                <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{thread.replies.toLocaleString()}</span>
                <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{thread.views.toLocaleString()}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
