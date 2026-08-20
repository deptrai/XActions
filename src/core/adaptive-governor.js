// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AdaptiveRateGovernor — infrastructure-aware throttling.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { globalProxyPool } from '../proxy/proxy-pool.js';

/** @typedef {import('./types.js').GovernorStatus} GovernorStatus */

export class PlatformRateLimit {
  /** @type {string} */
  platform;

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {number} */
  safeRequestsPerMinute = 30;

  /** @type {number} */
  baseReqPerSecondPerProxy = 1;

  /** @type {number} */
  throttleFactor = 1;

  /** @type {number} */
  burstWindow = 60;

  /**
   * @param {string} platform
   * @param {Partial<PlatformRateLimit>} [overrides]
   */
  constructor(platform, overrides = {}) {
    this.platform = platform;
    Object.assign(this, overrides);
  }
}

export class AdaptiveRateGovernor {
  /** @type {Map<string, PlatformRateLimit>} */
  #platformLimits = new Map();

  /** @type {number} */
  #healthyProxyCount = 0;

  /** @type {number} */
  #totalProxyCount = 0;

  /** @type {number} */
  #healthyProxyFloor = 0;

  /** @type {number} */
  #redisConsumerLag = 0;

  /** @type {boolean} */
  #isBackpressureActive = false;

  /** @type {Map<string, number[]>} */
  #accountRequestTimestamps = new Map();

  /** @type {number} */
  #currentReqPerSecond = 0;

  /** @type {number} */
  #windowStart = 0;

  /** @type {Array<{accountId: string, until: number, reason: string}>} */
  #hibernatingAccounts = [];

  /** @type {import('../proxy/proxy-pool.js').ProxyIpPool | null} */
  #proxyPool = null;

  /**
   * @param {Object} [deps]
   * @param {import('../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {number} [deps.healthyProxyFloor]
   */
  constructor(deps = {}) {
    this.#proxyPool = deps.proxyPool || null;
    this.#healthyProxyFloor = Math.max(0, deps.healthyProxyFloor ?? 0);
    this.#windowStart = Date.now();
  }

