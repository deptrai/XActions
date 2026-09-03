// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Mastodon Scrapers
 * REST API-based scrapers for Mastodon (any instance)
 *
 * Uses the public Mastodon REST API with fetch. No Puppeteer needed.
 * Most public data requires no authentication.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license MIT
 */

// ============================================================================
// Client
// ============================================================================

const DEFAULT_INSTANCE = 'https://mastodon.social';

/**
 * @typedef {Object} MastodonClient
 * @property {string} instance
 * @property {string | null} accessToken
 */

/**
 * @typedef {Object} MastodonClientOptions
 * @property {string} [instance]
 * @property {string} [accessToken]
 */

/**
 * @typedef {Object} MastodonScrapeOptions
 * @property {number} [limit]
 * @property {boolean} [includeReplies]
 * @property {(progress: { scraped: number; limit: number }) => void} [onProgress]
 */

/**
 * @typedef {Object} MastodonApiOptions
 * @property {Record<string, string | number | boolean | undefined>} [params]
 * @property {string} [method]
 */

/**
 * Create a Mastodon API client
 *
 * @param {MastodonClientOptions} [options]
 * @returns {MastodonClient}
 */
export function createClient(options = {}) {
  const rawInstance = options.instance || DEFAULT_INSTANCE;
  const withScheme = /^https?:\/\//.test(rawInstance) ? rawInstance : `https://${rawInstance}`;
  const instance = withScheme.replace(/\/$/, '');
  return {
    instance,
    accessToken: options.accessToken || null,
  };
}

/**
 * Strip HTML tags and decode the entities Mastodon leaves behind.
 *
 * Mastodon serves bios and post bodies as HTML fragments. Removing the tags
 * without decoding entities leaves raw `&amp;`, `&quot;`, and `&#39;` in what
 * is supposed to be plain text, which then shows up verbatim in exports,
 * dashboards, and anything that cross-posts the result.
 *
 * @param {string | null | undefined} html
 * @returns {string | null} Plain text, or null when there was nothing to convert
 */
function toPlainText(html) {
  if (!html) return null;

  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Internal helper — make a Mastodon API request
 *
 * @param {MastodonClient} client
 * @param {string} path
 * @param {MastodonApiOptions} [options]
 * @returns {Promise<unknown>}
 */
async function api(client, path, options = {}) {
  const { params = {}, method = 'GET' } = options;

  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(/** @type {string | number | boolean} */ (v))}`)
    .join('&');

  const url = `${client.instance}/api/v1${path}${qs ? '?' + qs : ''}`;

  /** @type {Record<string, string>} */
  const headers = {};
  if (client.accessToken) {
    headers['Authorization'] = `Bearer ${client.accessToken}`;
  }

  const res = await fetch(url, { method, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mastodon API error (${res.status}): ${text}`);
  }
  return await res.json();
}

/**
 * Internal helper — look up a user by username
 * Returns the account object
 *
 * @param {MastodonClient} client
 * @param {string} username
 * @returns {Promise<Record<string, unknown>>}
 */
async function lookupAccount(client, username) {
  if (typeof username !== 'string' || !username.trim()) {
    throw new TypeError('Mastodon scrape requires a username (e.g. "mastodon" or "user@instance.social")');
  }
  // Strip leading @
  const handle = username.trim().replace(/^@/, '');

  // Try the v1 lookup endpoint first (Mastodon 3.4+)
  try {
    return /** @type {Record<string, unknown>} */ (
      await api(client, '/accounts/lookup', {
        params: { acct: handle },
      })
    );
  } catch {
    // Fallback: search for the user
    const results = /** @type {Record<string, unknown>[]} */ (
      await api(client, '/accounts/search', {
        params: { q: handle, limit: 5, resolve: true },
      })
    );

    const match = results.find(
      (a) =>
        /** @type {string} */ (a.acct).toLowerCase() === handle.toLowerCase() ||
        /** @type {string} */ (a.username).toLowerCase() === handle.toLowerCase()
    );

    if (!match) throw new Error(`User not found on ${client.instance}: ${username}`);
    return match;
  }
}

