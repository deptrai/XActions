// by nichxbt
'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Video, Search, ExternalLink, RefreshCw, AlertTriangle,
  Flame, Users, MessageSquare, ThumbsUp, Calendar, Eye,
  Play, Sparkles, Clock, ArrowRight, X, User as UserIcon,
} from 'lucide-react';
import type { ApiResult } from '@medirus/api-client';
import { api } from '@/lib/api';
import { isAsyncAccepted, pollOperation } from '@/lib/scrape-poll';
import type { AsyncAccepted } from '@/lib/scrape-poll';

// ---------------------------------------------------------------------------
// Domain Types matching YouTube crawler & normalizer
// ---------------------------------------------------------------------------

interface PlatformEnvelope<T> {
  ok: boolean;
  platform?: string;
  action?: string;
  result?: T;
  error?: string;
  code?: string;
}

export interface YouTubeVideoMetadata {
  channelTitle?: string;
  channelId?: string;
  duration?: string;
  durationSeconds?: number;
  tags?: string[];
  regionCode?: string;
  categoryId?: string;
  sourcePlatform?: string;
}

export interface YouTubePost {
  id: string;
  platform: string;
  externalId: string;
  title?: string;
  category?: string;
  authorId?: string;
  authorName: string;
  authorUrl?: string;
  postUrl?: string;
  content?: string;
  mediaUrls?: string[];
  viewsCount?: number;
  likesCount?: number;
  repliesCount?: number;
  metadata?: YouTubeVideoMetadata;
  publishedAt?: string | Date | null;
  crawledAt?: string | Date;
}

export interface YouTubeChannelMetadata {
  videoCount?: number;
  viewCount?: number;
  country?: string;
  customUrl?: string;
  sourcePlatform?: string;
}

export interface YouTubeProfile {
  id: string;
  platform: string;
  externalId: string;
  name: string;
  authorName?: string;
  bio?: string;
  avatar?: string;
  profileUrl?: string;
  followersCount?: number;
  metadata?: YouTubeChannelMetadata;
  crawledAt?: string | Date;
}

export interface YouTubeCommentMetadata {
  videoId?: string;
  parentCommentId?: string;
  sourcePlatform?: string;
}

export interface YouTubeComment {
  id: string;
  platform: string;
  externalId: string;
  postId?: string;
  depth: number;
  parentCommentId?: string;
  authorId?: string;
  authorName: string;
  authorAvatar?: string | null;
  content: string;
  likesCount: number;
  subCommentsCount?: number;
  metadata?: YouTubeCommentMetadata;
  publishedAt?: string | Date | null;
  crawledAt?: string | Date;
}

