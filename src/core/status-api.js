// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Status API contract for governor and observability.
 * @author nich (@nichxbt)
 * @license MIT
 */

/** @typedef {import('./types.js').GovernorStatus} GovernorStatus */

export class StatusApi {
  /** @type {import('./adaptive-governor.js').AdaptiveRateGovernor | null} */
  #governor = null;

  /**
   * @param {Object} [deps]
   * @param {import('./adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   */
  constructor(deps = {}) {
    this.#governor = deps.governor || null;
  }

  /** @returns {GovernorStatus} */
  getGovernorStatus() {
    return this.#governor ? this.#governor.getStatus() : {
      healthyProxyCount: 0,
      totalProxyCount: 0,
      healthyProxyRatio: 0,
      currentReqPerSecond: 0,
      redisConsumerLag: 0,
      hibernatingAccounts: [],
      throttleLevel: 'normal',
    };
  }
}
