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

/**
 * Return the list of available crawler actions, optionally filtered by platform.
 *
 * @param {Object} [options]
 * @param {string} [options.platform]
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

    if (opts.platform && typeof opts.platform === "string") {
      const targetPlatform = opts.platform.toLowerCase();
      return allActions.filter((a) => a.platform?.toLowerCase() === targetPlatform);
    }

    return allActions;
  } finally {
    for (const crawler of crawlers) {
      if (typeof crawler.cleanup === "function") {
        await crawler.cleanup().catch(() => {});
      }
    }
  }
}
