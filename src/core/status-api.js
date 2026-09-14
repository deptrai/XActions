// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Status API contract for governor and observability.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { globalAdaptiveRateGovernor } from './adaptive-governor.js';
import { globalSessionHealthOrchestrator, SessionHealthOrchestrator } from './session-health-orchestrator.js';

/** @typedef {import('./types.js').GovernorStatus} GovernorStatus */

export class StatusApi {
  /** @type {import('./adaptive-governor.js').AdaptiveRateGovernor | null} */
  #governor = null;
  /** @type {import('./session-health-orchestrator.js').SessionHealthOrchestrator | null} */
  #orchestrator = null;

  /**
   * @param {Object} [deps]
   * @param {import('./adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('./session-health-orchestrator.js').SessionHealthOrchestrator} [deps.orchestrator]
   */
  constructor(deps = {}) {
    this.#governor = deps.governor || null;
    this.#orchestrator = deps.orchestrator || globalSessionHealthOrchestrator;
  }

  /** @returns {GovernorStatus & { healthScores?: Record<string, number>, circuitBreakerStates?: Record<string, import('./session-health-orchestrator.js').CircuitBreakerState> }} */
  getGovernorStatus() {
    const health = this.#orchestrator ? this.#orchestrator.getStatus() : { healthScores: {}, circuitBreakerStates: {} };
    const base = this.#governor ? this.#governor.getStatus() : {
      healthyProxyCount: 0,
      totalProxyCount: 0,
      healthyProxyRatio: 0,
      currentReqPerSecond: 0,
      redisConsumerLag: 0,
      hibernatingAccounts: [],
      throttleLevel: 'normal',
      dualPool: {
        realtime: { total: 0, healthy: 0, quarantined: 0 },
        bulk: { total: 0, healthy: 0, quarantined: 0 },
        yieldedCount: 0,
      },
      consumerQuotas: {},
      platformDrift: {},
    };
    return {
      ...base,
      healthScores: health.healthScores,
      circuitBreakerStates: health.circuitBreakerStates,
    };
  }
}

export const globalStatusApi = new StatusApi({ governor: globalAdaptiveRateGovernor });
