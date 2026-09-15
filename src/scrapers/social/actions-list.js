// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared action discovery for MCP and CLI.
 *
 * Keeps the crawler instantiation and listActions() call in one place so the
 * CLI does not need to import the full MCP server stack.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { DESCRIPTORS } from '../index.js';

const CANONICAL_PLATFORMS = [
  'twitter',
  'bluesky',
  'mastodon',
  'facebook',
  'threads',
  'reddit',
  'medium',
  'instagram',
  'tiktok',
  'youtube',
  'zalo',
  'tiktokshop',
  'fnb',
  'healthcare',
  'ipvietnam',
  'automotive',
  'b2b_registry_extended',
  'linkedin',
  'batdongsan',
  'chotot',
  'shopee',
  'topcv',
  'vietnamworks',
  'masothue',
];

/** @type {Record<string, string>} — derived from DESCRIPTORS aliases, not a manual map */
const PLATFORM_ALIASES = Object.fromEntries(
  Object.values(DESCRIPTORS).flatMap((d) =>
    (d.aliases || []).map((alias) => [alias, d.aliases[0]])
  )
);

/** @type {Record<string, string>} */
const PLATFORM_CATEGORIES = {
  twitter: 'social',
  bluesky: 'social',
  mastodon: 'social',
  facebook: 'social',
  threads: 'social',
  reddit: 'social',
  medium: 'social',
  instagram: 'social',
  tiktok: 'social',
  youtube: 'social',
  zalo: 'social',
  tiktokshop: 'ecom',
  shopee: 'ecom',
  linkedin: 'recruitment',
  topcv: 'recruitment',
  vietnamworks: 'recruitment',
  batdongsan: 'realestate',
  chotot: 'realestate',
  masothue: 'procurement',
  b2b_registry_extended: 'procurement',
  automotive: 'vehicles',
  fnb: 'fnb',
  healthcare: 'healthcare',
  ipvietnam: 'legal',
};

/** @type {Record<string, string>} */
const CATEGORY_MAP = {
  b2b: 'procurement',
  procurement: 'procurement',
  automotive: 'vehicles',
  vehicles: 'vehicles',
  fnb_merchant: 'fnb',
  fnb: 'fnb',
  social: 'social',
  ecom: 'ecom',
  recruitment: 'recruitment',
  realestate: 'realestate',
  legal: 'legal',
  healthcare: 'healthcare',
};