  /**
   * Internal account records are keyed by `platform:accountId`.
   * @param {string} accountId
   * @param {string} [platform]
   * @returns {string}
   */
  #resolveAccountId(accountId, platform) {
    if (platform) {
      if (typeof accountId === 'string' && accountId.startsWith(`${platform}:`)) {
        return accountId;
      }
      return `${platform}:${accountId}`;
    }
    if (typeof accountId === 'string' && accountId.includes(':')) {
      return accountId;
    }
    return accountId;
  }

  /**
   * @param {string} platform
   * @param {Partial<PlatformRateLimit>} [limits]
   */
  setPlatformLimit(platform, limits = {}) {
    this.#platformLimits.set(platform, new PlatformRateLimit(platform, limits));
  }

  /**
   * @param {string} platform
   * @returns {PlatformRateLimit}
   */
  getPlatformLimit(platform) {
    return this.#platformLimits.get(platform) || new PlatformRateLimit(platform);
  }

  /**
   * @param {string} platform
   * @returns {boolean}
   */
  isAuthRequired(platform) {
    return this.getPlatformLimit(platform).requiresAuth;
  }

  /**
   * @param {Object} state
   * @param {number} [state.healthyProxyCount]
   * @param {number} [state.totalProxyCount]
   * @param {number} [state.redisConsumerLag]
   */
  updateState(state) {
    if (!state || typeof state !== 'object') return;
    if (state.healthyProxyCount !== undefined) this.#healthyProxyCount = state.healthyProxyCount;
    if (state.totalProxyCount !== undefined) this.#totalProxyCount = state.totalProxyCount;
    if (state.redisConsumerLag !== undefined) this.updateRedisConsumerLag(state.redisConsumerLag);
  }

  /**
   * Update Redis consumer group lag directly with hysteresis (10000 on, 5000 off).
   * @param {number} lag
   */
  updateRedisConsumerLag(lag) {
    this.#redisConsumerLag = Math.max(0, Number(lag) || 0);
    if (this.#redisConsumerLag > 10000) {
      this.#isBackpressureActive = true;
    } else if (this.#redisConsumerLag < 5000) {
      this.#isBackpressureActive = false;
    }
  }

  /**
   * @returns {number}
   */
  getRedisConsumerLag() {
    return this.#redisConsumerLag;
  }

  /** @returns {void} */
  refreshFromProxyPool() {
    if (!this.#proxyPool) return;
    this.#healthyProxyCount = this.#proxyPool.healthyCount;
    this.#totalProxyCount = this.#proxyPool.totalCount;
  }

  /**
   * @param {string} platform
   * @returns {number}
   */
  getMaxThroughput(platform) {
    this.refreshFromProxyPool();
    const limit = this.#platformLimits.get(platform) || new PlatformRateLimit(platform);
    const total = this.#totalProxyCount;
    const healthy = this.#healthyProxyCount;
    const healthyProxyRatio = total > 0 ? healthy / total : 0;

    let factor = 1;
    if (total > 0 && (healthyProxyRatio < 0.1 || (this.#healthyProxyFloor > 0 && healthy < this.#healthyProxyFloor))) {
      return 0;
    }
    if (total > 0 && healthy < total * 0.5) {
      factor = 0.5;
    }
    if (this.#isBackpressureActive || this.#redisConsumerLag > 10000) {
      factor *= 0.25;
    }

    return healthy * limit.baseReqPerSecondPerProxy * limit.throttleFactor * factor;
  }

  /**
   * @param {string} accountId
   * @param {string} [platform]
   */
  recordRequest(accountId, platform) {
    const key = this.#resolveAccountId(accountId, platform);
    const now = Date.now();
    const timestamps = this.#accountRequestTimestamps.get(key) || [];
    timestamps.push(now);
    // Keep only last 60 seconds
    const cutoff = now - 60_000;
    const filtered = timestamps.filter((t) => t > cutoff);
    this.#accountRequestTimestamps.set(key, filtered);

    // Update current rps window
    if (now - this.#windowStart >= 1000) {
      this.#currentReqPerSecond = 0;
      this.#windowStart = now;
    }
    this.#currentReqPerSecond += 1;
  }

  /**
   * @param {string} accountId
   * @param {string} [platform]
   * @returns {number}
   */
  getAccountVelocity(accountId, platform) {
    const key = this.#resolveAccountId(accountId, platform);
    const timestamps = this.#accountRequestTimestamps.get(key) || [];
    const now = Date.now();
    return timestamps.filter((t) => now - t < 60_000).length;
  }

  /**
   * @param {string} accountId
   * @param {string} platform
   * @returns {boolean}
   */
  canAccountRequest(accountId, platform) {
    const key = this.#resolveAccountId(accountId, platform);
    if (this.isHibernating(key)) return false;
    const limit = this.#platformLimits.get(platform) || new PlatformRateLimit(platform);
    return this.getAccountVelocity(key) < limit.safeRequestsPerMinute;
  }

  /**
   * @param {string} accountId
   * @param {string} reason
   * @param {number} [durationMs]
   * @param {string} [platform]
   */
  hibernateAccount(accountId, reason, durationMs = 15 * 60 * 1000, platform) {
    const key = this.#resolveAccountId(accountId, platform);
    const until = Date.now() + durationMs;
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.accountId !== key);
    this.#hibernatingAccounts.push({ accountId: key, until, reason });
  }

  /**
   * Record a rate limit event for an account and hibernate it.
   * @param {string} accountId
   * @param {string} [platform]
   * @param {number} [durationMs]
   */
  recordRateLimit(accountId, platform, durationMs = 15 * 60 * 1000) {
    this.hibernateAccount(accountId, 'rate_limit', durationMs, platform);
  }

  /**
   * Record a bot challenge event for an account and hibernate it. Default 20 minutes.
   * @param {string} accountId
   * @param {string} [platform]
   * @param {number} [durationMs]
   */
  recordBotChallenge(accountId, platform, durationMs = 20 * 60 * 1000) {
    this.hibernateAccount(accountId, 'bot_challenge', durationMs, platform);
  }

  /**
   * Wake up an account early by clearing its hibernation status.
   * @param {string} accountId
   * @param {string} [platform]
   */
  wakeAccount(accountId, platform) {
    const key = this.#resolveAccountId(accountId, platform);
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.accountId !== key);
  }

  /**
   * @param {string} accountId
   * @param {string} [platform]
   * @returns {boolean}
   */
  isHibernating(accountId, platform) {
    const key = this.#resolveAccountId(accountId, platform);
    const now = Date.now();
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.until > now);
    return this.#hibernatingAccounts.some((h) => h.accountId === key);
  }

  /** @returns {GovernorStatus} */
  getStatus() {
    const now = Date.now();
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.until > now);
    this.refreshFromProxyPool();

    // Reset currentReqPerSecond if window has passed
    if (now - this.#windowStart >= 1000) {
      this.#currentReqPerSecond = 0;
      this.#windowStart = now;
    }

    // Prune inactive account timestamps
    const cutoff = now - 60_000;
    for (const [key, timestamps] of this.#accountRequestTimestamps.entries()) {
      const active = timestamps.filter((t) => t > cutoff);
      if (active.length === 0) {
        this.#accountRequestTimestamps.delete(key);
      } else {
        this.#accountRequestTimestamps.set(key, active);
      }
    }

    const healthyProxyRatio = this.#totalProxyCount ? this.#healthyProxyCount / this.#totalProxyCount : 0;
    const isCritical = this.#totalProxyCount > 0 && (healthyProxyRatio < 0.1 || (this.#healthyProxyFloor > 0 && this.#healthyProxyCount < this.#healthyProxyFloor));
    const isBackpressure = this.#isBackpressureActive || this.#redisConsumerLag > 10000;
    const throttleLevel =
      isCritical ? 'critical' :
      isBackpressure ? 'backpressure' :
      (this.#totalProxyCount > 0 && healthyProxyRatio < 0.5) ? 'reduced' : 'normal';

    return {
      healthyProxyCount: this.#healthyProxyCount,
      totalProxyCount: this.#totalProxyCount,
      healthyProxyRatio,
      currentReqPerSecond: this.#currentReqPerSecond,
      redisConsumerLag: this.#redisConsumerLag,
      hibernatingAccounts: this.#hibernatingAccounts.map((h) => ({
        accountId: h.accountId,
        remainingSeconds: Math.max(0, Math.ceil((h.until - now) / 1000)),
        reason: h.reason,
      })),
      throttleLevel,
    };
  }
}

export const globalAdaptiveRateGovernor = new AdaptiveRateGovernor({ proxyPool: globalProxyPool });
