// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { scrape, createRedditClient, createRedditCrawler, platforms } from '../../../../src/scrapers/index.js';
import { RedditCrawler } from '../../../../src/scrapers/social/reddit/crawler.js';
import { RedditClient } from '../../../../src/scrapers/social/reddit/client.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';

describe('Reddit Integration (Unified Dispatcher)', () => {
  let server;
  let serverUrl;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // OAuth token
        if (req.url === '/api/v1/access_token') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'token123', token_type: 'bearer', expires_in: 3600 }));
          return;
        }

        // Subreddit listing
        if (req.url?.startsWith('/r/programming/new.json') || req.url?.startsWith('/r/programming/new?') || req.url === '/r/programming/new') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't3',
                  data: {
                    name: 't3_abc',
                    id: 'abc',
                    subreddit: 'programming',
                    author: 'dev',
                    title: 'Integration test post',
                    selftext: 'Body',
                    score: 42,
                    num_comments: 3,
                    created_utc: 1700000000,
                    permalink: '/r/programming/comments/abc/',
                  },
                },
              ],
              after: 't3_integration_next',
            },
          }));
          return;
        }

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('exposes reddit platform in registry', () => {
    expect(platforms).toHaveProperty('reddit');
    expect(platforms).toHaveProperty('rdt');
  });

  it('creates RedditClient via factory', () => {
    const client = createRedditClient({ baseUrl: serverUrl });
    expect(client).toBeInstanceOf(RedditClient);
    expect(client.name).toBe('reddit');
  });

  it('creates RedditCrawler via factory', () => {
    const crawler = createRedditCrawler({ baseUrl: serverUrl });
    expect(crawler).toBeInstanceOf(RedditCrawler);
    expect(crawler.platform).toBe('reddit');
  });

  it('creates RedditCrawler when passing client instance', () => {
    const client = createRedditClient({ baseUrl: serverUrl });
    const crawler = createRedditCrawler(client, { store: undefined });
    expect(crawler).toBeInstanceOf(RedditCrawler);
    expect(crawler.client).toBe(client);
  });

  it('scrape() dispatches reddit subreddit action', async () => {
    const result = await scrape('reddit', 'subreddit', { name: 'programming', limit: 5, baseUrl: serverUrl });
    expect(result).toHaveProperty('posts');
    expect(result.posts[0].platform).toBe('reddit');
    expect(result.posts[0].id).toContain('reddit:');
    expect(result.pageInfo.end_cursor).toBe('t3_integration_next');
  });

  it('scrape() dispatches via rdt alias', async () => {
    const result = await scrape('rdt', 'subreddit', { subreddit: 'programming', limit: 5, baseUrl: serverUrl });
    expect(result.posts).toBeDefined();
    expect(result.posts.length).toBeGreaterThan(0);
  });

  it('scrape() rejects unknown platform', async () => {
    await expect(
      scrape('unknown', 'x', {})
    ).rejects.toThrow();
  });

  it('scrape() rejects unknown reddit action', async () => {
    await expect(
      scrape('reddit', 'nonexistent', { baseUrl: serverUrl })
    ).rejects.toThrow();
  });
});
