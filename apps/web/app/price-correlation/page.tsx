// by nichxbt
'use client';

import React, { useState, useEffect } from 'react';
import { TrendingUp, RefreshCw, DollarSign, BarChart2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface TokenData {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  correlation: number;
  volume: string;
  sparkline: number[];
}

interface CorrelationPair {
  tokenA: string;
  tokenB: string;
  correlation: number;
  period: string;
}

const SEEDED_TOKENS: TokenData[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: 67234.12, change24h: 2.4, correlation: 1.0, volume: '$28.4B', sparkline: [65, 67, 66, 68, 70, 69, 72, 71, 73, 75] },
  { symbol: 'ETH', name: 'Ethereum', price: 3241.87, change24h: 1.8, correlation: 0.94, volume: '$14.2B', sparkline: [30, 32, 31, 33, 35, 34, 36, 35, 37, 38] },
  { symbol: 'SOL', name: 'Solana', price: 178.43, change24h: -1.2, correlation: 0.87, volume: '$3.8B', sparkline: [18, 19, 17, 18, 20, 19, 21, 20, 19, 18] },
  { symbol: 'DOGE', name: 'Dogecoin', price: 0.1423, change24h: 4.7, correlation: 0.72, volume: '$1.9B', sparkline: [12, 13, 12, 14, 13, 15, 14, 16, 15, 17] },
  { symbol: 'XRP', name: 'Ripple', price: 0.5892, change24h: -0.8, correlation: 0.68, volume: '$2.1B', sparkline: [8, 9, 8, 9, 10, 9, 10, 9, 8, 9] },
];

const SEEDED_PAIRS: CorrelationPair[] = [
  { tokenA: 'BTC', tokenB: 'ETH', correlation: 0.94, period: '30d' },
  { tokenA: 'BTC', tokenB: 'SOL', correlation: 0.87, period: '30d' },
  { tokenA: 'ETH', tokenB: 'SOL', correlation: 0.91, period: '30d' },
  { tokenA: 'BTC', tokenB: 'DOGE', correlation: 0.72, period: '30d' },
  { tokenA: 'ETH', tokenB: 'XRP', correlation: 0.78, period: '30d' },
  { tokenA: 'SOL', tokenB: 'DOGE', correlation: 0.65, period: '30d' },
];

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const W = 80;
  const H = 32;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 4) - 2}`).join(' ');
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={positive ? '#10b981' : '#ef4444'}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CorrelationBadge({ value }: { value: number }) {
  const pct = Math.abs(value * 100).toFixed(0);
  const color = value >= 0.8 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
    : value >= 0.6 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
    : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400';
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>
      {value.toFixed(2)}
    </span>
  );
}

export default function PriceCorrelationPage() {
  const [tokens, setTokens] = useState<TokenData[]>(SEEDED_TOKENS);
  const [pairs, setPairs] = useState<CorrelationPair[]>(SEEDED_PAIRS);
  const [isLoading, setIsLoading] = useState(false);
  const [baseToken, setBaseToken] = useState('BTC');

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const res = await api<{ tokens?: TokenData[]; pairs?: CorrelationPair[] }>(
        'GET', '/api/price-correlation'
      );
      if (res.ok && res.data?.tokens) {
        setTokens(res.data.tokens);
        if (res.data.pairs) setPairs(res.data.pairs);
      }
    } catch {
      // keep seeded
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-600">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Price Correlation
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Token price movements and social sentiment correlation analysis.
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Token Prices Table */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-amber-500" />
          <span>Token Prices & Correlation vs {baseToken}</span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                {['Token', 'Price', '24h Change', 'Correlation', 'Volume', 'Trend'].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 pb-3 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.symbol} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 pr-4">
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white">{t.symbol}</span>
                      <span className="text-xs text-slate-500 ml-2">{t.name}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono font-medium text-slate-900 dark:text-white">
                    ${t.price < 1 ? t.price.toFixed(4) : t.price.toLocaleString()}
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`text-xs font-semibold ${t.change24h >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                      {t.change24h >= 0 ? '+' : ''}{t.change24h}%
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <CorrelationBadge value={t.correlation} />
                  </td>
                  <td className="py-3 pr-4 text-xs text-slate-500">{t.volume}</td>
                  <td className="py-3">
                    <Sparkline data={t.sparkline} positive={t.change24h >= 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Correlation Matrix */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-blue-500" />
          <span>Pair Correlation Matrix</span>
        </h2>
        <div className="space-y-2">
          {pairs.map((p) => (
            <div key={`${p.tokenA}-${p.tokenB}`} className="flex items-center gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 w-28">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{p.tokenA}</span>
                <span className="text-slate-400">↔</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{p.tokenB}</span>
              </div>
              <div className="flex-1">
                <div className="h-2 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                    style={{ width: `${Math.abs(p.correlation) * 100}%` }}
                  />
                </div>
              </div>
              <CorrelationBadge value={p.correlation} />
              <span className="text-xs text-slate-400 w-8">{p.period}</span>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/40">
          <AlertCircle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-400">
            Correlation values range from -1 (perfect inverse) to +1 (perfect positive). Values above 0.8 indicate strong co-movement — useful for portfolio diversification decisions.
          </p>
        </div>
      </div>
    </div>
  );
}
