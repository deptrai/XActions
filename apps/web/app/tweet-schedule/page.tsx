// by nichxbt
'use client';

import React, { useState } from 'react';
import { Calendar, Clock, Plus, Trash2, Send, Edit2 } from 'lucide-react';
import { api } from '@/lib/api';

interface ScheduledTweet {
  id: string;
  content: string;
  scheduledAt: string;
  status: 'pending' | 'posted' | 'failed';
  type: 'tweet' | 'thread' | 'reply';
}

const SEEDED: ScheduledTweet[] = [
  { id: 'st1', content: 'The biggest mistake in AI automation is...', scheduledAt: '2026-09-25 08:00', status: 'pending', type: 'tweet' },
  { id: 'st2', content: '🧵 Thread: 10 tools that replaced my entire workflow', scheduledAt: '2026-09-25 14:00', status: 'pending', type: 'thread' },
  { id: 'st3', content: 'Reply to @tech_guru thread on productivity', scheduledAt: '2026-09-26 09:30', status: 'pending', type: 'reply' },
  { id: 'st4', content: 'Weekly roundup: what I shipped this week', scheduledAt: '2026-09-24 08:00', status: 'posted', type: 'tweet' },
];

export default function TweetSchedulePage() {
  const [tweets, setTweets] = useState<ScheduledTweet[]>(SEEDED);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ content: '', scheduledAt: '', type: 'tweet' });

  const handleCreate = async () => {
    if (!form.content.trim() || !form.scheduledAt) return;
    const tweet: ScheduledTweet = { id: `st${Date.now()}`, content: form.content, scheduledAt: form.scheduledAt, type: form.type as ScheduledTweet['type'], status: 'pending' };
    setTweets((prev) => [...prev, tweet].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)));
    setIsCreating(false);
    setForm({ content: '', scheduledAt: '', type: 'tweet' });
    await api('POST', '/api/scheduler/tweets', { body: tweet }).catch(() => {});
  };

  const deleteTweet = async (id: string) => {
    setTweets((prev) => prev.filter((t) => t.id !== id));
    await api('DELETE', `/api/scheduler/tweets/${id}`).catch(() => {});
  };

  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400',
    posted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400',
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600">
              <Clock className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Tweet Scheduler</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Schedule tweets, threads, and replies for optimal timing.
          </p>
        </div>
        <button onClick={() => setIsCreating(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">
          <Plus className="w-4 h-4" /><span>Schedule Tweet</span>
        </button>
      </div>

      {isCreating && (
        <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-950/40 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Schedule New Tweet</h3>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="Tweet content..."
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div className="flex gap-3">
            <input
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
              <option value="tweet">Tweet</option>
              <option value="thread">Thread</option>
              <option value="reply">Reply</option>
            </select>
            <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium">Schedule</button>
            <button onClick={() => setIsCreating(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {tweets.map((tweet) => (
          <div key={tweet.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-900 dark:text-white line-clamp-2">{tweet.content}</p>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{tweet.scheduledAt}</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{tweet.type}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[tweet.status]}`}>{tweet.status}</span>
              {tweet.status === 'pending' && (
                <button onClick={() => deleteTweet(tweet.id)} className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
