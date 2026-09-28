// by nichxbt
'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Activity, Coins, Search, ExternalLink, Copy, Check, RefreshCw,
  AlertTriangle, ArrowUpDown, Flame, ArrowUpRight, ArrowDownRight,
  TrendingUp, Sparkles, X,
} from 'lucide-react';
import type { ApiResult } from '@xactions/api-client';
import { api } from '@/lib/api';
import { isAsyncAccepted, pollOperation } from '@/lib/scrape-poll';
import type { AsyncAccepted } from '@/lib/scrape-poll';

// ---------------------------------------------------------------------------
// Types matching Dexscreener crawler & normalizer
// ---------------------------------------------------------------------------

interface PlatformEnvelope<T> {
  ok: boolean;
  platform?: string;
  action?: string;
  result?: T;
  error?: string;
  code?: string;
}

export interface DexPair {
  dex_id: string | null;
  pair_address: string | null;
  pair_url: string | null;
  base_symbol: string | null;
  base_name: string | null;
  price_usd: number | null;
  price_native: number | null;
  liquidity_usd: number | null;
  volume_24h: number | null;
  price_change_24h: number | null;
  pair_created_at?: number | null;
}

export interface TokenLookupData {
  chain_id: string;
  token_address: string;
  pair_count: number;
  pairs: DexPair[];
}

export interface BoostedToken {
  token_address: string | null;
  chain_id: string | null;
  amount: number | null;
  total_amount: number | null;
  url: string | null;
  description: string | null;
  icon: string | null;
}

type ChainOption = 'all' | 'solana' | 'base' | 'ethereum' | 'bsc';
type SortOption = 'volume' | 'liquidity' | 'price_change';

const CHAIN_OPTIONS: { id: ChainOption; label: string }[] = [
  { id: 'all', label: 'All Chains' },
  { id: 'solana', label: 'Solana' },
  { id: 'base', label: 'Base' },
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'bsc', label: 'BSC' },
];

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'volume', label: 'Volume 24h' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'price_change', label: 'Price Change 24h' },
];

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
    '/api/platform/dexscreener/scrape',
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
    if (err.includes('404') || err.includes('Not Found')) {
      return { kind: 'warn', msg: 'Không tìm thấy token trên Dexscreener.' };
    }
    return { kind: 'error', msg: err };
  }
  const e = err as { code?: string; message?: string; error?: string } | undefined;
  const code = e?.code || '';
  const msg = e?.message || e?.error || 'Yêu cầu thất bại';
  if (code === 'XACT_4004' || msg.includes('404') || msg.includes('Not Found')) {
    return { kind: 'warn', msg: 'Không tìm thấy token trên Dexscreener.' };
  }
  if (code === 'XACT_4030' || msg.includes('403') || msg.includes('challenge')) {
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

// 'ambiguous' = địa chỉ EVM (0x…40) khi người dùng chưa chọn chain: cùng một
// contract có thể nằm trên Base, Ethereum hoặc BSC nên không được đoán bừa.
function detectChainFromAddress(addr: string): ChainOption | 'ambiguous' {
  const clean = addr.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(clean)) return 'ambiguous';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean)) return 'solana';
  return 'solana';
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  if (n === 0) return '$0.00';
  if (n < 0.000001) return `$${n.toExponential(4)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtCompactUsd(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function trunc(s?: string | null, head = 6, tail = 4): string {
  if (!s) return '—';
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function unwrapBoostedItem(item: unknown): BoostedToken {
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    const d = (obj.data && typeof obj.data === 'object' ? obj.data : obj) as Record<string, unknown>;
    return {
      token_address: typeof d.token_address === 'string' ? d.token_address : null,
      chain_id: typeof d.chain_id === 'string' ? d.chain_id : null,
      amount: typeof d.amount === 'number' ? d.amount : null,
      total_amount: typeof d.total_amount === 'number' ? d.total_amount : null,
      url: typeof d.url === 'string' ? d.url : null,
      description: typeof d.description === 'string' ? d.description : null,
      icon: typeof d.icon === 'string' ? d.icon : null,
    };
  }
  return {
    token_address: null,
    chain_id: null,
    amount: null,
    total_amount: null,
    url: null,
    description: null,
    icon: null,
  };
}

function unwrapLookupData(resData: unknown): TokenLookupData | null {
  if (!resData || typeof resData !== 'object') return null;
  const obj = resData as Record<string, unknown>;
  const d = (obj.data && typeof obj.data === 'object' ? obj.data : obj) as Record<string, unknown>;
  const rawPairs = Array.isArray(d.pairs) ? d.pairs : [];
  return {
    chain_id: String(d.chain_id || ''),
    token_address: String(d.token_address || ''),
    pair_count: typeof d.pair_count === 'number' ? d.pair_count : rawPairs.length,
    pairs: rawPairs as DexPair[],
  };
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function TokenIcon({ src, symbol }: { src?: string | null; symbol?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-200 dark:border-indigo-800/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs">
        {symbol ? symbol.slice(0, 3).toUpperCase() : <Coins className="w-5 h-5 text-slate-400" />}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={symbol || 'token icon'}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-slate-800"
    />
  );
}

function CopyPairAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Giữ nguyên trạng thái nút nếu clipboard API lỗi
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy Pair Address: ${address}`}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      <span>{copied ? 'Copied' : 'Copy Pair Address'}</span>
    </button>
  );
}

