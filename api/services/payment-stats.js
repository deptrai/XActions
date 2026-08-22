// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Payment Statistics Service
 * 
 * In-memory payment statistics tracking for x402 revenue analytics.
 * Note: Use Redis/DB in production for persistence across restarts.
 * 
 * @author nichxbt
 */

/** @type {{ totalPayments: number; totalRevenue: number; byOperation: Record<string, number>; byHour: Record<string, number>; recentPayments: Record<string, unknown>[] }} */
const stats = {
  totalPayments: 0,
  totalRevenue: 0, // in USD cents
  byOperation: {},
  byHour: {},
  recentPayments: [] // last 100
};

// Dedup set — prevents double-counting when both x402.js onAfterSettle
// and webhooks.js record the same payment by txHash.
const seenTxHashes = new Set();

/**
 * Record a successful payment
 * @param {Record<string, unknown>} payment - Payment details
 */
export function recordPayment(payment) {
  const txKey = /** @type {string | null} */ (payment.paymentId || payment.txHash || null);
  if (txKey) {
    if (seenTxHashes.has(txKey)) {
      console.log(`⚠️  Duplicate payment ignored: ${txKey}`);
      return;
    }
    seenTxHashes.add(txKey);
    // Keep the Set bounded to the last 10 000 transactions
    if (seenTxHashes.size > 10_000) {
      seenTxHashes.delete(seenTxHashes.values().next().value);
    }
  }

  stats.totalPayments++;
  stats.totalRevenue += parseFloat((/** @type {string} */ (payment.price)).replace('$', '')) * 100;

  // By operation
  const op = /** @type {string} */ (payment.operation);
  stats.byOperation[op] = (stats.byOperation[op] || 0) + 1;
  
  // By hour
  const hour = new Date().toISOString().slice(0, 13);
  stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
  
  // Recent payments (keep last 100)
  stats.recentPayments.unshift({
    ...payment,
    timestamp: new Date().toISOString()
  });
  if (stats.recentPayments.length > 100) {
    stats.recentPayments.pop();
  }
}

/**
 * Get current payment statistics
 * @returns {Record<string, unknown>} Payment statistics including totals and breakdowns
 */
export function getStats() {
  return {
    ...stats,
    totalRevenueUSD: (stats.totalRevenue / 100).toFixed(2)
  };
}

/**
 * Reset statistics (useful for testing)
 */
export function resetStats() {
  stats.totalPayments = 0;
  stats.totalRevenue = 0;
  stats.byOperation = {};
  stats.byHour = {};
  stats.recentPayments = [];
  seenTxHashes.clear();
}

export default { recordPayment, getStats, resetStats };
