// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * DexscreenerClient — keyless HTTP client for api.dexscreener.com public REST.
 * Extends AbstractApiClient. All endpoints are free/GET-only (verified in Epic
 * 50 research: /tokens/v1, /orders/v1, /token-pairs/v1, /token-boosts/latest/v1,
 * /token-profiles/latest/v1). No auth header, no API key, permissive CORS/CF.
 *
 * Live-probe notes (2026-09-27):
 * - `/token-pairs/v1/solana/{mint}` → 200 array of pair objects (~250-400ms).
 * - `/token-boosts/latest/v1` → 200 array of boosted tokens (~200ms).
 * - `/orders/v1/{chainId}/{token}` → 200 array of paid-order records.
 * - Sustained rapid requests → 429; per-IP bucket kept conservative (30 rpm).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';
import { globalDistributedTokenBucket } from '../../../core/distributed-token-bucket.js';

export const DEXSCREENER_API_BASE = 'https://api.dexscreener.com';

/** Base58 Solana address (32–44 chars, no 0/O/I/l). */
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** EVM hex address. */
export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Chains whose token addresses we validate strictly. */
const STRICT_CHAIN_PATTERNS = {
  solana: SOLANA_ADDRESS_RE,
  ethereum: EVM_ADDRESS_RE,
  bsc: EVM_ADDRESS_RE,
  base: EVM_ADDRESS_RE,
  arbitrum: EVM_ADDRESS_RE,
  polygon: EVM_ADDRESS_RE,
  optimism: EVM_ADDRESS_RE,
  avalanche: EVM_ADDRESS_RE,
};

export function createDexscreenerClient(options = {}) {
  return new DexscreenerClient(options);
}

export class DexscreenerClient extends AbstractApiClient {
  /** @type {string} */
  name = 'dexscreener';

  /** @type {string} */
  platform = 'dexscreener';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresResidential = false;

  /** @type {'undici' | 'got' | 'curl'} */
  client = 'undici';

  /** @type {string} */
  baseUrl;

  /** @type {import('../../../core/distributed-token-bucket.js').DistributedTokenBucket} */
  #tokenBucket;

  /** @type {number} max upstream requests per minute per egress IP */
  #reqPerMinute;

  constructor(options = {}) {
    super(options);
    this.baseUrl = typeof options.baseUrl === 'string' && options.baseUrl ? options.baseUrl : DEXSCREENER_API_BASE;
    this.#tokenBucket = options.tokenBucket || globalDistributedTokenBucket;
    // Dexscreener publishes ~300rpm for token endpoints; stay conservative.
    this.#reqPerMinute = Number.isFinite(options.reqPerMinute) ? Number(options.reqPerMinute) : 30;
    if (typeof options.transport === 'string' && options.transport) {
      this.client = options.transport;
    }
  }

