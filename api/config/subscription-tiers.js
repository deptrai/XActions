// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Subscription Tier Configuration
 * Defines pricing, limits, and feature access for each tier.
 *
 * @author nichxbt
 */

/** @type {Record<string, Record<string, unknown>>} */
export const TIERS = {
  free: {
    name: 'Free',
    price: 0,
    stripePriceId: null,
    limits: {
      apiCallsPerDay: 50,
      scrapesPerDay: 10,
      automationsPerDay: 5,
      monitoredAccounts: 0,
      exportFormats: ['json'],
      multiAccount: false,
    },
    features: {
      localCli: true,
      localMcp: true,
      hostedApi: true,
      continuousMonitoring: false,
      advancedAnalytics: false,
      prioritySupport: false,
      whiteLabel: false,
    },
  },
  pro: {
    name: 'Pro',
    price: 19,
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID,
    limits: {
      apiCallsPerDay: 1000,
      scrapesPerDay: 500,
      automationsPerDay: 100,
      monitoredAccounts: 3,
      exportFormats: ['json', 'csv', 'xlsx'],
      multiAccount: false,
    },
    features: {
      localCli: true,
      localMcp: true,
      hostedApi: true,
      continuousMonitoring: true,
      advancedAnalytics: true,
      prioritySupport: false,
      whiteLabel: false,
    },
  },
  business: {
    name: 'Business',
    price: 49,
    stripePriceId: process.env.STRIPE_BUSINESS_PRICE_ID,
    limits: {
      apiCallsPerDay: 10000,
      scrapesPerDay: -1, // unlimited
      automationsPerDay: -1,
      monitoredAccounts: 25,
      exportFormats: ['json', 'csv', 'xlsx', 'google-sheets'],
      multiAccount: true,
      maxAccounts: 5,
    },
    features: {
      localCli: true,
      localMcp: true,
      hostedApi: true,
      continuousMonitoring: true,
      advancedAnalytics: true,
      prioritySupport: true,
      whiteLabel: false,
    },
  },
  enterprise: {
    name: 'Enterprise',
    price: null, // custom pricing
    stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
    limits: {
      apiCallsPerDay: -1,
      scrapesPerDay: -1,
      automationsPerDay: -1,
      monitoredAccounts: -1,
      exportFormats: ['json', 'csv', 'xlsx', 'google-sheets'],
      multiAccount: true,
      maxAccounts: -1,
    },
    features: {
      localCli: true,
      localMcp: true,
      hostedApi: true,
      continuousMonitoring: true,
      advancedAnalytics: true,
      prioritySupport: true,
      whiteLabel: true,
    },
  },
};

// Tier hierarchy for comparison (higher = more access)
/** @type {Record<string, number>} */
const TIER_RANK = { free: 0, pro: 1, business: 2, enterprise: 3 };

/**
 * Check if a tier meets or exceeds a required tier level
 * @param {string} userTier
 * @param {string} requiredTier
 */
export function tierMeetsRequirement(userTier, requiredTier) {
  return (TIER_RANK[userTier] ?? 0) >= (TIER_RANK[requiredTier] ?? 0);
}

/**
 * Get tier config by name, defaults to free
 * @param {string} tierName
 * @returns {Record<string, unknown>}
 */
export function getTier(tierName) {
  return /** @type {Record<string, unknown>} */ (TIERS[tierName] || TIERS.free);
}

/**
 * Check if a limit is exceeded (-1 = unlimited)
 * @param {number} limit
 * @param {number} current
 */
export function isWithinLimit(limit, current) {
  if (limit === -1) return true;
  return current < limit;
}
