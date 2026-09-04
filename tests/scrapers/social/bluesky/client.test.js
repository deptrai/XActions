// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { BlueskyClient, resolveActor, DEFAULT_BLUESKY_SERVICE } from '../../../../src/scrapers/social/bluesky/client.js';
import { BlueskyPlatformResponseValidator } from '../../../../src/scrapers/social/bluesky/validator.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';

describe('Story 23.2: BlueskyClient (XRPC & AbstractApiClient)', () => {
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
          const urlObj = new URL(req.url, 'http://127.0.0.1');
          const handle = urlObj.searchParams.get('handle');
          if (handle === 'notfound.bsky.social') {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'NotFound', message: 'Handle not found' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ did: 'did:plc:resolved123' }));
          return;
        }

        // 2. Create Session (Auth Login)
        if (req.url === '/xrpc/com.atproto.server.createSession') {
          try {
            const parsed = JSON.parse(body || '{}');
            if (parsed.identifier === 'valid.user' && parsed.password === 'secret-pass') {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({
                did: 'did:plc:authuser456',
                handle: 'valid.user',
                accessJwt: 'jwt-access-token-xyz',
                refreshJwt: 'jwt-refresh-token-abc',
              }));
              return;
            }
          } catch {}

          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }));
          return;
        }

        // 3. Get Profile
        if (req.url?.startsWith('/xrpc/app.bsky.actor.getProfile')) {
          const urlObj = new URL(req.url, 'http://127.0.0.1');
          const actor = urlObj.searchParams.get('actor');
          if (actor === 'ratelimited.bsky.social') {
            res.writeHead(429, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'RateLimitExceeded', message: 'Too many requests' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            did: 'did:plc:profile123',
            handle: actor || 'test.bsky.social',
            displayName: 'Test User',
            description: 'Hello Bluesky',
            followersCount: 42,
            followsCount: 10,
            postsCount: 100,
          }));
          return;
        }

        // 4. Search Posts
        if (req.url?.startsWith('/xrpc/app.bsky.feed.searchPosts')) {
          const auth = req.headers['authorization'];
          // Simulate auth requirement on protected search endpoint
          const urlObj = new URL(req.url, 'http://127.0.0.1');
          if (urlObj.searchParams.get('q') === 'need-auth' && !auth) {
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Blocked', message: 'Auth required by gateway' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            posts: [
              {
                uri: 'at://did:plc:123/app.bsky.feed.post/1',
                cid: 'cid1',
                author: { did: 'did:plc:123', handle: 'alice.bsky.social' },
                record: { text: 'Search result post', createdAt: '2026-09-04T00:00:00Z' },
                likeCount: 5,
              },
            ],
            cursor: 'search_cursor_next',
          }));
          return;
        }

        // 5. Trending Topics
        if (req.url?.startsWith('/xrpc/app.bsky.unspecced.getTrendingTopics')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            topics: [
              { topic: 'Bluesky', displayName: '#Bluesky', description: 'Decentralized social network' },
              { topic: 'AI', displayName: '#AI', description: 'Artificial Intelligence' },
            ],
            suggested: [],
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

  it('inherits from AbstractApiClient and sets platform to bluesky', () => {
    const client = new BlueskyClient({ baseUrl: serverUrl });
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(client.platform).toBe('bluesky');
    expect(client.name).toBe('bluesky');
    expect(client.responseValidator).toBeInstanceOf(BlueskyPlatformResponseValidator);
  });

  it('sign() is a no-op returning empty object', async () => {
    const client = new BlueskyClient({ baseUrl: serverUrl });
    const signResult = await client.sign({ foo: 'bar' });
    expect(signResult).toEqual({});
  });

  it('resolveActor parses bsky URLs, @ prefixes, and raw handles', () => {
    expect(resolveActor('https://bsky.app/profile/alice.bsky.social')).toBe('alice.bsky.social');
    expect(resolveActor('http://staging.bsky.app/profile/bob.com/post/123')).toBe('bob.com');
    expect(resolveActor('@carol.bsky.social')).toBe('carol.bsky.social');
    expect(resolveActor('did:plc:123456')).toBe('did:plc:123456');
    expect(resolveActor('  dave.bsky.social  ')).toBe('dave.bsky.social');
  });

  it('resolveHandle queries com.atproto.identity.resolveHandle', async () => {
    const client = new BlueskyClient({ baseUrl: serverUrl });
    const did = await client.resolveHandle('alice.bsky.social');
    expect(did).toBe('did:plc:resolved123');
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].url).toContain('/xrpc/com.atproto.identity.resolveHandle?handle=alice.bsky.social');
  });

  it('resolveHandle returns DID directly without HTTP request if input is already DID', async () => {
    const client = new BlueskyClient({ baseUrl: serverUrl });
    const did = await client.resolveHandle('did:plc:directdid');
    expect(did).toBe('did:plc:directdid');
    expect(receivedRequests.length).toBe(0);
  });

  it('xrpc performs GET request with query params and extracts data', async () => {
    const client = new BlueskyClient({ baseUrl: serverUrl });
    const data = await client.xrpc('app.bsky.actor.getProfile', { actor: 'alice.bsky.social' });
    expect(data.did).toBe('did:plc:profile123');
    expect(data.displayName).toBe('Test User');
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].method).toBe('GET');
  });

  it('login creates session with com.atproto.server.createSession and attaches Bearer token', async () => {
    const client = new BlueskyClient({ baseUrl: serverUrl });
    const token = await client.login({ identifier: 'valid.user', password: 'secret-pass' });
    expect(token).toBe('jwt-access-token-xyz');
    expect(client.accessJwt).toBe('jwt-access-token-xyz');
    expect(client.did).toBe('did:plc:authuser456');

    // Next xrpc call should carry authorization header
    await client.xrpc('app.bsky.feed.searchPosts', { q: 'need-auth' });
    const searchReq = receivedRequests.find((r) => r.url?.includes('searchPosts'));
    expect(searchReq).toBeDefined();
    expect(searchReq.headers['authorization']).toBe('Bearer jwt-access-token-xyz');
  });

  it('integrates with ProxyIpPool and AdaptiveRateGovernor via AbstractApiClient', async () => {
    const proxyPool = new ProxyIpPool({ proxies: ['http://127.0.0.1:8888'] });
    const governor = new AdaptiveRateGovernor({ proxyPool });

    const client = new BlueskyClient({
      baseUrl: serverUrl,
      proxyPool,
      governor,
      requiresProxy: false,
    });

    const data = await client.xrpc('app.bsky.unspecced.getTrendingTopics', {});
    expect(data.topics).toHaveLength(2);
    expect(client.governor).toBe(governor);
  });

  it('classifies 429 rate limits through BlueskyPlatformResponseValidator', async () => {
    const client = new BlueskyClient({ baseUrl: serverUrl, retryCount: 1, initialRetryDelayMs: 10 });
    await expect(
      client.xrpc('app.bsky.actor.getProfile', { actor: 'ratelimited.bsky.social' })
    ).rejects.toThrow();
  });
});
