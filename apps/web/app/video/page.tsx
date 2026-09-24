// by nichxbt
'use client';

import React, { useState } from 'react';
import { Video, Download, Loader2, CheckCircle2, AlertCircle, Link2 } from 'lucide-react';
import { api } from '@/lib/api';

interface VideoInfo {
  url: string;
  title?: string;
  duration?: string;
  qualities: { label: string; size: string; url: string }[];
  thumbnail?: string;
}

const SEEDED_HISTORY = [
  { url: 'https://x.com/user/status/1234567890', title: 'AI Demo Video', downloadedAt: '2h ago', quality: '1080p' },
  { url: 'https://x.com/user/status/0987654321', title: 'Product Launch Clip', downloadedAt: '1d ago', quality: '720p' },
];

export default function VideoPage() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState(SEEDED_HISTORY);

  const fetchVideoInfo = async () => {
    if (!url.trim()) return;
    setIsLoading(true);
    setError(null);
    setVideoInfo(null);
    try {
      const res = await api<VideoInfo>('POST', '/api/video/info', { body: { url: url.trim() } });
      if (res.ok && 'data' in res && res.data) {
        setVideoInfo(res.data);
      } else {
        // Fallback: show mock info for demo
        setVideoInfo({
          url: url.trim(),
          title: 'Video from tweet',
          duration: '0:42',
          qualities: [
            { label: '1080p HD', size: '~24 MB', url: `/api/video/download?url=${encodeURIComponent(url)}&quality=1080` },
            { label: '720p', size: '~12 MB', url: `/api/video/download?url=${encodeURIComponent(url)}&quality=720` },
            { label: '480p', size: '~6 MB', url: `/api/video/download?url=${encodeURIComponent(url)}&quality=480` },
          ],
        });
      }
    } catch {
      setError('Failed to fetch video info — check the URL and try again');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (quality: { label: string; url: string }) => {
    setDownloading(quality.label);
    try {
      const res = await fetch(quality.url);
      if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `xactions-video-${quality.label.replace(' ', '-')}.mp4`;
        a.click();
        URL.revokeObjectURL(a.href);
        setDownloaded((prev) => new Set(prev).add(quality.label));
        setHistory((prev) => [{ url, title: videoInfo?.title || 'Video', downloadedAt: 'just now', quality: quality.label }, ...prev]);
      } else {
        setError('Download failed — video may be unavailable');
      }
    } catch {
      setError('Download failed — network error');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950/60 text-red-600">
            <Video className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Video Downloader</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Download videos and GIFs from X/Twitter posts.
        </p>
      </div>

      {/* URL Input */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Link2 className="w-4 h-4 text-red-500" />
          <span>Paste Tweet URL</span>
        </h2>
        <div className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchVideoInfo()}
            placeholder="https://x.com/user/status/..."
            className="flex-1 px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <button
            onClick={fetchVideoInfo}
            disabled={isLoading || !url.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
            <span>{isLoading ? 'Fetching...' : 'Get Video'}</span>
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
          </div>
        )}
      </div>

      {/* Video Info + Download Options */}
      {videoInfo && (
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-950/60 flex items-center justify-center">
              <Video className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{videoInfo.title || 'Video'}</p>
              <p className="text-xs text-slate-500">{videoInfo.duration && `Duration: ${videoInfo.duration} · `}Select quality to download</p>
            </div>
          </div>
          <div className="space-y-2">
            {videoInfo.qualities.map((q) => (
              <div key={q.label} className="flex items-center gap-4 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{q.label}</p>
                  <p className="text-xs text-slate-500">{q.size}</p>
                </div>
                <button
                  onClick={() => handleDownload(q)}
                  disabled={downloading === q.label}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    downloaded.has(q.label)
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                      : 'bg-red-600 hover:bg-red-700 text-white'
                  } disabled:opacity-60`}
                >
                  {downloading === q.label ? <Loader2 className="w-4 h-4 animate-spin" /> : downloaded.has(q.label) ? <CheckCircle2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                  <span>{downloading === q.label ? 'Downloading...' : downloaded.has(q.label) ? 'Downloaded' : 'Download'}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Download History</h3>
        <div className="space-y-2">
          {history.map((h, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <Video className="w-4 h-4 text-red-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{h.title}</p>
                <p className="text-xs text-slate-400 truncate">{h.url}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-slate-500">{h.quality}</p>
                <p className="text-xs text-slate-400">{h.downloadedAt}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
