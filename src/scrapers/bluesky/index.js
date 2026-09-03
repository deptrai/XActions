// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Bluesky Scrapers
 * AT Protocol-based scrapers for Bluesky (bsky.social)
 *
 * Uses the official @atproto/api package. No Puppeteer needed.
 * Public data requires no authentication.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license MIT
 */

// ============================================================================
// AT Protocol Client
// ============================================================================

const DEFAULT_SERVICE = 'https://public.api.bsky.app';

/**
 * @typedef {Object} BlueskyAgentOptions
 * @property {string} [service]
 * @property {string} [identifier]
 * @property {string} [password]
 */

/**
 * @typedef {Object} BlueskySdkClient
 * @property {'sdk'} type
 * @property {import('@atproto/api').BskyAgent} agent
 */

/**
 * @typedef {Object} BlueskyFetchClient
 * @property {'fetch'} type
 * @property {string} service
 * @property {string} [identifier]
 * @property {string} [password]
 * @property {string} [accessJwt]
 */

/** @typedef {BlueskySdkClient | BlueskyFetchClient} BlueskyClient */

/**
 * @typedef {Object} BlueskyScrapeOptions
 * @property {number} [limit]
 * @property {(progress: { scraped: number; limit: number }) => void} [onProgress]
 */

/**
 * Create a Bluesky API agent
 * Uses @atproto/api if installed, otherwise falls back to fetch-based client.
 *
 * @param {BlueskyAgentOptions} [options]
 * @returns {Promise<BlueskyClient>}
 */
export async function createAgent(options = {}) {
  const service = options.service || DEFAULT_SERVICE;

  try {
    const { BskyAgent } = await import('@atproto/api');
    const agent = new BskyAgent({ service });

    if (options.identifier && options.password) {
      await agent.login({
        identifier: options.identifier,
        password: options.password,
      });
    }

    return { agent, type: 'sdk' };
  } catch {
    // Fallback to fetch-based client when @atproto/api is not installed
    const fetchClient = {
      service,
      identifier: options.identifier,
      password: options.password,
      type: 'fetch',
    };

    // Authenticate with app-password for endpoints that require auth (e.g. search)
    if (options.identifier && options.password) {
      try {
        const session = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            identifier: options.identifier,
            password: options.password,
          }),
        }).then((r) => (r.ok ? r.json() : null));
        if (session?.accessJwt) {
          fetchClient.accessJwt = session.accessJwt;
        }
      } catch {
        // Auth is best-effort; callers surface actionable errors when endpoints require it.
      }
    }

    return fetchClient;
  }
}

/**
 * Internal helper — resolve a Bluesky handle to a DID
 *
 * @param {BlueskyClient} client
 * @param {string} handle
 * @returns {Promise<string>}
 */
async function resolveHandle(client, handle) {
  if (handle.startsWith('did:')) return handle;

  if (client.type === 'sdk') {
    const res = await client.agent.resolveHandle({ handle });
    return res.data.did;
  }

  const url = `${client.service}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to resolve handle: ${handle}`);
  const data = /** @type {Record<string, unknown>} */ (await res.json());
  return /** @type {string} */ (data.did);
}

/**
 * Internal helper — call an XRPC method
 *
 * @param {BlueskyClient} client
 * @param {string} nsid
 * @param {Record<string, string | number | undefined>} [params]
 * @returns {Promise<Record<string, unknown>>}
 */
