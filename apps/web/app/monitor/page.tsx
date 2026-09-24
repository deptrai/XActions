'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Radio,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Filter,
  Trash2,
  Zap,
  Server,
  Layers,
  ArrowUpRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getRealtimeClient, RealtimeStatus, SystemHealthData } from '@/lib/realtime';

interface JobProgress {
  id: string;
  name: string;
  type: string;
  progress: number;
  total: number;
  current: number;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'queued';
  startedAt: string;
  rateLimitUsage: number; // percentage
}

interface EventItem {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  source: string;
  message: string;
}

const INITIAL_JOBS: JobProgress[] = [
  {
    id: 'job-101',
    name: 'Unfollower Detection Sweep',
    type: 'detectUnfollowers',
    progress: 74,
    current: 185,
    total: 250,
    status: 'running',
    startedAt: '2 mins ago',
    rateLimitUsage: 45,
  },
  {
    id: 'job-102',
    name: 'Growth Algorithm Calibration',
    type: 'algorithmTrainer',
    progress: 38,
    current: 19,
    total: 50,
    status: 'running',
    startedAt: '6 mins ago',
    rateLimitUsage: 28,
  },
  {
    id: 'job-103',
    name: 'Mass Inactive Follower Cleanup',
    type: 'unfollowNonFollowers',
    progress: 100,
    current: 100,
    total: 100,
    status: 'completed',
    startedAt: '18 mins ago',
    rateLimitUsage: 82,
  },
];

const INITIAL_EVENTS: EventItem[] = [
  {
    id: 'evt-1',
    timestamp: new Date(Date.now() - 15000).toLocaleTimeString(),
    type: 'info',
    source: 'Realtime Engine',
    message: 'Telemetry channel established via same-origin transport',
  },
  {
    id: 'evt-2',
    timestamp: new Date(Date.now() - 45000).toLocaleTimeString(),
    type: 'success',
    source: 'Crawler',
    message: 'Canary probe for twitter-profile scraper succeeded (tier A)',
  },
  {
    id: 'evt-3',
    timestamp: new Date(Date.now() - 90000).toLocaleTimeString(),
    type: 'warn',
    source: 'RateLimiter',
    message: 'Rate limit bucket at 65% capacity. Pacing delayed by 1.2s',
  },
];

