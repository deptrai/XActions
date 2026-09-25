// by nichxbt
'use client';

import React, { useState } from 'react';
import { Search, Users, Globe, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface ProfileResult {
  handle: string;
  platform: string;
  displayName?: string;
  bio?: string;
  followers?: number;
  verified?: boolean;
  profileUrl?: string;
  confidence?: number;
}

interface Cluster {
  id: string;
  name: string;
  platforms: string[];
  handles: string[];
  confidence: number;
}

const SEEDED_CLUSTERS: Cluster[] = [
  { id: 'c1', name: 'Crypto Twitter Cluster', platforms: ['x', 'threads'], handles: ['@crypto_whale', '@defi_analyst'], confidence: 0.94 },
  { id: 'c2', name: 'Tech Influencer Cluster', platforms: ['x', 'linkedin', 'mastodon'], handles: ['@tech_guru', '@ai_researcher'], confidence: 0.87 },
  { id: 'c3', name: 'E-commerce Seller Cluster', platforms: ['facebook', 'shopee', 'tiktok'], handles: ['@shop_vn', '@dropship_pro'], confidence: 0.78 },
];

const PLATFORM_COLORS: Record<string, string> = {
  x: 'bg-slate-900 text-white',
  twitter: 'bg-slate-900 text-white',
  threads: 'bg-purple-600 text-white',
  instagram: 'bg-pink-600 text-white',
  linkedin: 'bg-blue-700 text-white',
  facebook: 'bg-blue-600 text-white',
  tiktok: 'bg-black text-white',
  youtube: 'bg-red-600 text-white',
  reddit: 'bg-orange-600 text-white',
  mastodon: 'bg-indigo-600 text-white',
  bluesky: 'bg-sky-500 text-white',
  shopee: 'bg-orange-500 text-white',
};

export default function OsintPage() {
  const [handle, setHandle] = useState('');
  const [platform, setPlatform] = useState('auto');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<ProfileResult[] | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>(SEEDED_CLUSTERS);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'lookup' | 'clusters'>('lookup');

  const handleSearch = async () => {
    if (!handle.trim()) return;
    setIsSearching(true);
    setError(null);
    try {
      const res = await api<{ profiles?: ProfileResult[]; clusters?: Cluster[] }>(
        'POST',
        '/api/osint/find-profiles',
        { body: { query: handle.trim(), queryType: platform === 'auto' ? 'auto' : 'username', platforms: platform === 'auto' ? undefined : [platform] } }
      );
      if (res.ok && res.data) {
        // Backend returns ProfileItem {username,name,followersCount,...}; the UI
        // expects {handle,displayName,followers}. Normalize so fields render.
        const raw = Array.isArray(res.data.profiles) ? res.data.profiles : [];
        setResults(raw.map((p: any) => ({
          handle: p.handle ?? p.username ?? p.externalId ?? '',
          displayName: p.displayName ?? p.name ?? p.authorName,
          bio: p.bio,
          followers: typeof p.followers === 'number' ? p.followers : p.followersCount,
          verified: p.verified,
          profileUrl: p.profileUrl,
          platform: p.platform,
          confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
        })));
        if (Array.isArray(res.data.clusters)) setClusters(res.data.clusters);
      } else {
        const msg = !res.ok && 'error' in res ? String((res.error as {message?:string})?.message || 'Lookup failed') : 'Lookup failed';
        setError(msg);
        setResults([]);
      }
    } catch {
      setError('Network error — check backend connection');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600">
              <Search className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              OSINT Lookup
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Cross-platform identity search, handle mapping, and cluster analysis.
          </p>
        </div>
        <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
          {(['lookup', 'clusters'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all capitalize ${
                activeTab === tab
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab === 'lookup' ? <Search className="w-4 h-4" /> : <Users className="w-4 h-4" />}
              <span>{tab === 'lookup' ? 'Profile Lookup' : 'Identity Clusters'}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Lookup Tab */}
      {activeTab === 'lookup' && (
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-500" />
            <span>Cross-Platform Profile Search</span>
          </h2>
          <div className="flex gap-3">
            <div className="flex-1">
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Enter handle, email, or name..."
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="auto">All Platforms</option>
              <option value="x">X / Twitter</option>
              <option value="threads">Threads</option>
              <option value="instagram">Instagram</option>
              <option value="linkedin">LinkedIn</option>
              <option value="facebook">Facebook</option>
              <option value="tiktok">TikTok</option>
            </select>
            <button
              onClick={handleSearch}
              disabled={isSearching || !handle.trim()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition-colors disabled:opacity-60"
            >
              {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span>{isSearching ? 'Searching...' : 'Search'}</span>
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {results !== null && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 font-medium">
                {results.length} result{results.length !== 1 ? 's' : ''} found
              </p>
              {results.length === 0 ? (
                <p className="text-sm text-slate-400 italic py-4 text-center">No profiles found. Try a different query.</p>
              ) : (
                results.map((r, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ${PLATFORM_COLORS[r.platform] || 'bg-slate-500 text-white'}`}>
                      {r.platform.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{r.displayName || r.handle}</span>
                        {r.verified && <span className="text-blue-500 text-xs">✓</span>}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{r.handle} · {r.platform}</p>
                      {r.bio && <p className="text-xs text-slate-400 mt-0.5 truncate">{r.bio}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{r.followers?.toLocaleString() || '—'} followers</p>
                      <p className="text-xs text-slate-400">
                        {typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? `${(r.confidence * 100).toFixed(0)}% match` : '— match'}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Clusters Tab */}
      {activeTab === 'clusters' && (
        <div className="space-y-4">
          {clusters.map((cluster) => (
            <div key={cluster.id} className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{cluster.name}</h4>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                  {(cluster.confidence * 100).toFixed(0)}% confidence
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {cluster.platforms.map((p) => (
                  <span key={p} className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLORS[p] || 'bg-slate-500 text-white'}`}>
                    {p}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {cluster.handles.map((h) => (
                  <span key={h} className="text-xs font-mono px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    {h}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
