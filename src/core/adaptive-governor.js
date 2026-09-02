// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AdaptiveRateGovernor — infrastructure-aware throttling.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { globalProxyPool } from '../proxy/proxy-pool.js';
import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';

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

  /** @type {boolean} */
  #loggedThrottleThisSession = false;

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

  /** Sliding-window request timestamps per consumer (AD-20, in-memory only). */
  #consumerRequestTimestamps = new Map();

  /** Registered consumer quotas (AD-20). Unknown consumers fall back to `internal`. */
  #consumerQuotas = new Map();

  /**
   * @param {Object} [deps]
   * @param {import('../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {number} [deps.healthyProxyFloor]
   */
  constructor(deps = {}) {
    this.#proxyPool = deps.proxyPool || null;
    this.#healthyProxyFloor = Math.max(0, deps.healthyProxyFloor ?? 0);
    this.#windowStart = Date.now();

    // AD-20 default consumer quotas. NOWING_RATE_LIMIT_RPM overrides the
    // Nowing workspace plan RPM; internal traffic is unmetered.
    const parsedNowingRpm = Number(process.env.NOWING_RATE_LIMIT_RPM);
    const nowingRpm = Number.isInteger(parsedNowingRpm) && parsedNowingRpm > 0 ? parsedNowingRpm : 60;
    this.#consumerQuotas.set('chainlens', { consumerId: 'chainlens', rpmLimit: 10, burstLimit: 5, priority: 1 });
    this.#consumerQuotas.set('nowing', {
      consumerId: 'nowing',
      rpmLimit: nowingRpm,
      burstLimit: 15,
      priority: 2,
    });
    this.#consumerQuotas.set('internal', { consumerId: 'internal', rpmLimit: Infinity, burstLimit: 1000, priority: 99 });
  }

  /**
   * Normalize a consumer id to a registered quota key. Unknown consumers are
   * treated as `internal` (unmetered) — recording never throws (AD-20).
   * @param {string} consumerId
   * @returns {string}
   */
  #resolveConsumerId(consumerId) {
    const id = String(consumerId ?? '').trim().toLowerCase();
    return this.#consumerQuotas.has(id) ? id : 'internal';
  }

  /**
   * Prune timestamps older than the 60s sliding window for a consumer.
   * @param {string} consumerId
   * @returns {number[]}
   */
  #pruneConsumerWindow(consumerId) {
    const now = Date.now();
    const cutoff = now - 60_000;
    const timestamps = (this.#consumerRequestTimestamps.get(consumerId) || []).filter((/** @type {number} */ t) => t > cutoff);
    this.#consumerRequestTimestamps.set(consumerId, timestamps);
    return timestamps;
  }

  /**
   * Register or update a consumer quota (AD-20). Merges with the existing
   * config when the consumer is already registered.
   * @param {string} consumerId
   * @param {Partial<import('./types.js').ConsumerQuotaConfig>} config
   */
  setConsumerQuota(consumerId, config = {}) {
    const id = String(consumerId ?? '').trim().toLowerCase();
    if (!id) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'consumerId is required to set a consumer quota',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    if (config === null || typeof config !== 'object') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'config must be an object',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    const rpmLimit = config.rpmLimit ?? this.#consumerQuotas.get(id)?.rpmLimit;
    if (rpmLimit !== undefined && (rpmLimit !== Infinity && (!Number.isFinite(rpmLimit) || rpmLimit <= 0 || !Number.isInteger(rpmLimit)))) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'rpmLimit must be a positive integer or Infinity',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    if (config.burstLimit !== undefined && (!Number.isInteger(config.burstLimit) || config.burstLimit < 0)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'burstLimit must be a non-negative integer',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    if (config.priority !== undefined && (!Number.isInteger(config.priority) || config.priority < 0)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'priority must be a non-negative integer',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    const existing = this.#consumerQuotas.get(id) || { consumerId: id, rpmLimit: Infinity, burstLimit: 1000, priority: 99 };
    this.#consumerQuotas.set(id, { ...existing, ...config, consumerId: id });
  }

  /**
   * Whether the consumer has quota left in its 60s sliding window (AD-20).
   * Consumers with an Infinity rpmLimit (internal) always pass.
   * @param {string} consumerId
   * @returns {boolean}
   */
  canConsumerRequest(consumerId) {
    const id = this.#resolveConsumerId(consumerId);
    const quota = this.#consumerQuotas.get(id);
    if (!quota || quota.rpmLimit === Infinity) return true;
    const timestamps = this.#pruneConsumerWindow(id);
    return timestamps.length < quota.rpmLimit;
  }

  /**
   * Record a consumer request into its 60s sliding window (AD-20).
   * Never throws: unknown consumers are normalized to `internal`.
   * @param {string} consumerId
   */
  recordConsumerRequest(consumerId) {
    const id = this.#resolveConsumerId(consumerId);
    const timestamps = this.#pruneConsumerWindow(id);
    timestamps.push(Date.now());
    this.#consumerRequestTimestamps.set(id, timestamps);
  }

  /**
   * Observability snapshot for a single consumer (AD-20).
   * `burstLimit` never blocks — it only feeds `isThrottled` reporting.
   * @param {string} consumerId
   * @returns {import('./types.js').ConsumerStatus}
   */
  getConsumerStatus(consumerId) {
    const id = this.#resolveConsumerId(consumerId);
    const quota = this.#consumerQuotas.get(id) || { consumerId: id, rpmLimit: Infinity, burstLimit: 1000, priority: 99 };
    const usedInWindow = quota.rpmLimit === Infinity ? 0 : this.#pruneConsumerWindow(id).length;
    const remaining = Math.max(0, quota.rpmLimit - usedInWindow);
    // burstLimit is advisory for reporting only; per AC-4 it does not block.
    const isThrottled = quota.rpmLimit !== Infinity && usedInWindow >= quota.rpmLimit;
    const overBurst = quota.rpmLimit !== Infinity && usedInWindow >= quota.burstLimit;
    return {
      consumerId: id,
      rpmLimit: quota.rpmLimit,
      burstLimit: quota.burstLimit,
      priority: quota.priority,
      usedInWindow,
      remaining,
      isThrottled,
      overBurst,
    };
  }

  /**
   * Seconds until the oldest timestamp in the consumer's window expires
   * (+1s buffer, minimum 1s) — used for RateLimitError.retryAfter (AD-20).
   * @param {string} consumerId
   * @returns {number}
   */
  getConsumerRetryAfterSeconds(consumerId) {
    const id = this.#resolveConsumerId(consumerId);
    const timestamps = this.#pruneConsumerWindow(id);
    if (timestamps.length === 0) return 1;
    const now = Date.now();
    // Use the oldest timestamp explicitly to guard against clock skew or
    // out-of-order pushes. Math.min over the window is cheap for the typical
    // small window size.
    const oldest = Math.min(...timestamps);
    const ms = (oldest + 60_000 - now) + 1000;
    return Math.max(1, Math.ceil(ms / 1000));
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
    if (typeof state.healthyProxyCount === 'number' && Number.isFinite(state.healthyProxyCount)) {
      this.#healthyProxyCount = Math.max(0, state.healthyProxyCount);
    }
    if (typeof state.totalProxyCount === 'number' && Number.isFinite(state.totalProxyCount)) {
      this.#totalProxyCount = Math.max(0, state.totalProxyCount);
    }
    if (state.redisConsumerLag !== undefined) this.updateRedisConsumerLag(state.redisConsumerLag);
  }

  /**
   * Update Redis consumer group lag directly with hysteresis (10000 on, 5000 off).
   * @param {number} lag
   */
  updateRedisConsumerLag(lag) {
    this.#redisConsumerLag = Math.max(0, Number(lag) || 0);
    if (this.#redisConsumerLag > 10000) {
      if (!this.#isBackpressureActive) {
        console.warn('[AdaptiveRateGovernor] Redis stream consumer lag threshold exceeded:', {
          throttle_reason: 'redis_lag',
          reduced_to_percent: 25,
          redisConsumerLag: this.#redisConsumerLag,
        });
        this.#loggedThrottleThisSession = true;
      }
      this.#isBackpressureActive = true;
    } else if (this.#redisConsumerLag < 5000) {
      this.#isBackpressureActive = false;
      this.#loggedThrottleThisSession = false;
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
      if (!this.#loggedThrottleThisSession) {
        console.warn('[AdaptiveRateGovernor] Throttling bulk throughput due to Redis stream consumer lag:', {
          throttle_reason: 'redis_lag',
          reduced_to_percent: 25,
          redisConsumerLag: this.#redisConsumerLag,
          platform,
        });
        this.#loggedThrottleThisSession = true;
      }
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

  /**
   * @param {string} accountId
   * @param {string} [platform]
   * @returns {string | null}
   */
  getHibernationReason(accountId, platform) {
    const key = this.#resolveAccountId(accountId, platform);
    const now = Date.now();
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.until > now);
    const entry = this.#hibernatingAccounts.find((h) => h.accountId === key);
    return entry ? entry.reason : null;
  }

  /**
   * @param {string} accountId
   * @param {string} [platform]
   * @returns {number | null}
   */
  getHibernationUntil(accountId, platform) {
    const key = this.#resolveAccountId(accountId, platform);
    const now = Date.now();
    this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.until > now);
    const entry = this.#hibernatingAccounts.find((h) => h.accountId === key);
    return entry ? entry.until : null;
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

    // AD-20 dual-pool partition stats (via ProxyIpPool.getPoolStats()).
    const emptyPoolStats = {
      realtime: { total: 0, healthy: 0, quarantined: 0 },
      bulk: { total: 0, healthy: 0, quarantined: 0 },
      yieldedCount: 0,
    };
    const dualPool = this.#proxyPool && typeof this.#proxyPool.getPoolStats === 'function'
      ? this.#proxyPool.getPoolStats()
      : emptyPoolStats;

    // AD-20 per-consumer quota observability.
    /** @type {Record<string, import('./types.js').ConsumerStatus>} */
    const consumerQuotas = {};
    for (const id of this.#consumerQuotas.keys()) {
      consumerQuotas[id] = this.getConsumerStatus(id);
    }

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
      dualPool,
      consumerQuotas,
    };
  }
}

export const globalAdaptiveRateGovernor = new AdaptiveRateGovernor({ proxyPool: globalProxyPool });
