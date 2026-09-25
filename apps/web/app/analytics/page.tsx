// by nichxbt
'use client';

import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Users, Heart, MessageCircle, Repeat2, Eye, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

interface MetricCard {
  label: string;
  value: string;
  change: string;
  positive: boolean;
  icon: React.ReactNode;
}

interface ChartPoint {
  label: string;
  value: number;
}

const SEEDED_METRICS: MetricCard[] = [
  { label: 'Total Followers', value: '12,847', change: '+3.2%', positive: true, icon: <Users className="w-4 h-4" /> },
  { label: 'Engagement Rate', value: '4.7%', change: '+0.8%', positive: true, icon: <Heart className="w-4 h-4" /> },
  { label: 'Impressions', value: '284K', change: '+12.1%', positive: true, icon: <Eye className="w-4 h-4" /> },
  { label: 'Replies', value: '1,832', change: '-2.4%', positive: false, icon: <MessageCircle className="w-4 h-4" /> },
  { label: 'Reposts', value: '943', change: '+18.7%', positive: true, icon: <Repeat2 className="w-4 h-4" /> },
  { label: 'Profile Visits', value: '8,412', change: '+5.3%', positive: true, icon: <TrendingUp className="w-4 h-4" /> },
];

const SEEDED_WEEKLY: ChartPoint[] = [
  { label: 'Mon', value: 42 }, { label: 'Tue', value: 68 }, { label: 'Wed', value: 55 },
  { label: 'Thu', value: 89 }, { label: 'Fri', value: 74 }, { label: 'Sat', value: 91 },
  { label: 'Sun', value: 63 },
];

const SEEDED_MONTHLY: ChartPoint[] = [
  { label: 'W1', value: 320 }, { label: 'W2', value: 410 }, { label: 'W3', value: 380 },
  { label: 'W4', value: 520 },
];

const TOP_POSTS = [
  { content: 'Nobody is talking about the massive AI shift...', likes: 2847, reposts: 412, replies: 89, score: 94 },
  { content: 'Stop spending 40 hours on cold emails...', likes: 1923, reposts: 287, replies: 64, score: 89 },
  { content: 'I grew from 0 to 100k followers in 90 days...', likes: 3421, reposts: 634, replies: 142, score: 92 },
];

function BarChart({ data, color = '#6366f1' }: { data: ChartPoint[]; color?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2 h-32">
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
          <span className="text-xs font-mono text-slate-500">{d.value}</span>
          <div
            className="w-full rounded-t-sm transition-all duration-500"
            style={{ height: `${(d.value / max) * 80}%`, backgroundColor: color, opacity: 0.8 }}
          />
          <span className="text-xs text-slate-400">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<MetricCard[]>(SEEDED_METRICS);
  const [weekly, setWeekly] = useState<ChartPoint[]>(SEEDED_WEEKLY);
  const [monthly, setMonthly] = useState<ChartPoint[]>(SEEDED_MONTHLY);
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const [isLoading, setIsLoading] = useState(false);

  const fetchAnalytics = async () => {
    setIsLoading(true);
    try {
      const res = await api<{ metrics?: Array<Omit<MetricCard, 'icon'>>; weekly?: ChartPoint[] }>('GET', '/api/analytics/overview');
      if (res.ok && res.data?.metrics) {
        // Merge icon from seeded map by label (icons are ReactNode, can't cross JSON)
        const iconByLabel = new Map(SEEDED_METRICS.map((m) => [m.label, m.icon]));
        setMetrics(res.data.metrics.map((m) => ({ ...m, icon: iconByLabel.get(m.label) ?? m.icon })));
        if (res.data.weekly) setWeekly(res.data.weekly);
      }
    } catch {
      // keep seeded
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchAnalytics(); }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Analytics
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Engagement metrics, follower growth, and content performance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
            {(['7d', '30d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  period === p
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {p === '7d' ? '7 Days' : '30 Days'}
              </button>
            ))}
          </div>
          <button
            onClick={fetchAnalytics}
            disabled={isLoading}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              {m.icon}
              <span className="text-xs font-medium">{m.label}</span>
            </div>
            <p className="text-xl font-bold text-slate-900 dark:text-white">{m.value}</p>
            <p className={`text-xs font-medium ${m.positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
              {m.change}
            </p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Daily Engagement (This Week)</h3>
          <BarChart data={weekly} color="#6366f1" />
        </div>
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Weekly Impressions (This Month)</h3>
          <BarChart data={monthly} color="#10b981" />
        </div>
      </div>

      {/* Top Posts */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Top Performing Posts</h3>
        <div className="space-y-3">
          {TOP_POSTS.map((post, i) => (
            <div key={i} className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 dark:text-slate-300 truncate italic">&ldquo;{post.content}&rdquo;</p>
              </div>
              <div className="flex items-center gap-4 text-xs font-medium shrink-0">
                <span className="text-slate-500 flex items-center gap-1"><Heart className="w-3 h-3" />{post.likes.toLocaleString()}</span>
                <span className="text-slate-500 flex items-center gap-1"><Repeat2 className="w-3 h-3" />{post.reposts.toLocaleString()}</span>
                <span className="text-slate-500 flex items-center gap-1"><MessageCircle className="w-3 h-3" />{post.replies}</span>
                <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold">
                  {post.score}/100
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
