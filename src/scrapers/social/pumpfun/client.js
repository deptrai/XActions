// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFunClient — unauthenticated HTTP/2 REST client for pump.fun social data.
 * Extends AbstractApiClient. Hits `frontend-api-v3.pump.fun` for mint-positions
 * (theses + top holders via embedded callout), replies (comment velocity), and
 * currently-live coins (livestream status). Falls back to a curl transport when
 * the default HTTP/2 client is fingerprinted by Cloudflare (HTTP 403).
 *
 * Live-probe notes (2026-09-25):
 * - `/mint-positions/{mint}?sortBy=TOP&withThesis=true` → 200 `{positions[],totalCount,hasMore}`.
 * - `/replies/{mint}` → 404 on v3 — treated as "no replies" (graceful-empty), not a hard error.
 * - `/coins/currently-live` → 200 array of coin objects.
 * - Sustained rapid requests → 429 `{statusCode:429,message:"Rate limit exceeded",retryAfterMs}`.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { createCurlTransport } from '../../../core/curl-transport.js';
import {
  PlatformError,
  RateLimitError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';
import { globalJevChallengeDiagnoser, extractSnippet } from '../../../core/jev-challenge-diagnoser.js';
import { globalDistributedTokenBucket } from '../../../core/distributed-token-bucket.js';
import { PumpFunLivechat } from './livechat.js';

export const PUMPFUN_API_BASE = 'https://frontend-api-v3.pump.fun';

/** Base58 Solana address (32–44 chars, no 0/O/I/l). */
export const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function createPumpFunClient(options = {}) {
  return new PumpFunClient(options);
}

export class PumpFunClient extends AbstractApiClient {
  /** @type {string} */
  name = 'pumpfun';

  /** @type {string} */
  platform = 'pumpfun';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresResidential = false;

  /** @type {'undici' | 'got' | 'curl'} */
  client = 'undici';

  /** @type {string} */
  baseUrl;

  /**
   * In-flight request deduplication: mint → { promise, expiresAt }.
   * Concurrent callers within the dedup window share one upstream round-trip.
   * @type {Map<string, { promise: Promise<any>, expiresAt: number }>}
   */
  #inFlight = new Map();

  /** @type {number} dedup window ms */
  #dedupWindowMs;

  /** @type {import('../../../core/distributed-token-bucket.js').DistributedTokenBucket} */
  #tokenBucket;

  /** @type {number} max upstream requests per minute per egress IP */
  #reqPerMinute;

  /**
   * Lazily-created curl transport used when the HTTP/2 client is TLS-fingerprinted.
   * @type {Function | null}
   */
  #curlTransport = null;

  /**
   * Socket.IO livechat client for `wss://livechat.pump.fun` — source of
   * coin comments/replies, which moved off REST on v3 (GET /replies → 404).
   * Injected for tests; lazily constructed on first livechat call.
   * @type {PumpFunLivechat | null}
   */
  livechat = null;

  constructor(options = {}) {
    super(options);
    this.baseUrl = typeof options.baseUrl === 'string' && options.baseUrl ? options.baseUrl : PUMPFUN_API_BASE;
    this.#dedupWindowMs = Number.isFinite(options.dedupWindowMs) ? Number(options.dedupWindowMs) : 3000;
    this.#tokenBucket = options.tokenBucket || globalDistributedTokenBucket;
    this.#reqPerMinute = Number.isFinite(options.reqPerMinute) ? Number(options.reqPerMinute) : 40;
    if (typeof options.transport === 'string' && options.transport) {
      this.client = options.transport;
    }
    if (options.livechat) this.livechat = options.livechat;
  }

  /**
   * Validate a Solana mint address (Base58). Throws XACT_4002 before any
   * upstream request or rate-limit token is consumed.
   * @param {unknown} mintAddress
   * @returns {string}
   */
  assertValidMint(mintAddress) {
    const mint = typeof mintAddress === 'string' ? mintAddress.trim() : '';
    if (!SOLANA_MINT_RE.test(mint)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4002',
        message: `Invalid Solana mint address "${mintAddress}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    return mint;
  }

  /**
   * Route a request through the primary transport; on a Cloudflare TLS
   * fingerprint block (HTTP 403) retry once via `createCurlTransport('pumpfun')`.
   * On HTTP 200 with an empty body, run the Jev challenge diagnoser before
   * returning empty data to the caller.
   *
   * @param {string} url
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<{ status: number, headers: Record<string, unknown>, data: any }>}
   */
  async #apiGet(url, options = {}) {
    // Distributed token-bucket gate — 40 req/min per egress IP (Redis atomic Lua,
    // in-memory fallback). Throws XACT_4029 + retryAfterMs when over quota so the
    // caller backs off instead of hammering upstream.
    await this.#consumeRateToken(options);
    let response;
    try {
      response = await this.request('GET', url, { skipResponseValidation: true, ...options });
    } catch (err) {
      if (this.#isTlsBlock(err)) {
        response = await this.#curlGet(url, options);
      } else {
        throw err;
      }
    }

    if (response && response.status === 403) {
      // HTTP client surfaced the fingerprint block as a response, not a throw.
      response = await this.#curlGet(url, options);
    }

    const status = response?.status ?? 0;
    const data = response?.data;

    if (status === 429) {
      throw this.#rateLimitError(response);
    }

    if (status === 200 && this.#isEmptyPayload(data)) {
      // Silent-block / captcha check before returning empty data.
      try {
        const snippet = extractSnippet(typeof data === 'string' ? data : JSON.stringify(data ?? ''));
        const diag = await globalJevChallengeDiagnoser.diagnose({
          snippet,
          platform: this.platform,
          accountId: options.accountId || null,
        });
        this._lastJevDiag = diag;
      } catch {
        this._lastJevDiag = null;
      }
    }

    return { status, headers: response?.headers || {}, data };
  }

  /**
   * Consume one rate-limit token for this egress IP. Throws XACT_4029 with
   * retryAfterMs when the bucket is empty.
   * @param {Record<string, unknown>} options
   */
  async #consumeRateToken(options = {}) {
    if (!this.#tokenBucket || typeof this.#tokenBucket.consume !== 'function') return;
    const proxyKey = options.proxy && (options.proxy.server || options.proxy.host || options.proxy)
      ? String(options.proxy.server || options.proxy.host || options.proxy)
      : 'direct';
    const key = `pumpfun:${proxyKey}`;
    const res = await this.#tokenBucket.consume(key, 1, {
      capacity: this.#reqPerMinute,
      refillRate: this.#reqPerMinute / 60,
    });
    if (res && res.allowed === false) {
      throw new RateLimitError({
        code: 'XACT_4029',
        message: 'pump.fun per-IP rate budget exceeded (40 req/min)',
        statusCode: 429,
        suggestedAction: SuggestedActions.REDUCE_RATE,
        retryAfterMs: res.retryAfterMs || 60000,
        platform: this.platform,
      });
    }
  }

  /**
   * @param {unknown} err
   * @returns {boolean}
   */
  #isTlsBlock(err) {
    const status = err?.statusCode ?? err?.status ?? 0;
    return status === 403;
  }

  /**
   * @param {any} data
   * @returns {boolean}
   */
  #isEmptyPayload(data) {
    if (data == null) return true;
    if (typeof data === 'string') return data.trim().length === 0;
    if (Array.isArray(data)) return data.length === 0;
    if (typeof data === 'object') return Object.keys(data).length === 0;
    return false;
  }

  /**
   * Execute a GET via the curl transport (OpenSSL TLS fingerprint bypass).
   * @param {string} url
   * @param {Record<string, unknown>} options
   */
  async #curlGet(url, options = {}) {
    if (!this.#curlTransport) {
      this.#curlTransport = createCurlTransport(this.platform);
    }
    const proxy = options.proxy ?? this.proxy ?? null;
    const res = await this.#curlTransport({
      method: 'GET',
      url,
      headers: options.headers || {},
      proxy,
      timeout: options.timeout,
    });
    if (res?.status === 429) {
      throw this.#rateLimitError(res);
    }
    return { status: res?.status ?? 0, headers: res?.headers || {}, data: res?.data };
  }

  /**
   * @param {{ status?: number, headers?: Record<string, unknown>, data?: any }} response
   * @returns {RateLimitError}
   */
  #rateLimitError(response) {
    const headers = response?.headers || {};
    const retryAfterMs =
      Number(response?.data?.retryAfterMs) ||
      Number(headers['retry-after'] || headers['Retry-After'] || 0) * 1000 ||
      60000;
    return new RateLimitError({
      code: 'XACT_4029',
      message: `pump.fun rate limit exceeded`,
      statusCode: 429,
      suggestedAction: SuggestedActions.REDUCE_RATE,
      retryAfterMs,
      platform: this.platform,
    });
  }

  /**
   * Fetch theses + top holders. Source of `theses` (callout.thesis) and
   * `topHolders` (amountHeld/pnlUsd/pnlPercentage/isVerified).
   * @param {string} mintAddress
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<{ positions: any[], totalCount: number, hasMore: boolean }>}
   */
  async getMintPositions(mintAddress, options = {}) {
    const mint = this.assertValidMint(mintAddress);
    const url = `${this.baseUrl}/mint-positions/${encodeURIComponent(mint)}?sortBy=TOP&withThesis=true`;
    const { status, data } = await this.#apiGet(url, options);
    if (status === 404) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4004',
        message: `Mint "${mint}" not found on pump.fun`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    // Surface unexpected non-2xx statuses — otherwise an upstream 5xx/403 looks
    // like a successful scrape with zero positions.
    if (status !== 200) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: `pump.fun mint-positions returned status ${status}`,
        statusCode: status,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: this.platform,
      });
    }
    const obj = data && typeof data === 'object' ? data : {};
    return {
      positions: Array.isArray(obj.positions) ? obj.positions : [],
      totalCount: Number(obj.totalCount) || 0,
      hasMore: Boolean(obj.hasMore),
    };
  }

  /**
   * Fetch recent replies/comments for comment-velocity.
   *
   * The `/replies/{mint}` REST path is absent on v3 (404) — comments moved to
   * the Socket.IO livechat service (`wss://livechat.pump.fun`). Strategy:
   *   1. Try REST (cheap, in case the route ever comes back).
   *   2. On 404 / empty → fall back to livechat `getMessageHistory`.
   *
   * Livechat messages are normalized to `{ timestamp, ... }` so
   * `computeCommentVelocity` works unchanged on either source.
   *
   * @param {string} mintAddress
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<any[]>}
   */
  async getReplies(mintAddress, options = {}) {
    const mint = this.assertValidMint(mintAddress);
    const limit = Number.isFinite(options.limit) ? options.limit : 50;
    const url = `${this.baseUrl}/replies/${encodeURIComponent(mint)}?offset=0&limit=${limit}`;
    try {
      const { status, data } = await this.#apiGet(url, options);
      const rows = this.#extractArray(data, ['replies', 'comments', 'data', 'items', 'results']);
      if (status !== 404 && rows.length > 0) return rows;
      // 404 or empty REST → fall through to livechat.
    } catch (err) {
      // Preserve real errors (rate-limit, auth, network) — don't mask a 429 as
      // "no comments". Only fall back to livechat for expected-missing/empty REST.
      if (err && (err.code === 'XACT_4029' || err instanceof RateLimitError)) throw err;
      // other REST failures → livechat fallback below.
    }
    return this.#getRepliesViaLivechat(mint, options);
  }

  /**
   * Pull chat history for a mint from the Socket.IO livechat service and
   * normalize each message to the reply shape `computeCommentVelocity` expects
   * ({ timestamp: <iso-or-ms>, ...original }).
   * @param {string} mint
   * @param {Record<string, unknown>} options
   * @returns {Promise<any[]>}
   */
  async #getRepliesViaLivechat(mint, options = {}) {
    const lc = this.livechat || (this.livechat = new PumpFunLivechat({
      timeoutMs: Number.isFinite(options.livechatTimeoutMs) ? options.livechatTimeoutMs : 8000,
    }));
    const { messages } = await lc.getMessageHistory(mint, {
      limit: Number.isFinite(options.limit) ? options.limit : 50,
      ...(Number.isFinite(options.before) ? { before: options.before } : {}),
    });
    return messages.map((m) => ({
      ...m,
      // normalize: velocity expects a parseable `timestamp` field.
      timestamp: m?.timestamp ?? m?.createdAt ?? m?.created_at ?? null,
    }));
  }

  /**
   * Extract the first array found under any of `keys` (or return data itself
   * if it's already an array).
   * @param {any} data
   * @param {string[]} keys
   * @returns {any[]}
   */
  #extractArray(data, keys) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      for (const key of keys) if (Array.isArray(data[key])) return data[key];
    }
    return [];
  }

  /**
   * Fetch the currently-live coin list (livestream status source).
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<any[]>}
   */
  async getCurrentlyLive(options = {}) {
    const url = `${this.baseUrl}/coins/currently-live`;
    const { status, data } = await this.#apiGet(url, options);
    if (status === 404) return [];
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch full coin metadata: social links, market cap, creator, bonding curve.
   * Cached in-memory for 60s to prevent rate-limit exhaustion.
   * @param {string} mintAddress
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getCoin(mintAddress, options = {}) {
    const mint = this.assertValidMint(mintAddress);
    const cacheKey = `coin:${mint}`;
    const cached = this.#cacheGet(cacheKey);
    if (cached) return cached;

    const url = `${this.baseUrl}/coins/${encodeURIComponent(mint)}`;
    const { status, data } = await this.#apiGet(url, options);
    if (status === 404) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4004',
        message: `Coin with mint "${mint}" not found on pump.fun`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    if (status !== 200) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: `pump.fun coins returned status ${status}`,
        statusCode: status,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: this.platform,
      });
    }
    const result = data && typeof data === 'object' ? data : {};
    this.#cacheSet(cacheKey, result, 60_000);
    return result;
  }

  /**
   * Resolve public user profile by username: wallet address, userId, is_pump_user.
   * Cached in-memory for 5 minutes.
   * @param {string} username
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async getUser(username, options = {}) {
    let cleanUser = typeof username === 'string' ? username.trim() : '';
    if (cleanUser.startsWith('@')) cleanUser = cleanUser.slice(1).trim();
    if (!cleanUser) return null;

    const cacheKey = `user:${cleanUser.toLowerCase()}`;
    const cached = this.#cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    const url = `${this.baseUrl}/users/${encodeURIComponent(cleanUser)}`;
    try {
      const { status, data } = await this.#apiGet(url, options);
      if (status === 404) {
        this.#cacheSet(cacheKey, null, 300_000);
        return null;
      }
      if (status !== 200) return null;
      const result = data && typeof data === 'object' ? data : null;
      this.#cacheSet(cacheKey, result, 300_000);
      return result;
    } catch (err) {
      if (err && (err.code === 'XACT_4029' || err instanceof RateLimitError)) throw err;
      return null;
    }
  }

  /**
   * Fetch discovery feeds across pump.fun coins.
   * @param {object} [params]
   * @param {number} [params.offset=0]
   * @param {number} [params.limit=50]
   * @param {string} [params.sort='last_trade_timestamp'] - created_timestamp | last_trade_timestamp | market_cap
   * @param {string} [params.order='DESC'] - ASC | DESC
   * @param {boolean} [params.includeNsfw=false]
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<any[]>}
   */
  async getCoinsFeed(params = {}, options = {}) {
    const q = new URLSearchParams();
    q.set('offset', String(params.offset || 0));
    q.set('limit', String(params.limit || 50));
    q.set('sort', params.sort || 'last_trade_timestamp');
    q.set('order', params.order || 'DESC');
    q.set('includeNsfw', params.includeNsfw ? 'true' : 'false');

    const url = `${this.baseUrl}/coins?${q.toString()}`;
    const { status, data } = await this.#apiGet(url, options);
    if (status !== 200 && status !== 0) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: `pump.fun coins feed returned status ${status}`,
        statusCode: status,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: this.platform,
      });
    }
    return Array.isArray(data) ? data : [];
  }

  /** @type {Map<string, { value: any, expiresAt: number }>} */
  #ttlCache = new Map();

  #cacheGet(key) {
    const entry = this.#ttlCache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.#ttlCache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  #cacheSet(key, value, ttlMs) {
    // Keep cache bounded to 500 items max
    if (this.#ttlCache.size >= 500) {
      const oldestKey = this.#ttlCache.keys().next().value;
      if (oldestKey) this.#ttlCache.delete(oldestKey);
    }
    this.#ttlCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * In-flight deduplication: concurrent callers for the same mint within
   * `dedupWindowMs` share one upstream Promise.
   * @template T
   * @param {string} mint
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  dedup(mint, fn) {
    const existing = this.#inFlight.get(mint);
    const now = Date.now();
    // Share an in-flight promise unconditionally while it's still pending; only
    // apply the short reuse window once it has settled.
    if (existing && (existing.settledAt == null || existing.settledAt + this.#dedupWindowMs > now)) {
      return existing.promise;
    }
    const entry = { promise: null, settledAt: null };
    entry.promise = (async () => {
      try {
        return await fn();
      } finally {
        entry.settledAt = Date.now();
        // Purge after the dedup window measured from settle time.
        setTimeout(() => {
          if (this.#inFlight.get(mint) === entry) this.#inFlight.delete(mint);
        }, Math.max(0, this.#dedupWindowMs)).unref?.();
      }
    })();
    this.#inFlight.set(mint, entry);
    return entry.promise;
  }
}

export default PumpFunClient;
