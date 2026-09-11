// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt — InstagramCrawler tests using a real node:http fixture server (no mocks).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { InstagramCrawler, createInstagramCrawler } from '../../../../src/scrapers/social/instagram/crawler.js';
import { InstagramClient } from '../../../../src/scrapers/social/instagram/client.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';
import { SessionManager } from '../../../../src/core/session-manager.js';

let server;
let baseUrl;

const USER_PAYLOAD = {
  user: {
    pk: 98765, username: 'natgeo', full_name: 'Nat Geo', biography: 'planet',
    follower_count: 250000000, following_count: 130, is_verified: true,
    edge_owner_to_timeline_media: {
      edges: [
        { node: { pk: 1, id: '1_9', code: 'A1', taken_at: 1700000000, caption: { text: 'one' }, like_count: 10, comment_count: 1, user: { pk: 98765, username: 'natgeo' }, image_versions2: { candidates: [{ url: 'https://cdn/1.jpg' }] } } },
        { node: { pk: 2, id: '2_9', code: 'A2', taken_at: 1700000100, caption: { text: 'two' }, like_count: 20, comment_count: 2, user: { pk: 98765, username: 'natgeo' }, image_versions2: { candidates: [{ url: 'https://cdn/2.jpg' }] } } },
      ],
      page_info: { has_next_page: false, end_cursor: null },
    },
  },
};
const TAG_PAYLOAD = {
  hashtag: { name: 'travel', edge_hashtag_to_media: {
    edges: [ { node: { pk: 9, id: '9_5', code: 'H9', taken_at: 1700000200, caption: { text: 'tag' }, like_count: 5, user: { pk: 5, username: 't' }, image_versions2: { candidates: [{ url: 'https://cdn/h.jpg' }] } } } ],
    page_info: { has_next_page: false, end_cursor: null } } },
};
const POST_PAYLOAD = {
  media: { pk: 42, id: '42_9', code: 'P42', taken_at: 1700000300, caption: { text: 'single' }, like_count: 99, comment_count: 1, user: { pk: 9, username: 'p' }, image_versions2: { candidates: [{ url: 'https://cdn/p.jpg' }] },
    edge_media_to_comment: { edges: [ { node: { pk: 500, text: 'nice', user: { pk: 2, username: 'c' }, like_count: 1, created_at: 1700000400 } } ] } },
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/natgeo/') return res.end(JSON.stringify(USER_PAYLOAD));
    if (u.pathname === '/explore/tags/travel/') return res.end(JSON.stringify(TAG_PAYLOAD));
    if (u.pathname === '/p/P42/') return res.end(JSON.stringify(POST_PAYLOAD));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

function makeCrawler(extra = {}) {
  const client = new InstagramClient({
    transport: 'http', baseUrl, delayMin: 0, delayMax: 0,
    requiresProxy: false, requiresAuth: false,
    credentials: { sessionid: 'TEST' },
    sessionManager: new SessionManager(),
  });
  return new InstagramCrawler({ client, requiresAuth: false, ...extra });
}

describe('InstagramCrawler registration', () => {
  it('registers user/hashtag/post/comments actions + aliases', () => {
    const c = makeCrawler();
    const actions = c.listActions().map((a) => a.action);
    for (const a of ['user', 'author', 'profile', 'hashtag', 'tag', 'topic', 'post', 'post_detail', 'media', 'comments']) {
      expect(actions).toContain(a);
    }
    expect(c.name).toBe('instagram');
    expect(c.platform).toBe('instagram');
    expect(c.category).toBe('social');
  });
  it('createInstagramCrawler builds a crawler', () => {
    expect(createInstagramCrawler({ transport: 'http', requiresAuth: false })).toBeInstanceOf(InstagramCrawler);
  });
});

describe('action handlers via start()', () => {
  it('user action returns { profile, posts, pageInfo }', async () => {
    const c = makeCrawler();
    const res = await c.start({ action: 'user', args: { username: 'natgeo', limit: 25 }, session: { accountId: 'acct-test' } });
    expect(res.profile.username).toBe('natgeo');
    expect(res.profile.id).toBe('instagram:98765');
    expect(res.profile.followersCount).toBe(250000000);
    expect(res.posts).toHaveLength(2);
    expect(res.posts[0].platform).toBe('instagram');
    expect(res.posts[0].postUrl).toContain('/p/A1/');
  });
  it('hashtag action returns posts[] with media urls', async () => {
    const c = makeCrawler();
    const res = await c.start({ action: 'hashtag', args: { tag: 'travel', limit: 25 }, session: { accountId: 'acct-test' } });
    expect(res.posts).toHaveLength(1);
    expect(res.posts[0].mediaUrls).toContain('https://cdn/h.jpg');
  });
  it('post action returns { post } by shortcode', async () => {
    const c = makeCrawler();
    const res = await c.start({ action: 'post', args: { shortcode: 'P42' }, session: { accountId: 'acct-test' } });
    expect(res.post.externalId).toBe('42');
    expect(res.post.content).toBe('single');
  });
  it('comments action returns CommentItem[]', async () => {
    const c = makeCrawler();
    const res = await c.start({ action: 'comments', args: { shortcode: 'P42', limit: 50 }, session: { accountId: 'acct-test' } });
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0].content).toBe('nice');
    expect(res.comments[0].id).toBe('instagram:42:500');
  });
  it('aliases resolve: profile→user, tag→hashtag, media→post', async () => {
    const c = makeCrawler();
    const p = await c.start({ action: 'profile', args: { username: 'natgeo' }, session: { accountId: 'acct-test' } });
    expect(p.profile.username).toBe('natgeo');
    const t = await c.start({ action: 'tag', args: { tag: 'travel' }, session: { accountId: 'acct-test' } });
    expect(t.posts).toHaveLength(1);
    const m = await c.start({ action: 'media', args: { shortcode: 'P42' }, session: { accountId: 'acct-test' } });
    expect(m.post.externalId).toBe('42');
  });
});