// ============================================================================
// Profile Scraper
// ============================================================================

/**
 * Scrape a Mastodon profile
 *
 * @param {MastodonClient} client - Mastodon client from createClient()
 * @param {string} username - Mastodon handle (e.g. user or user@instance.social)
 * @returns {Promise<Record<string, unknown>>} Normalized profile data
 */
export async function scrapeProfile(client, username) {
  if (!username) throw new TypeError('Mastodon scrapeProfile requires a username');
  const account = await lookupAccount(client, username);
  const a = /** @type {Record<string, unknown>} */ (account);

  return {
    name: /** @type {string | null} */ (a.display_name) || null,
    username: /** @type {string | null} */ (a.acct) || null,
    id: /** @type {string | null} */ (a.id) || null,
    bio: toPlainText(/** @type {string | null | undefined} */ (a.note)),
    avatar: /** @type {string | null} */ (a.avatar) || null,
    header: /** @type {string | null} */ (a.header) || null,
    followers: /** @type {number | null | undefined} */ (a.followers_count) ?? null,
    following: /** @type {number | null | undefined} */ (a.following_count) ?? null,
    posts: /** @type {number | null | undefined} */ (a.statuses_count) ?? null,
    joined: /** @type {string | null} */ (a.created_at) || null,
    url: /** @type {string | null} */ (a.url) || null,
    bot: /** @type {boolean} */ (a.bot) || false,
    locked: /** @type {boolean} */ (a.locked) || false,
    fields: (/** @type {Record<string, unknown>[]} */ (a.fields || [])).map((f) => ({
      name: /** @type {string} */ (f.name),
      value: toPlainText(/** @type {string | null | undefined} */ (f.value)) || '',
    })),
    platform: 'mastodon',
    instance: client.instance,
  };
}

// ============================================================================
// Followers Scraper
// ============================================================================

/**
 * Scrape followers for a Mastodon user
 *
 * @param {MastodonClient} client
 * @param {string} username
 * @param {MastodonScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function scrapeFollowers(client, username, options = {}) {
  if (!username) throw new TypeError('Mastodon scrapeFollowers requires a username');
  const limit = options.limit ?? 100;
  const onProgress = options.onProgress;

  const account = await lookupAccount(client, username);
  const accountId = /** @type {string} */ (account.id);
  const followers = [];
  /** @type {string | undefined} */
  let maxId;

  while (followers.length < limit) {
    const pageLimit = Math.min(80, limit - followers.length);
    /** @type {Record<string, string | number | boolean | undefined>} */
    const params = { limit: pageLimit };
    if (maxId) params.max_id = maxId;

    const data = /** @type {Record<string, unknown>[]} */ (
      await api(client, `/accounts/${accountId}/followers`, { params })
    );
    if (!data || data.length === 0) break;

    for (const f of data) {
      followers.push({
        username: /** @type {string} */ (f.acct),
        id: /** @type {string} */ (f.id),
        name: /** @type {string | null} */ (f.display_name) || null,
        bio: toPlainText(/** @type {string | null | undefined} */ (f.note)),
        avatar: /** @type {string | null} */ (f.avatar) || null,
        url: /** @type {string | null} */ (f.url) || null,
        bot: /** @type {boolean} */ (f.bot) || false,
        platform: 'mastodon',
      });
    }

    if (onProgress) {
      onProgress({ scraped: followers.length, limit });
    }

    maxId = /** @type {string} */ (data[data.length - 1]?.id);
    if (data.length < pageLimit) break;
  }

  return followers.slice(0, limit);
}

// ============================================================================
// Following Scraper
// ============================================================================