  /**
   * Validate a chain id — non-empty string; strict address check for known
   * chains, non-empty-only for chains outside the strict table.
   * @param {unknown} chainId
   * @returns {string}
   */
  assertValidChainId(chainId) {
    const chain = typeof chainId === 'string' ? chainId.trim().toLowerCase() : '';
    if (!chain || !/^[a-z0-9_-]{2,32}$/.test(chain)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4002',
        message: `Invalid chainId "${chainId}" — expected e.g. 'solana', 'ethereum', 'bsc'`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    return chain;
  }

  /**
   * Validate a token address for the given chain. Solana → Base58; known EVM
   * chains → 0x hex; unknown chains → non-empty check only.
   * @param {unknown} tokenAddress
   * @param {string} chainId
   * @returns {string}
   */
  assertValidTokenAddress(tokenAddress, chainId) {
    const addr = typeof tokenAddress === 'string' ? tokenAddress.trim() : '';
    if (!addr) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4002',
        message: `Missing tokenAddress for chain "${chainId}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    const pattern = STRICT_CHAIN_PATTERNS[chainId];
    if (pattern && !pattern.test(addr)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4002',
        message: `Invalid token address "${tokenAddress}" for chain "${chainId}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    return addr;
  }

  /**
   * Distributed token-bucket gate — per-egress-IP upstream budget.
   * @param {{ proxy?: any, [key: string]: unknown }} [options]
   */
  async #consumeRateToken(options = {}) {
    if (!this.#tokenBucket || typeof this.#tokenBucket.consume !== 'function') return;
    const proxyKey = options.proxy && (options.proxy.server || options.proxy.host || options.proxy)
      ? String(options.proxy.server || options.proxy.host || options.proxy)
      : 'direct';
    const key = `dexscreener:${proxyKey}`;
    const res = await this.#tokenBucket.consume(key, 1, {
      capacity: this.#reqPerMinute,
      refillRate: this.#reqPerMinute / 60,
      ttlSeconds: 3600,
    });
    if (res && res.allowed === false) {
      throw new PlatformError({
        type: ErrorTypes.RATE_LIMIT,
        code: 'XACT_4029',
        message: `dexscreener per-IP rate budget exceeded (${this.#reqPerMinute} req/min)`,
        statusCode: 429,
        suggestedAction: SuggestedActions.REDUCE_RATE,
        retryAfterMs: res.retryAfterMs || 60000,
        platform: this.platform,
      });
    }
  }

  /**
   * Route a GET through the primary transport with status → error mapping.
   * @param {string} url
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<{ status: number, headers: Record<string, unknown>, data: any }>}
   */
  async #apiGet(url, options = {}) {
    await this.#consumeRateToken(options);
    /** @type {any} */
    const response = await this.request('GET', url, { skipResponseValidation: true, ...options });
    const status = response?.status ?? 0;

    if (status === 429) {
      const headers = response?.headers || {};
      const retryAfterSec = Number(headers['retry-after'] || headers['x-retry-after'] || 0) || 60;
      throw new PlatformError({
        type: ErrorTypes.RATE_LIMIT,
        code: 'XACT_4029',
        message: 'dexscreener rate limit exceeded',
        statusCode: 429,
        suggestedAction: SuggestedActions.REDUCE_RATE,
        retryAfterMs: retryAfterSec * 1000,
        platform: this.platform,
      });
    }

    return response || { status: 0, headers: {}, data: null };
  }

  /**
   * @param {string} what - human-readable endpoint label for error messages
   * @param {{ status: number, data: any }} res
   * @param {string} notFoundMsg
   * @returns {any} res.data
   */
  #requireData(what, res, notFoundMsg) {
    const status = res?.status ?? 0;
    if (status === 404) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4004',
        message: notFoundMsg,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    if (status !== 200) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: `dexscreener ${what} returned status ${status}`,
        statusCode: status,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: this.platform,
      });
    }
    return res.data;
  }

  /**
   * GET /tokens/v1/{chainId}/{tokenAddress} — token profile incl. info.socials.
   * @param {string} chainId
   * @param {string} tokenAddress
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown> | Record<string, unknown>[]>}
   */
  async getTokenProfiles(chainId, tokenAddress, options = {}) {
    const chain = this.assertValidChainId(chainId);
    const token = this.assertValidTokenAddress(tokenAddress, chain);
    const url = `${this.baseUrl}/tokens/v1/${encodeURIComponent(chain)}/${encodeURIComponent(token)}`;
    const res = await this.#apiGet(url, options);
    return this.#requireData(
      'tokens/v1',
      res,
      `Token "${token}" on chain "${chain}" not found on dexscreener`,
    );
  }

  /**
   * GET /orders/v1/{chainId}/{tokenAddress} — dev-paid orders + boost status.
   * @param {string} chainId
   * @param {string} tokenAddress
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<{ orders: unknown[], boosts: unknown[] }>}
   */
  async getTokenOrders(chainId, tokenAddress, options = {}) {
    const chain = this.assertValidChainId(chainId);
    const token = this.assertValidTokenAddress(tokenAddress, chain);
    const url = `${this.baseUrl}/orders/v1/${encodeURIComponent(chain)}/${encodeURIComponent(token)}`;
    const res = await this.#apiGet(url, options);
    const data = this.#requireData(
      'orders/v1',
      res,
      `Orders for token "${token}" on chain "${chain}" not found on dexscreener`,
    );
    // Upstream shape (verified live 2026-09-27): `{orders:[...], boosts:[...]}` —
    // legacy returned bare array; support both.
    if (Array.isArray(data)) return { orders: data, boosts: [] };
    if (data && typeof data === 'object') {
      return {
        orders: Array.isArray(data.orders) ? data.orders : [],
        boosts: Array.isArray(data.boosts) ? data.boosts : [],
      };
    }
    return { orders: [], boosts: [] };
  }

  /**
   * GET /token-pairs/v1/{chainId}/{tokenAddress} — pairs + liquidity + priceUsd.
   * @param {string} chainId
   * @param {string} tokenAddress
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async getTokenPairs(chainId, tokenAddress, options = {}) {
    const chain = this.assertValidChainId(chainId);
    const token = this.assertValidTokenAddress(tokenAddress, chain);
    const url = `${this.baseUrl}/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(token)}`;
    const res = await this.#apiGet(url, options);
    const data = this.#requireData(
      'token-pairs/v1',
      res,
      `Pairs for token "${token}" on chain "${chain}" not found on dexscreener`,
    );
    return Array.isArray(data) ? data : [];
  }

  /**
   * GET /token-boosts/latest/v1 — trending boosted tokens (platform-wide).
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async getLatestBoosted(options = {}) {
    const url = `${this.baseUrl}/token-boosts/latest/v1`;
    const res = await this.#apiGet(url, options);
    const data = this.#requireData(
      'token-boosts/latest',
      res,
      'Latest boosted tokens not found on dexscreener',
    );
    return Array.isArray(data) ? data : [];
  }

  /**
   * GET /token-profiles/latest/v1 — newly updated token profiles.
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async getLatestProfiles(options = {}) {
    const url = `${this.baseUrl}/token-profiles/latest/v1`;
    const res = await this.#apiGet(url, options);
    const data = this.#requireData(
      'token-profiles/latest',
      res,
      'Latest token profiles not found on dexscreener',
    );
    return Array.isArray(data) ? data : [];
  }
}

export default DexscreenerClient;