async function xrpc(client, nsid, params = {}) {
  if (client.type === 'sdk') {
    // Walk the namespace (app.bsky.actor.getProfile) keeping the owner of the
    // final property. The method must be invoked with that owner as `this`:
    // @atproto/api's generated namespaces read `this._client` internally, so a
    // detached `method(params)` call threw
    // "Cannot read properties of undefined (reading '_client')" for every
    // Bluesky scrape.
    const path = nsid.split('.');
    const name = /** @type {string} */ (path.pop());
    let owner = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (client.agent.api));
    for (const key of path) {
      owner = /** @type {Record<string, unknown>} */ (owner[key]);
      if (!owner) break;
    }

    if (owner && typeof owner[name] === 'function') {
      const method = /** @type {(p: Record<string, string | number | undefined>) => Promise<{ data: Record<string, unknown> }>} */ (owner[name]);
      const res = await method.call(owner, params);
      return res.data;
    }

    // Fallback to generic call
    const res = await client.agent.api.app.bsky.actor.getProfile(
      /** @type {import('@atproto/api').AppBskyActorGetProfile.QueryParams} */ (/** @type {unknown} */ (params))
    );
    return /** @type {Record<string, unknown>} */ (res.data);
  }

  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(/** @type {string | number} */ (v))}`)
    .join('&');

  const url = `${client.service}/xrpc/${nsid}${qs ? '?' + qs : ''}`;
  /** @type {Record<string, string>} */
  const headers = {};
  if (client.type === 'fetch' && client.accessJwt) {
    headers['Authorization'] = `Bearer ${client.accessJwt}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bluesky API error (${res.status}): ${text}`);
  }
  return /** @type {Record<string, unknown>} */ (await res.json());
}

// ============================================================================
// Profile Scraper
// ============================================================================

/**
 * Scrape a Bluesky profile
 *
 * @param {BlueskyClient} client - Bluesky agent from createAgent()
 * @param {string} username - Bluesky handle (e.g. user.bsky.social) or DID
 * @returns {Promise<Record<string, unknown>>} Normalized profile data
 */
export async function scrapeProfile(client, username) {
  const handle = username.replace(/^@/, '');

  const data = await xrpc(client, 'app.bsky.actor.getProfile', { actor: handle });

  return {
    name: /** @type {string | null} */ (data.displayName) || null,
    username: /** @type {string | null} */ (data.handle) || null,
    did: /** @type {string | null} */ (data.did) || null,
    bio: /** @type {string | null} */ (data.description) || null,
    avatar: /** @type {string | null} */ (data.avatar) || null,
    banner: /** @type {string | null} */ (data.banner) || null,
    followers: /** @type {number | null | undefined} */ (data.followersCount) ?? null,
    following: /** @type {number | null | undefined} */ (data.followsCount) ?? null,
    posts: /** @type {number | null | undefined} */ (data.postsCount) ?? null,
    joined: /** @type {string | null} */ (data.createdAt) || null,
    labels: (/** @type {Record<string, unknown>[]} */ (data.labels || [])).map(
      (l) => /** @type {string} */ (l.val)
    ),
    platform: 'bluesky',
  };
}

// ============================================================================
// Followers Scraper
// ============================================================================

/**
 * Scrape followers for a Bluesky user
 *
 * @param {BlueskyClient} client - Bluesky agent
 * @param {string} username - Bluesky handle
 * @param {BlueskyScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>} List of follower objects
 */
export async function scrapeFollowers(client, username, options = {}) {
  const limit = options.limit ?? 100;
  const onProgress = options.onProgress;
  const handle = username.replace(/^@/, '');

  const followers = [];
  /** @type {string | undefined} */
  let cursor;

  while (followers.length < limit) {
    const pageLimit = Math.min(100, limit - followers.length);
    const data = await xrpc(client, 'app.bsky.graph.getFollowers', {
      actor: handle,
      limit: pageLimit,
      cursor,
    });

    const page = /** @type {Record<string, unknown>[]} */ (data.followers || []);
    if (page.length === 0) break;

    for (const f of page) {
      followers.push({
        username: /** @type {string} */ (f.handle),
        did: /** @type {string} */ (f.did),
        name: /** @type {string | null} */ (f.displayName) || null,
        bio: /** @type {string | null} */ (f.description) || null,
        avatar: /** @type {string | null} */ (f.avatar) || null,
        platform: 'bluesky',
      });
    }

    if (onProgress) {
      onProgress({ scraped: followers.length, limit });
    }

    cursor = /** @type {string | undefined} */ (data.cursor);
    if (!cursor) break;
  }

  return followers.slice(0, limit);
}

// ============================================================================
// Following Scraper
// ============================================================================

/**
 * Scrape accounts a user is following on Bluesky
 *
 * @param {BlueskyClient} client
 * @param {string} username
 * @param {BlueskyScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function scrapeFollowing(client, username, options = {}) {
  const limit = options.limit ?? 100;
  const onProgress = options.onProgress;
  const handle = username.replace(/^@/, '');

  const following = [];
  /** @type {string | undefined} */
  let cursor;

  while (following.length < limit) {
    const pageLimit = Math.min(100, limit - following.length);
    const data = await xrpc(client, 'app.bsky.graph.getFollows', {
      actor: handle,
      limit: pageLimit,
      cursor,
    });

    const page = /** @type {Record<string, unknown>[]} */ (data.follows || []);
    if (page.length === 0) break;

    for (const f of page) {
      following.push({
        username: /** @type {string} */ (f.handle),
        did: /** @type {string} */ (f.did),
        name: /** @type {string | null} */ (f.displayName) || null,
        bio: /** @type {string | null} */ (f.description) || null,
        avatar: /** @type {string | null} */ (f.avatar) || null,
        platform: 'bluesky',
      });
    }

    if (onProgress) {
      onProgress({ scraped: following.length, limit });
    }

    cursor = /** @type {string | undefined} */ (data.cursor);
    if (!cursor) break;
  }

  return following.slice(0, limit);
}

// ============================================================================
// Posts Scraper (equivalent of tweets)
// ============================================================================

/**
 * Scrape posts from a Bluesky user's feed
 *
 * @param {BlueskyClient} client
 * @param {string} username
 * @param {BlueskyScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function scrapeTweets(client, username, options = {}) {
  const limit = options.limit ?? 50;
  const onProgress = options.onProgress;
  const handle = username.replace(/^@/, '');

  const did = await resolveHandle(client, handle);
  const posts = [];
  /** @type {string | undefined} */
  let cursor;

  while (posts.length < limit) {
    const pageLimit = Math.min(100, limit - posts.length);
    const data = await xrpc(client, 'app.bsky.feed.getAuthorFeed', {
      actor: did,
      limit: pageLimit,
      cursor,
    });

    const feed = /** @type {Record<string, unknown>[]} */ (data.feed || []);
    if (feed.length === 0) break;

    for (const item of feed) {
      const post = /** @type {Record<string, unknown>} */ (item.post);
      const record = /** @type {Record<string, unknown>} */ (post.record || {});
      const author = /** @type {Record<string, unknown>} */ (post.author);
      const embed = /** @type {Record<string, unknown> | undefined} */ (record.embed);
      const postUri = /** @type {string | undefined} */ (post.uri);

      posts.push({
        id: postUri || null,
        text: /** @type {string | null} */ (record.text) || null,
        timestamp: /** @type {string | null} */ (record.createdAt) || null,
        likes: /** @type {number | null | undefined} */ (post.likeCount) ?? 0,
        reposts: /** @type {number | null | undefined} */ (post.repostCount) ?? 0,
        replies: /** @type {number | null | undefined} */ (post.replyCount) ?? 0,
        url: postUri
          ? `https://bsky.app/profile/${/** @type {string | undefined} */ (author?.handle)}/post/${postUri.split('/').pop()}`
          : null,
        author: /** @type {string | null} */ (author?.handle) || null,
        media: {
          images: (/** @type {Record<string, unknown>[]} */ (embed?.images || [])).map((img) => {
            const image = /** @type {Record<string, unknown> | undefined} */ (img.image);
            const ref = /** @type {Record<string, unknown> | undefined} */ (image?.ref);
            const $link = /** @type {string | undefined} */ (ref?.$link);
            return $link
              ? `https://cdn.bsky.app/img/feed_thumbnail/plain/${/** @type {string | undefined} */ (author?.did)}/${$link}@jpeg`
              : null;
          }).filter(Boolean),
          hasVideo: false,
        },
        isRepost: !!item.reason,
        platform: 'bluesky',
      });
    }

    if (onProgress) {
      onProgress({ scraped: posts.length, limit });
    }

    cursor = /** @type {string | undefined} */ (data.cursor);
    if (!cursor) break;
  }

  return posts.slice(0, limit);
}

