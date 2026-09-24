// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * KOL wallet matching — two-tier cache over kolscan.io with a static seed-file
 * fallback so the crawl flow never breaks when kolscan is unreachable.
 *
 * Tier 1: Redis (`GET kolscan:wallets`, TTL 10m) when a redis client is wired.
 * Tier 2: `config/kol-wallets-seed.json` static seed.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KOLSCAN_URL = 'https://kolscan.io/coins/kolscan';
const REDIS_KEY = 'kolscan:wallets';
const REDIS_TTL_SECONDS = 600; // 10m

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SEED_PATH = path.resolve(__dirname, '../../../../config/kol-wallets-seed.json');

/**
 * Load the static KOL seed file. Returns a Map wallet → { name? }.
 * @param {string} [seedPath]
 * @returns {Promise<Map<string, { name?: string }>>}
 */
export async function loadKolSeed(seedPath = DEFAULT_SEED_PATH) {
  if (!existsSync(seedPath)) return new Map();
  try {
    const raw = await readFile(seedPath, 'utf8');
    const parsed = JSON.parse(raw);
    const map = new Map();
    const list = Array.isArray(parsed) ? parsed : parsed.wallets || [];
    for (const entry of list) {
      if (typeof entry === 'string') map.set(entry, {});
      else if (entry && typeof entry === 'object' && entry.wallet) {
        map.set(String(entry.wallet), { name: entry.name || entry.label || undefined });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Fetch the live KOL wallet set from kolscan.io.
 * @param {Object} [deps]
 * @param {Function} [deps.fetchFn] - injectable fetch for tests.
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<Map<string, { name?: string }> | null>} null on failure.
 */
export async function fetchKolscanWallets(deps = {}) {
  const fetchFn = deps.fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) return null;
  const timeoutMs = deps.timeoutMs || 10000;
  try {
    const res = await fetchFn(KOLSCAN_URL, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    const map = new Map();
    const list = Array.isArray(data) ? data : data.wallets || data.kols || [];
    for (const entry of list) {
      if (typeof entry === 'string') map.set(entry, {});
      else if (entry && typeof entry === 'object') {
        const wallet = entry.wallet || entry.walletAddress || entry.address;
        if (wallet) map.set(String(wallet), { name: entry.name || entry.label || entry.username || undefined });
      }
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

/**
 * KolscanResolver — resolves KOL wallet membership with a two-tier cache.
 */
export class KolscanResolver {
  /**
   * @param {Object} [deps]
   * @param {import('redis').RedisClientType | any} [deps.redis] - optional redis client.
   * @param {string} [deps.seedPath]
   * @param {Function} [deps.fetchFn]
   * @param {number} [deps.timeoutMs]
   */
  constructor(deps = {}) {
    this.redis = deps.redis || null;
    this.seedPath = deps.seedPath || DEFAULT_SEED_PATH;
    this.fetchFn = deps.fetchFn;
    this.timeoutMs = deps.timeoutMs;
    /** @type {Map<string, { name?: string }> | null} */
    this._memoryCache = null;
    this._memoryCacheAt = 0;
    this._memoryTtlMs = REDIS_TTL_SECONDS * 1000;
  }

  /**
   * Resolve the full KOL wallet map (wallet → { name? }). Order: in-memory →
   * Redis → kolscan.io (then writes back) → seed file.
   * @returns {Promise<Map<string, { name?: string }>>}
   */
  async resolve() {
    const now = Date.now();
    if (this._memoryCache && now - this._memoryCacheAt < this._memoryTtlMs) {
      return this._memoryCache;
    }

    // Tier 1: Redis.
    const fromRedis = await this.#fromRedis();
    if (fromRedis && fromRedis.size > 0) {
      this.#remember(fromRedis);
      return fromRedis;
    }

    // Tier 1 refresh: kolscan.io.
    const live = await fetchKolscanWallets({ fetchFn: this.fetchFn, timeoutMs: this.timeoutMs });
    if (live && live.size > 0) {
      await this.#toRedis(live);
      this.#remember(live);
      return live;
    }

    // Tier 2: static seed file.
    const seed = await loadKolSeed(this.seedPath);
    this.#remember(seed);
    return seed;
  }

  /**
   * Match a set of wallets against the KOL map.
   * @param {Iterable<string>} wallets
   * @returns {Promise<{ isKolPresent: boolean, kolCount: number, matchedKols: Array<{ name?: string, wallet: string }> }>}
   */
  async matchKols(wallets) {
    const map = await this.resolve();
    const matchedKols = [];
    for (const wallet of wallets || []) {
      if (wallet == null) continue;
      const hit = map.get(String(wallet));
      if (hit !== undefined) {
        matchedKols.push({ wallet: String(wallet), ...(hit.name ? { name: hit.name } : {}) });
      }
    }
    return {
      isKolPresent: matchedKols.length > 0,
      kolCount: matchedKols.length,
      matchedKols,
    };
  }

  #remember(map) {
    this._memoryCache = map;
    this._memoryCacheAt = Date.now();
  }

  async #fromRedis() {
    if (!this.redis || typeof this.redis.get !== 'function') return null;
    try {
      const raw = await this.redis.get(REDIS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const map = new Map();
      const list = Array.isArray(parsed) ? parsed : parsed.wallets || [];
      for (const entry of list) {
        if (typeof entry === 'string') map.set(entry, {});
        else if (entry && entry.wallet) map.set(String(entry.wallet), { name: entry.name });
      }
      return map.size > 0 ? map : null;
    } catch {
      return null;
    }
  }

  async #toRedis(map) {
    if (!this.redis || typeof this.redis.set !== 'function') return;
    try {
      const arr = [...map.entries()].map(([wallet, v]) => ({ wallet, name: v.name }));
      await this.redis.set(REDIS_KEY, JSON.stringify(arr), { EX: REDIS_TTL_SECONDS });
    } catch {
      /* cache write is best-effort */
    }
  }
}

export function createKolscanResolver(deps = {}) {
  return new KolscanResolver(deps);
}

export default KolscanResolver;
