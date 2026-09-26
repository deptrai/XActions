// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Gateway Metrics & Ring Buffer Service — Story 50.4 (Epic 50 — Public Scrape Gateway).
 *
 * Maintains an in-memory circular ring buffer of the last 1000 gateway calls
 * to power the operator observability dashboard (`GET /api/admin/gateway/metrics`
 * and `/gateway/monitor/`).
 *
 * Thread-safe, bounded, zero memory leak.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

const MAX_RING_BUFFER_SIZE = 1000;

/**
 * @typedef {Object} GatewayCallRecord
 * @property {number} timestamp - Unix epoch ms
 * @property {string} requestId - Trace ID
 * @property {string} consumerId - Effective consumer ID (e.g. 'jev', 'internal', 'anonymous')
 * @property {string} [consumerType] - 'internal' | 'named' | 'anonymous' | 'x402'
 * @property {string} platform - Target platform
 * @property {string} action - Target action
 * @property {'sync' | 'async'} mode - Executed mode
 * @property {number} durationMs - Execution time in ms
 * @property {number} status - HTTP status code
 * @property {string} [degradedReason] - Closed degrade enum when 202 degraded
 * @property {string} [errorKind] - C-10 error.kind when error
 */

/** @type {GatewayCallRecord[]} */
let ringBuffer = [];
let ringIndex = 0;
let isFull = false;

/**
 * Record a gateway call in the ring buffer.
 * @param {GatewayCallRecord} record
 */
export function recordGatewayCall(record) {
  if (!record || typeof record !== 'object') return;
  const entry = {
    timestamp: record.timestamp || Date.now(),
    requestId: record.requestId || 'unknown',
    consumerId: record.consumerId || 'anonymous',
    consumerType: record.consumerType || (
      record.consumerId === 'internal' ? 'internal' :
      record.consumerId === 'anonymous' ? 'anonymous' : 'named'
    ),
    platform: record.platform || 'unknown',
    action: record.action || 'unknown',
    mode: record.mode === 'sync' ? 'sync' : 'async',
    durationMs: typeof record.durationMs === 'number' && Number.isFinite(record.durationMs) ? Math.max(0, record.durationMs) : 0,
    status: typeof record.status === 'number' ? record.status : 200,
    degradedReason: record.degradedReason,
    errorKind: record.errorKind,
  };

  if (!isFull) {
    ringBuffer.push(entry);
    if (ringBuffer.length >= MAX_RING_BUFFER_SIZE) {
      isFull = true;
      ringIndex = 0;
    }
  } else {
    ringBuffer[ringIndex] = entry;
    ringIndex = (ringIndex + 1) % MAX_RING_BUFFER_SIZE;
  }
}

/**
 * Get all records from the ring buffer in chronological order.
 * @returns {GatewayCallRecord[]}
 */
export function getRecentCalls() {
  if (!isFull) {
    return [...ringBuffer];
  }
  return [
    ...ringBuffer.slice(ringIndex),
    ...ringBuffer.slice(0, ringIndex),
  ];
}

/**
 * Lookup a specific call trace by requestId.
 * @param {string} requestId
 * @returns {GatewayCallRecord | null}
 */
export function getCallTrace(requestId) {
  if (!requestId || typeof requestId !== 'string') return null;
  const calls = getRecentCalls();
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].requestId === requestId) {
      return calls[i];
    }
  }
  return null;
}

/**
 * Calculate percentiles for an array of numbers.
 * @param {number[]} values
 * @returns {{ p50: number, p95: number, p99: number }}
 */
function calculatePercentiles(values) {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const getP = (p) => {
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * (p / 100)));
    return sorted[idx];
  };
  return {
    p50: getP(50),
    p95: getP(95),
    p99: getP(99),
  };
}

/**
 * Compile aggregate metrics summary for the dashboard.
 * @returns {Record<string, unknown>}
 */
export function getMetricsSummary() {
  const calls = getRecentCalls();
  const totalCalls = calls.length;

  const trafficSplit = {
    internal: 0,
    named: 0,
    anonymous: 0,
    x402: 0,
  };

  const degradeReasons = {
    upstream_timeout: 0,
    cf_challenge: 0,
    upstream_rate_limit: 0,
    queue_fallback: 0,
  };

  /** @type {Record<string, number[]>} */
  const latenciesByPlatform = {};
  /** @type {Record<string, { total: number, errors: number, last429: number | null }>} */
  const platformStats = {};
  /** @type {Record<string, { total: number, count429: number }>} */
  const consumerStats = {};

  let totalDegraded = 0;
  let totalErrors = 0;
  let total429 = 0;

  for (const call of calls) {
    // Traffic split
    if (call.consumerType && trafficSplit[call.consumerType] !== undefined) {
      trafficSplit[call.consumerType]++;
    } else {
      trafficSplit.anonymous++;
    }

    // Platform latency tracking
    if (!latenciesByPlatform[call.platform]) latenciesByPlatform[call.platform] = [];
    latenciesByPlatform[call.platform].push(call.durationMs);

    if (!platformStats[call.platform]) {
      platformStats[call.platform] = { total: 0, errors: 0, last429: null };
    }
    platformStats[call.platform].total++;

    // Consumer stats
    const cKey = `${call.consumerId}:${call.platform}:${call.action}`;
    if (!consumerStats[cKey]) {
      consumerStats[cKey] = { total: 0, count429: 0 };
    }
    consumerStats[cKey].total++;

    // Status counts
    if (call.status === 429) {
      total429++;
      consumerStats[cKey].count429++;
      platformStats[call.platform].last429 = call.timestamp;
    }
    if (call.status >= 400 && call.status !== 429) {
      totalErrors++;
      platformStats[call.platform].errors++;
    }

    // Degrade reasons
    if (call.degradedReason && degradeReasons[call.degradedReason] !== undefined) {
      degradeReasons[call.degradedReason]++;
      totalDegraded++;
    }
  }

  // Latency percentiles per platform
  /** @type {Record<string, { p50: number, p95: number, p99: number, errorRate: number, last429: number | null }>} */
  const upstreamHealth = {};
  for (const [platform, durations] of Object.entries(latenciesByPlatform)) {
    const p = calculatePercentiles(durations);
    const stats = platformStats[platform];
    upstreamHealth[platform] = {
      ...p,
      errorRate: stats.total > 0 ? Number((stats.errors / stats.total).toFixed(4)) : 0,
      last429: stats.last429,
    };
  }

  const degradeRate = totalCalls > 0 ? Number((totalDegraded / totalCalls).toFixed(4)) : 0;

  return {
    totalCalls,
    totalErrors,
    total429,
    degradeRate,
    degradeReasons,
    trafficSplit,
    upstreamHealth,
    consumerUsage: Object.entries(consumerStats).map(([key, data]) => {
      const [consumer_id, platform, action] = key.split(':');
      return {
        consumer_id,
        platform,
        action,
        totalCalls: data.total,
        count429: data.count429,
      };
    }),
    recentCalls: calls.slice(-50).reverse(), // Last 50 calls newest-first
  };
}

/**
 * Reset ring buffer state (for test isolation).
 */
export function _resetMetrics() {
  ringBuffer = [];
  ringIndex = 0;
  isFull = false;
}
