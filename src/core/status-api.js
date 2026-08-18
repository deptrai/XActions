// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Status API contract for governor and observability.
 * @author nich (@nichxbt)
 * @license MIT
 */

/** @typedef {import('./types.js').GovernorStatus} GovernorStatus */

export class StatusApi {
  /** @returns {GovernorStatus} */
  getGovernorStatus() {
    return {
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
