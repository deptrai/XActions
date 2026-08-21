// Copyright (c) 2024-2026 nich (@nichxbt). MIT License.
// src/premiumManager.js  
// Premium subscription feature management for X/Twitter
// by nichxbt

/**
 * Premium Manager - Check and manage Premium subscription features
 * 
 * Features:
 * - Check Premium tier (Basic/Premium/Premium+)
 * - List available features per tier
 * - Verification status
 * - Revenue sharing eligibility
 * - Pay-for-reach analysis (2026)
 */

/** @param {number} ms */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  premiumNav: 'a[href="/i/premium_sign_up"]',
  verificationBadge: '[data-testid="icon-verified"]',
  subscriptionInfo: '[data-testid="subscriptionInfo"]',
  premiumBanner: '[data-testid="premiumBanner"]',
};

/**
 * Tier feature definitions
 * @type {Record<string, Record<string, unknown>>}
 */
const TIER_FEATURES = {
  free: {
    tier: 'Free',
    price: '$0/mo',
    features: {
      postLength: 280,
      videoLength: '140s',
      adReduction: 'None',
      verification: false,
      editPost: false,
      scheduling: false,
      bookmarkFolders: false,
      formatting: false,
      revenueShare: false,
      articles: false,
      radarSearch: false,
      grokLevel: 'Basic (~10 queries/day)',
      replyBoost: 'None',
    },
  },
  basic: {
    tier: 'Basic',
    price: '$3/mo',
    features: {
      postLength: 280,
      videoLength: '140s',
      adReduction: '50% fewer',
      verification: false,
      editPost: false,
      scheduling: false,
      bookmarkFolders: false,
      formatting: false,
      revenueShare: false,
      articles: false,
      radarSearch: false,
      grokLevel: 'More queries',
      replyBoost: 'Small',
    },
  },
  premium: {
    tier: 'Premium',
    price: '$8/mo',
    features: {
      postLength: 25000,
      videoLength: '60min',
      adReduction: '50% fewer',
      verification: true,
      editPost: true,
      scheduling: true,
      bookmarkFolders: true,
      formatting: true,
      revenueShare: true,
      articles: false,
      radarSearch: false,
      grokLevel: 'Higher (~100 queries/day)',
      replyBoost: 'Medium',
    },
  },
  'premium+': {
    tier: 'Premium+',
    price: '$16/mo',
    features: {
      postLength: 25000,
      videoLength: '3hr',
      adReduction: 'No ads',
      verification: true,
      editPost: true,
      scheduling: true,
      bookmarkFolders: true,
      formatting: true,
      revenueShare: true,
      articles: true,
      radarSearch: true,
      grokLevel: 'Highest (unlimited)',
      replyBoost: 'Largest',
    },
  },
  supergrok: {
    tier: 'SuperGrok',
    price: '$60/mo (separate xAI subscription)',
    features: {
      unlimited_grok: true,
      unlimited_agents: true,
      dedicated_apps: 'MacOS/iOS',
      project_org: true,
      advanced_ai: true,
    },
  },
};

/**
 * Check a user's Premium tier
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @returns {Promise<Record<string, unknown>>}
 */
export async function checkPremiumStatus(page, username) {
  await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
  await sleep(2000);

  const status = /** @type {Record<string, unknown>} */ (await page.evaluate(( /** @type {Record<string, string>} */ sel) => {
    const isVerified = !!document.querySelector(sel.verificationBadge);
    const badges = document.querySelectorAll('svg[data-testid]');
    let badgeType = 'none';

    badges.forEach(badge => {
      const testId = badge.getAttribute('data-testid');
      if (testId?.includes('verified')) badgeType = 'blue';
      if (testId?.includes('verifiedOrg')) badgeType = 'gold';
    });

    return { isVerified, badgeType };
  }, SELECTORS));

  // Infer tier from badge
  let inferredTier = 'free';
  if ((/** @type {string} */ (status.badgeType)) === 'gold') inferredTier = 'organization';
  else if (status.isVerified) inferredTier = 'premium_or_higher';

  return {
    username,
    ...status,
    inferredTier,
    note: 'Exact tier detection requires account owner access',
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Get features available for a tier
 * @param {string} tier - 'free', 'basic', 'premium', 'premium+', 'supergrok'
 * @returns {Record<string, unknown>}
 */
export function getTierFeatures(tier) {
  const normalized = tier.toLowerCase().replace(/\s+/g, '');
  return TIER_FEATURES[normalized] || { error: `Unknown tier: ${tier}` };
}

/**
 * Compare two tiers
 * @param {string} tier1
 * @param {string} tier2
 * @returns {Record<string, unknown>}
 */
export function compareTiers(tier1, tier2) {
  const t1 = getTierFeatures(tier1);
  const t2 = getTierFeatures(tier2);

  if (t1.error || t2.error) {
    return { error: t1.error || t2.error };
  }

  /** @type {Record<string, unknown>} */
  const comparison = {};
  const t1Features = /** @type {Record<string, unknown>} */ (t1.features || {});
  const t2Features = /** @type {Record<string, unknown>} */ (t2.features || {});
  const allFeatures = new Set([
    ...Object.keys(t1Features),
    ...Object.keys(t2Features),
  ]);

  const t1Tier = /** @type {string} */ (t1.tier);
  const t2Tier = /** @type {string} */ (t2.tier);

  for (const feature of allFeatures) {
    comparison[feature] = {
      [t1Tier]: t1Features[feature] ?? 'N/A',
      [t2Tier]: t2Features[feature] ?? 'N/A',
    };
  }

  return { comparison, tiers: [t1Tier, t2Tier] };
}

/**
 * Check revenue sharing eligibility
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @returns {Promise<Record<string, unknown>>}
 */
export async function checkRevenueEligibility(page, username) {
  const profile = /** @type {Record<string, unknown>} */ (await page.evaluate(() => {
    const followers = document.querySelector('a[href$="/followers"] span')?.textContent || '0';
    return { followers };
  }));

  const followerCount = parseInt((/** @type {string} */ (profile.followers)).replace(/[,K.M]/g, '')) || 0;

  return {
    username,
    followers: profile.followers,
    meetsFollowerMin: followerCount >= 500,
    requirements: {
      minFollowers: '500+',
      minImpressions: '5M+ in last 3 months',
      premiumRequired: true,
      note: 'Must have Premium ($8/mo) or higher',
    },
    note: 'Impression data requires account owner access to verify',
  };
}

export default {
  checkPremiumStatus,
  getTierFeatures,
  compareTiers,
  checkRevenueEligibility,
  TIER_FEATURES,
  SELECTORS,
};
