// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';

/**
 * Story 13.2.12 — Twitter Hybrid Integration & Caller Migration
 * Verifies that scrape('twitter'|'x', ...) dispatches to TwitterCrawler.
 */

describe('Story 13.2.12 — Twitter Hybrid Integration & Caller Migration', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedRequests.push({ method: req.method, path: url.pathname, search: url.search, body });

        // UserByScreenName
        if (url.pathname.includes('/Gb-d6r0vxPOADdG62OEBpQ/UserByScreenName')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              user: {
                result: {
                  __typename: 'User',
                  rest_id: '44196397',
                  core: { name: 'Elon Musk', screen_name: 'elonmusk', created_at: 'Wed Jun 02 21:10:00 +0000 2010' },
                  profile_bio: { description: 'Mars & Cars' },
                  relationship_counts: { followers: 100, following: 50 },
                  avatar: { image_url: 'https://pbs.twimg.com/profile_images/1/normal.jpg' },
                  is_blue_verified: false,
                  legacy: { screen_name: 'elonmusk' },
                },
              },
            },
          }));
          return;
        }

        // SearchTimeline
        if (url.pathname.includes('/hyPfJYJ_XAtDYoslQc-Rgg/SearchTimeline')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [] } } } },
          }));
          return;
        }

        // CreateTweet (dry-run won't hit this, but catch-all)
        if (url.pathname.includes('/WXTdKnLddrQOunD6MhWi3g/CreateTweet')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { create_tweet: { tweet_results: { result: { __typename: 'Tweet', rest_id: 'new-1' } } } } }));
          return;
        }

        // DM new2.json
        if (url.pathname.includes('/1.1/dm/new2.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ event: { id: 'dm-1', created_timestamp: '1725000000000' } }));
          return;
        }

        // Lists create
        if (url.pathname.includes('/1.1/lists/create.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id_str: 'list-1', name: 'test', mode: 'public', member_count: 0 }));
          return;
        }

        // Catch-all: return empty success
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: {} }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    serverUrl = `http://${address.address}:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  it('scrape("twitter", "profile") dispatches to TwitterCrawler', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');
    const result = await scrape('twitter', 'profile', {
      username: 'elonmusk',
      baseUrl: serverUrl,
    });

    expect(result).toBeTruthy();
    expect(receivedRequests.some((r) => r.path.includes('/UserByScreenName'))).toBe(true);
  });

  it('scrape("x", "search") dispatches to TwitterCrawler with auth session', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');
    const result = await scrape('x', 'search', {
      query: 'javascript',
      baseUrl: serverUrl,
      limit: 5,
      accountId: 'test-user',
      cookies: 'auth_token=test; ct0=csrf',
    });

    expect(result).toBeTruthy();
    expect(receivedRequests.some((r) => r.path.includes('/SearchTimeline'))).toBe(true);
  });

  it('scrape("twitter", "post") with dryRun dispatches to TwitterCrawler and does not hit API', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');
    const result = await scrape('twitter', 'post', {
      text: 'Hello from integration test',
      dryRun: true,
      baseUrl: serverUrl,
      accountId: 'test-user',
      cookies: 'auth_token=test; ct0=csrf',
    });

    expect(result).toBeTruthy();
    expect(result.tweet?.metadata?.dryRun).toBe(true);
    expect(receivedRequests.filter((r) => r.path.includes('/CreateTweet'))).toHaveLength(0);
  });

  it('scrape("twitter", "send_dm") with dryRun dispatches to TwitterCrawler', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');
    const result = await scrape('twitter', 'send_dm', {
      userId: '44196397',
      text: 'Integration test DM',
      dryRun: true,
      baseUrl: serverUrl,
      accountId: 'test-user',
      cookies: 'auth_token=test; ct0=csrf',
    });

    expect(result).toEqual({ success: true, dryRun: true });
    expect(receivedRequests.filter((r) => r.path.includes('/dm/'))).toHaveLength(0);
  });

  it('scrape("twitter", "create_list") with dryRun dispatches to TwitterCrawler', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');
    const result = await scrape('twitter', 'create_list', {
      name: 'Test List',
      dryRun: true,
      baseUrl: serverUrl,
      accountId: 'test-user',
      cookies: 'auth_token=test; ct0=csrf',
    });

    expect(result).toEqual({ success: true, dryRun: true });
    expect(receivedRequests.filter((r) => r.path.includes('/lists/'))).toHaveLength(0);
  });

  it('package.json exports include ./scrapers/social/twitter', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    expect(pkg.exports['./scrapers/social/twitter']).toBe('./src/scrapers/social/twitter/index.js');
  });

  it('legacy src/scrapers/twitter/index.js is marked @deprecated', async () => {
    const source = await fs.readFile('src/scrapers/twitter/index.js', 'utf8');
    expect(source).toMatch(/@deprecated/);
  });

  it('deprecation plan marks Twitter Puppeteer as deprecated-marked', async () => {
    const plan = await fs.readFile('docs/deprecation-plan.md', 'utf8');
    expect(plan).toMatch(/Twitter Puppeteer.*deprecated-marked.*Story 13\.2\.12/);
    expect(plan).toMatch(/Twitter HTTP.*deprecated-marked.*Story 13\.2\.12/);
  });
});