export type TabType = 'trending' | 'channel' | 'comments';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function scrape<T = unknown>(
  action: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ApiResult<T>> {
  const res = await api<PlatformEnvelope<T> & AsyncAccepted>(
    'POST',
    '/api/platform/youtube/scrape',
    { body: { action, ...args }, signal }
  );
  if (res.ok && res.data && typeof res.data === 'object') {
    if (isAsyncAccepted(res.data)) {
      return pollOperation<T>(res.data.statusUrl as string, signal, res.data.retry_after_ms);
    }
    const env = res.data as PlatformEnvelope<T>;
    if ('result' in env) {
      return { ok: true as const, status: res.status, data: env.result as T };
    }
  }
  return res as unknown as ApiResult<T>;
}

function mapError(err: unknown): { kind: 'warn' | 'error'; msg: string } {
  if (typeof err === 'string') {
    if (err.includes('404') || err.includes('Not Found') || err.includes('not found')) {
      return { kind: 'warn', msg: 'Không tìm thấy kênh hoặc video.' };
    }
    return { kind: 'error', msg: err };
  }
  const e = err as { code?: string; message?: string; error?: string } | undefined;
  const code = e?.code || '';
  const msg = e?.message || e?.error || 'Yêu cầu thất bại';
  if (code === 'XACT_4004' || msg.includes('404') || msg.includes('not found') || msg.includes('Not Found')) {
    return { kind: 'warn', msg: 'Không tìm thấy kênh hoặc video.' };
  }
  if (code === 'XACT_4030' || msg.includes('403') || msg.includes('challenge')) {
    if (msg.includes('quota') || msg.includes('Quota')) {
      return {
        kind: 'warn',
        msg: 'Hạn ngạch API YouTube đã vượt quá hoặc bị từ chối truy cập. Vui lòng kiểm tra API key hoặc thử lại sau.',
      };
    }
    return {
      kind: 'warn',
      msg: 'Nền tảng đang áp dụng xác thực chống bot. Vui lòng thử lại sau vài phút hoặc sử dụng proxy cao cấp.',
    };
  }
  if (code === 'XACT_4029' || code === 'XACT_429' || msg.includes('429')) {
    return {
      kind: 'warn',
      msg: 'Bị giới hạn tần suất yêu cầu (Rate limited). Vui lòng thử lại sau giây lát.',
    };
  }
  return { kind: 'error', msg };
}

function extractVideoId(input: string): string {
  const clean = input.trim();
  if (!clean) return '';
  // youtu.be/<id>
  const shortMatch = clean.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  // /shorts/<id>
  const shortsMatch = clean.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];
  // /embed/<id>
  const embedMatch = clean.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  // watch?v=<id> or ?v=<id> or &v=<id>
  const watchMatch = clean.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  // 11-char videoId directly
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
  return clean;
}

