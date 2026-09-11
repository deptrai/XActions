// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt — Universal scrape() dispatcher integration for Instagram (Story 35.3).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  scrape,
  platforms,
  getPlatform,
} from '../../../../src/scrapers/index.js';
import { InstagramClient } from '../../../../src/scrapers/social/instagram/client.js';
import { InstagramCrawler } from '../../../../src/scrapers/social/instagram/crawler.js';
import { SessionManager } from '../../../../src/core/session-manager.js';

let server;
let baseUrl;

const USER_PAYLOAD = {
  user: {
    pk: 98765, username: 'natgeo', full_name: 'Nat Geo',
    follower_count: 250000000, following_count: 130, is_verified: true,
    edge_owner_to_timeline_media: {
      edges: [
        { node: { pk: 1, id: '1_9', code: 'A1', taken_at: 1700000000, caption: { text: 'one' }, like_count: 10, comment_count: 1, user: { pk: 98765, username: 'natgeo' }, image_versions2: { candidates: [{ url: 'https://cdn/1.jpg' }] } } },
      ],
      page_info: { has_next_page: false, end_cursor: null },
    },
  },
};

const POST_PAYLOAD = {
  media: { pk: 42, id: '42_9', code: 'POST42', taken_at: 1700000300, caption: { text: 'x' }, like_count: 1, comment_count: 0, user: { pk: 9, username: 'p' }, image_versions2: { candidates: [{ url: 'https://cdn/p.jpg' }] },
    edge_media_to_comment: { edges: [], page_info: { has_next_page: false } } },
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/natgeo/') return res.end(JSON.stringify(USER_PAYLOAD));
    if (u.pathname === '/p/POST42/') return res.end(JSON.stringify(POST_PAYLOAD));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

const opts = (extra = {}) => ({
  baseUrl,
  transport: 'http',
  requiresAuth: false,
  requiresProxy: false,
  session: { accountId: 'acct-disp' },
  sessionManager: new SessionManager(),
  ...extra,
});

describe('scrape() dispatcher — instagram', () => {
  it('routes scrape("instagram","user",…) to InstagramCrawler.getUser', async () => {
    const res = await scrape('instagram', 'user', opts({ username: 'natgeo' }));
    expect(res.profile.username).toBe('natgeo');
    expect(res.profile.id).toBe('instagram:98765');
    expect(res.posts).toHaveLength(1);
  });

  it('supports platform aliases "ig" and "insta"', async () => {
    const a = await scrape('ig', 'profile', opts({ username: 'natgeo' }));
    const b = await scrape('insta', 'author', opts({ username: 'natgeo' }));
    expect(a.profile.username).toBe('natgeo');
    expect(b.profile.username).toBe('natgeo');
  });

  it('maps action aliases: posts→user, media→post, replies→comments', async () => {
    // posts → user
    const posts = await scrape('instagram', 'posts', opts({ username: 'natgeo' }));
    expect(posts.profile.username).toBe('natgeo');
    // media → post
    const media = await scrape('instagram', 'media', opts({ shortcode: 'POST42' }));
    expect(media.post.externalId).toBe('42');
    // replies → comments
    const replies = await scrape('instagram', 'replies', opts({ shortcode: 'POST42' }));
    expect(replies).toHaveProperty('comments');
  });

  it('throws 400 XACT_4001 actionNotAvailable for unknown action', async () => {
    let err;
    try { await scrape('instagram', 'nonexistent', opts()); }
    catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('XACT_4001');
    expect(err.message).toMatch(/not available on platform "instagram"/);
  });

  it('maps options args: user/handle → username, url → shortcode', async () => {
    // handle alias → username
    const h = await scrape('instagram', 'user', opts({ handle: 'natgeo' }));
    expect(h.profile.username).toBe('natgeo');
    // url → shortcode: resolveShortcode only accepts instagram.com URLs;
    // the resolved shortcode is then fetched from the fixture baseUrl.
    const p = await scrape('instagram', 'post', opts({ url: 'https://www.instagram.com/p/POST42/' }));
    expect(p.post.externalId).toBe('42');
  });
});

describe('platform registry + factories', () => {
  it('platforms map exposes instagram/ig/insta', () => {
    expect(platforms.instagram).toBeDefined();
    expect(platforms.ig).toBe(platforms.instagram);
    expect(platforms.insta).toBe(platforms.instagram);
  });
  it('getPlatform("ig") returns the instagram module', () => {
    expect(getPlatform('ig')).toBe(platforms.instagram);
  });
  it('instagram module exports client + crawler classes', () => {
    expect(typeof platforms.instagram.InstagramClient).toBe('function');
    expect(typeof platforms.instagram.InstagramCrawler).toBe('function');
  });
});
