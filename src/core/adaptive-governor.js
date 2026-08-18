// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AdaptiveRateGovernor — infrastructure-aware throttling stub.
 * @author nich (@nichxbt)
 * @license MIT
 */

/** @typedef {import('./types.js').GovernorStatus} GovernorStatus */

export class PlatformRateLimit {
  /** @type {string} */
  platform;

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

  /** @type {Array<{accountId: string, until: number, reason: string}>} */
  #hibernatingAccounts = [];

  /**
   * @param {Object} [deps]
   * @param {import('../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   */
  constructor(deps = {}) {
    this.proxyPool = deps.proxyPool;
  }

  /**
   * @param {string} platform
   * @param {Partial<PlatformRateLimit>} [limits]
   */
  setPlatformLimit(platform, limits = {}) {
    this.#platformLimits.set(platform, new PlatformRateLimit(platform, limits));
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

  /**
   * @param {string} platform
   * @returns {number}
   */
  getMaxThroughput(platform) {
    const limit = this.#platformLimits.get(platform) || new PlatformRateLimit(platform);
    let factor = 1;
    if (this.#healthyProxyCount < this.#totalProxyCount * 0.5) factor = 0.5;
    if (this.#healthyProxyCount < 5) factor = 0;
    if (this.#redisConsumerLag > 10000) factor *= 0.25;
    return this.#healthyProxyCount * limit.baseReqPerSecondPerProxy * limit.throttleFactor * factor;
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

  /** @returns {GovernorStatus} */
  getStatus() {
    const now = Date.now();
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.until > now);
    const healthyProxyRatio = this.#totalProxyCount ? this.#healthyProxyCount / this.#totalProxyCount : 0;
    const throttleLevel =
      this.#redisConsumerLag > 10000 ? 'backpressure' :
      healthyProxyRatio < 0.1 ? 'critical' :
      healthyProxyRatio < 0.5 ? 'reduced' : 'normal';

    return {
      healthyProxyCount: this.#healthyProxyCount,
      totalProxyCount: this.#totalProxyCount,
      healthyProxyRatio,
      currentReqPerSecond: 0,
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
