// by nichxbt
'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Flame, User as UserIcon, Globe, RefreshCw, RefreshCcwDot, ExternalLink,
  Copy, Check, X, AlertTriangle, ImageOff, MessageCircle, Repeat2, Heart,
  LayoutGrid, Search,
} from 'lucide-react';
import type { ApiResult } from '@medirus/api-client';
import { api } from '@/lib/api';
import { isAsyncAccepted, pollOperation } from '@/lib/scrape-poll';
import type { AsyncAccepted } from '@/lib/scrape-poll';

// ---------------------------------------------------------------------------
// Types matching Bluesky & Mastodon crawlers + normalizers (PostItem)
// ---------------------------------------------------------------------------

interface PlatformEnvelope<T> {
  ok: boolean;
  platform?: string;
  action?: string;
  result?: T;
  error?: string;
  code?: string;
}

export interface FediversePost {
  id?: string;
  platform: string;
  externalId?: string;
  authorId?: string;
  authorName: string;
  authorAvatar?: string | null;
  authorUrl?: string;
  postUrl?: string;
  content: string;
  mediaUrls?: string[];
  likesCount?: number;
  repostsCount?: number;
  repliesCount?: number;
  metadata?: Record<string, unknown>;
  publishedAt?: string | Date | null;
}

export interface BlueskyPageInfo {
  end_cursor?: string | null;
  has_next_page?: boolean;
}

export interface BlueskyFeedData {
  posts?: FediversePost[];
  pageInfo?: BlueskyPageInfo;
}

