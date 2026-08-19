// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AdaptiveRateGovernor — infrastructure-aware throttling.
 * @author nich (@nichxbt)
 * @license MIT
 */

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
  #redisConsumerLag = 0;

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
   */
  constructor(deps = {}) {
    this.#proxyPool = deps.proxyPool || null;
    this.#windowStart = Date.now();
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
   * @param {number} state.healthyProxyCount
   * @param {number} state.totalProxyCount
   * @param {number} state.redisConsumerLag
   */
  updateState(state) {
    this.#healthyProxyCount = state.healthyProxyCount;
    this.#totalProxyCount = state.totalProxyCount;
    this.#redisConsumerLag = state.redisConsumerLag;
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
    let factor = 1;
    if (this.#healthyProxyCount < this.#totalProxyCount * 0.5) factor = 0.5;
    if (this.#healthyProxyCount < 5) factor = 0;
    if (this.#redisConsumerLag > 10000) factor *= 0.25;
    return this.#healthyProxyCount * limit.baseReqPerSecondPerProxy * limit.throttleFactor * factor;
  }

  /**
   * @param {string} accountId
   */
  recordRequest(accountId) {
    const now = Date.now();
    const timestamps = this.#accountRequestTimestamps.get(accountId) || [];
    timestamps.push(now);
    // Keep only last 60 seconds
    const cutoff = now - 60_000;
    const filtered = timestamps.filter((t) => t > cutoff);
    this.#accountRequestTimestamps.set(accountId, filtered);

    // Update current rps window
    if (now - this.#windowStart >= 1000) {
      this.#currentReqPerSecond = 0;
      this.#windowStart = now;
    }
    this.#currentReqPerSecond += 1;
  }

  /**
   * @param {string} accountId
   * @returns {number}
   */
  getAccountVelocity(accountId) {
    const timestamps = this.#accountRequestTimestamps.get(accountId) || [];
    const now = Date.now();
    return timestamps.filter((t) => now - t < 60_000).length;
  }

  /**
   * @param {string} accountId
   * @param {string} platform
   * @returns {boolean}
   */
  canAccountRequest(accountId, platform) {
    if (this.isHibernating(accountId)) return false;
    const limit = this.#platformLimits.get(platform) || new PlatformRateLimit(platform);
    return this.getAccountVelocity(accountId) < limit.safeRequestsPerMinute;
  }

  /**
   * @param {string} accountId
   * @param {string} reason
   * @param {number} [durationMs]
   */
  hibernateAccount(accountId, reason, durationMs = 15 * 60 * 1000) {
    const until = Date.now() + durationMs;
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.accountId !== accountId);
    this.#hibernatingAccounts.push({ accountId, until, reason });
  }

  /**
   * Record a rate limit event for an account and hibernate it.
   * @param {string} accountId
   * @param {string} [platform]
   * @param {number} [durationMs]
   */
  recordRateLimit(accountId, platform, durationMs = 15 * 60 * 1000) {
    this.hibernateAccount(accountId, `rate_limit:${platform || 'unknown'}`, durationMs);
  }

  /**
   * Wake up an account early by clearing its hibernation status.
   * @param {string} accountId
   */
  wakeAccount(accountId) {
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.accountId !== accountId);
  }

  /**
   * @param {string} accountId
   * @returns {boolean}
   */
  isHibernating(accountId) {
    const now = Date.now();
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.until > now);
    return this.#hibernatingAccounts.some((h) => h.accountId === accountId);
  }

  /** @returns {GovernorStatus} */
  getStatus() {
    const now = Date.now();
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.until > now);
    this.refreshFromProxyPool();
    const healthyProxyRatio = this.#totalProxyCount ? this.#healthyProxyCount / this.#totalProxyCount : 0;
    const throttleLevel =
      this.#redisConsumerLag > 10000 ? 'backpressure' :
      healthyProxyRatio < 0.1 ? 'critical' :
      healthyProxyRatio < 0.5 ? 'reduced' : 'normal';

    return {
      healthyProxyCount: this.#healthyProxyCount,
      totalProxyCount: this.#totalProxyCount,
      healthyProxyRatio,
      currentReqPerSecond: this.#currentReqPerSecond,
      redisConsumerLag: this.#redisConsumerLag,
      hibernatingAccounts: this.#hibernatingAccounts.map((h) => ({
        accountId: h.accountId,
        remainingSeconds: Math.ceil((h.until - now) / 1000),
        reason: h.reason,
      })),
      throttleLevel,
    };
  }
}
