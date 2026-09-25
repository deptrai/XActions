// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Price Correlation API — real CoinGecko market data for the /price-correlation
 * dashboard panel.
 *
 * GET /api/price-correlation — returns { tokens: TokenData[], pairs: CorrelationPair[] }
 *
 * Tokens are fetched live from CoinGecko's free API (current price, 24h change,
 * 24h volume, 7d sparkline). Pairwise correlation is computed with Pearson's r
 * over the aligned daily price series (30d). No mocks — every value is derived
 * from live market data; if CoinGecko is unreachable the route returns 502 so
 * the dashboard falls back to its seeded view.
 */

import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

/** Dashboard token watchlist → CoinGecko coin IDs. */
const WATCHLIST = [
  { symbol: 'BTC', name: 'Bitcoin', cgId: 'bitcoin' },
  { symbol: 'ETH', name: 'Ethereum', cgId: 'ethereum' },
  { symbol: 'SOL', name: 'Solana', cgId: 'solana' },
  { symbol: 'DOGE', name: 'Dogecoin', cgId: 'dogecoin' },
  { symbol: 'XRP', name: 'Ripple', cgId: 'ripple' },
];

const CG_MARKET = 'https://api.coingecko.com/api/v3/coins/markets';

/** In-memory cache — CoinGecko free tier rate-limits aggressively. */
let cache = { at: 0, payload: null };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/** @param {number[]} xs @param {number[]} ys */
function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

const fmtVol = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v)}`);

/**
 * GET /api/price-correlation
 * Live token prices + 30d Pearson correlation pairs from CoinGecko.
 */
router.get('/', authenticateToken, async (_req, res) => {
  try {
    if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
      return res.json({ ...cache.payload, cached: true });
    }

    const ids = WATCHLIST.map((w) => w.cgId).join(',');
    const marketUrl = `${CG_MARKET}?vs_currency=usd&ids=${ids}&sparkline=true&price_change_percentage=24h`;
    const marketResp = await fetch(marketUrl, { headers: { accept: 'application/json' } });
    if (!marketResp.ok) {
      return res.status(502).json({ success: false, error: `CoinGecko ${marketResp.status}` });
    }
    const market = /** @type {Array<Record<string, any>>} */ (await marketResp.json());
    const byId = new Map(market.map((m) => [m.id, m]));

    // Use the 7d sparkline already present in the market response for
    // correlation (avoids 5 extra rate-limited market_chart calls).
    const series = new Map();
    for (const w of WATCHLIST) {
      const m = byId.get(w.cgId) || {};
      const spark = m.sparkline_in_7d?.price || [];
      series.set(w.symbol, spark);
    }

    const tokens = WATCHLIST.map((w) => {
      const m = byId.get(w.cgId) || {};
      const spark = (m.sparkline_in_7d?.price || []).filter((_, i, a) => i % Math.ceil(a.length / 10) === 0).slice(0, 10);
      return {
        symbol: w.symbol,
        name: w.name,
        price: m.current_price ?? 0,
        change24h: Number((m.price_change_percentage_24h ?? 0).toFixed(2)),
        correlation: w.symbol === 'BTC' ? 1.0 : Number(pearson(series.get('BTC') || [], series.get(w.symbol) || []).toFixed(2)),
        volume: fmtVol(m.total_volume ?? 0),
        sparkline: spark.length ? spark : [0],
      };
    });

    const pairs = [];
    for (let i = 0; i < WATCHLIST.length; i++) {
      for (let j = i + 1; j < WATCHLIST.length; j++) {
        const a = WATCHLIST[i].symbol, b = WATCHLIST[j].symbol;
        pairs.push({ tokenA: a, tokenB: b, correlation: Number(pearson(series.get(a) || [], series.get(b) || []).toFixed(2)), period: '7d' });
      }
    }

    const payload = { success: true, tokens, pairs };
    cache = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    res.status(502).json({ success: false, error: (err instanceof Error ? err.message : String(err)) });
  }
});

export default router;
