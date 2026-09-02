// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ProxyIpPool — centralized proxy management with quarantine, validation,
 * two allocation strategies: sticky (per-account) and round-robin (no-auth),
 * and AD-20 dual-pool partitioning (Realtime 30% / Bulk 70%) with dynamic
 * realtime-to-bulk yielding and multi-pool observability stats.
 * @author nich (@nichxbt)
 * @license MIT
 */

import 'dotenv/config';
import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import { formatProxyUrl, getProxyAgent, normalizeProxy } from './providers.js';

const DEFAULT_QUARANTINE_MS = 5 * 60 * 1000;

export class ProxyIpPool {
  /** @type {any[]} */
  #proxies = [];

  /** @type {Map<string, number>} */
  #quarantined = new Map();

  /** @type {Map<string, string>} */
  #stickyMap = new Map();

  /** @type {number} */
  #roundRobinIndex = 0;

  /**
   * Dual-Pool partition (AD-20): realtime capacity ratio. Bulk ratio is the complement.
   * @type {number}
   */
  realtimeRatio = 0.30;

  /**
   * Dual-Pool partition (AD-20): bulk capacity ratio (= 1 - realtimeRatio).
   * @type {number}
   */
  bulkRatio = 0.70;

  /** Cumulative count of proxies borrowed from Bulk to serve Realtime requests. */
  #yieldedCount = 0;

  /** @type {number} */
  #realtimeOffset = 0;

  /** @type {number} */
  #bulkOffset = 0;

  /**
   * @param {Object} [options]
   * @param {any[]} [options.proxies]
   * @param {boolean} [options.validateOnAdd]
   * @param {number} [options.realtimeRatio] - Realtime pool capacity share (default 0.30, AD-20).
   * @param {number} [options.bulkRatio] - Optional explicit bulk share; must equal 1 - realtimeRatio.
   */
  constructor(options = {}) {
    this.validateOnAdd = options.validateOnAdd !== false;

    if (options.realtimeRatio !== undefined) {
      const ratio = Number(options.realtimeRatio);
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: 'realtimeRatio must be a number between 0 and 1',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
      this.realtimeRatio = ratio;
      this.bulkRatio = 1 - ratio;
    }

    if (options.bulkRatio !== undefined) {
      const bulk = Number(options.bulkRatio);
      if (!Number.isFinite(bulk) || bulk < 0 || bulk > 1 || Math.abs(bulk + this.realtimeRatio - 1) > 1e-9) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: 'bulkRatio must satisfy realtimeRatio + bulkRatio === 1',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
      this.bulkRatio = bulk;
    }

    this.#proxies = (options.proxies || []).map((p) => this.validateOnAdd ? this.#normalize(p) : p);
  }