/**
 * Scrape accounts a Mastodon user is following
 *
 * @param {MastodonClient} client
 * @param {string} username
 * @param {MastodonScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function scrapeFollowing(client, username, options = {}) {
  if (!username) throw new TypeError('Mastodon scrapeFollowing requires a username');
  const limit = options.limit ?? 100;
  const onProgress = options.onProgress;

  const account = await lookupAccount(client, username);
  const accountId = /** @type {string} */ (account.id);
  const following = [];
  /** @type {string | undefined} */
  let maxId;

  while (following.length < limit) {
    const pageLimit = Math.min(80, limit - following.length);
    /** @type {Record<string, string | number | boolean | undefined>} */
    const params = { limit: pageLimit };
    if (maxId) params.max_id = maxId;

    const data = /** @type {Record<string, unknown>[]} */ (
      await api(client, `/accounts/${accountId}/following`, { params })
    );
    if (!data || data.length === 0) break;

    for (const f of data) {
      following.push({
        username: /** @type {string} */ (f.acct),
        id: /** @type {string} */ (f.id),
        name: /** @type {string | null} */ (f.display_name) || null,
        bio: toPlainText(/** @type {string | null | undefined} */ (f.note)),
        avatar: /** @type {string | null} */ (f.avatar) || null,
        url: /** @type {string | null} */ (f.url) || null,
        bot: /** @type {boolean} */ (f.bot) || false,
        platform: 'mastodon',
      });
    }

    if (onProgress) {
      onProgress({ scraped: following.length, limit });
    }

    maxId = /** @type {string} */ (data[data.length - 1]?.id);
    if (data.length < pageLimit) break;
  }

  return following.slice(0, limit);
}

// ============================================================================
// Posts (Toots) Scraper
// ============================================================================

/**
 * Scrape posts from a Mastodon user (equivalent of scrapeTweets)
 *
 * @param {MastodonClient} client
 * @param {string} username
 * @param {MastodonScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function scrapeTweets(client, username, options = {}) {
  if (!username) throw new TypeError('Mastodon scrapeTweets requires a username');
  const limit = options.limit ?? 50;
  const includeReplies = options.includeReplies ?? false;
  const onProgress = options.onProgress;

  const account = await lookupAccount(client, username);
  const accountId = /** @type {string} */ (account.id);
  const posts = [];
  /** @type {string | undefined} */
  let maxId;

  while (posts.length < limit) {
    const pageLimit = Math.min(40, limit - posts.length);
    /** @type {Record<string, string | number | boolean | undefined>} */
    const params = {
      limit: pageLimit,
      exclude_replies: !includeReplies,
      exclude_reblogs: false,
    };
    if (maxId) params.max_id = maxId;

    const data = /** @type {Record<string, unknown>[]} */ (
      await api(client, `/accounts/${accountId}/statuses`, { params })
    );
    if (!data || data.length === 0) break;

    for (const status of data) {
      posts.push(normalizeStatus(status, client.instance));
    }

    if (onProgress) {
      onProgress({ scraped: posts.length, limit });
    }

    maxId = /** @type {string} */ (data[data.length - 1]?.id);
    if (data.length < pageLimit) break;
  }

  return posts.slice(0, limit);
}

// ============================================================================
// Search Posts
// ============================================================================

/**
 * Search Mastodon posts by query
 *
 * @param {MastodonClient} client
 * @param {string} query
 * @param {MastodonScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function searchTweets(client, query, options = {}) {
  if (!query) throw new TypeError('Mastodon searchTweets requires a query');
  const limit = options.limit ?? 50;
  const onProgress = options.onProgress;

  // Use v2 search endpoint. Resolve requires auth; only enable with an access token.
  const qs = new URLSearchParams({
    q: query,
    type: 'statuses',
    limit: String(Math.min(40, limit)),
    resolve: client.accessToken ? 'true' : 'false',
  });

  const url = `${client.instance}/api/v2/search?${qs}`;
  /** @type {Record<string, string>} */
  const headers = {};
  if (client.accessToken) {
    headers['Authorization'] = `Bearer ${client.accessToken}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Mastodon search error (${res.status}): ${await res.text()}`);
  }
  const data = /** @type {Record<string, unknown>} */ (await res.json());

  const posts = (/** @type {Record<string, unknown>[]} */ (data.statuses || [])).map((s) =>
    normalizeStatus(s, client.instance)
  );

  if (onProgress) {
    onProgress({ scraped: posts.length, limit });
  }

  return posts.slice(0, limit);
}

