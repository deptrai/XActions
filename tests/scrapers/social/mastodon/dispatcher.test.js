// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  scrape,
  createMastodonClient,
  createMastodonCrawler,
  MastodonClient,
  MastodonCrawler,
} from '../../../../src/scrapers/index.js';
import pkg from '../../../../package.json' with { type: 'json' };

describe('Story 23.6: Universal scrape() Dispatcher Integration for Mastodon', () => {
  let server;
  let serverUrl;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      // 1. Account lookup
      if (req.url?.startsWith('/api/v1/accounts/lookup')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: '12345',
          username: 'Gargron',
          acct: 'Gargron',
          display_name: 'Eugen Rochko',
          note: '<p>Founder of Mastodon</p>',
          url: 'https://mastodon.social/@Gargron',
          followers_count: 1000,
          following_count: 200,
          statuses_count: 5000,
          created_at: '2016-03-16T00:00:00.000Z',
        }));
        return;
      }

      // 2. Account search fallback
      if (req.url?.startsWith('/api/v1/accounts/search')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          {
            id: '12345',
            username: 'Gargron',
            acct: 'Gargron',
            display_name: 'Eugen Rochko',
            note: '<p>Founder of Mastodon</p>',
            url: 'https://mastodon.social/@Gargron',
            followers_count: 1000,
            following_count: 200,
            statuses_count: 5000,
            created_at: '2016-03-16T00:00:00.000Z',
          },
        ]));
        return;
      }

      // 3. Account statuses (posts)
      if (req.url?.startsWith('/api/v1/accounts/12345/statuses')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          {
            id: '888',
            created_at: '2026-09-05T00:00:00.000Z',
            content: '<p>Recent post by Gargron</p>',
            account: {
              id: '12345',
              username: 'Gargron',
              acct: 'Gargron',
              display_name: 'Eugen Rochko',
            },
          },
        ]));
        return;
      }

      // 4. Followers
      if (req.url?.startsWith('/api/v1/accounts/12345/followers')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          {
            id: 'f1',
            username: 'follower1',
            acct: 'follower1@mastodon.social',
            display_name: 'Follower One',
            note: '<p>First follower</p>',
            url: 'https://mastodon.social/@follower1',
            followers_count: 10,
            following_count: 5,
            statuses_count: 1,
            created_at: '2026-09-01T00:00:00.000Z',
          },
        ]));
        return;
      }

      // 5. Following
      if (req.url?.startsWith('/api/v1/accounts/12345/following')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          {
            id: 'g1',
            username: 'friend1',
            acct: 'friend1@mastodon.social',
            display_name: 'Friend One',
            note: '<p>Following back</p>',
            url: 'https://mastodon.social/@friend1',
            followers_count: 20,
            following_count: 10,
            statuses_count: 2,
            created_at: '2026-09-02T00:00:00.000Z',
          },
        ]));
        return;
      }

      // 6. Trending statuses
      if (req.url?.startsWith('/api/v1/trends/statuses')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          {
            id: '999',
            created_at: '2026-09-05T00:00:00.000Z',
            content: '<p>Trending Mastodon post!</p>',
            account: {
              id: '12345',
              username: 'Gargron',
              acct: 'Gargron',
              display_name: 'Eugen Rochko',
            },
          },
        ]));
        return;
      }

      // 7. Hashtag timeline
      if (req.url?.startsWith('/api/v1/timelines/tag/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([
          {
            id: '777',
            created_at: '2026-09-05T00:00:00.000Z',
            content: '<p>Great #tech post</p>',
            account: {
              id: '234',
              username: 'techie',
              acct: 'techie',
              display_name: 'Tech Fan',
            },
          },
        ]));
        return;
      }

      // 8. Search
      if (req.url?.startsWith('/api/v2/search')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          accounts: [
            { id: '12345', username: 'Gargron', acct: 'Gargron', display_name: 'Eugen' },
          ],
          statuses: [
            {
              id: '666',
              content: '<p>Search result post</p>',
              account: { id: '12345', username: 'Gargron', acct: 'Gargron' },
            },
          ],
          hashtags: [{ name: 'tech' }],
        }));
        return;
      }

      // Fallback
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Record not found' }));
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
        resolve(null);
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('dispatches scrape("mastodon", "profile", ...) to MastodonCrawler', async () => {
    const profile = await scrape('mastodon', 'profile', {
      username: 'Gargron',
      baseUrl: serverUrl,
    });

    expect(profile.platform).toBe('mastodon');
    expect(profile.username).toBe('Gargron');
    expect(profile.name).toBe('Eugen Rochko');
    expect(profile.bio).toBe('Founder of Mastodon');
    expect(profile.followersCount).toBe(1000);
    expect(profile.id).toContain(':12345');
  });

  it('dispatches scrape("mastodon", "profile", ...) via URL target', async () => {
    const profile = await scrape('mastodon', 'profile', {
      target: 'https://mastodon.social/@Gargron',
    });

    expect(profile.platform).toBe('mastodon');
    expect(profile.username).toBe('Gargron');
  });

  it('dispatches scrape("masto", "trending", ...) with alias support', async () => {
    const trends = await scrape('masto', 'trending', {
      baseUrl: serverUrl,
    });

    expect(trends).toHaveLength(1);
    expect(trends[0].id).toContain(':999');
    expect(trends[0].content).toBe('Trending Mastodon post!');
    expect(trends[0].platform).toBe('mastodon');
  });

  it('dispatches scrape("mastodon", "posts", ...) and aliases like "tweets", "timeline", "feed", "user_feed"', async () => {
    const posts = await scrape('mastodon', 'posts', {
      username: 'Gargron',
      baseUrl: serverUrl,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0].id).toContain(':888');
    expect(posts[0].content).toBe('Recent post by Gargron');

    const tweets = await scrape('mastodon', 'tweets', {
      username: 'Gargron',
      baseUrl: serverUrl,
    });
    expect(tweets).toHaveLength(1);
    expect(tweets[0].id).toContain(':888');

    const timeline = await scrape('mastodon', 'timeline', {
      username: 'Gargron',
      baseUrl: serverUrl,
    });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].id).toContain(':888');

    const feed = await scrape('mastodon', 'feed', {
      username: 'Gargron',
      baseUrl: serverUrl,
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].id).toContain(':888');

    const userFeed = await scrape('mastodon', 'user_feed', {
      username: 'Gargron',
      baseUrl: serverUrl,
    });
    expect(userFeed).toHaveLength(1);
    expect(userFeed[0].id).toContain(':888');
  });

  it('dispatches scrape("mastodon", "posts", ...) with count, max_id, and token normalization', async () => {
    const posts = await scrape('mastodon', 'posts', {
      username: 'Gargron',
      baseUrl: serverUrl,
      count: 10,
      max_id: '777',
      token: 'bearer-xyz',
    });

    expect(posts).toHaveLength(1);
    expect(posts[0].id).toContain(':888');
  });

  it('dispatches scrape("mastodon", "followers", ...)', async () => {
    const result = await scrape('mastodon', 'followers', {
      username: 'Gargron',
      baseUrl: serverUrl,
    });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].username).toBe('follower1');
    expect(result.profiles[0].platform).toBe('mastodon');
    expect(result.pageInfo).toHaveProperty('has_next_page');
  });

  it('dispatches scrape("mastodon", "following", ...)', async () => {
    const result = await scrape('mastodon', 'following', {
      username: 'Gargron',
      baseUrl: serverUrl,
    });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].username).toBe('friend1');
    expect(result.profiles[0].platform).toBe('mastodon');
    expect(result.pageInfo).toHaveProperty('has_next_page');
  });

  it('dispatches scrape("mastodon", "hashtag", ...) and alias "tag"', async () => {
    const hashtagPosts = await scrape('mastodon', 'hashtag', {
      hashtag: 'tech',
      baseUrl: serverUrl,
    });

    expect(hashtagPosts).toHaveLength(1);
    expect(hashtagPosts[0].id).toContain(':777');
    expect(hashtagPosts[0].content).toBe('Great #tech post');

    const tagPosts = await scrape('mastodon', 'tag', {
      hashtag: 'tech',
      baseUrl: serverUrl,
    });
    expect(tagPosts).toHaveLength(1);
    expect(tagPosts[0].id).toContain(':777');
  });

  it('dispatches scrape("mastodon", "search", ...)', async () => {
    const searchRes = await scrape('mastodon', 'search', {
      query: 'open source',
      baseUrl: serverUrl,
    });

    expect(searchRes.profiles).toHaveLength(1);
    expect(searchRes.posts).toHaveLength(1);
    expect(searchRes.hashtags).toHaveLength(1);
  });

  it('dispatches scrape("mastodon", "search", ...) with q keyword alias', async () => {
    const searchRes = await scrape('mastodon', 'search', {
      q: 'open source',
      baseUrl: serverUrl,
    });

    expect(searchRes.profiles).toHaveLength(1);
    expect(searchRes.posts).toHaveLength(1);
    expect(searchRes.hashtags).toHaveLength(1);
  });

  it('throws a clear error when an invalid action is called', async () => {
    await expect(
      scrape('mastodon', 'invalid_action', { baseUrl: serverUrl })
    ).rejects.toThrow('Action "invalid_action" not available on platform "mastodon"');
  });

  it('exports factory helpers createMastodonClient and createMastodonCrawler', () => {
    const client = createMastodonClient({ baseUrl: serverUrl });
    expect(client).toBeInstanceOf(MastodonClient);

    const crawler = createMastodonCrawler(client);
    expect(crawler).toBeInstanceOf(MastodonCrawler);
    expect(crawler.client).toBe(client);
  });

  it('exposes MastodonCrawler and MastodonClient as named exports', () => {
    expect(typeof MastodonCrawler).toBe('function');
    expect(typeof MastodonClient).toBe('function');
  });

  it('maps Mastodon package.json exports for social subpaths', () => {
    expect(pkg.exports).toHaveProperty('./scrapers/social/mastodon');
    expect(pkg.exports).toHaveProperty('./scrapers/social/bluesky');
    expect(pkg.exports['./scrapers/social/mastodon']).toBe('./src/scrapers/social/mastodon/index.js');
    expect(pkg.exports['./scrapers/social/bluesky']).toBe('./src/scrapers/social/bluesky/index.js');
  });
});
