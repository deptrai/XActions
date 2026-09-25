// by nichxbt
'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Coins, Rss, Radio, UserCircle, RefreshCw, Play, Square, Copy, Check,
  ExternalLink, Download, AlertTriangle, CheckCircle2, XCircle, Search,
} from 'lucide-react';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types matching PumpFun crawler output (src/scrapers/social/pumpfun/*)
// ---------------------------------------------------------------------------

interface CoinMeta {
  mint?: string | null;
  name?: string | null;
  symbol?: string | null;
  imageUri?: string | null;
  creator?: string | null;
  marketCapUsd?: number;
  marketCapSol?: number | null;
  athMarketCap?: number | null;
  replyCount?: number;
  isCurrentlyLive?: boolean;
  socialLinks?: { twitter?: string | null; telegram?: string | null; website?: string | null };
}

interface Reply {
  authorName?: string | null;
  walletAddress?: string | null;
  text?: string;
  timestamp?: number | string | null;
}

interface FeedItem {
  mint?: string | null;
  name?: string | null;
  symbol?: string | null;
  imageUri?: string | null;
  marketCapUsd?: number;
  replyCount?: number;
  isCurrentlyLive?: boolean;
  viewers?: number;
  creator?: string | null;
}

interface ChatMessage {
  user?: string;
  username?: string;
  authorName?: string;
  text?: string;
  message?: string;
  timestamp?: number;
}

interface MintSocialResult {
  coinMeta?: CoinMeta;
  comments?: Reply[];
  replies?: Reply[];
}

interface MyProfile {
  username?: string;
  address?: string;
  walletAddress?: string;
  userId?: string;
  is_pump_user?: boolean;
  followers?: number;
  following?: number;
}

interface Clip {
  clipId?: string | null;
  title?: string;
  duration?: number;
  hlsPlaylistUrl?: string | null;
  thumbnailUrl?: string | null;
  streamerWallet?: string | null;
}

interface ResolvedUser {
  username?: string;
  walletAddress?: string | null;
  userId?: string | null;
  isPumpUser?: boolean;
  followers?: number;
  following?: number;
}

type TabId = 'mint' | 'feed' | 'live' | 'account';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'mint', label: 'Mint', icon: <Coins className="w-4 h-4" /> },
  { id: 'feed', label: 'Feed', icon: <Rss className="w-4 h-4" /> },
  { id: 'live', label: 'Live Chat', icon: <Radio className="w-4 h-4" /> },
  { id: 'account', label: 'Account', icon: <UserCircle className="w-4 h-4" /> },
];

const FEED_TYPES = [
  { id: 'currently_live', label: 'Live Now' },
  { id: 'new_creations', label: 'Latest' },
  { id: 'graduating', label: 'Graduating' },
  { id: 'koth', label: 'King of the Hill' },
  { id: 'last_trade', label: 'Last Trade' },
];

const CHAT_DURATIONS = [15, 30, 60, 120];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const trunc = (s?: string | null, head = 6, tail = 4) =>
  s && s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s || '—';

const fmtUsd = (n?: number | null) => {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};

const fmtTs = (ts?: number | string | null) => {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date(ts);
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleTimeString();
};

async function scrape<T = unknown>(action: string, args: Record<string, unknown>, signal?: AbortSignal) {
  return api<T>('POST', '/api/platform/pumpfun/scrape', { body: { action, ...args }, signal });
}

async function automate<T = unknown>(action: string, args: Record<string, unknown>) {
  return api<T>('POST', '/api/platform/pumpfun/automate', { body: { action, ...args } });
}

/** Map scrape() error payload → human banner kind + message. */
function mapError(err: unknown): { kind: 'warn' | 'error'; msg: string } {
  const e = err as { code?: string; message?: string } | undefined;
  const code = e?.code || '';
  const msg = e?.message || 'Request failed';
  if (code === 'XACT_4004') return { kind: 'warn', msg: '⚠️ Not found on pump.fun.' };
  if (code === 'XACT_4010') return { kind: 'error', msg: '🔒 Auth required or session expired — connect in Account tab.' };
  if (code === 'XACT_4291') return { kind: 'warn', msg: '⚠️ Stream/action cap reached — wait for an active stream to finish.' };
  if (code === 'XACT_4029' || code === 'XACT_429') return { kind: 'warn', msg: '⚠️ Rate limited — pump.fun allows ~40 req/min/IP. Retry shortly.' };
  return { kind: 'error', msg: `❌ ${msg}` };
}

// ---------------------------------------------------------------------------
// Small shared components
// ---------------------------------------------------------------------------

function ErrBanner({ err }: { err: { kind: 'warn' | 'error'; msg: string } | null }) {
  if (!err) return null;
  const cls = err.kind === 'warn'
    ? 'border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
    : 'border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400';
  return <div className={`px-4 py-2.5 rounded-xl border text-sm font-medium ${cls}`}>{err.msg}</div>;
}

function CopyField({ value, label }: { value?: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-400">—</span>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <button onClick={copy} title={label ? `${label}: ${value}` : value}
      className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400">
      {trunc(value)} {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function download(filename: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  // Defer revocation so browser has time to begin download reliably (F8)
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function PumpFunInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tabParam = (params.get('tab') as TabId) || 'mint';
  const [tab, setTabState] = useState<TabId>(['mint', 'feed', 'live', 'account'].includes(tabParam) ? tabParam : 'mint');

  const setTab = (t: TabId) => {
    setTabState(t);
    const q = new URLSearchParams(params.toString());
    q.set('tab', t);
    router.replace(`/pumpfun?${q.toString()}`, { scroll: false });
  };

  // Sync tab state when URL changes (browser back/forward navigation) (F1)
  useEffect(() => {
    if (tabParam && ['mint', 'feed', 'live', 'account'].includes(tabParam) && tabParam !== tab) {
      setTabState(tabParam);
    }
  }, [tabParam, tab]);

  // --- Auth session detection ---
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const checkAuth = useCallback(async () => {
    const res = await scrape<MyProfile>('fetch_my_profile', {});
    setAuthChecked(true);
    if (res.ok && res.data) setProfile(res.data);
    else setProfile(null);
  }, []);
  useEffect(() => { checkAuth(); }, [checkAuth]);

  // --- Mint tab ---
  const [mint, setMint] = useState(params.get('mint') || '');
  const [mintLoading, setMintLoading] = useState(false);
  const [mintErr, setMintErr] = useState<{ kind: 'warn' | 'error'; msg: string } | null>(null);
  const [mintData, setMintData] = useState<MintSocialResult | null>(null);

  const fetchMint = useCallback(async (m?: string) => {
    const target = (m ?? mint).trim();
    if (target.length < 32 || target.length > 44) return;
    setMintLoading(true); setMintErr(null); setMintData(null); // Clear old coin on new lookup (F6)
    const res = await scrape<MintSocialResult>('fetch_mint_social', { mintAddress: target });
    if (res.ok && res.data) setMintData(res.data);
    else setMintErr(mapError(!res.ok && 'error' in res ? res.error : undefined));
    setMintLoading(false);
  }, [mint]);

  // auto-fetch on ?mint= deep-link
  const autoFetched = useRef(false);
  useEffect(() => {
    const pm = params.get('mint');
    if (pm && pm.length >= 32 && !autoFetched.current) {
      autoFetched.current = true;
      setMint(pm);
      setTabState('mint');
      fetchMint(pm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // --- Feed tab ---
  const [feedType, setFeedType] = useState('currently_live');
  const [feedLimit, setFeedLimit] = useState(20);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedErr, setFeedErr] = useState<{ kind: 'warn' | 'error'; msg: string } | null>(null);
  const [feedOffset, setFeedOffset] = useState(0);

  const loadFeed = useCallback(async (append = false) => {
    setFeedLoading(true); setFeedErr(null);
    const offset = append ? feedOffset : 0;
    const res = await scrape<FeedItem[]>('fetch_platform_feed', { feedType, limit: feedLimit, offset });
    if (res.ok && Array.isArray(res.data)) {
      setFeedItems((prev) => (append ? [...prev, ...res.data!] : res.data!));
      setFeedOffset(offset + (res.data?.length || 0));
    } else setFeedErr(mapError(!res.ok && 'error' in res ? res.error : undefined));
    setFeedLoading(false);
  }, [feedType, feedLimit, feedOffset]);

  const goToMint = (m?: string | null) => {
    if (!m) return;
    const q = new URLSearchParams({ tab: 'mint', mint: m });
    router.push(`/pumpfun?${q.toString()}`);
    autoFetched.current = false; // allow auto-fetch of the new mint
  };

  // --- Live chat tab ---
  const [chatMint, setChatMint] = useState('');
  const [chatDur, setChatDur] = useState(30);
  const [chatRunning, setChatRunning] = useState(false);
  const [chatLeft, setChatLeft] = useState(0);
  const [chatErr, setChatErr] = useState<{ kind: 'warn' | 'error'; msg: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatAbort = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopChat = useCallback(() => {
    chatAbort.current?.abort();
    if (chatTimer.current) { clearInterval(chatTimer.current); chatTimer.current = null; }
    setChatRunning(false);
  }, []);

  const startChat = useCallback(async () => {
    const m = chatMint.trim();
    if (m.length < 32) return;
    setChatMessages([]); setChatErr(null); setChatRunning(true); setChatLeft(chatDur);
    const ac = new AbortController();
    chatAbort.current = ac;
    const started = Date.now();
    chatTimer.current = setInterval(() => {
      const left = Math.max(0, chatDur - Math.floor((Date.now() - started) / 1000));
      setChatLeft(left);
      if (left <= 0 && chatTimer.current) { clearInterval(chatTimer.current); chatTimer.current = null; }
    }, 500);
    const res = await scrape<{ messageCount?: number; messages?: ChatMessage[] }>(
      'stream_mint_chat', { mintAddress: m, durationMs: chatDur * 1000 }, ac.signal);
    if (chatTimer.current) { clearInterval(chatTimer.current); chatTimer.current = null; }
    setChatRunning(false);
    if (ac.signal.aborted) return;
    if (res.ok && res.data) setChatMessages(res.data.messages || []);
    else setChatErr(mapError(!res.ok && 'error' in res ? res.error : undefined));
  }, [chatMint, chatDur]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
  useEffect(() => () => { chatAbort.current?.abort(); if (chatTimer.current) clearInterval(chatTimer.current); }, []);

  const exportChat = (fmt: 'json' | 'csv') => {
    if (fmt === 'json') download(`pumpfun-chat-${chatMint.slice(0, 8)}.json`, JSON.stringify(chatMessages, null, 2));
    else {
      // Neutralize spreadsheet formulas: prefix cells leading with = + - @ with a single quote (F4)
      const sanitizeCell = (val: string) => {
        const cleaned = val.replace(/"/g, '""');
        return /^[=+\-@]/.test(cleaned) ? `"'${cleaned}"` : `"${cleaned}"`;
      };
      const rows = [
        ['"timestamp"', '"user"', '"text"'],
        ...chatMessages.map((m) => [
          sanitizeCell(fmtTs(m.timestamp)),
          sanitizeCell(m.user || m.username || m.authorName || ''),
          sanitizeCell(m.text || m.message || ''),
        ]),
      ];
      download(`pumpfun-chat-${chatMint.slice(0, 8)}.csv`, rows.map((r) => r.join(',')).join('\n'), 'text/csv');
    }
  };

  // --- Account tab ---
  const [followUserId, setFollowUserId] = useState('');
  const [following, setFollowing] = useState<ResolvedUser[] | null>(null);
  const [accErr, setAccErr] = useState<{ kind: 'warn' | 'error'; msg: string } | null>(null);
  const [accLoading, setAccLoading] = useState<string | null>(null);
  const [resolveQ, setResolveQ] = useState('');
  const [resolved, setResolved] = useState<ResolvedUser | null>(null);
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [clipQ, setClipQ] = useState('');
  const [replyMint, setReplyMint] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyToId, setReplyToId] = useState('');
  const [replyResult, setReplyResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const authed = !!profile;

  const fetchFollowing = async () => {
    const uid = (followUserId || profile?.userId || '').trim();
    if (!uid) return;
    setAccLoading('following'); setAccErr(null);
    const res = await scrape<ResolvedUser[]>('fetch_user_following', { userId: uid });
    if (res.ok) setFollowing(Array.isArray(res.data) ? res.data : []);
    else setAccErr(mapError(!res.ok && 'error' in res ? res.error : undefined));
    setAccLoading(null);
  };

  const resolveUser = async () => {
    const u = resolveQ.trim().replace(/^@/, '');
    if (!u) return;
    setAccLoading('resolve'); setAccErr(null); setResolved(null);
    const res = await scrape<ResolvedUser | null>('resolve_user_wallet', { username: u });
    if (res.ok) setResolved(res.data);
    else setAccErr(mapError(!res.ok && 'error' in res ? res.error : undefined));
    setAccLoading(null);
  };

  const fetchClips = async () => {
    const q = clipQ.trim();
    if (!q) return;
    setAccLoading('clips'); setAccErr(null);
    const res = await scrape<Clip[]>('fetch_livestream_clips', { mintOrWallet: q });
    if (res.ok) setClips(Array.isArray(res.data) ? res.data : []);
    else setAccErr(mapError(!res.ok && 'error' in res ? res.error : undefined));
    setAccLoading(null);
  };

  const postReply = async () => {
    setConfirming(false);
    setAccLoading('reply'); setAccErr(null); setReplyResult(null);
    const res = await automate<{ id?: string }>('post_mint_reply', {
      mintAddress: replyMint.trim(), text: replyText.trim(),
      ...(replyToId.trim() ? { replyToId: replyToId.trim() } : {}),
    });
    if (res.ok) { setReplyResult(`✅ Posted${res.data?.id ? ` · id ${res.data.id}` : ''}`); setReplyText(''); }
    else setAccErr(mapError(!res.ok && 'error' in res ? res.error : undefined));
    setAccLoading(null);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-950/60 text-green-600 text-xl leading-none">🎰</div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Pump.fun Intelligence</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Meme-coin social signals, livestreams &amp; chat monitor.
          </p>
        </div>
        <button onClick={checkAuth} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">
          <RefreshCw className="w-4 h-4" /><span>Refresh auth</span>
        </button>
      </div>

      {/* Auth banner */}
      {authChecked && (
        authed ? (
          <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/40 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Connected as {profile.username || 'unknown'} <span className="font-mono text-xs">({trunc(profile.address || profile.walletAddress)})</span>
              </p>
              <p className="text-xs text-slate-500">{profile.is_pump_user ? 'pump user' : 'standard'} · userId {trunc(profile.userId, 8, 4)}</p>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/40 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">No pump.fun session</p>
              <p className="text-xs text-slate-500">Authenticated features (profile, following, replies) need a session via Browser Bridge.</p>
            </div>
            <a href="/docs/pumpfun-auth" target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium">
              How to connect <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit max-w-full overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${tab === t.id ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ============================= MINT ============================= */}
      {tab === 'mint' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={mint} onChange={(e) => setMint(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchMint()}
              placeholder="So1111… or any pump.fun mint address"
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono" />
            <button onClick={() => fetchMint()} disabled={mint.trim().length < 32 || mint.trim().length > 44 || mintLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
              {mintLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Fetch
            </button>
          </div>
          {mint.trim().length > 0 && (mint.trim().length < 32 || mint.trim().length > 44) && (
            <p className="text-xs text-red-500">Mint must be 32–44 chars (Solana Base58 address).</p>
          )}
          <ErrBanner err={mintErr} />

          {mintLoading && (
            <div className="space-y-2">{[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}</div>
          )}

          {mintData?.coinMeta && !mintLoading && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
              <div className="flex items-start gap-3">
                {mintData.coinMeta.imageUri
                  ? <img src={mintData.coinMeta.imageUri} alt="" className="w-14 h-14 rounded-lg object-cover" />
                  : <div className="w-14 h-14 rounded-lg bg-slate-100 dark:bg-slate-800" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-900 dark:text-white">{mintData.coinMeta.name || '—'}</h3>
                    <span className="text-xs font-mono text-slate-500">${mintData.coinMeta.symbol || '?'}</span>
                    {mintData.coinMeta.isCurrentlyLive && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 font-semibold animate-pulse">🔴 LIVE</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>MCap {fmtUsd(mintData.coinMeta.marketCapUsd)}{mintData.coinMeta.marketCapSol != null ? ` · ◎${mintData.coinMeta.marketCapSol.toFixed(1)}` : ''}</span>
                    {mintData.coinMeta.athMarketCap != null && <span>ATH {fmtUsd(mintData.coinMeta.athMarketCap)}</span>}
                    <span>💬 {mintData.coinMeta.replyCount ?? 0}</span>
                    <span className="inline-flex items-center gap-1">Creator <CopyField value={mintData.coinMeta.creator} /></span>
                  </div>
                </div>
              </div>
              {mintData.coinMeta.socialLinks && (
                <div className="flex flex-wrap gap-2">
                  {mintData.coinMeta.socialLinks.twitter && <a href={mintData.coinMeta.socialLinks.twitter} target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-cyan-600">𝕏 twitter ↗</a>}
                  {mintData.coinMeta.socialLinks.telegram && <a href={mintData.coinMeta.socialLinks.telegram} target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-cyan-600">✈ telegram ↗</a>}
                  {mintData.coinMeta.socialLinks.website && <a href={mintData.coinMeta.socialLinks.website} target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-cyan-600">🌐 website ↗</a>}
                </div>
              )}
            </div>
          )}

          {(() => {
            const replies = mintData?.comments || mintData?.replies || [];
            if (!mintData || mintLoading) return null;
            return (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Replies ({replies.length})
                </div>
                {replies.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-400">No replies yet — coin may be too new.</div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
                    {replies.slice(0, 20).map((r, i) => (
                      <div key={i} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 w-24 truncate shrink-0">@{r.authorName || 'anon'}</span>
                        <span className="shrink-0"><CopyField value={r.walletAddress} /></span>
                        <span className="flex-1 text-slate-600 dark:text-slate-400 break-words min-w-0">{r.text}</span>
                        <span className="text-xs text-slate-400 shrink-0">{fmtTs(r.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ============================= FEED ============================= */}
      {tab === 'feed' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              {FEED_TYPES.map((f) => (
                <button key={f.id} onClick={() => setFeedType(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${feedType === f.id ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <input type="number" min={1} max={50} value={feedLimit} onChange={(e) => setFeedLimit(Number(e.target.value) || 20)}
              className="w-20 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm" />
            <button onClick={() => loadFeed(false)} disabled={feedLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
              {feedLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Go
            </button>
          </div>
          <ErrBanner err={feedErr} />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {feedItems.map((it, i) => (
              <div key={it.mint || i} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5">
                <div className="flex items-center gap-2.5">
                  {it.imageUri
                    ? <img src={it.imageUri} alt="" className="w-10 h-10 rounded-lg object-cover" />
                    : <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{it.name || '—'}</p>
                    <p className="text-xs font-mono text-slate-500">${it.symbol || '?'}</p>
                  </div>
                  {it.isCurrentlyLive && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 font-semibold">🔴 LIVE</span>}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{fmtUsd(it.marketCapUsd)}</span>
                  <span>💬 {it.replyCount ?? 0}</span>
                  {it.viewers != null && <span>👥 {it.viewers}</span>}
                </div>
                <button onClick={() => goToMint(it.mint)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                  View →
                </button>
              </div>
            ))}
          </div>
          {feedItems.length === 0 && !feedLoading && (
            <div className="py-12 text-center text-sm text-slate-400">Nothing here yet — pick a feed type and Go.</div>
          )}
          {feedItems.length > 0 && (
            <button onClick={() => loadFeed(true)} disabled={feedLoading}
              className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-50">
              {feedLoading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}

      {/* ============================= LIVE CHAT ============================= */}
      {tab === 'live' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input value={chatMint} onChange={(e) => setChatMint(e.target.value)} placeholder="Mint address"
              className="flex-1 min-w-[280px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono" />
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              {CHAT_DURATIONS.map((d) => (
                <button key={d} onClick={() => setChatDur(d)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${chatDur === d ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>
                  {d}s
                </button>
              ))}
            </div>
            {!chatRunning ? (
              <button onClick={startChat} disabled={chatMint.trim().length < 32}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
                <Play className="w-4 h-4" /> Start
              </button>
            ) : (
              <button onClick={stopChat}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium">
                <Square className="w-4 h-4" /> Stop
              </button>
            )}
          </div>
          <ErrBanner err={chatErr} />

          {chatRunning && (
            <div className="p-3 rounded-xl border border-green-200 dark:border-green-800/40 bg-green-50 dark:bg-green-950/40 text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Collecting messages for {chatDur}s… {chatLeft}s left
            </div>
          )}

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{chatMessages.length} messages captured</span>
              <div className="flex gap-2">
                <button onClick={() => exportChat('json')} disabled={!chatMessages.length}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 border border-slate-200 dark:border-slate-800 disabled:opacity-40">
                  <Download className="w-3.5 h-3.5" /> JSON
                </button>
                <button onClick={() => exportChat('csv')} disabled={!chatMessages.length}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 border border-slate-200 dark:border-slate-800 disabled:opacity-40">
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
              </div>
            </div>
            <div className="h-80 overflow-y-auto p-3 space-y-1 font-mono text-xs">
              {chatMessages.length === 0 && !chatRunning && (
                <p className="text-slate-400 text-center py-10 font-sans text-sm">Enter a mint, pick a duration, Start — the batch appears here after collection.</p>
              )}
              {chatMessages.slice(-200).map((m, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-400 shrink-0">{fmtTs(m.timestamp)}</span>
                  <span className="text-cyan-600 dark:text-cyan-400 font-semibold shrink-0 max-w-[140px] truncate">{m.user || m.username || m.authorName || 'anon'}:</span>
                  <span className="text-slate-700 dark:text-slate-300 break-words min-w-0">{m.text || m.message || ''}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* ============================= ACCOUNT ============================= */}
      {tab === 'account' && (
        <div className="space-y-4">
          {!authed && authChecked && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-sm text-slate-500 flex items-center gap-2">
              <XCircle className="w-4 h-4" /> Account tools are locked until a pump.fun session is connected via Browser Bridge.
            </div>
          )}
          <ErrBanner err={accErr} />

          {/* My profile */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">My Profile</h3>
            {profile ? (
              <div className="text-sm space-y-1">
                <p>username <span className="font-mono font-semibold">{profile.username || '—'}</span> {profile.is_pump_user && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-950/60 text-green-600">pump user</span>}</p>
                <p className="flex items-center gap-1">wallet <CopyField value={profile.address || profile.walletAddress} /></p>
                <p className="text-xs text-slate-500">userId <span className="font-mono">{profile.userId || '—'}</span> · followers {profile.followers ?? '—'} · following {profile.following ?? '—'}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400">{authChecked ? 'Not connected' : 'Checking…'}</p>
            )}
          </div>

          {/* Resolve username → wallet */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Username → Wallet</h3>
            <div className="flex gap-2">
              <input value={resolveQ} onChange={(e) => setResolveQ(e.target.value)} placeholder="@username"
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono" />
              <button onClick={resolveUser} disabled={!resolveQ.trim() || accLoading === 'resolve'}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium disabled:opacity-50">
                {accLoading === 'resolve' ? '…' : 'Resolve'}
              </button>
            </div>
            {resolved && (
              <div className="flex items-center gap-3 text-sm">
                <span className="font-mono">{resolved.username}</span>
                <CopyField value={resolved.walletAddress} />
                {resolved.isPumpUser && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-950/60 text-green-600">pump user</span>}
                {resolved.walletAddress == null && <span className="text-xs text-amber-500">no wallet on profile</span>}
              </div>
            )}
          </div>

          {/* Following */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Following list</h3>
            <div className="flex gap-2">
              <input value={followUserId} onChange={(e) => setFollowUserId(e.target.value)}
                placeholder={profile?.userId ? `default: ${trunc(profile.userId, 8, 4)}` : 'userId'}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono" />
              <button onClick={fetchFollowing} disabled={!authed || accLoading === 'following'}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium disabled:opacity-50">
                {accLoading === 'following' ? '…' : 'Fetch'}
              </button>
            </div>
            {following && (
              following.length === 0
                ? <p className="text-xs text-slate-400">Not following anyone.</p>
                : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
                    {following.map((u, i) => (
                      <div key={i} className="py-2 flex items-center gap-3 text-sm">
                        <span className="font-mono w-28 truncate">{u.username || '—'}</span>
                        <CopyField value={u.walletAddress} />
                      </div>
                    ))}
                  </div>
                )
            )}
          </div>

          {/* Post reply */}
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Post Reply</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600">⚠ max 5 comments/min</span>
            </div>
            <input value={replyMint} onChange={(e) => setReplyMint(e.target.value)} placeholder="mint address"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono" />
            <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="reply text" rows={2}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm" />
            <input value={replyToId} onChange={(e) => setReplyToId(e.target.value)} placeholder="replyToId (optional)"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono" />
            <button onClick={() => setConfirming(true)} disabled={!authed || replyMint.trim().length < 32 || !replyText.trim() || accLoading === 'reply'}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50">
              {accLoading === 'reply' ? 'Posting…' : 'Post'}
            </button>
            {replyResult && <p className="text-sm text-emerald-600">{replyResult} {replyMint && <a className="underline" target="_blank" rel="noreferrer" href={`https://pump.fun/coin/${replyMint}`}>view ↗</a>}</p>}
          </div>

          {/* Clips */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Livestream Clips</h3>
            <div className="flex gap-2">
              <input value={clipQ} onChange={(e) => setClipQ(e.target.value)} placeholder="mint or wallet"
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-mono" />
              <button onClick={fetchClips} disabled={!authed || !clipQ.trim() || accLoading === 'clips'}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium disabled:opacity-50">
                {accLoading === 'clips' ? '…' : 'Fetch'}
              </button>
            </div>
            {clips && (
              clips.length === 0
                ? <p className="text-xs text-slate-400">No clips found.</p>
                : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {clips.map((c, i) => (
                      <div key={c.clipId || i} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
                        <p className="text-sm font-semibold truncate">{c.title || `Clip ${i + 1}`}</p>
                        <p className="text-xs text-slate-500">duration {c.duration != null ? `${Math.round(c.duration)}s` : '—'} · <CopyField value={c.streamerWallet} /></p>
                        {c.hlsPlaylistUrl && (
                          <a href={c.hlsPlaylistUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-cyan-600 dark:text-cyan-400 hover:underline">
                            Open playlist <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )
            )}
          </div>
        </div>
      )}

      {/* Confirm post modal */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Confirm post reply</h3>
            <div className="text-sm space-y-1">
              <p className="text-slate-500">Posting as <span className="font-mono font-semibold text-slate-900 dark:text-white">{profile?.username || 'unknown'}</span> on pump.fun</p>
              <p className="font-mono text-xs text-slate-400 break-all">mint: {replyMint}</p>
              <p className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{replyText}</p>
            </div>
            <p className="text-xs text-amber-600">⚠ This writes to pump.fun under your account. Rate limit: 5 comments/min.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm">Cancel</button>
              <button onClick={postReply} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium">Post</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PumpFunPage() {
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto p-6 text-sm text-slate-400">Loading pump.fun…</div>}>
      <PumpFunInner />
    </Suspense>
  );
}
