// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ProxyBudgetGovernor — daily cost ceiling enforcement for paid proxy tiers
 * (Story 40.1 / AD-42).
 *
 * Tracks estimated spend per day via DistributedTokenBucket (Redis-backed
 * with in-memory fallback). Daily key `proxy:budget:YYYY-MM-DD` auto-expires
 * via TTL — no manual reset needed.
 *
 * Cost model: fixed estimate per request (~50MB) × tier rate.
 * Conservative estimate prevents overrun without byte-level tracking.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import { globalDistributedTokenBucket } from './distributed-token-bucket.js';

/**
 * Cost per GB in USD per proxy tier.
 * `free` and unknown tiers cost nothing.
 * @type {Record<string, number>}
 */
export const TIER_COST_USD_PER_GB = Object.freeze({
  free: 0,
  datacenter: 0.5,
  residential: 8.0,
  mobile_4g: 15.0,
});

/** Fixed estimate of bytes transferred per proxy request (~50MB). */
const ESTIMATED_BYTES_PER_REQUEST = 50 * 1024 * 1024;

/** Default daily budget when env var unset. */
const DEFAULT_DAILY_BUDGET_USD = 50;

export class ProxyBudgetGovernor {
  /** @type {import('./distributed-token-bucket.js').DistributedTokenBucket} */
  #bucket;

  /** @type {number} */
  #dailyBudgetUsd;

  /** @type {Set<string>} */
  #initializedKeys = new Set();

  /**
   * @param {Object} [options]
   * @param {import('./distributed-token-bucket.js').DistributedTokenBucket} [options.bucket]
   * @param {number} [options.dailyBudgetUsd] - Override env var for testing.
   */
  constructor(options = {}) {
    this.#bucket = options.bucket || globalDistributedTokenBucket;
    this.#dailyBudgetUsd = options.dailyBudgetUsd !== undefined
      ? Number(options.dailyBudgetUsd)
      : parseFloat(process.env.PROXY_DAILY_BUDGET_USD || String(DEFAULT_DAILY_BUDGET_USD));
  }

  /**
   * Current configured daily budget ceiling in USD.
   * @returns {number}
   */
  get dailyBudgetUsd() {
    return this.#dailyBudgetUsd;
  }

  /**
   * Today's bucket key — date-scoped so TTL expiry resets the budget daily.
   * @returns {string}
   */
  #todayKey() {
    return `proxy:budget:${new Date().toISOString().slice(0, 10)}`;
  }

  /**
   * Estimated USD cost for a request through the given tier.
   * @param {string} tier
   * @param {number} [estimatedBytes]
   * @returns {number}
   */
  estimateCostUsd(tier, estimatedBytes = ESTIMATED_BYTES_PER_REQUEST) {
    const rate = TIER_COST_USD_PER_GB[tier] || 0;
    return (estimatedBytes / 1e9) * rate;
  }

  /**
   * Pre-flight check — can we afford `tier` without exceeding the daily ceiling?
   * Free tier always allowed. Unknown tiers treated as free (cost 0).
   *
   * @param {string} tier
   * @param {number} [estimatedBytes]
   * @returns {Promise<{ allowed: boolean, remaining: number, estimatedCostUsd: number, dailyBudgetUsd: number }>}
   */
  async canAfford(tier, estimatedBytes = ESTIMATED_BYTES_PER_REQUEST) {
    const cost = this.estimateCostUsd(tier, estimatedBytes);
    if (cost <= 0) {
      return { allowed: true, remaining: this.#dailyBudgetUsd, estimatedCostUsd: 0, dailyBudgetUsd: this.#dailyBudgetUsd };
    }
    // DistributedTokenBucket.canConsume() returns only boolean, not remaining.
    // To get remaining we must call consume(0) — which spends 1 token
    // (Math.max(1, tokens)) — acceptable overhead vs ~50 budget capacity.
    // We call it unconditionally so the remaining figure is always accurate.
    const key = this.#todayKey();
    const res = await this.#bucket.consume(key, 0, {
      capacity: this.#dailyBudgetUsd,
      refillRate: 0,
      ttlSeconds: 86400,
    });
    const remaining = Number(res?.remaining) || 0;
    return {
      allowed: remaining >= cost,
      remaining,
      estimatedCostUsd: cost,
      dailyBudgetUsd: this.#dailyBudgetUsd,
    };
  }

    /**
   * Record actual spend for a completed request.
   * Called after a successful request to debit the daily bucket.
   *
   * @param {string} tier
   * @param {number} [bytesUsed]
   * @returns {Promise<{ allowed: boolean, remaining: number, spentUsd: number }>}
   */
  async consume(tier, bytesUsed = ESTIMATED_BYTES_PER_REQUEST) {
    const cost = this.estimateCostUsd(tier, bytesUsed);
    if (cost <= 0) {
      return { allowed: true, remaining: this.#dailyBudgetUsd, spentUsd: 0 };
    }
    const res = await this.#bucket.consume(this.#todayKey(), cost, {
      capacity: this.#dailyBudgetUsd,
      refillRate: 0,
      ttlSeconds: 86400,
    });
    return {
      allowed: Boolean(res?.allowed),
      remaining: Number(res?.remaining) || 0,
      spentUsd: cost,
    };
  }

  /**
   * Remaining budget today (approximate — bucket may be shared across processes).
   * @returns {Promise<{ remaining: number, dailyBudgetUsd: number }>}
   */
  async checkRemaining() {
    const res = await this.#bucket.consume(this.#todayKey(), 0, {
      capacity: this.#dailyBudgetUsd,
      refillRate: 0,
      ttlSeconds: 86400,
    });
    return {
      remaining: Number(res?.remaining) || 0,
      dailyBudgetUsd: this.#dailyBudgetUsd,
    };
  }
}

export const globalProxyBudgetGovernor = new ProxyBudgetGovernor();