// ============================================================================
// Search Posts
// ============================================================================

/**
 * Search Bluesky posts by query
 *
 * @param {BlueskyClient} client
 * @param {string} query
 * @param {BlueskyScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function searchTweets(client, query, options = {}) {
  const limit = options.limit ?? 50;
  const onProgress = options.onProgress;
  const posts = [];
  /** @type {string | undefined} */
  let cursor;

  // app.bsky.feed.searchPosts requires authentication — auto-login when
  // credentials are supplied, otherwise surface a clear actionable error.
  let effectiveClient = client;
  if (client.type === 'fetch' && options.identifier && options.password) {
    effectiveClient = /** @type {any} */ (await createAgent({
      service: client.service,
      identifier: options.identifier,
      password: options.password,
    }));
  } else if (client.type === 'fetch') {
    try {
      await xrpc(client, 'app.bsky.feed.searchPosts', { q: query, limit: 1 });
    } catch (err) {
      const is403 = /\(403\)/.test(String(err?.message || err));
      if (is403) {
        throw new Error(
          'Bluesky search requires authentication. Pass { identifier, password } (app-password) ' +
          'to createAgent() or as options to searchTweets().'
        );
      }
      throw err;
    }
  }

  while (posts.length < limit) {
    const pageLimit = Math.min(25, limit - posts.length);
    const data = await xrpc(effectiveClient, 'app.bsky.feed.searchPosts', {
      q: query,
      limit: pageLimit,
      cursor,
    });

    const page = /** @type {Record<string, unknown>[]} */ (data.posts || []);
    if (page.length === 0) break;

    for (const post of page) {
      const record = /** @type {Record<string, unknown>} */ (post.record || {});
      const author = /** @type {Record<string, unknown>} */ (post.author);
      const postUri = /** @type {string | undefined} */ (post.uri);

      posts.push({
        id: postUri || null,
        text: /** @type {string | null} */ (record.text) || null,
        author: /** @type {string | null} */ (author?.handle) || null,
        timestamp: /** @type {string | null} */ (record.createdAt) || null,
        likes: /** @type {number | null | undefined} */ (post.likeCount) ?? 0,
        reposts: /** @type {number | null | undefined} */ (post.repostCount) ?? 0,
        url: postUri
          ? `https://bsky.app/profile/${/** @type {string | undefined} */ (author?.handle)}/post/${postUri.split('/').pop()}`
          : null,
        platform: 'bluesky',
      });
    }

    if (onProgress) {
      onProgress({ scraped: posts.length, limit });
    }

    cursor = /** @type {string | undefined} */ (data.cursor);
    if (!cursor) break;
  }

  return posts.slice(0, limit);
}

