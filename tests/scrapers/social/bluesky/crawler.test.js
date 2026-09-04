// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { BlueskyCrawler } from '../../../../src/scrapers/social/bluesky/crawler.js';
import { BlueskyClient } from '../../../../src/scrapers/social/bluesky/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractStore } from '../../../../src/core/base-store.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';

class MemoryTestStore extends AbstractStore {
  name = 'memory';
  stored = [];
  async storeContent(item) {
    this.stored.push(item);
  }
  async storeBatch(items) {
    this.stored.push(...items);
  }
  async findContent() {
    return this.stored;
  }
}

describe('Story 23.2: BlueskyCrawler (AbstractCrawler Actions)', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });

        // 1. Resolve Handle
        if (req.url?.startsWith('/xrpc/com.atproto.identity.resolveHandle')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ did: 'did:plc:alice123' }));
          return;
        }

        // 2. Get Profile
        if (req.url?.startsWith('/xrpc/app.bsky.actor.getProfile')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            did: 'did:plc:alice123',
            handle: 'alice.bsky.social',
            displayName: 'Alice In Wonderland',
            description: 'ATProto Explorer',
            avatar: 'https://cdn.bsky.app/avatar.jpg',
            followersCount: 120,
            followsCount: 80,
            postsCount: 300,
          }));
          return;
        }

        // 3. Get Followers
        if (req.url?.startsWith('/xrpc/app.bsky.graph.getFollowers')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            subject: { did: 'did:plc:alice123', handle: 'alice.bsky.social' },
            followers: [
              {
                did: 'did:plc:bob456',
                handle: 'bob.bsky.social',
                displayName: 'Bob',
                description: 'Follower of Alice',
              },
            ],
            cursor: 'next_followers_cursor',
          }));
          return;
        }

        // 4. Get Follows (Following)
        if (req.url?.startsWith('/xrpc/app.bsky.graph.getFollows')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            subject: { did: 'did:plc:alice123', handle: 'alice.bsky.social' },
            follows: [
              {
                did: 'did:plc:carol789',
                handle: 'carol.bsky.social',
                displayName: 'Carol',
              },
            ],
            cursor: 'next_follows_cursor',
          }));
          return;
        }

        // 5. Author Feed (Posts)
        if (req.url?.startsWith('/xrpc/app.bsky.feed.getAuthorFeed')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            feed: [
              {
                post: {
                  uri: 'at://did:plc:alice123/app.bsky.feed.post/post1',
                  cid: 'cid1',
                  author: { did: 'did:plc:alice123', handle: 'alice.bsky.social' },
                  record: { text: 'First post!', createdAt: '2026-09-04T01:00:00Z' },
                  likeCount: 15,
                  repostCount: 3,
                },
              },
            ],
            cursor: 'next_author_feed_cursor',
          }));
          return;
        }

        // 6. Search Posts
        if (req.url?.startsWith('/xrpc/app.bsky.feed.searchPosts')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            posts: [
              {
                uri: 'at://did:plc:dave999/app.bsky.feed.post/post2',
                cid: 'cid2',
                author: { did: 'did:plc:dave999', handle: 'dave.bsky.social' },
                record: { text: 'Search match for tech', createdAt: '2026-09-04T02:00:00Z' },
                likeCount: 9,
              },
            ],
            cursor: 'next_search_cursor',
          }));
          return;
        }

        // 7. Trending Topics
        if (req.url?.startsWith('/xrpc/app.bsky.unspecced.getTrendingTopics')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            topics: [
              { topic: 'TechNews', displayName: '#TechNews', description: 'Latest in tech' },
              { topic: 'BlueskyGrowth', displayName: '#BlueskyGrowth', description: 'Community milestones' },
            ],
          }));
          return;
        }

        // 8. Custom Feed
        if (req.url?.startsWith('/xrpc/app.bsky.feed.getFeed')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            feed: [
              {
                post: {
                  uri: 'at://did:plc:feedauthor/app.bsky.feed.post/post3',
                  cid: 'cid3',
                  author: { did: 'did:plc:feedauthor', handle: 'feedauthor.bsky.social' },
                  record: { text: 'Trending on custom feed', createdAt: '2026-09-04T03:00:00Z' },
                },
              },
            ],
            cursor: 'next_feed_cursor',
          }));
          return;
        }

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'NotFound', message: 'Endpoint not found' }));
      });
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

  beforeEach(() => {
    receivedRequests = [];
  });

  it('inherits from AbstractCrawler and registers 8 core actions', () => {
    const crawler = new BlueskyCrawler({ baseUrl: serverUrl });
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('bluesky');
    expect(crawler.platform).toBe('bluesky');

    const actions = crawler.listActions().map((a) => a.action);
    expect(actions).toContain('profile');
    expect(actions).toContain('followers');
    expect(actions).toContain('following');
    expect(actions).toContain('posts');
    expect(actions).toContain('tweets');
    expect(actions).toContain('search');
    expect(actions).toContain('trending');
    expect(actions).toContain('feed');
  });

  it('executes profile action via start() and saves to store', async () => {
    const store = new MemoryTestStore();
    const crawler = new BlueskyCrawler({ baseUrl: serverUrl, store });

    const profile = await crawler.start({
      action: 'profile',
      args: { handle: 'alice.bsky.social' },
    });

    expect(profile.id).toBe('bluesky:did:plc:alice123');
    expect(profile.username).toBe('alice.bsky.social');
    expect(profile.followersCount).toBe(120);
    expect(store.stored).toHaveLength(1);
    expect(store.stored[0].id).toBe('bluesky:did:plc:alice123');
  });

  it('executes followers action with pagination cursor and store batch persistence', async () => {
    const store = new MemoryTestStore();
    const crawler = new BlueskyCrawler({ baseUrl: serverUrl, store });

    const result = await crawler.start({
      action: 'followers',
      args: { handle: 'alice.bsky.social', limit: 20 },
    });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].id).toBe('bluesky:did:plc:bob456');
    expect(result.pageInfo.end_cursor).toBe('next_followers_cursor');
    expect(result.pageInfo.has_next_page).toBe(true);
    expect(store.stored).toHaveLength(1);
  });

  it('executes following action with pagination cursor', async () => {
    const crawler = new BlueskyCrawler({ baseUrl: serverUrl });

    const result = await crawler.start({
      action: 'following',
      args: { handle: 'alice.bsky.social' },
    });

    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].id).toBe('bluesky:did:plc:carol789');
    expect(result.pageInfo.end_cursor).toBe('next_follows_cursor');
    expect(result.pageInfo.has_next_page).toBe(true);
  });

  it('executes posts and tweets actions resolving handle to DID', async () => {
    const crawler = new BlueskyCrawler({ baseUrl: serverUrl });

    const postsResult = await crawler.start({
      action: 'posts',
      args: { handle: 'alice.bsky.social' },
    });

    expect(postsResult.posts).toHaveLength(1);
    expect(postsResult.posts[0].id).toBe('bluesky:at://did:plc:alice123/app.bsky.feed.post/post1');
    expect(postsResult.pageInfo.end_cursor).toBe('next_author_feed_cursor');

    const tweetsResult = await crawler.start({
      action: 'tweets',
      args: { handle: 'alice.bsky.social' },
    });

    expect(tweetsResult.posts).toHaveLength(1);
    expect(tweetsResult.posts[0].content).toBe('First post!');
  });

  it('executes search action querying keywords', async () => {
    const crawler = new BlueskyCrawler({ baseUrl: serverUrl });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'tech' },
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].content).toBe('Search match for tech');
    expect(result.pageInfo.end_cursor).toBe('next_search_cursor');
  });

  it('executes trending action returning trending topics as PostItem items', async () => {
    const crawler = new BlueskyCrawler({ baseUrl: serverUrl });

    const result = await crawler.start({
      action: 'trending',
      args: { limit: 10 },
    });

    expect(result.trends).toHaveLength(2);
    expect(result.trends[0].id).toBe('bluesky:trend:TechNews');
    expect(result.trends[0].category).toBe('trending');
    expect(result.trends[1].id).toBe('bluesky:trend:BlueskyGrowth');
  });

  it('executes feed action querying custom feed generators', async () => {
    const crawler = new BlueskyCrawler({ baseUrl: serverUrl });

    const result = await crawler.start({
      action: 'feed',
      args: { feedUri: 'at://did:plc:generator/app.bsky.feed.generator/whats-hot' },
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].content).toBe('Trending on custom feed');
    expect(result.pageInfo.end_cursor).toBe('next_feed_cursor');
  });

  it('throws INVALID_ARGS error envelope on missing required arguments', async () => {
    const crawler = new BlueskyCrawler({ baseUrl: serverUrl });

    await expect(
      crawler.start({
        action: 'profile',
        args: {},
      })
    ).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
      platform: 'bluesky',
    });

    await expect(
      crawler.start({
        action: 'search',
        args: {},
      })
    ).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
      platform: 'bluesky',
    });

    await expect(
      crawler.start({
        action: 'feed',
        args: {},
      })
    ).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
      platform: 'bluesky',
    });
  });
});