function parseIsoDuration(durationStr: string): number {
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(seconds?: number | null, isoStr?: string | null): string {
  let sec = seconds;
  if ((sec == null || isNaN(sec)) && isoStr) {
    sec = parseIsoDuration(isoStr);
  }
  if (sec == null || isNaN(sec) || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatNumber(n?: number | null): string {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatViews(views?: number | null): string {
  if (views == null || isNaN(views)) return '—';
  return `${formatNumber(views)} lượt xem`;
}

function formatSubscribers(count?: number | null): string {
  if (count == null || isNaN(count)) return '—';
  return `${formatNumber(count)} người đăng ký`;
}

function formatDate(dateVal?: string | Date | null): string {
  if (!dateVal) return '';
  try {
    const d = typeof dateVal === 'string' ? new Date(dateVal) : dateVal;
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Subcomponents with Fallback & referrerPolicy="no-referrer"
// ---------------------------------------------------------------------------

function YouTubeThumbnail({
  src,
  title,
  duration,
}: {
  src?: string | null;
  title?: string;
  duration?: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 flex items-center justify-center group">
      {!src || failed ? (
        <div className="flex flex-col items-center justify-center text-slate-400 gap-1.5 p-4 text-center">
          <Video className="w-8 h-8 opacity-60" />
          <span className="text-[11px] font-medium">YouTube Video</span>
        </div>
      ) : (
        <img
          src={src}
          alt={title || 'video thumbnail'}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      )}

      {duration && (
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-[11px] font-mono font-medium flex items-center gap-1 shadow-sm">
          <Clock className="w-3 h-3 text-slate-300" />
          <span>{duration}</span>
        </div>
      )}
    </div>
  );
}

function YouTubeAvatar({
  src,
  name,
  size = 'md',
}: {
  src?: string | null;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-16 h-16 text-xl',
  }[size];

  if (!src || failed) {
    const initial = name ? name.trim().charAt(0).toUpperCase() : '?';
    return (
      <div
        className={`${sizeClasses} shrink-0 rounded-full bg-gradient-to-br from-red-500/20 to-orange-500/20 border border-red-200 dark:border-red-900/40 flex items-center justify-center font-bold text-red-600 dark:text-red-400`}
      >
        {initial !== '?' ? initial : <UserIcon className="w-4 h-4 text-slate-400" />}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name || 'channel avatar'}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${sizeClasses} shrink-0 rounded-full object-cover border border-slate-200 dark:border-slate-800 shadow-sm`}
    />
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

function YouTubeInsightsInner() {
  const params = useSearchParams();
  const router = useRouter();

  // Active Tab State
  const [activeTab, setActiveTab] = useState<TabType>('trending');

  // Input states
  const [channelInput, setChannelInput] = useState(
    params.get('channel') || params.get('handle') || params.get('channelId') || ''
  );
  const [videoInput, setVideoInput] = useState(
    params.get('v') || params.get('videoId') || ''
  );

  // Last action for Retry button
  const [lastAction, setLastAction] = useState<TabType | null>(null);

  // Tab 1: Trending VN state
  const [trendingPosts, setTrendingPosts] = useState<YouTubePost[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingError, setTrendingError] = useState<{ kind: 'warn' | 'error'; msg: string } | null>(null);

  // Tab 2: Channel Inspector state
  const [channelProfile, setChannelProfile] = useState<YouTubeProfile | null>(null);
  const [channelVideos, setChannelVideos] = useState<YouTubePost[]>([]);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelError, setChannelError] = useState<{ kind: 'warn' | 'error'; msg: string } | null>(null);

  // Tab 3: Comment Reader state
  const [comments, setComments] = useState<YouTubeComment[]>([]);
  const [commentsVideoId, setCommentsVideoId] = useState<string>('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<{ kind: 'warn' | 'error'; msg: string } | null>(null);

  // -------------------------------------------------------------------------
  // Fetch Functions
  // -------------------------------------------------------------------------

  // Trending VN fetch
  const fetchTrending = useCallback(async () => {
    setTrendingLoading(true);
    setTrendingError(null);
    setLastAction('trending');

    const res = await scrape<{ posts?: YouTubePost[] }>('trending_vn', {
      regionCode: 'VN',
      mode: 'sync',
    });

    if (res.ok && res.data) {
      const dataObj = res.data as { posts?: YouTubePost[]; data?: { posts?: YouTubePost[] } };
      const rawPosts = dataObj.posts || dataObj.data?.posts;
      if (Array.isArray(rawPosts)) {
        setTrendingPosts(rawPosts);
      } else if (Array.isArray(res.data)) {
        setTrendingPosts(res.data as YouTubePost[]);
      } else {
        setTrendingPosts([]);
      }
    } else {
      setTrendingError(mapError(!res.ok && 'error' in res ? res.error : undefined));
    }
    setTrendingLoading(false);
  }, []);

  // Channel Inspector fetch
  const fetchChannel = useCallback(async (targetChannel?: string) => {
    const rawTarget = (targetChannel ?? channelInput).trim();
    if (!rawTarget) return;

    setChannelLoading(true);
    setChannelError(null);
    setLastAction('channel');

    const isChannelId = rawTarget.startsWith('UC') && rawTarget.length >= 20;
    const detailPayload = isChannelId
      ? { channelId: rawTarget, mode: 'sync' }
      : { forHandle: rawTarget.replace(/^@/, ''), mode: 'sync' };

    const detailRes = await scrape<{ profile?: YouTubeProfile }>('channel_detail', detailPayload);

    if (detailRes.ok && detailRes.data) {
      const dObj = detailRes.data as { profile?: YouTubeProfile; data?: { profile?: YouTubeProfile } };
      const profile = dObj.profile || dObj.data?.profile;
      if (profile) {
        setChannelProfile(profile);

        // Fetch channel videos with resolved channelId
        const channelId = profile.externalId || (isChannelId ? rawTarget : '');
        if (channelId) {
          const videosRes = await scrape<{ posts?: YouTubePost[] }>('channel_videos', {
            channelId,
            limit: 12,
            mode: 'sync',
          });
          if (videosRes.ok && videosRes.data) {
            const vObj = videosRes.data as { posts?: YouTubePost[]; data?: { posts?: YouTubePost[] } };
            const vPosts = vObj.posts || vObj.data?.posts;
            setChannelVideos(Array.isArray(vPosts) ? vPosts.slice(0, 12) : []);
          } else {
            setChannelVideos([]);
          }
        }
      } else {
        setChannelProfile(null);
        setChannelVideos([]);
        setChannelError({ kind: 'warn', msg: 'Không tìm thấy kênh YouTube này.' });
      }
    } else {
      setChannelProfile(null);
      setChannelVideos([]);
      setChannelError(mapError(!detailRes.ok && 'error' in detailRes ? detailRes.error : undefined));
    }
    setChannelLoading(false);
  }, [channelInput]);

  // Comment Reader fetch
  const fetchComments = useCallback(async (targetVideo?: string) => {
    const rawTarget = (targetVideo ?? videoInput).trim();
    const vid = extractVideoId(rawTarget);
    if (!vid) return;

    setCommentsLoading(true);
    setCommentsError(null);
    setCommentsVideoId(vid);
    setLastAction('comments');

    const res = await scrape<{ comments?: YouTubeComment[] }>('video_comments', {
      videoId: vid,
      mode: 'sync',
    });

    if (res.ok && res.data) {
      const cObj = res.data as { comments?: YouTubeComment[]; data?: { comments?: YouTubeComment[] } };
      const rawComments = cObj.comments || cObj.data?.comments;
      if (Array.isArray(rawComments)) {
        setComments(rawComments);
      } else if (Array.isArray(res.data)) {
        setComments(res.data as YouTubeComment[]);
      } else {
        setComments([]);
      }
    } else {
      setComments([]);
      setCommentsError(mapError(!res.ok && 'error' in res ? res.error : undefined));
    }
    setCommentsLoading(false);
  }, [videoInput]);

  // -------------------------------------------------------------------------
  // URL-only effect using refs (so typing in inputs does not refetch)
  // -------------------------------------------------------------------------
  const fetchTrendingRef = useRef(fetchTrending);
  fetchTrendingRef.current = fetchTrending;
  const fetchChannelRef = useRef(fetchChannel);
  fetchChannelRef.current = fetchChannel;
  const fetchCommentsRef = useRef(fetchComments);
  fetchCommentsRef.current = fetchComments;

  useEffect(() => {
    const tab = params.get('tab') as TabType | null;
    const qVideo = params.get('v') || params.get('videoId');
    const qChannel = params.get('channel') || params.get('handle') || params.get('channelId');

    if (qVideo) {
      setActiveTab('comments');
      const vid = extractVideoId(qVideo);
      setVideoInput(vid);
      fetchCommentsRef.current(vid);
    } else if (qChannel) {
      setActiveTab('channel');
      setChannelInput(qChannel);
      fetchChannelRef.current(qChannel);
    } else if (tab === 'channel') {
      setActiveTab('channel');
    } else if (tab === 'comments') {
      setActiveTab('comments');
    } else {
      setActiveTab('trending');
      fetchTrendingRef.current();
    }
  }, [params]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleRetry = () => {
    if (lastAction === 'channel') {
      fetchChannel();
    } else if (lastAction === 'comments') {
      fetchComments();
    } else {
      fetchTrending();
    }
  };

  // Jump from trending video card to comments tab
  // Chỉ đẩy URL — effect theo params sẽ gọi fetchComments đúng một lần.
  const handleSelectVideoForComments = (videoId: string) => {
    if (!videoId) return;
    router.push(`/youtube?tab=comments&v=${videoId}`, { scroll: false });
  };

  // Client-side sorted comments (up to 20, descending by likesCount)
  const sortedComments = useMemo(() => {
    if (!comments || !comments.length) return [];
    const list = [...comments];
    list.sort((a, b) => (b.likesCount ?? 0) - (a.likesCount ?? 0));
    return list.slice(0, 20);
  }, [comments]);

  const currentError =
    activeTab === 'trending'
      ? trendingError
      : activeTab === 'channel'
      ? channelError
      : commentsError;

  const isCurrentLoading =
    activeTab === 'trending'
      ? trendingLoading
      : activeTab === 'channel'
      ? channelLoading
      : commentsLoading;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400">
              <Video className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                YouTube Video &amp; Channel Insights Suite
              </h1>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Thịnh hành YouTube Việt Nam, thống kê kênh và đọc bình luận video theo thời gian thực.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRetry}
            disabled={isCurrentLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60 shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${isCurrentLoading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => {
            setActiveTab('trending');
            if (trendingPosts.length === 0) fetchTrending();
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'trending'
              ? 'bg-red-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Flame className="w-4 h-4" />
          <span>Trending VN</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('channel')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'channel'
              ? 'bg-red-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Channel Inspector</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('comments')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'comments'
              ? 'bg-red-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Comment Reader</span>
        </button>
      </div>

      {/* Upstream Error Banner with Retry */}
      {currentError && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            <span className="text-sm font-medium text-red-700 dark:text-red-400">
              {currentError.msg}
            </span>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 1: TRENDING VN                                                    */}
      {/* ===================================================================== */}
      {activeTab === 'trending' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-red-500" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Video thịnh hành Việt Nam ({trendingPosts.length})
              </h2>
            </div>
          </div>

          {trendingLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 animate-pulse"
                >
                  <div className="aspect-video w-full rounded-xl bg-slate-100 dark:bg-slate-800" />
                  <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-1/2" />
                </div>
              ))}
            </div>
          )}

          {!trendingLoading && trendingPosts.length === 0 && !trendingError && (
            <div className="p-12 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-3">
              <Flame className="w-10 h-10 text-slate-400 mx-auto" />
              <h3 className="font-semibold text-slate-900 dark:text-white">
                Chưa có dữ liệu thịnh hành
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Bấm nút làm mới để tải danh sách các video đang thịnh hành tại Việt Nam.
              </p>
              <button
                type="button"
                onClick={fetchTrending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tải Trending</span>
              </button>
            </div>
          )}

          {!trendingLoading && trendingPosts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {trendingPosts.map((post, idx) => {
                const duration = formatDuration(
                  post.metadata?.durationSeconds,
                  post.metadata?.duration
                );
                const thumb = post.mediaUrls?.[0] || null;
                const externalWatchUrl =
                  post.postUrl || (post.externalId ? `https://www.youtube.com/watch?v=${post.externalId}` : null);

                return (
                  <div
                    key={post.id || post.externalId || idx}
                    className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      {/* Thumbnail with duration */}
                      <YouTubeThumbnail src={thumb} title={post.title} duration={duration} />

                      {/* Video Title */}
                      <h3
                        className="font-bold text-slate-900 dark:text-white text-sm line-clamp-2 leading-snug cursor-pointer hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        onClick={() => handleSelectVideoForComments(post.externalId)}
                        title={post.title}
                      >
                        {post.title || 'Video không có tiêu đề'}
                      </h3>

                      {/* Author & Stats */}
                      <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <div className="font-semibold text-slate-700 dark:text-slate-300 truncate">
                          {post.authorName || 'Kênh YouTube'}
                        </div>
                        <div className="flex items-center gap-3">
                          {post.viewsCount != null && (
                            <span className="flex items-center gap-1">
                              <Eye className="w-3.5 h-3.5" />
                              {formatViews(post.viewsCount)}
                            </span>
                          )}
                          {post.publishedAt && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5" />
                              {formatDate(post.publishedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => handleSelectVideoForComments(post.externalId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Xem bình luận</span>
                      </button>

                      {externalWatchUrl && (
                        <a
                          href={externalWatchUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-medium"
                        >
                          <span>YouTube</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: CHANNEL INSPECTOR                                              */}
      {/* ===================================================================== */}
      {activeTab === 'channel' && (
        <div className="space-y-6">
          {/* Channel Search Form */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchChannel();
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  placeholder="Nhập handle kênh (vd: @MixiGaming3004, @F8VNOfficial) hoặc channelId (UC...)..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <button
                type="submit"
                disabled={!channelInput.trim() || channelLoading}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 shadow-sm"
              >
                {channelLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                <span>Tra cứu kênh</span>
              </button>
            </form>
          </div>

          {channelLoading && (
            <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-800" />
                <div className="space-y-2 flex-1">
                  <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded w-1/4" />
                  <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-1/3" />
                </div>
              </div>
            </div>
          )}

          {/* Channel Profile Header */}
          {channelProfile && !channelLoading && (
            <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <YouTubeAvatar
                    src={channelProfile.avatar}
                    name={channelProfile.name}
                    size="lg"
                  />
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white truncate">
                      {channelProfile.name}
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-mono mt-0.5">
                      {channelProfile.metadata?.customUrl && (
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          {channelProfile.metadata.customUrl.startsWith('@')
                            ? channelProfile.metadata.customUrl
                            : `@${channelProfile.metadata.customUrl}`}
                        </span>
                      )}
                      <span>·</span>
                      <span>ID: {channelProfile.externalId}</span>
                    </div>
                  </div>
                </div>

                {channelProfile.profileUrl && (
                  <a
                    href={channelProfile.profileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <span>Mở trên YouTube</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/60 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Người đăng ký</span>
                  <span className="font-bold text-slate-900 dark:text-white text-base">
                    {formatSubscribers(channelProfile.followersCount)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Tổng số video</span>
                  <span className="font-bold text-slate-900 dark:text-white text-base">
                    {formatNumber(channelProfile.metadata?.videoCount)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Tổng lượt xem</span>
                  <span className="font-bold text-slate-900 dark:text-white text-base">
                    {formatNumber(channelProfile.metadata?.viewCount)}
                  </span>
                </div>
              </div>

              {channelProfile.bio && (
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-line line-clamp-3">
                  {channelProfile.bio}
                </p>
              )}
            </div>
          )}

          {/* Channel Videos Grid (up to 12) */}
          {channelProfile && !channelLoading && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-red-500" />
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    Video mới nhất ({channelVideos.length})
                  </h3>
                </div>
              </div>

              {channelVideos.length === 0 ? (
                <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-2">
                  <Video className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Kênh này chưa có video nào hoặc không thể tải danh sách video.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {channelVideos.map((video, idx) => {
                    const duration = formatDuration(
                      video.metadata?.durationSeconds,
                      video.metadata?.duration
                    );
                    const thumb = video.mediaUrls?.[0] || null;
                    const watchUrl =
                      video.postUrl || (video.externalId ? `https://www.youtube.com/watch?v=${video.externalId}` : null);

                    return (
                      <div
                        key={video.id || video.externalId || idx}
                        className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          <YouTubeThumbnail src={thumb} title={video.title} duration={duration} />
                          <h4
                            className="font-bold text-slate-900 dark:text-white text-sm line-clamp-2 leading-snug cursor-pointer hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            onClick={() => handleSelectVideoForComments(video.externalId)}
                            title={video.title}
                          >
                            {video.title || 'Video không có tiêu đề'}
                          </h4>
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            {video.viewsCount != null && (
                              <span>{formatViews(video.viewsCount)}</span>
                            )}
                            {video.publishedAt && (
                              <span>{formatDate(video.publishedAt)}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => handleSelectVideoForComments(video.externalId)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Bình luận</span>
                          </button>
                          {watchUrl && (
                            <a
                              href={watchUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                            >
                              <span>Xem</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Empty / Initial State for Channel tab */}
          {!channelProfile && !channelLoading && !channelError && (
            <div className="p-12 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-3">
              <Users className="w-10 h-10 text-slate-400 mx-auto" />
              <h3 className="font-semibold text-slate-900 dark:text-white">
                Tra cứu thông tin kênh YouTube
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Nhập handle (ví dụ @F8VNOfficial) hoặc ID kênh (bắt đầu bằng UC...) để xem số lượng subscriber, tổng số video và danh sách video mới nhất.
              </p>
            </div>
          )}

          {/* Not Found Empty State */}
          {!channelProfile && !channelLoading && channelError && (
            <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-3">
              <Search className="w-8 h-8 text-slate-400 mx-auto" />
              <h3 className="font-semibold text-slate-900 dark:text-white">
                Không tìm thấy kênh
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Vui lòng kiểm tra lại handle hoặc channelId vừa nhập và thử lại.
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: COMMENT READER                                                 */}
      {/* ===================================================================== */}
      {activeTab === 'comments' && (
        <div className="space-y-6">
          {/* Comment Search Form */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchComments();
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  placeholder="Dán link YouTube (watch?v=..., youtu.be/..., /shorts/...) hoặc 11 ký tự videoId..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <button
                type="submit"
                disabled={!videoInput.trim() || commentsLoading}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 shadow-sm"
              >
                {commentsLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <MessageSquare className="w-4 h-4" />
                )}
                <span>Đọc bình luận</span>
              </button>
            </form>

            {commentsVideoId && (
              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100 dark:border-slate-800 text-slate-500">
                <div className="flex items-center gap-2">
                  <span>Video ID:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {commentsVideoId}
                  </span>
                </div>
                <a
                  href={`https://www.youtube.com/watch?v=${commentsVideoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 hover:underline font-medium"
                >
                  <span>Mở video</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {commentsLoading && (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse flex items-start gap-3"
                >
                  <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/4" />
                    <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-full" />
                    <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Initial State for Comment tab */}
          {!commentsVideoId && !commentsLoading && (
            <div className="p-12 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-3">
              <MessageSquare className="w-10 h-10 text-slate-400 mx-auto" />
              <h3 className="font-semibold text-slate-900 dark:text-white">
                Khám phá bình luận YouTube
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Dán URL video hoặc ID video để xem 20 bình luận có lượt thích cao nhất, giúp bạn phân tích phản hồi của khán giả.
              </p>
            </div>
          )}

          {/* Empty comments state */}
          {commentsVideoId && !commentsLoading && sortedComments.length === 0 && !commentsError && (
            <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-3">
              <MessageSquare className="w-8 h-8 text-slate-400 mx-auto" />
              <h3 className="font-semibold text-slate-900 dark:text-white">
                Video này chưa có bình luận
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Video này chưa có bình luận nào hoặc tính năng bình luận đã bị chủ kênh tắt.
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* List of comments */}
          {commentsVideoId && !commentsLoading && sortedComments.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ThumbsUp className="w-4 h-4 text-red-500" />
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    Top bình luận ({sortedComments.length}) · Sắp xếp theo lượt thích
                  </h3>
                </div>
              </div>

              <div className="space-y-3">
                {sortedComments.map((comment, idx) => {
                  const isReply = comment.depth > 0;
                  return (
                    <div
                      key={comment.id || comment.externalId || idx}
                      className={`p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 shadow-sm transition-colors ${
                        isReply ? 'ml-6 sm:ml-10 border-l-4 border-l-red-500' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <YouTubeAvatar
                            src={comment.authorAvatar}
                            name={comment.authorName}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                {comment.authorName || 'Người dùng YouTube'}
                              </span>
                              {isReply && (
                                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                  Phản hồi
                                </span>
                              )}
                            </div>
                            {comment.publishedAt && (
                              <span className="text-[11px] text-slate-400">
                                {formatDate(comment.publishedAt)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Likes Count */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800/80 text-xs font-semibold text-slate-700 dark:text-slate-300 shrink-0">
                          <ThumbsUp className="w-3.5 h-3.5 text-red-500" />
                          <span>{formatNumber(comment.likesCount)}</span>
                        </div>
                      </div>

                      {/* Comment Content */}
                      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line pl-11">
                        {comment.content}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function YouTubePage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-slate-500">
          Đang tải YouTube Insights...
        </div>
      }
    >
      <YouTubeInsightsInner />
    </Suspense>
  );
}