// ============================================================================
// Hashtag Timeline
// ============================================================================

/**
 * Scrape posts from a hashtag timeline
 *
 * @param {MastodonClient} client
 * @param {string} hashtag
 * @param {MastodonScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function scrapeHashtag(client, hashtag, options = {}) {
  if (!hashtag) throw new TypeError('Mastodon scrapeHashtag requires a hashtag');
  const limit = options.limit ?? 50;
  const onProgress = options.onProgress;
  const tag = hashtag.replace(/^#/, '');

  const posts = [];
  /** @type {string | undefined} */
  let maxId;

  while (posts.length < limit) {
    const pageLimit = Math.min(40, limit - posts.length);
    /** @type {Record<string, string | number | boolean | undefined>} */
    const params = { limit: pageLimit };
    if (maxId) params.max_id = maxId;

    const data = /** @type {Record<string, unknown>[]} */ (
      await api(client, `/timelines/tag/${encodeURIComponent(tag)}`, { params })
    );
    if (!data || data.length === 0) break;

    for (const status of data) {
      posts.push(normalizeStatus(status, client.instance));
    }

    if (onProgress) {
      onProgress({ scraped: posts.length, limit });
    }

    maxId = /** @type {string} */ (data[data.length - 1]?.id);
    if (data.length < pageLimit) break;
  }

  return posts.slice(0, limit);
}

// ============================================================================
// Trending
// ============================================================================

/**
 * Scrape trending topics from a Mastodon instance
 *
 * @param {MastodonClient} client
 * @param {MastodonScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function scrapeTrending(client, options = {}) {
  const limit = options.limit ?? 20;

  // Trending tags
  const tags = /** @type {Record<string, unknown>[]} */ (
    await api(client, '/trends/tags', { params: { limit } })
  );

  return tags.map((t) => {
    const history = /** @type {Record<string, unknown>[]} */ (t.history || []);
    const first = /** @type {Record<string, unknown>} */ (history[0]);
    const name = /** @type {string} */ (t.name);
    return {
      topic: `#${name}`,
      posts: /** @type {string | number} */ (first?.uses) || '0',
      accounts: /** @type {string | number} */ (first?.accounts) || '0',
      url: /** @type {string | null} */ (t.url) || `${client.instance}/tags/${name}`,
      platform: 'mastodon',
    };
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize a Mastodon status to common post format
 *
 * @param {Record<string, unknown>} status
 * @param {string} instance
 * @returns {Record<string, unknown>}
 */
function normalizeStatus(status, instance) {
  const mediaAttachments = /** @type {Record<string, unknown>[]} */ (status.media_attachments || []);
  const account = /** @type {Record<string, unknown> | null | undefined} */ (status.account);

  const images = mediaAttachments
    .filter((m) => /** @type {string} */ (m.type) === 'image')
    .map((m) => /** @type {string} */ (m.url || m.preview_url));

  const hasVideo = mediaAttachments.some(
    (m) => /** @type {string} */ (m.type) === 'video' || /** @type {string} */ (m.type) === 'gifv'
  );

  return {
    id: status.id,
    text: toPlainText(/** @type {string | null | undefined} */ (status.content)),
    timestamp: /** @type {string | null} */ (status.created_at) || null,
    likes: /** @type {number | null | undefined} */ (status.favourites_count) ?? 0,
    reposts: /** @type {number | null | undefined} */ (status.reblogs_count) ?? 0,
    replies: /** @type {number | null | undefined} */ (status.replies_count) ?? 0,
    url: /** @type {string | null} */ (status.url) || null,
    author: account ? /** @type {string | null} */ (account.acct) || null : null,
    media: {
      images,
      hasVideo,
    },
    isRepost: !!status.reblog,
    sensitive: /** @type {boolean} */ (status.sensitive) || false,
    visibility: /** @type {string} */ (status.visibility) || 'public',
    platform: 'mastodon',
    instance,
  };
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  createClient,
  scrapeProfile,
  scrapeFollowers,
  scrapeFollowing,
  scrapeTweets,
  searchTweets,
  scrapeHashtag,
  scrapeTrending,
};