export default function MonitorPage() {
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disconnected');
  const [healthData, setHealthData] = useState<SystemHealthData | null>(null);
  const [jobs, setJobs] = useState<JobProgress[]>(INITIAL_JOBS);
  const [events, setEvents] = useState<EventItem[]>(INITIAL_EVENTS);
  const [filterLevel, setFilterLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [autoScroll, setAutoScroll] = useState(true);

  // Initialize and subscribe to realtime events
  useEffect(() => {
    const client = getRealtimeClient();

    // Subscribe to status changes
    const unsubStatus = client.onStatusChange((status) => {
      setRealtimeStatus(status);
    });

    // Subscribe to health updates
    const unsubHealth = client.subscribe<SystemHealthData>('health:update', (data) => {
      setHealthData(data);
    });

    // Subscribe to job events
    const unsubEvents = client.subscribe<Record<string, unknown>>('job:event', (evt) => {
      const newEvent: EventItem = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toLocaleTimeString(),
        type: (evt.level as 'info' | 'success' | 'warn' | 'error') || 'info',
        source: (evt.source as string) || 'System',
        message: (evt.message as string) || JSON.stringify(evt),
      };
      setEvents((prev) => [newEvent, ...prev.slice(0, 99)]);
    });

    // Subscribe to job progress updates
    const unsubProgress = client.subscribe<{ id: string; progress: number }>('job:progress', (data) => {
      if (!data?.id) return;
      setJobs((prev) =>
        prev.map((j) => (j.id === data.id ? { ...j, progress: data.progress } : j))
      );
    });

    // Fetch initial health & operations
    async function loadInitialData() {
      const healthRes = await api<SystemHealthData>('GET', '/api/health');
      if (healthRes.ok && healthRes.data) {
        setHealthData(healthRes.data);
      }
    }
    loadInitialData();

    return () => {
      unsubStatus();
      unsubHealth();
      unsubEvents();
      unsubProgress();
    };
  }, []);

  const handleToggleJob = (id: string) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id === id) {
          const nextStatus = j.status === 'running' ? 'paused' : 'running';
          return { ...j, status: nextStatus };
        }
        return j;
      })
    );
  };

  const handleClearEvents = () => {
    setEvents([]);
  };

  const filteredEvents = events.filter((e) => {
    if (filterLevel === 'all') return true;
    return e.type === filterLevel;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <Activity className="w-7 h-7 text-blue-600" />
            Operations Monitor
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Realtime telemetry, automation progress tracker, and live event audit stream
          </p>
        </div>

        {/* Realtime Transport Indicator */}
        <div className="flex items-center gap-3">
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              realtimeStatus === 'connected'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                : realtimeStatus === 'polling'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                realtimeStatus === 'connected'
                  ? 'bg-emerald-500 animate-pulse'
                  : realtimeStatus === 'polling'
                  ? 'bg-blue-500'
                  : 'bg-amber-500'
              }`}
            />
            <span className="capitalize">{realtimeStatus}</span>
            {realtimeStatus === 'polling' && <span className="text-[10px] opacity-75">(10s)</span>}
          </div>
        </div>
      </div>

      {/* Metric & Quota Health Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span>API Rate Limit Health</span>
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-slate-900 dark:text-white">68%</span>
            <span className="text-xs text-slate-500">136 / 200 req</span>
          </div>
          <div className="mt-2 w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full" style={{ width: '68%' }} />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span>Active Workers</span>
            <Server className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-slate-900 dark:text-white">
              {jobs.filter((j) => j.status === 'running').length} / 5
            </span>
            <span className="text-xs text-emerald-500 font-medium">Optimal</span>
          </div>
          <div className="mt-2 w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: '40%' }} />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span>Live Stream Latency</span>
            <Radio className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-slate-900 dark:text-white">42ms</span>
            <span className="text-xs text-emerald-500 font-medium">&lt; 100ms Target</span>
          </div>
          <div className="mt-2 w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: '25%' }} />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span>Event Buffer</span>
            <Layers className="w-4 h-4 text-purple-500" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-extrabold text-slate-900 dark:text-white">
              {events.length}
            </span>
            <span className="text-xs text-slate-500">Max 100 retained</span>
          </div>
          <div className="mt-2 w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full"
              style={{ width: `${Math.min(events.length, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Grid: Left = Active Jobs Progress, Right = Live Event Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Job Progress (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600" />
              Active Automations &amp; Progress
            </h2>
            <span className="text-xs text-slate-500">
              {jobs.length} tracked jobs
            </span>
          </div>

          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white text-sm">
                        {job.name}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-semibold capitalize ${
                          job.status === 'running'
                            ? 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
                            : job.status === 'completed'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                            : job.status === 'paused'
                            ? 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {job.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-3">
                      <span>ID: {job.id}</span>
                      <span>•</span>
                      <span>Started {job.startedAt}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleToggleJob(job.id)}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
                    title={job.status === 'running' ? 'Pause' : 'Resume'}
                  >
                    {job.status === 'running' ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1.5 font-medium">
                    <span className="text-slate-600 dark:text-slate-400">
                      Processed: {job.current} / {job.total}
                    </span>
                    <span className="text-slate-900 dark:text-white font-bold">
                      {job.progress}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        job.progress === 100
                          ? 'bg-emerald-500'
                          : 'bg-blue-600'
                      }`}
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Live Event Feed (5 cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-purple-600" />
              Live Event Feed
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value as 'all' | 'info' | 'warn' | 'error')}
                className="text-xs bg-slate-100 dark:bg-slate-800 border-none rounded-lg px-2 py-1 text-slate-600 dark:text-slate-300 font-medium"
              >
                <option value="all">All Events</option>
                <option value="info">Info</option>
                <option value="warn">Warnings</option>
                <option value="error">Errors</option>
              </select>
              <button
                onClick={handleClearEvents}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Clear feed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Event container */}
          <div className="flex-1 min-h-[420px] max-h-[560px] overflow-y-auto p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
            {filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center text-slate-400 text-xs">
                <Activity className="w-8 h-8 stroke-[1.5] mb-2 opacity-40" />
                <span>No live events in current buffer</span>
              </div>
            ) : (
              filteredEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs flex items-start gap-2.5 transition-all"
                >
                  {evt.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  ) : evt.type === 'warn' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  ) : evt.type === 'error' ? (
                    <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  ) : (
                    <Clock className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {evt.source}
                      </span>
                      <span>{evt.timestamp}</span>
                    </div>
                    <p className="text-slate-800 dark:text-slate-200 break-words leading-relaxed">
                      {evt.message}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
