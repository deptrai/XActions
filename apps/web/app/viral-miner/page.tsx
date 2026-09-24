'use client';

import React, { useState, useEffect } from 'react';
import {
  Flame,
  Play,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  Layers,
  Sparkles,
  RefreshCw,
  Clock,
  DollarSign,
  AlertCircle,
} from 'lucide-react';

const DEFAULT_PLATFORMS = [
  'x', 'facebook', 'tiktok', 'threads', 'instagram', 'linkedin',
  'youtube', 'reddit', 'medium', 'bluesky', 'mastodon', 'shopee',
  'chotot', 'topcv', 'vietnamworks', 'zalo', 'batdongsan', 'telegram'
];

const HOOK_DISTRIBUTION = [
  { name: 'How-to / Actionable', percentage: 32, count: 1240, color: 'bg-blue-500' },
  { name: 'Contrast / Myth-busting', percentage: 24, count: 930, color: 'bg-purple-500' },
  { name: 'Curiosity / Question', percentage: 18, count: 698, color: 'bg-emerald-500' },
  { name: 'Hot Take / Controversial', percentage: 14, count: 542, color: 'bg-amber-500' },
  { name: 'Story / Personal Experience', percentage: 8, count: 310, color: 'bg-pink-500' },
  { name: 'Data / Statistical', percentage: 4, count: 155, color: 'bg-indigo-500' },
];

const TOP_PATTERNS = [
  {
    title: 'The "Nobody is talking about X" Opening',
    platform: 'X (Twitter)',
    avgScore: 94,
    engagementMultiplier: '4.8x',
    example: 'Nobody is talking about the massive AI shift happening right now. Here are 5 things you must know:',
  },
  {
    title: 'The "Stop doing X, do Y instead" Inversion',
    platform: 'LinkedIn / Threads',
    avgScore: 89,
    engagementMultiplier: '3.6x',
    example: 'Stop spending 40 hours on cold emails. Do this 10-minute setup instead:',
  },
  {
    title: 'The "0 to 100k" Proof-First Framework',
    platform: 'TikTok / YouTube',
    avgScore: 92,
    engagementMultiplier: '4.2x',
    example: 'I grew from 0 to 100k followers in 90 days. Here is the exact script playbook:',
  },
];

export default function ViralMinerPage() {
  const [platforms, setPlatforms] = useState<string[]>(DEFAULT_PLATFORMS);
  const [selectedPlatform, setSelectedPlatform] = useState('x');
  const [niche, setNiche] = useState('saas');
  const [count, setCount] = useState(500);
  const [activeTab, setActiveTab] = useState<'overview' | 'patterns'>('overview');

  // Mining state
  const [isMining, setIsMining] = useState(false);
  const [progress, setProgress] = useState<{
    scraped: number;
    classified: number;
    total: number;
    cost: string;
    elapsed: string;
  } | null>(null);

  useEffect(() => {
    // Try fetching available platforms from API
    fetch('http://localhost:3001/api/viral/platforms')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.data?.platforms) {
          setPlatforms(data.data.platforms);
        }
      })
      .catch(() => {});
  }, []);

  const handleStartMining = () => {
    setIsMining(true);
    setProgress({
      scraped: 0,
      classified: 0,
      total: count,
      cost: '$0.00',
      elapsed: '0s',
    });

    let currentScraped = 0;
    const interval = setInterval(() => {
      currentScraped += Math.min(100, count - currentScraped);
      const classified = Math.floor(currentScraped * 0.95);
      const cost = `$${((currentScraped * 0.0001)).toFixed(3)}`;

      setProgress((prev) => ({
        scraped: currentScraped,
        classified,
        total: count,
        cost,
        elapsed: `${Math.round(currentScraped / 50)}s`,
      }));

      if (currentScraped >= count) {
        clearInterval(interval);
        setIsMining(false);
      }
    }, 400);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-600">
              <Flame className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Viral DNA Miner
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Mine top performing social content, reverse engineer hook archetypes, and extract high-converting copy patterns.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'overview'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Hook Distribution</span>
          </button>
          <button
            onClick={() => setActiveTab('patterns')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'patterns'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Top Patterns</span>
          </button>
        </div>
      </div>

      {/* Configuration & Mining Trigger Card */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-500" />
          <span>Mining Parameters</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Platform select */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Platform</label>
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Niche Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Niche / Topic</label>
            <input
              type="text"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="e.g. saas, ai, crypto, fitness"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Post Count */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Sample Count</label>
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={100}>100 posts (Quick)</option>
              <option value={500}>500 posts (Standard)</option>
              <option value={1000}>1,000 posts (Deep)</option>
              <option value={5000}>5,000 posts (Comprehensive)</option>
            </select>
          </div>

          {/* Run Button */}
          <div className="flex items-end">
            <button
              onClick={handleStartMining}
              disabled={isMining}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors shadow-sm disabled:opacity-60"
            >
              {isMining ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Mining...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Run Mining</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Progress Card */}
        {progress && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-xs text-slate-500">Scraped Posts</span>
                <p className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                  {progress.scraped} / {progress.total}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-xs text-slate-500">Classified Archetypes</span>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {progress.classified}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-xs text-slate-500">Est. Cost (x402)</span>
                <p className="text-lg font-bold text-blue-600 dark:text-blue-400 mt-0.5">
                  {progress.cost}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-xs text-slate-500">Elapsed</span>
                <p className="text-lg font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                  {progress.elapsed}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {activeTab === 'overview' && (
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Hook Archetype Distribution
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Relative performance and frequency of top hook structures in {selectedPlatform.toUpperCase()} - #{niche}
              </p>
            </div>
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40">
              3,875 Analyzed
            </span>
          </div>

          {/* Visual SVG / CSS Bar Chart */}
          <div className="space-y-4">
            {HOOK_DISTRIBUTION.map((item) => (
              <div key={item.name} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-slate-700 dark:text-slate-300">{item.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 font-mono text-[11px]">{item.count.toLocaleString()} posts</span>
                    <span className="text-slate-900 dark:text-white font-bold w-10 text-right">{item.percentage}%</span>
                  </div>
                </div>
                <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${item.color} rounded-full transition-all duration-500`}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Patterns Tab */}
      {activeTab === 'patterns' && (
        <div className="space-y-4">
          {TOP_PATTERNS.map((pattern) => (
            <div
              key={pattern.title}
              className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    {pattern.platform}
                  </span>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    {pattern.title}
                  </h4>
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" />
                    {pattern.engagementMultiplier}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                    Score: {pattern.avgScore}/100
                  </span>
                </div>
              </div>
              <p className="text-xs italic bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800/80 text-slate-600 dark:text-slate-300">
                &ldquo;{pattern.example}&rdquo;
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