export interface MastodonTrendingData {
  posts?: FediversePost[];
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

type ColumnId = 'bsky-hot' | 'bsky-profile' | 'masto-trending';

const WHATS_HOT_FEED_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
const PAGE_LIMIT = 30;
const DEFAULT_PROFILE_HANDLE = 'bsky.app';

const COLUMNS: { id: ColumnId; label: string; network: 'bluesky' | 'mastodon'; paginated: boolean }[] = [
  { id: 'bsky-hot', label: 'Bluesky Hot', network: 'bluesky', paginated: true },
  { id: 'bsky-profile', label: 'Bluesky Profile', network: 'bluesky', paginated: true },
  { id: 'masto-trending', label: 'Mastodon', network: 'mastodon', paginated: false },
];

// ---------------------------------------------------------------------------
// Helpers — mirrored from app/dexscreener/page.tsx (URL-only effect + scrape())
// ---------------------------------------------------------------------------

async function scrape<T = unknown>(
  platform: 'bluesky' | 'mastodon',
  action: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ApiResult<T>> {
  const res = await api<PlatformEnvelope<T> & AsyncAccepted>(
    'POST',
    `/api/platform/${platform}/scrape`,
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

/** PostItem.publishedAt can be Date (in-process) or ISO string (JSON round-trip). */
function fmtDate(value: FediversePost['publishedAt']): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

function fmtCount(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function cleanHandle(raw: string): string {
  // Accept @handle@instance, @handle, handle, or a full bsky.app profile URL.
  let h = raw.trim();
  h = h.replace(/^https?:\/\/bsky\.app\/profile\//i, '');
  h = h.replace(/^@+/, '');
  return h;
}

/**
 * Bottom-of-column sentinel that triggers `onVisible` when scrolled into view
 * (desktop) or when the active tab shows it (mobile). Mounted only while the
 * column still has a next cursor — Bluesky only; Mastodon trending never
 * mounts it because `trending` has no pagination.
 */
function LoadMoreSentinel({
  hasCursor,
  loading,
  onVisible,
}: {
  hasCursor: boolean;
  loading: boolean;
  onVisible: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // onVisible changes identity every render (closure over columns state) —
  // keep it in a ref so the IntersectionObserver is created exactly once.
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onVisibleRef.current();
        }
      },
      { rootMargin: '160px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={sentinelRef} className="h-10 flex items-center justify-center text-xs text-slate-400">
      {loading ? 'Đang tải thêm…' : hasCursor ? 'Cuộn để tải thêm…' : ''}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface ColumnState {
  posts: FediversePost[];
  cursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const INITIAL_COLUMN: ColumnState = { posts: [], cursor: null, loading: false, loadingMore: false, error: null };

function emptyStateMessage(col: ColumnId): string {
  switch (col) {
    case 'bsky-hot': return 'What\'s Hot chưa có bài viết nào.';
    case 'bsky-profile': return 'Không tìm thấy bài viết nào cho handle này.';
    case 'masto-trending': return 'Mastodon Trending chưa có bài viết nào.';
  }
}

function FediverseDeck() {
  const [columns, setColumns] = useState<Record<ColumnId, ColumnState>>({
    'bsky-hot': INITIAL_COLUMN,
    'bsky-profile': INITIAL_COLUMN,
    'masto-trending': INITIAL_COLUMN,
  });
  const [handleInput, setHandleInput] = useState(DEFAULT_PROFILE_HANDLE);
  const [activeHandle, setActiveHandle] = useState(DEFAULT_PROFILE_HANDLE);
  const [activeColumn, setActiveColumn] = useState<ColumnId>('bsky-hot');
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);

  // Track media <img> onError fallback per (column, index)
  const [failedMedia, setFailedMedia] = useState<Record<string, boolean>>({});
  // Avatar onError fallback — per authorName key
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>({});

  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One monotonically increasing generation per column: every full reload
  // (mount, Retry, Refresh, handle submit, Refresh All) bumps it and any
  // in-flight response from an older generation is discarded — a stale
  // response must never clobber a freshly reloaded column.
  const generationRef = useRef<Record<ColumnId, number>>({
    'bsky-hot': 0,
    'bsky-profile': 0,
    'masto-trending': 0,
  });
  // In-flight guard so the infinite-scroll sentinel cannot fire a duplicate
  // load-more while one is already running (observers re-fire on layout shifts).
  const inFlightRef = useRef<Record<ColumnId, 'full' | 'more' | null>>({
    'bsky-hot': null,
    'bsky-profile': null,
    'masto-trending': null,
  });

  const setColumn = useCallback((col: ColumnId, patch: Partial<ColumnState>) => {
    setColumns((prev) => ({ ...prev, [col]: { ...prev[col], ...patch } }));
  }, []);

  const appendPosts = useCallback((col: ColumnId, posts: FediversePost[]) => {
    setColumns((prev) => ({
      ...prev,
      [col]: {
        ...prev[col],
        posts: [...prev[col].posts, ...posts],
      },
    }));
  }, []);

  // Normalizes a sync scrape outcome into {posts, cursor, error} for a column.
  const applyResult = useCallback((col: ColumnId, data: unknown): { posts: FediversePost[]; cursor: string | null } => {
    if (col === 'masto-trending') {
      // Mastodon getTrending returns a bare PostItem[] (no {posts} wrapper, no paging).
      const raw = Array.isArray(data) ? data : (data as MastodonTrendingData)?.posts;
      return { posts: Array.isArray(raw) ? raw : [], cursor: null };
    }
    const d = (data ?? {}) as BlueskyFeedData;
    return {
      posts: Array.isArray(d.posts) ? d.posts : [],
      cursor: d.pageInfo?.has_next_page && d.pageInfo.end_cursor ? d.pageInfo.end_cursor : null,
    };
  }, []);

  const loadColumn = useCallback(async (col: ColumnId, opts: { cursor?: string | null; handle?: string; signal?: AbortSignal } = {}) => {
    const isMore = Boolean(opts.cursor);
    // Load-more never overlaps itself (sentinel re-fires on layout shifts).
    // Full reloads always proceed — their generation bump makes any in-flight
    // response stale so it discards on landing instead of clobbering.
    if (isMore && inFlightRef.current[col]) return;
    inFlightRef.current[col] = isMore ? 'more' : 'full';
    const gen = isMore ? generationRef.current[col] : ++generationRef.current[col];

    setColumn(col, isMore ? { loadingMore: true } : { loading: true, error: null });
    let res: ApiResult<unknown>;
    try {
      // Bluesky/Mastodon actions are NOT sync-eligible (no syncCapableActions
      // in their descriptors) — omit `mode` so the gateway resolves to the
      // async lane; scrape() polls via statusUrl (isAsyncAccepted).
      if (col === 'bsky-hot') {
        res = await scrape<unknown>('bluesky', 'feed', {
          feedUri: WHATS_HOT_FEED_URI,
          limit: PAGE_LIMIT,
          ...(opts.cursor ? { cursor: opts.cursor } : {}),
        }, opts.signal);
      } else if (col === 'bsky-profile') {
        res = await scrape<unknown>('bluesky', 'posts', {
          handle: opts.handle ?? activeHandle,
          limit: PAGE_LIMIT,
          ...(opts.cursor ? { cursor: opts.cursor } : {}),
        }, opts.signal);
      } else {
        res = await scrape<unknown>('mastodon', 'trending', {
          limit: PAGE_LIMIT,
        }, opts.signal);
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setColumn(col, { loading: false, loadingMore: false, error: err instanceof Error ? err.message : 'Tải dữ liệu thất bại' });
      return;
    } finally {
      inFlightRef.current[col] = null;
    }

    // Stale response — a newer full reload has superseded this one.
    if (generationRef.current[col] !== gen || opts.signal?.aborted) return;

    if (res.ok) {
      const { posts, cursor } = applyResult(col, res.data);
      if (isMore) {
        appendPosts(col, posts);
        setColumn(col, { cursor, loadingMore: false });
      } else {
        setColumn(col, { posts, cursor, loading: false, error: null });
      }
    } else {
      const payload = 'error' in res ? res.error : undefined;
      const msg = payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message?: unknown }).message ?? 'Tải dữ liệu thất bại')
        : 'Tải dữ liệu thất bại';
      setColumn(col, { loading: false, loadingMore: false, error: msg });
    }
  }, [activeHandle, applyResult, appendPosts, setColumn]);

  // "Load" a column from scratch: clears state first so Retry, Refresh, and
  // handle-submit behave identically. A full reload always proceeds — its
  // generation bump discards any in-flight (load-more or older full) response
  // on landing. Returns the promise so Refresh All can await each column.
  const fetchColumn = useCallback((col: ColumnId, handleOverride?: string): Promise<void> => {
    setColumn(col, { posts: [], cursor: null, loading: true, error: null });
    return loadColumn(col, { handle: handleOverride });
  }, [loadColumn, setColumn]);

  // Initial + URL-independent mount load — depends on nothing but the mount,
  // mirroring the URL-only effect in app/dexscreener/page.tsx (refs keep the
  // latest loaders out of the deps so typing a handle never re-triggers).
  const loadColumnRef = useRef(loadColumn);
  loadColumnRef.current = loadColumn;
  useEffect(() => {
    loadColumnRef.current('bsky-hot');
    loadColumnRef.current('bsky-profile');
    loadColumnRef.current('masto-trending');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh All — strictly sequential (each column's request completes before
  // the next starts) to stay gentle on upstream rate limits.
  const refreshAll = useCallback(async () => {
    setRefreshingAll(true);
    try {
      for (const col of COLUMNS) {
        setColumn(col.id, { posts: [], cursor: null, loading: true, error: null });
        await loadColumn(col.id);
      }
    } finally {
      setRefreshingAll(false);
    }
  }, [loadColumn, setColumn]);

  // Profile stream: submit handle → reset column and load with the new handle.
  const submitHandle = useCallback(() => {
    const handle = cleanHandle(handleInput);
    if (!handle) return;
    setActiveHandle(handle);
    void fetchColumn('bsky-profile', handle);
  }, [handleInput, fetchColumn]);

  // Infinite scroll — only for paginated columns (Bluesky). Mastodon trending
  // has no cursor, so its sentinel is never rendered.
  const loadMore = useCallback((col: ColumnId) => {
    const state = columns[col];
    if (!state.cursor || state.loading || state.loadingMore || state.error) return;
    void loadColumn(col, { cursor: state.cursor });
  }, [columns, loadColumn]);

  const copyPermalink = useCallback(async (post: FediversePost) => {
    const url = post.postUrl || '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return; // clipboard unavailable (permissions/iframe) — never crash
    }
    setCopiedId(post.id ?? url);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // Đóng modal Lightbox khi nhấn phím Escape
  useEffect(() => {
    if (!lightbox) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightbox]);

  const markFailedMedia = useCallback((key: string) => {
    setFailedMedia((prev) => ({ ...prev, [key]: true }));
  }, []);
  const markFailedAvatar = useCallback((key: string) => {
    setFailedAvatars((prev) => ({ ...prev, [key]: true }));
  }, []);

  // -----------------------------------------------------------------------
  // Post card
  // -----------------------------------------------------------------------

  const renderPostCard = (col: ColumnId, post: FediversePost, index: number) => {
    // Khóa ổn định dựa trên id / externalId / postUrl thay vì thuần index mảng
    const stableId = post.id || post.externalId || post.postUrl || `${col}:${index}`;
    const mediaKey = `${col}:${stableId}`;
    const media = (post.mediaUrls ?? []).filter(Boolean);
    const avatarKey = `${col}:${post.authorName}:${post.authorAvatar ?? ''}`;
    const copyDone = copiedId !== null && copiedId === (post.id ?? post.postUrl);
    return (
      <article
        key={stableId}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
      >
        <div className="flex items-start gap-2.5">
          {post.authorAvatar && !failedAvatars[avatarKey] ? (
            <img
              src={post.authorAvatar}
              alt={post.authorName}
              referrerPolicy="no-referrer"
              onError={() => markFailedAvatar(avatarKey)}
              className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-800 shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <UserIcon className="w-4 h-4" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                {post.authorName || 'Unknown'}
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${
                  post.platform === 'mastodon'
                    ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400'
                    : 'bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400'
                }`}
              >
                {post.platform}
              </span>
            </div>
            {post.publishedAt && (
              <div className="text-[11px] text-slate-400 dark:text-slate-500">{fmtDate(post.publishedAt)}</div>
            )}
          </div>
          {post.postUrl && (
            <a
              href={post.postUrl}
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-indigo-500 shrink-0"
              aria-label="Open original post"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {post.content && (
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
            {post.content}
          </p>
        )}

        {media.length > 0 && (
          <div className={`grid gap-1.5 ${media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {media.slice(0, 4).map((src, mi) => (
              <div
                key={`${mediaKey}:${mi}`}
                className="relative rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 aspect-[4/3] group cursor-zoom-in"
                onClick={() => !failedMedia[`${mediaKey}:${mi}`] && setLightbox({ src, alt: `${post.authorName} — media ${mi + 1}` })}
              >
                {failedMedia[`${mediaKey}:${mi}`] ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-1">
                    <ImageOff className="w-5 h-5 opacity-60" />
                    <span className="text-[10px]">Ảnh không khả dụng</span>
                  </div>
                ) : (
                  <img
                    src={src}
                    alt={`${post.authorName} — media ${mi + 1}`}
                    referrerPolicy="no-referrer"
                    onError={() => markFailedMedia(`${mediaKey}:${mi}`)}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1" title="Likes">
              <Heart className="w-3.5 h-3.5" /> {fmtCount(post.likesCount)}
            </span>
            <span className="inline-flex items-center gap-1" title="Reposts">
              <Repeat2 className="w-3.5 h-3.5" /> {fmtCount(post.repostsCount)}
            </span>
            <span className="inline-flex items-center gap-1" title="Replies">
              <MessageCircle className="w-3.5 h-3.5" /> {fmtCount(post.repliesCount)}
            </span>
          </div>
          {post.postUrl && (
            <button
              type="button"
              onClick={() => void copyPermalink(post)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                copyDone
                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {copyDone ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copyDone ? 'Copied' : 'Copy link'}
            </button>
          )}
        </div>
      </article>
    );
  };

  // -----------------------------------------------------------------------
  // Column body (shared by desktop pane and mobile tab)
  // -----------------------------------------------------------------------

  const renderColumn = (col: ColumnId) => {
    const state = columns[col];
    const def = COLUMNS.find((c) => c.id === col);
    return (
      <div className="flex flex-col h-full min-h-0">
        {/* Column header */}
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {col === 'bsky-hot' && <Flame className="w-4 h-4 text-sky-500 shrink-0" />}
            {col === 'bsky-profile' && <UserIcon className="w-4 h-4 text-sky-500 shrink-0" />}
            {col === 'masto-trending' && <Globe className="w-4 h-4 text-purple-500 shrink-0" />}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{def?.label}</div>
              {col === 'bsky-profile' && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">@{activeHandle}</div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchColumn(col)}
            disabled={state.loading}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors shrink-0"
          >
            <RefreshCw className={`w-3 h-3 ${state.loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {/* Profile handle input (Bluesky Profile column only) */}
        {col === 'bsky-profile' && (
          <form
            className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0"
            onSubmit={(e) => {
              e.preventDefault();
              submitHandle();
            }}
          >
            <input
              type="text"
              value={handleInput}
              onChange={(e) => setHandleInput(e.target.value)}
              placeholder="handle (vd: bsky.app)"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={state.loading || !handleInput.trim()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium transition-colors shrink-0"
            >
              <Search className="w-3 h-3" /> Xem
            </button>
          </form>
        )}

        {/* Column body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
          {state.loading ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2 animate-pulse">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-800" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-2.5 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="h-2 w-1/4 rounded bg-slate-100 dark:bg-slate-800/60" />
                    </div>
                  </div>
                  <div className="h-2.5 w-full rounded bg-slate-100 dark:bg-slate-800/60" />
                  <div className="h-2.5 w-4/5 rounded bg-slate-100 dark:bg-slate-800/60" />
                </div>
              ))}
            </div>
          ) : state.error && state.posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-10 px-3 gap-2">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Không tải được cột này</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs break-words">{state.error}</p>
              <button
                type="button"
                onClick={() => fetchColumn(col)}
                className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          ) : state.posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-10 px-3 gap-2">
              <AlertTriangle className="w-8 h-8 text-slate-300 dark:text-slate-700" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Trống</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">{emptyStateMessage(col)}</p>
              <button
                type="button"
                onClick={() => fetchColumn(col)}
                className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          ) : (
            <>
              {state.posts.map((post, idx) => renderPostCard(col, post, idx))}
              {/* Nếu load-more gặp lỗi nhưng đã có sẵn bài viết: giữ nguyên feed,
                  chỉ hiển thị thanh báo lỗi nhỏ ở đáy cột kèm nút thử lại */}
              {state.error && (
                <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/40 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{state.error}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadMore(col)}
                    className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors"
                  >
                    Thử lại
                  </button>
                </div>
              )}
              {/* Infinite-scroll sentinel — paginated columns only (Bluesky).
                  Mastodon trending has no cursor so its column never mounts one. */}
              {def?.paginated && !state.error && (
                <LoadMoreSentinel
                  hasCursor={Boolean(state.cursor)}
                  loading={state.loadingMore}
                  onVisible={() => loadMore(col)}
                />
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Layout
  // -----------------------------------------------------------------------

  // 100vh − header (4rem) − main p-6 (3rem) − breadcrumb (~1.5rem): the deck
  // fills the visible dashboard area so columns scroll internally, not the page.
  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)] min-h-[480px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1 pt-1 pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xl leading-none">
            <LayoutGrid className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Fediverse Deck
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Bluesky + Mastodon song song — không cần đăng nhập.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={refreshingAll}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          <RefreshCcwDot className={`w-4 h-4 ${refreshingAll ? 'animate-spin' : ''}`} /> Refresh All
        </button>
      </div>

      {/* Mobile tab bar (<1024px): 3 tabs, one column at a time */}
      <div className="lg:hidden flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0" role="tablist">
        {COLUMNS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={activeColumn === c.id}
            onClick={() => setActiveColumn(c.id)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
              activeColumn === c.id
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {c.id === 'bsky-hot' && <Flame className="w-3.5 h-3.5" />}
            {c.id === 'bsky-profile' && <UserIcon className="w-3.5 h-3.5" />}
            {c.id === 'masto-trending' && <Globe className="w-3.5 h-3.5" />}
            {c.label}
          </button>
        ))}
      </div>

      {/* Desktop: 3 parallel columns (≥1024px). Mobile: single active tab column. */}
      <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)] grid-cols-1 lg:grid-cols-3 gap-3">
        {COLUMNS.map((c) => (
          <div
            key={c.id}
            className={`${activeColumn === c.id ? 'block' : 'hidden'} lg:block rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 overflow-hidden`}
          >
            {renderColumn(c.id)}
          </div>
        ))}
      </div>

      {/* Lightbox modal */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            onClick={() => setLightbox(null)}
            aria-label="Đóng lightbox"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            referrerPolicy="no-referrer"
            className="max-w-full max-h-full object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default function FediversePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Đang tải Fediverse Deck...</div>}>
      <FediverseDeck />
    </Suspense>
  );
}