  /**
   * @param {any} proxy
   * @returns {import('./providers.js').NormalizedProxy}
   */
  #normalize(proxy) {
    return normalizeProxy(proxy);
  }

  /** @returns {any[]} */
  get healthyProxies() {
    const now = Date.now();
    return this.#proxies
      .map((p) => this.#normalize(p))
      .filter((p) => !this.#isQuarantined(p, now));
  }

  /** @returns {number} */
  get healthyCount() {
    const now = Date.now();
    return this.#proxies.reduce((count, p) => {
      const normalized = this.#normalize(p);
      return this.#isQuarantined(normalized, now) ? count : count + 1;
    }, 0);
  }

  /** @returns {number} */
  get totalCount() {
    return this.#proxies.length;
  }

  /** @returns {string[]} */
  get antiLeakFlags() {
    return ['remote-dns', 'disable-non-proxied-udp'];
  }

  /**
   * @param {any} proxy
   * @param {number} [now]
   * @returns {boolean}
   */
  #isQuarantined(proxy, now = Date.now()) {
    const key = this.#key(proxy);
    const until = this.#quarantined.get(key);
    if (!until) return false;
    if (now >= until) {
      this.#quarantined.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Build a canonical key for a proxy using URL-encoded credentials and bracketed IPv6.
   * @param {any} proxy
   * @returns {string}
   */
  #key(proxy) {
    if (proxy == null) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is required for key operation',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    const normalized = this.#normalize(proxy);
    return formatProxyUrl(normalized);
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  #hasKey(key) {
    return this.#proxies.some((p) => this.#key(p) === key);
  }

  /**
   * Find the canonical pool key for a proxy by matching either the full
   * credentialed URL or the server-only URI. This lets dashboard callers
   * quarantine/release using the redacted `server` value returned by listAll().
   * @param {any} proxy
   * @returns {string | null}
   */
  #resolveKey(proxy) {
    if (proxy == null) return null;

    const normalized = this.#normalize(proxy);
    const inputKey = formatProxyUrl(normalized);

    if (this.#hasKey(inputKey)) {
      return inputKey;
    }

    // Fall back to matching by scheme://host:port (no credentials).
    const serverOnlyKey = this.#proxies
      .map((p) => this.#normalize(p))
      .find((p) => p.server === normalized.server);

    if (serverOnlyKey) {
      return formatProxyUrl(serverOnlyKey);
    }

    return null;
  }

  /**
   * @param {string} key
   * @param {number} [now]
   * @returns {any | null}
   */
  #findHealthyByKey(key, now = Date.now()) {
    for (const p of this.#proxies) {
      const normalized = this.#normalize(p);
      if (this.#key(normalized) === key && !this.#isQuarantined(normalized, now)) {
        return normalized;
      }
    }
    return null;
  }

  /**
   * @param {any} proxy
   */
  add(proxy) {
    this.#proxies.push(this.validateOnAdd ? this.#normalize(proxy) : proxy);
  }

  /**
   * Get the next healthy proxy using round-robin rotation against the total pool.
   * @param {boolean} [requiresResidential=false]
   * @returns {any | null}
   */
  getNext(requiresResidential = false) {
    const total = this.#proxies.length;
    if (total === 0) return null;

    const now = Date.now();
    for (let i = 0; i < total; i++) {
      const idx = (this.#roundRobinIndex + i) % total;
      const p = this.#proxies[idx];
      const normalized = this.#normalize(p);
      if (this.#isQuarantined(normalized, now)) continue;
      if (requiresResidential && !normalized.residential) continue;

      this.#roundRobinIndex = (idx + 1) % total;
      return { ...normalized };
    }
    return null;
  }

  /**
   * Alias for getNext() to satisfy round-robin proxy contract.
   * @param {boolean} [requiresResidential=false]
   * @returns {any | null}
   */
  getRoundRobinProxy(requiresResidential = false) {
    return this.getNext(requiresResidential);
  }

  /**
   * Alias for getNext() to satisfy rotating proxy contract.
   * @param {boolean} [requiresResidential=false]
   * @returns {any | null}
   */
  getRotatingProxy(requiresResidential = false) {
    return this.getNext(requiresResidential);
  }

  /**
   * Number of proxies reserved for the Realtime partition (AD-20).
   * Edge cases: total === 0 → 0; total === 1 → 1 (the lone proxy stays realtime
   * so on-demand requests never die); otherwise at least 1.
   * @returns {number}
   */
  #realtimeCount() {
    const total = this.#proxies.length;
    if (total === 0) return 0;
    if (total === 1) return 1;
    return Math.max(1, Math.floor(total * this.realtimeRatio));
  }

  /**
   * Find a healthy, non-quarantined proxy inside the index range [start, end)
   * using a rotating (round-robin) scan per pool partition.
   * @param {number} start
   * @param {number} end
   * @param {boolean} requiresResidential
   * @param {'realtime' | 'bulk'} pool
   * @returns {any | null}
   */
  #findHealthyInRange(start, end, requiresResidential, pool) {
    const span = end - start;
    if (span <= 0) return null;

    const rawOffset = pool === 'realtime' ? this.#realtimeOffset : this.#bulkOffset;
    // Guard against stale offsets after `add()` or ratio changes grow/shrink span.
    const offset = Number.isFinite(rawOffset) ? ((rawOffset % span) + span) % span : 0;
    const now = Date.now();
    for (let i = 0; i < span; i++) {
      const idx = start + ((offset + i) % span);
      const normalized = this.#normalize(this.#proxies[idx]);
      if (this.#isQuarantined(normalized, now)) continue;
      if (requiresResidential && !normalized.residential) continue;

      if (pool === 'realtime') {
        this.#realtimeOffset = (offset + i + 1) % span;
      } else {
        this.#bulkOffset = (offset + i + 1) % span;
      }
      return normalized;
    }
    return null;
  }

  /**
   * Primary dual-pool selector (AD-20).
   *
   * - pool 'realtime': search the realtime partition first; when exhausted and
   *   `yieldFromBulk` is not false, borrow a healthy proxy from the bulk
   *   partition (dynamic yield). Bulk never borrows from realtime.
   * - pool 'bulk': search only the bulk partition.
   *
   * When `accountId` is provided the sticky binding is honored first (even
   * across partitions — a sticky bulk binding may be yielded to realtime and
   * is never cleared by yielding). Returns null when no healthy proxy is
   * available; callers translate that into ProxyDeadError (XACT_5030).
   *
   * @param {Object} [options]
   * @param {'realtime' | 'bulk'} [options.pool='bulk']
   * @param {string} [options.accountId]
   * @param {boolean} [options.requiresResidential]
   * @param {boolean} [options.yieldFromBulk=true]
   * @returns {any | null}
   */
  getProxy(options = {}) {
    const total = this.#proxies.length;
    if (total === 0) return null;

    const safeOptions = options || {};
    const pool = safeOptions.pool === 'realtime' ? 'realtime' : 'bulk';
    const requiresResidential = options.requiresResidential === true;
    const accountKey = safeOptions.accountId ? String(safeOptions.accountId) : null;

    if (accountKey) {
      const boundKey = this.#stickyMap.get(accountKey);
      if (boundKey) {
        const existing = this.#findHealthyByKey(boundKey);
        if (existing && (!requiresResidential || existing.residential)) return { ...existing };
        if (existing && requiresResidential && !existing.residential) this.#stickyMap.delete(accountKey);
      }
    }

    const realtimeCount = this.#realtimeCount();
    const [start, end] = pool === 'realtime' ? [0, realtimeCount] : [realtimeCount, total];

    const found = this.#findHealthyInRange(start, end, requiresResidential, pool);
    if (found) {
      if (accountKey) this.#stickyMap.set(accountKey, this.#key(found));
      return { ...found };
    }

    // Dynamic yield: realtime may borrow from bulk when its partition is dry.
    if (pool === 'realtime' && safeOptions.yieldFromBulk !== false && realtimeCount < total) {
      const yielded = this.#findHealthyInRange(realtimeCount, total, requiresResidential, 'bulk');
      if (yielded) {
        this.#yieldedCount += 1;
        // The proxy stays in the bulk partition; the sticky binding (if any)
        // is preserved so it is restored to bulk semantics on completion.
        if (accountKey) this.#stickyMap.set(accountKey, this.#key(yielded));
        return { ...yielded };
      }
    }

    return null;
  }

  /**
   * Realtime-partition selector (AD-20) with dynamic yield from bulk enabled.
   * @param {Object} [options]
   * @param {string} [options.accountId]
   * @param {boolean} [options.requiresResidential]
   * @param {boolean} [options.yieldFromBulk=true]
   * @returns {any | null}
   */
  getRealtimeProxy(options = {}) {
    return this.getProxy({ ...options, pool: 'realtime' });
  }

  /**
   * Bulk-partition selector (AD-20). Never borrows from the realtime
   * partition so on-demand AI agent capacity is preserved.
   * @param {Object} [options]
   * @param {string} [options.accountId]
   * @param {boolean} [options.requiresResidential]
   * @returns {any | null}
   */
  getBulkProxy(options = {}) {
    return this.getProxy({ ...options, pool: 'bulk', yieldFromBulk: false });
  }

  /**
   * Dual-pool observability stats (AD-20): per-partition totals plus the
   * cumulative yield counter.
   * @returns {{ realtime: { total: number, healthy: number, quarantined: number }, bulk: { total: number, healthy: number, quarantined: number }, yieldedCount: number }}
   */
  getPoolStats() {
    const total = this.#proxies.length;
    const realtimeCount = this.#realtimeCount();
    const now = Date.now();
    /** @type {{ realtime: { total: number, healthy: number, quarantined: number }, bulk: { total: number, healthy: number, quarantined: number }, yieldedCount: number }} */
    const stats = {
      realtime: { total: realtimeCount, healthy: 0, quarantined: 0 },
      bulk: { total: total - realtimeCount, healthy: 0, quarantined: 0 },
      yieldedCount: this.#yieldedCount,
    };

    for (let i = 0; i < total; i++) {
      const bucket = i < realtimeCount ? stats.realtime : stats.bulk;
      if (this.#isQuarantined(this.#normalize(this.#proxies[i]), now)) {
        bucket.quarantined += 1;
      } else {
        bucket.healthy += 1;
      }
    }
    return stats;
  }

  /**
   * Get a deterministic sticky proxy for an account ID.
   * When `options.pool` is provided, new bindings are only created inside that
   * partition; an existing healthy binding is always honored first (even when
   * it lives in the other partition — AD-2 sticky affinity is never broken).
   * @param {string} accountId
   * @param {boolean} [requiresResidential=false]
   * @param {{ pool?: 'realtime' | 'bulk' }} [options]
   * @returns {any | null}
   */
  getStickyProxy(accountId, requiresResidential = false, options = {}) {
    const total = this.#proxies.length;
    if (total === 0) return null;

    const safeOptions = options || {};

    const accountKey = String(accountId || '');
    const boundKey = this.#stickyMap.get(accountKey);
    if (boundKey) {
      const existing = this.#findHealthyByKey(boundKey);
      if (existing && (!requiresResidential || existing.residential)) return { ...existing };
      if (existing && requiresResidential && !existing.residential) this.#stickyMap.delete(accountKey);
    }

    const pool = safeOptions?.pool === 'realtime' || safeOptions?.pool === 'bulk' ? safeOptions.pool : null;
    const realtimeCount = this.#realtimeCount();
    const start = pool === 'realtime' ? 0 : pool === 'bulk' ? realtimeCount : 0;
    const end = pool === 'realtime' ? realtimeCount : total;

    const now = Date.now();
    const span = end - start;
    const startIndex = start + (this.#hashAccount(accountKey) % Math.max(1, span));
    for (let i = 0; i < span; i++) {
      const idx = start + ((startIndex - start + i) % span);
      const p = this.#proxies[idx];
      const normalized = this.#normalize(p);
      if (this.#isQuarantined(normalized, now)) continue;
      if (requiresResidential && !normalized.residential) continue;

      this.#stickyMap.set(accountKey, this.#key(normalized));
      return { ...normalized };
    }
    return null;
  }

  /**
   * @param {string} accountId
   * @returns {number}
   */
  #hashAccount(accountId) {
    const str = String(accountId || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
  }

  /**
   * Mark a proxy as unavailable for a duration and break any sticky bindings.
   * @param {any} proxy
   * @param {number} [durationMs]
   */
  quarantine(proxy, durationMs = DEFAULT_QUARANTINE_MS) {
    if (proxy == null) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is required to quarantine',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    if (durationMs <= 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Quarantine duration must be positive',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const key = this.#resolveKey(proxy);
    if (!key) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is not a member of the pool',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    this.#quarantined.set(key, Date.now() + durationMs);

    // Remove any sticky bindings using this proxy.
    for (const [accountId, assigned] of this.#stickyMap) {
      if (assigned === key) {
        this.#stickyMap.delete(accountId);
      }
    }
  }

  /**
   * Release a proxy from quarantine immediately.
   * @param {any} proxy
   * @returns {boolean} True if the proxy was quarantined and is now released.
   */
  release(proxy) {
    if (proxy == null) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is required to release',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const key = this.#resolveKey(proxy);
    if (!key) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is not a member of the pool',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    return this.#quarantined.delete(key);
  }

  /**
   * Alias for release(proxy) to satisfy unquarantine naming conventions.
   * @param {any} proxy
   * @returns {boolean}
   */
  unquarantine(proxy) {
    return this.release(proxy);
  }

  /**
   * List all registered proxies with their current status and metadata.
   * Passwords and sensitive credentials are never exposed in key or metadata.
   * Each entry carries its dual-pool partition (AD-20): 'realtime' | 'bulk'.
   * @returns {Array<{ key: string, server: string, protocol: string, host: string, port: number, residential: boolean, status: 'healthy' | 'quarantined', quarantinedUntil: number | null, expiresAt: number | null, pool: 'realtime' | 'bulk' }>}
   */
  listProxies() {
    const now = Date.now();
    const realtimeCount = this.#realtimeCount();
    return this.#proxies.map((p, index) => {
      const normalized = this.#normalize(p);
      const internalKey = this.#key(normalized);
      const quarantinedUntil = this.#quarantined.get(internalKey) || null;
      const isQuarantined = quarantinedUntil !== null && quarantinedUntil > now;
      const safeServer = `${normalized.scheme}://${normalized.host}:${normalized.port}`;

      return {
        key: safeServer,
        server: safeServer,
        protocol: normalized.protocol,
        host: normalized.host,
        port: normalized.port,
        residential: Boolean(normalized.residential),
        status: isQuarantined ? 'quarantined' : 'healthy',
        quarantinedUntil: isQuarantined ? quarantinedUntil : null,
        expiresAt: normalized.expiresAt ?? null,
        pool: index < realtimeCount ? 'realtime' : 'bulk',
      };
    });
  }

  /**
   * List all registered proxies with their health and quarantine status.
   * @returns {Array<{ server: string, protocol: string, isQuarantined: boolean, quarantinedUntil: number | null, healthy: boolean, failCount: number }>}
   */
  listAll() {
    const now = Date.now();
    return this.#proxies.map((p) => {
      const normalized = this.#normalize(p);
      const isQuarantined = this.#isQuarantined(normalized, now);
      const key = this.#key(normalized);
      const until = isQuarantined ? (this.#quarantined.get(key) || null) : null;
      return {
        server: normalized.server,
        protocol: normalized.scheme || 'http',
        isQuarantined,
        quarantinedUntil: until,
        healthy: !isQuarantined,
        failCount: 0,
      };
    });
  }

  /**
   * @returns {boolean}
   */
  isAllQuarantined() {
    const now = Date.now();
    if (this.#proxies.length === 0) return true;
    return this.#proxies.every((p) => this.#isQuarantined(p, now));
  }

  /**
   * @returns {void}
   */
  pruneExpiredQuarantines() {
    const now = Date.now();
    for (const [key, until] of this.#quarantined) {
      if (now >= until) this.#quarantined.delete(key);
    }
  }

  /**
   * Convert normalized proxy to Playwright proxy configuration object.
   * @param {any} proxy
   * @returns {{ server: string, username?: string, password?: string } | null}
   */
  static toPlaywrightProxy(proxy) {
    if (!proxy) return null;
    const normalized = typeof proxy === 'string' ? normalizeProxy(proxy) : normalizeProxy(proxy);
    const result = /** @type {{ server: string, username?: string, password?: string }} */ ({ server: normalized.server });
    if (normalized.username !== undefined) result.username = normalized.username;
    if (normalized.password !== undefined) result.password = normalized.password;
    return result;
  }

  /**
   * @param {any} proxy
   * @returns {{ server: string, username?: string, password?: string } | null}
   */
  toPlaywrightProxy(proxy) {
    return ProxyIpPool.toPlaywrightProxy(proxy);
  }

  /**
   * Return Chromium launch flags for the proxy, including anti-leak settings.
   *
   * Throws on invalid proxy input and never falls back to a raw, unvalidated string.
   *
   * @param {any} proxy
   * @returns {string[]}
   */
  getBrowserArgs(proxy) {
    const flags = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
    if (!proxy) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Proxy is required to build browser args',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const normalized = this.#normalize(proxy);
    flags.push(`--proxy-server=${normalized.server}`);

    const proxyHost = normalized.host.includes(':') && !normalized.host.startsWith('[')
      ? `[${normalized.host}]`
      : normalized.host;
    flags.push(`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${proxyHost}`);

    // Prevent WebRTC from leaking the real local IP when a proxy is used.
    flags.push('--disable-features=WebRtcHideLocalIpsWithMdns');

    return flags;
  }

  /**
   * Factory for creating client-specific proxy agent without direct connection fallback.
   * @param {any} proxy
   * @param {Object} [options]
   * @param {'undici' | 'got'} [options.client='undici']
   * @returns {any}
   */
  getProxyAgent(proxy, options = {}) {
    return getProxyAgent(proxy, options);
  }

  /**
   * @param {any} proxy
   * @param {Object} [options]
   * @param {'undici' | 'got'} [options.client='undici']
   * @returns {any}
   */
  static getProxyAgent(proxy, options = {}) {
    return getProxyAgent(proxy, options);
  }
}

export const globalProxyPool = new ProxyIpPool();

// Auto-seed globalProxyPool from environment variables if present
(function seedFromEnv() {
  const envUrls = [
    process.env.PROXY_URL,
    process.env.PROXY_URLS,
    process.env.XEEPY_PROXY_URL,
    process.env.FACEBOOK_PROXY && process.env.FACEBOOK_PROXY_AUTH_USERNAME && process.env.FACEBOOK_PROXY_AUTH_PASSWORD
      ? `${process.env.FACEBOOK_PROXY.replace(/^https?:\/\//, `http://${encodeURIComponent(process.env.FACEBOOK_PROXY_AUTH_USERNAME)}:${encodeURIComponent(process.env.FACEBOOK_PROXY_AUTH_PASSWORD)}@`)}`
      : null
  ].filter(Boolean);

  const seen = new Set();
  for (const raw of envUrls) {
    const list = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    for (const url of list) {
      if (!seen.has(url)) {
        seen.add(url);
        try {
          globalProxyPool.add(url);
        } catch {}
      }
    }
  }
})();