// ============================================================================
// Feeds Scraper
// ============================================================================

/**
 * Get posts from a specific Bluesky feed (custom algorithm)
 *
 * @param {BlueskyClient} client
 * @param {string} feedUri
 * @param {BlueskyScrapeOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function scrapeFeed(client, feedUri, options = {}) {
  const limit = options.limit ?? 50;
  const posts = [];
  /** @type {string | undefined} */
  let cursor;

  while (posts.length < limit) {
    const pageLimit = Math.min(100, limit - posts.length);
    const data = await xrpc(client, 'app.bsky.feed.getFeed', {
      feed: feedUri,
      limit: pageLimit,
      cursor,
    });

    const feed = /** @type {Record<string, unknown>[]} */ (data.feed || []);
    if (feed.length === 0) break;

    for (const item of feed) {
      const post = /** @type {Record<string, unknown>} */ (item.post);
      const record = /** @type {Record<string, unknown>} */ (post.record || {});
      const author = /** @type {Record<string, unknown>} */ (post.author);
      const postUri = /** @type {string | undefined} */ (post.uri);

      posts.push({
        id: postUri || null,
        text: /** @type {string | null} */ (record.text) || null,
        author: /** @type {string | null} */ (author?.handle) || null,
        timestamp: /** @type {string | null} */ (record.createdAt) || null,
        likes: /** @type {number | null | undefined} */ (post.likeCount) ?? 0,
        reposts: /** @type {number | null | undefined} */ (post.repostCount) ?? 0,
        url: postUri
          ? `https://bsky.app/profile/${/** @type {string | undefined} */ (author?.handle)}/post/${postUri.split('/').pop()}`
          : null,
        platform: 'bluesky',
      });
    }

    cursor = /** @type {string | undefined} */ (data.cursor);
    if (!cursor) break;
  }

  return posts.slice(0, limit);
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  createAgent,
  scrapeProfile,
  scrapeFollowers,
  scrapeFollowing,
  scrapeTweets,
  searchTweets,
  scrapeFeed,
};
