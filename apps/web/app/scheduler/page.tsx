// by nichxbt
'use client';

import React, { useState } from 'react';
import { Calendar, Clock, Plus, Trash2, Play, Pause, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  type: string;
  status: 'active' | 'paused' | 'failed';
  nextRun: string;
  lastRun?: string;
  runCount: number;
}

const SEEDED_JOBS: ScheduledJob[] = [
  { id: 'j1', name: 'Trending Topics Scraper', cron: '0 */6 * * *', type: 'scrape', status: 'active', nextRun: 'in 2h 14m', lastRun: '4h ago', runCount: 847 },
  { id: 'j2', name: 'Follower Snapshot', cron: '0 0 * * *', type: 'snapshot', status: 'active', nextRun: 'in 8h 32m', lastRun: '16h ago', runCount: 365 },
  { id: 'j3', name: 'Analytics Report', cron: '0 9 * * 1', type: 'report', status: 'active', nextRun: 'Mon 9:00 AM', lastRun: '3d ago', runCount: 52 },
  { id: 'j4', name: 'Unfollower Check', cron: '0 */12 * * *', type: 'check', status: 'paused', nextRun: 'paused', lastRun: '2d ago', runCount: 124 },
  { id: 'j5', name: 'Viral Miner Run', cron: '0 6 * * *', type: 'mine', status: 'failed', nextRun: 'failed', lastRun: '1d ago', runCount: 89 },
];

const JOB_TYPES = ['scrape', 'snapshot', 'report', 'check', 'mine', 'post', 'dm', 'clean'];
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400',
};

export default function SchedulerPage() {
  const [jobs, setJobs] = useState<ScheduledJob[]>(SEEDED_JOBS);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ name: '', cron: '', type: 'scrape' });

  const toggleJob = async (id: string) => {
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, status: j.status === 'active' ? 'paused' : 'active' } : j));
    await api('PATCH', `/api/scheduler/${id}`, { body: { action: 'toggle' } }).catch(() => {});
  };

  const deleteJob = async (id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    await api('DELETE', `/api/scheduler/${id}`).catch(() => {});
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.cron.trim()) return;
    const job: ScheduledJob = { id: `j${Date.now()}`, ...form, status: 'active', nextRun: 'pending', runCount: 0 };
    setJobs((prev) => [...prev, job]);
    setIsCreating(false);
    setForm({ name: '', cron: '', type: 'scrape' });
    await api('POST', '/api/scheduler', { body: job }).catch(() => {});
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600">
              <Clock className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Job Scheduler</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Cron-based job scheduling — automate recurring tasks.
          </p>
        </div>
        <button onClick={() => setIsCreating(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium">
          <Plus className="w-4 h-4" /><span>Schedule Job</span>
        </button>
      </div>

      {isCreating && (
        <div className="p-4 rounded-xl border border-purple-200 dark:border-purple-800/40 bg-purple-50 dark:bg-purple-950/40 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Schedule New Job</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Job name..." className="col-span-2 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
            <input type="text" value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} placeholder="0 */6 * * *" className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono" />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
              {JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium">Schedule</button>
            <button onClick={() => setIsCreating(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">Cancel</button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
                {['Job', 'Cron', 'Type', 'Status', 'Next Run', 'Last Run', 'Runs', 'Actions'].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{job.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">{job.cron}</td>
                  <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{job.type}</span></td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status]}`}>{job.status}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{job.nextRun}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{job.lastRun || '—'}</td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-300">{job.runCount.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggleJob(job.id)} className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
                        {job.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => deleteJob(job.id)} className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