function PriceChangePill({ change }: { change: number | null | undefined }) {
  if (change == null || isNaN(change)) {
    return (
      <span className="text-xs px-2.5 py-1 rounded-full font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-500">
        0.00%
      </span>
    );
  }
  const isPositive = change >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs px-2.5 py-1 rounded-full font-mono font-semibold ${
        isPositive
          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
          : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400'
      }`}
    >
      {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {isPositive ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Component Body
// ---------------------------------------------------------------------------

function DexscreenerInner() {
  const params = useSearchParams();
  const router = useRouter();

  // Search input & selected chain
  const [addressInput, setAddressInput] = useState(
    params.get('address') || params.get('token') || params.get('mint') || ''
  );
  const [selectedChain, setSelectedChain] = useState<ChainOption>(
    (params.get('chain') as ChainOption) || 'all'
  );
  const [sortField, setSortField] = useState<SortOption>('volume');

  // Token Lookup state
  const [lookupData, setLookupData] = useState<TokenLookupData | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<{ kind: 'warn' | 'error'; msg: string } | null>(null);
  const [chainHint, setChainHint] = useState<string | null>(null);

  // Trending / Boosted state
  const [boostedTokens, setBoostedTokens] = useState<BoostedToken[]>([]);
  const [boostedLoading, setBoostedLoading] = useState(false);
  const [boostedError, setBoostedError] = useState<{ kind: 'warn' | 'error'; msg: string } | null>(null);

  // Action that triggered current error, allowing Retry button
  const [lastAction, setLastAction] = useState<'lookup' | 'boosted' | null>(null);

  // Fetch Trending Boosted Tokens
  const fetchBoosted = useCallback(async () => {
    setBoostedLoading(true);
    setBoostedError(null);
    setLastAction('boosted');
    const res = await scrape<unknown[]>('latest_boosted', { limit: 50, mode: 'sync' });
    if (res.ok && Array.isArray(res.data)) {
      setBoostedTokens(res.data.map(unwrapBoostedItem));
    } else {
      setBoostedError(mapError(!res.ok && 'error' in res ? res.error : undefined));
    }
    setBoostedLoading(false);
  }, []);

  // Fetch Token Lookup
  const executeLookup = useCallback(
    async (tokenAddr?: string, chainOverride?: ChainOption) => {
      const targetAddr = (tokenAddr ?? addressInput).trim();
      if (!targetAddr) return;

      const activeChainChoice = chainOverride ?? selectedChain;
      const detected = detectChainFromAddress(targetAddr);
      if (activeChainChoice === 'all' && detected === 'ambiguous') {
        setChainHint(
          'Địa chỉ EVM này có thể thuộc Base, Ethereum hoặc BSC. Hãy chọn chain trước khi tra cứu.'
        );
        setLookupError(null);
        setLookupData(null);
        return;
      }
      const chainToUse = activeChainChoice === 'all' ? detected : activeChainChoice;

      setChainHint(null);
      setLookupData(null);
      setLookupLoading(true);
      setLookupError(null);
      setLastAction('lookup');

      const res = await scrape<unknown>('token_lookup', {
        chainId: chainToUse,
        tokenAddress: targetAddr,
        mode: 'sync',
      });

      if (res.ok && res.data) {
        const parsed = unwrapLookupData(res.data);
        if (parsed) {
          setLookupData(parsed);
        } else {
          setLookupData({
            chain_id: chainToUse,
            token_address: targetAddr,
            pair_count: 0,
            pairs: [],
          });
        }
      } else {
        setLookupError(mapError(!res.ok && 'error' in res ? res.error : undefined));
      }
      setLookupLoading(false);
    },
    [addressInput, selectedChain]
  );

  // Chỉ chạy khi URL đổi (tải trang / deep-link), KHÔNG khi người dùng gõ —
  // executeLookup đổi danh tính theo từng ký tự nên không được nằm trong deps.
  const executeLookupRef = useRef(executeLookup);
  executeLookupRef.current = executeLookup;
  const fetchBoostedRef = useRef(fetchBoosted);
  fetchBoostedRef.current = fetchBoosted;
  useEffect(() => {
    const qAddr = params.get('address') || params.get('token') || params.get('mint');
    if (qAddr && qAddr.trim().length >= 32) {
      executeLookupRef.current(qAddr);
    } else {
      fetchBoostedRef.current();
    }
  }, [params]);

  // Client-side sorting for lookup pairs
  const sortedPairs = useMemo(() => {
    if (!lookupData?.pairs) return [];
    const list = [...lookupData.pairs];
    list.sort((a, b) => {
      if (sortField === 'volume') {
        return (b.volume_24h ?? 0) - (a.volume_24h ?? 0);
      }
      if (sortField === 'liquidity') {
        return (b.liquidity_usd ?? 0) - (a.liquidity_usd ?? 0);
      }
      if (sortField === 'price_change') {
        return (b.price_change_24h ?? 0) - (a.price_change_24h ?? 0);
      }
      return 0;
    });
    return list;
  }, [lookupData, sortField]);

  // Client-side filtering for boosted tokens by chain
  const filteredBoosted = useMemo(() => {
    if (selectedChain === 'all') return boostedTokens;
    return boostedTokens.filter(
      (item) => item.chain_id?.toLowerCase() === selectedChain.toLowerCase()
    );
  }, [boostedTokens, selectedChain]);

  // Handle retry
  const handleRetry = () => {
    if (lastAction === 'lookup') {
      executeLookup();
    } else {
      fetchBoosted();
    }
  };

  // Quick lookup from boosted token
  const handleSelectBoosted = (token: BoostedToken) => {
    if (!token.token_address) return;
    setAddressInput(token.token_address);
    const chain = (token.chain_id as ChainOption) || 'solana';
    setSelectedChain(chain);
    executeLookup(token.token_address, chain);
  };

  const handleClearLookup = () => {
    setAddressInput('');
    setLookupData(null);
    setLookupError(null);
    if (boostedTokens.length === 0) {
      fetchBoosted();
    }
    router.replace('/dexscreener', { scroll: false });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xl leading-none">
              <Activity className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Dexscreener Intelligence
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Real-time DEX liquidity, trading pairs, volume &amp; trending boosted tokens.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {lookupData && (
            <button
              type="button"
              onClick={handleClearLookup}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" /> Quay lại Trending
            </button>
          )}
          <button
            type="button"
            onClick={handleRetry}
            disabled={lookupLoading || boostedLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${lookupLoading || boostedLoading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Search Bar & Controls */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeLookup();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Nhập địa chỉ token (Solana mint, 0x EVM contract address)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={!addressInput.trim() || lookupLoading}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
          >
            {lookupLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Search</span>
          </button>
        </form>

        {/* Chain Filters & Sort Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-slate-400 mr-1">Chain:</span>
            {CHAIN_OPTIONS.map((c) => {
              const active = selectedChain === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedChain(c.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          {lookupData && (
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs text-slate-500">Sắp xếp:</span>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortOption)}
                aria-label="Sắp xếp kết quả"
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 focus:outline-none"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Cần chọn chain cho địa chỉ EVM khi đang để "All Chains" */}
      {chainHint && (
        <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/40 flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">{chainHint}</span>
        </div>
      )}

      {/* Upstream Error Banner with Retry */}
      {(lookupError || boostedError) && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            <span className="text-sm font-medium text-red-700 dark:text-red-400">
              {lookupError?.msg || boostedError?.msg}
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
      {/* LOOKUP RESULTS VIEW                                                    */}
      {/* ===================================================================== */}
      {lookupLoading && (
        <div className="space-y-4">
          <div className="h-6 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {lookupData && !lookupLoading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Cặp giao dịch ({sortedPairs.length})
              </h2>
              <span className="text-xs font-mono text-slate-500">
                Chain: {lookupData.chain_id} · {trunc(lookupData.token_address)}
              </span>
            </div>
          </div>

          {/* Empty result state */}
          {sortedPairs.length === 0 ? (
            <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-3">
              <Search className="w-8 h-8 text-slate-400 mx-auto" />
              <h3 className="font-semibold text-slate-900 dark:text-white">
                Không tìm thấy cặp giao dịch
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Không có dữ liệu thanh khoản hoặc cặp giao dịch nào được ghi nhận cho địa chỉ token này trên chain đã chọn.
              </p>
              <button
                type="button"
                onClick={handleClearLookup}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Quay lại danh sách thịnh hành
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sortedPairs.map((pair, idx) => {
                const isSolana =
                  lookupData.chain_id?.toLowerCase() === 'solana' ||
                  pair.dex_id?.toLowerCase() === 'pumpfun';
                return (
                  <div
                    key={pair.pair_address || idx}
                    className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <TokenIcon symbol={pair.base_symbol} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-slate-900 dark:text-white truncate">
                              {pair.base_name || pair.base_symbol || 'Unknown Token'}
                            </h3>
                            {pair.base_symbol && (
                              <span className="text-xs font-mono text-slate-500 font-semibold">
                                ${pair.base_symbol}
                              </span>
                            )}
                            {pair.dex_id && (
                              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {pair.dex_id}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            Pair: {trunc(pair.pair_address)}
                          </div>
                        </div>
                      </div>
                      <PriceChangePill change={pair.price_change_24h} />
                    </div>

                    {/* Price & Stats Grid */}
                    <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/60 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Giá USD</span>
                        <span className="font-bold font-mono text-slate-900 dark:text-white text-sm">
                          {fmtUsd(pair.price_usd)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Volume 24h</span>
                        <span className="font-semibold font-mono text-slate-800 dark:text-slate-200">
                          {fmtCompactUsd(pair.volume_24h)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Liquidity</span>
                        <span className="font-semibold font-mono text-slate-800 dark:text-slate-200">
                          {fmtCompactUsd(pair.liquidity_usd)}
                        </span>
                      </div>
                    </div>

                    {/* Footer Actions & Origin Badge */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2">
                        {isSolana && (
                          <a
                            href={`/pumpfun?mint=${lookupData.token_address}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                          >
                            <span>Pump.fun Origin</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {pair.pair_address && (
                          <CopyPairAddressButton address={pair.pair_address} />
                        )}
                      </div>

                      {pair.pair_url && (
                        <a
                          href={pair.pair_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium"
                        >
                          <span>View on Dexscreener</span>
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
      {/* TRENDING & BOOSTED TOKENS FEED (Initial / Unsearched State)            */}
      {/* ===================================================================== */}
      {!lookupData && !lookupError && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Trending Boosted Tokens
              </h2>
              {selectedChain !== 'all' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold uppercase">
                  {selectedChain}
                </span>
              )}
            </div>
            <span className="text-xs text-slate-400">
              {filteredBoosted.length} token đang boost
            </span>
          </div>

          {boostedLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-32 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
              ))}
            </div>
          )}

          {!boostedLoading && filteredBoosted.length === 0 && (
            <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-2">
              <Coins className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Không có token boosted nào khớp với bộ lọc chain này.
              </p>
              <button
                type="button"
                onClick={() => setSelectedChain('all')}
                className="text-xs text-indigo-600 dark:text-indigo-400 underline font-medium"
              >
                Hiển thị tất cả chain
              </button>
            </div>
          )}

          {!boostedLoading && filteredBoosted.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBoosted.map((token, i) => (
                <div
                  key={`${token.token_address}-${i}`}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start gap-3">
                      <TokenIcon src={token.icon} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                            {trunc(token.token_address)}
                          </span>
                          {token.chain_id && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 uppercase">
                              {token.chain_id}
                            </span>
                          )}
                        </div>
                        {token.amount != null && (
                          <div className="text-xs text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                            ⚡ {token.amount} boosts {token.total_amount ? `(Tổng ${token.total_amount})` : ''}
                          </div>
                        )}
                      </div>
                    </div>

                    {token.description && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                        {token.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleSelectBoosted(token)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                    >
                      <Search className="w-3 h-3" />
                      <span>Tra cứu cặp</span>
                    </button>

                    {token.url && (
                      <a
                        href={token.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      >
                        <span>Dexscreener</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DexscreenerPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Đang tải Dexscreener...</div>}>
      <DexscreenerInner />
    </Suspense>
  );
}