describe('arg validation', () => {
  it('user without username → XACT_4001', async () => {
    const c = makeCrawler();
    let err;
    try { await c.start({ action: 'user', args: {}, session: { accountId: 'acct-test' } }); }
    catch (e) { err = e; }
    expect(err).toBeInstanceOf(PlatformError);
    expect(err.code).toBe('XACT_4001');
  });
  it('hashtag without tag → XACT_4001', async () => {
    const c = makeCrawler();
    await expect(c.start({ action: 'hashtag', args: {}, session: { accountId: 'acct-test' } })).rejects.toThrow('tag');
  });
  it('post without shortcode → XACT_4001', async () => {
    const c = makeCrawler();
    await expect(c.start({ action: 'post', args: {}, session: { accountId: 'acct-test' } })).rejects.toThrow('shortcode');
  });
});

describe('cleanup', () => {
  it('cleanup() closes the client without throwing', async () => {
    const c = makeCrawler();
    await expect(c.cleanup()).resolves.toBeUndefined();
  });
});

describe('checkpoint + stream emission (AC-5)', () => {
  function makeStore() {
    const calls = { storeBatch: [], saveCheckpoint: [] };
    return {
      calls,
      telemetryContext: null,
      async storeBatch(items) { calls.storeBatch.push(items); return { insertedCount: items.length, totalCount: items.length, duplicates: [] }; },
      async saveCheckpoint(cp) { calls.saveCheckpoint.push(cp); return cp; },
      async getCheckpoint() { return null; },
      async findExistingIds() { return []; },
    };
  }

  it('emits saveCheckpoint for user action with correct shape', async () => {
    const store = makeStore();
    const c = makeCrawler({ store });
    await c.start({ action: 'user', args: { username: 'natgeo' }, session: { accountId: 'acct-test' } });
    expect(store.calls.saveCheckpoint).toHaveLength(1);
    const cp = store.calls.saveCheckpoint[0];
    expect(cp.platform).toBe('instagram');
    expect(cp.targetType).toBe('user');
    expect(cp.targetKey).toBe('natgeo');
    expect(cp.status).toBe('completed'); // fixture page_info.has_next_page=false
  });

  it('publishes each post to the Redis stream when REDIS_STREAM_ENABLED', async () => {
    process.env.REDIS_STREAM_ENABLED = '1';
    const published = [];
    const redisPublisher = { publish: async (evt) => { published.push(evt); } };
    const store = makeStore();
    const c = makeCrawler({ store, redisPublisher });
    try {
      await c.start({ action: 'user', args: { username: 'natgeo' }, session: { accountId: 'acct-test' } });
    } finally {
      delete process.env.REDIS_STREAM_ENABLED;
    }
    expect(published).toHaveLength(2);
    expect(published[0].platform).toBe('instagram');
    expect(published[0].externalId).toBe('1');
    expect(published[0].category).toBe('social');
    expect(published[0].storageRef).toBe(published[0].id);
  });

  it('does not publish when REDIS_STREAM_ENABLED is unset', async () => {
    delete process.env.REDIS_STREAM_ENABLED;
    const published = [];
    const redisPublisher = { publish: async (evt) => { published.push(evt); } };
    const c = makeCrawler({ store: makeStore(), redisPublisher });
    await c.start({ action: 'hashtag', args: { tag: 'travel' }, session: { accountId: 'acct-test' } });
    expect(published).toHaveLength(0);
  });
});

describe('limit + transport resolution', () => {
  it('honours a numeric limit smaller than the page', async () => {
    const c = makeCrawler();
    const res = await c.start({ action: 'user', args: { username: 'natgeo', limit: 1 }, session: { accountId: 'acct-test' } });
    expect(res.posts).toHaveLength(1);
  });
  it('falls back to default limit on garbage', async () => {
    const c = makeCrawler();
    const res = await c.start({ action: 'user', args: { username: 'natgeo', limit: 'abc' }, session: { accountId: 'acct-test' } });
    expect(res.posts).toHaveLength(2); // fixture has 2, default limit 25 doesn't truncate
  });
  it('per-request transport override switches client.transport', async () => {
    const c = makeCrawler();
    await c.start({ action: 'user', args: { username: 'natgeo', transport: 'http' }, session: { accountId: 'acct-test' } });
    expect(c.client.transport).toBe('http');
  });
});