/**
 * Return the list of available crawler actions, optionally filtered by platform.
 *
 * @param {Object} [options]
 * @param {string} [options.platform]
 * @param {string} [options.category]
 * @param {'summary' | 'full'} [options.detailLevel]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function executeActionListTool(options = {}) {
  const opts = options || {};
  const crawlerLoaders = [
    () => import("./twitter/crawler.js").then((m) => new m.TwitterCrawler()),
    () => import("./bluesky/crawler.js").then((m) => new m.BlueskyCrawler()),
    () => import("./mastodon/crawler.js").then((m) => new m.MastodonCrawler()),
    () => import("./facebook/crawler.js").then((m) => new m.FacebookCrawler()),
    () => import("./threads/crawler.js").then((m) => new m.ThreadsCrawler()),
    () => import("./reddit/crawler.js").then((m) => new m.RedditCrawler()),
    () => import("./medium/crawler.js").then((m) => new m.MediumCrawler()),
    () => import("./instagram/crawler.js").then((m) => new m.InstagramCrawler()),
    () => import("./tiktok/crawler.js").then((m) => new m.TikTokCrawler()),
    () => import("./youtube/crawler.js").then((m) => new m.YouTubeVNCrawler()),
    () => import("./zalo/crawler.js").then((m) => new m.ZaloCrawler()),
    () => import("../ecom/tiktok-shop/crawler.js").then((m) => new m.TikTokShopCrawler()),
    () => import("../fnb/merchant/crawler.js").then((m) => new m.FnbMerchantCrawler()),
    () => import("../healthcare/crawler.js").then((m) => new m.HealthcareCrawler()),
    () => import("../legal/ip-trademark/crawler.js").then((m) => new m.IpLegalCrawler()),
    () => import("../vehicles/automotive/crawler.js").then((m) => new m.AutomotiveCrawler()),
    () => import("../procurement/b2b-registry-extended/index.js").then((m) => new m.B2BRegistryExtendedCrawler()),
    () => import("../recruitment/linkedin/crawler.js").then((m) => new m.LinkedInCrawler()),
    () => import("../realestate/batdongsan/crawler.js").then((m) => new m.BatdongsanCrawler()),
    () => import("../realestate/chotot/crawler.js").then((m) => new m.ChototCrawler()),
    () => import("../ecom/shopee/crawler.js").then((m) => new m.ShopeeCrawler()),
    () => import("../recruitment/topcv/crawler.js").then((m) => new m.TopCvCrawler()),
    () => import("../recruitment/vietnamworks/crawler.js").then((m) => new m.VietnamWorksCrawler()),
    () => import("../procurement/masothue/crawler.js").then((m) => new m.MaSoThueCrawler()),
  ];

  const crawlers = [];
  for (const loader of crawlerLoaders) {
    try {
      const crawler = await loader();
      crawlers.push(crawler);
    } catch {
      // Gracefully skip platforms whose dependencies or modules are not present
    }
  }

  try {
    /** @type {Record<string, unknown>[]} */
    const allActions = [];

    for (const crawler of crawlers) {
      try {
        const platform = crawler.platform || crawler.name;
        const actions = crawler.listActions().map((desc) => ({ ...desc, platform }));
        allActions.push(...actions);
      } catch {
        // Skip any crawler whose listActions throws
      }
    }

    for (const action of allActions) {
      delete action.checkpointResolver;
      if (typeof action.platform === 'string') {
        action.category = action.category || PLATFORM_CATEGORIES[action.platform] || 'social';
      }
    }

    const loadedPlatforms = new Set(allActions.map((a) => a.platform));
    for (const canonical of CANONICAL_PLATFORMS) {
      if (!loadedPlatforms.has(canonical)) {
        allActions.push({
          platform: canonical,
          action: null,
          category: PLATFORM_CATEGORIES[canonical] || 'unknown',
          no_crawler: true,
          description: 'Platform registered in DESCRIPTORS but no Crawler class available',
        });
      }
    }

    let filtered = allActions;

    if (opts.platform && typeof opts.platform === "string") {
      const targetPlatform = opts.platform.toLowerCase();
      const canonicalTarget = PLATFORM_ALIASES[targetPlatform] || targetPlatform;
      filtered = filtered.filter(
        (a) => typeof a.platform === 'string' && (a.platform.toLowerCase() === targetPlatform || a.platform.toLowerCase() === canonicalTarget)
      );
    }

    if (opts.category && typeof opts.category === "string") {
      const targetCategory = opts.category.toLowerCase();
      const normalizedCategory = CATEGORY_MAP[targetCategory] || targetCategory;
      filtered = filtered.filter((a) => {
        const cat = typeof a.category === 'string' ? a.category.toLowerCase() : '';
        const normCat = CATEGORY_MAP[cat] || cat;
        return cat === targetCategory || normCat === normalizedCategory;
      });
    }

    if (opts.detailLevel === 'summary') {
      filtered = filtered.map(({ platform, action, description, requiredArgs, no_crawler, category }) => ({
        platform,
        action,
        description,
        requiredArgs: requiredArgs || [],
        no_crawler: no_crawler || false,
        category,
      }));
    }

    return filtered;
  } finally {
    for (const crawler of crawlers) {
      if (typeof crawler.cleanup === "function") {
        await crawler.cleanup().catch(() => {});
      }
    }
  }
}
