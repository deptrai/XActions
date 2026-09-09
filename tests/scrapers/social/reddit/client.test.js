// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { RedditClient, createRedditClient, buildRedditUserAgent } from '../../../../src/scrapers/social/reddit/client.js';
import { RedditPlatformResponseValidator } from '../../../../src/scrapers/social/reddit/validator.js';
import { PlatformError, RateLimitError, BotChallengeError, AuthSessionExpiredError } from '../../../../src/core/error-envelope.js';

describe('RedditClient (OAuth2 + Public .json)', () => {
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

        // 1. OAuth token endpoint
        if (req.url === '/api/v1/access_token') {
          const auth = req.headers['authorization'];
          if (auth && auth.startsWith('Basic ')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              access_token: 'mock_access_token_123',
              token_type: 'bearer',
              expires_in: 3600,
            }));
            return;
          }
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }

        // 2. Public subreddit listing
        if (req.url?.startsWith('/r/programming/new.json') || req.url?.startsWith('/r/programming/new?') || req.url === '/r/programming/new') {
          const urlObj = new URL(req.url, 'http://127.0.0.1');
          const after = urlObj.searchParams.get('after');
          res.writeHead(200, {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '55',
            'x-ratelimit-used': '5',
            'x-ratelimit-reset': '1700003600',
          });
          res.end(JSON.stringify({
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't3',
                  data: {
                    name: 't3_abc123',
                    id: 'abc123',
                    subreddit: 'programming',
                    author: 'dev1',
                    title: 'Test post',
                    selftext: 'Hello',
                    score: 10,
                    num_comments: 2,
                    created_utc: 1700000000,
                    permalink: '/r/programming/comments/abc123/test/',
                    url: 'https://example.com',
                  },
                },
              ],
              after: after ? null : 't3_nextpage',
              before: null,
            },
          }));
          return;
        }

        // 3. User about
        if (req.url?.startsWith('/user/spez/about')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            kind: 't2',
            data: {
              name: 'spez',
              fullname: 't2_abc123',
              id: 'abc123',
              icon_img: 'https://example.com/avatar.png',
              link_karma: 1000,
              comment_karma: 5000,
              created_utc: 1100000000,
              is_mod: true,
              verified: true,
            },
          }));
          return;
        }

        // 4. User submitted
        if (req.url?.startsWith('/user/spez/submitted')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't3',
                  data: {
                    name: 't3_userpost',
                    id: 'userpost',
                    subreddit: 'test',
                    author: 'spez',
                    title: 'User post',
                    score: 5,
                    num_comments: 1,
                    created_utc: 1700000000,
                  },
                },
              ],
              after: null,
            },
          }));
          return;
        }

        // 5. Search
        if (req.url?.startsWith('/search')) {
          const urlObj = new URL(req.url, 'http://127.0.0.1');
          const q = urlObj.searchParams.get('q');
          if (q === 'ratelimit') {
            res.writeHead(429, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'too many requests' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            kind: 'Listing',
            data: {
              children: [
                {
                  kind: 't3',
                  data: {
                    name: 't3_search1',
                    id: 'search1',
                    subreddit: 'all',
                    author: 'user1',
                    title: `Search: ${q}`,
                    score: 20,
                    num_comments: 5,
                    created_utc: 1700000000,
                  },
                },
              ],
              after: 't3_searchnext',
            },
          }));
          return;
        }

        // 6. Post comments
        if (req.url?.match(/\/r\/test\/comments\/post123/)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify([
            {
              kind: 'Listing',
              data: {
                children: [
                  {
                    kind: 't3',
                    data: {
                      name: 't3_post123',
                      id: 'post123',
                      subreddit: 'test',
                      author: 'poster',
                      title: 'Post title',
                      score: 50,
                      num_comments: 3,
                      created_utc: 1700000000,
                    },
                  },
                ],
              },
            },
            {
              kind: 'Listing',
              data: {
                children: [
                  {
                    kind: 't1',
                    data: {
                      name: 't1_comment1',
                      id: 'comment1',
                      link_id: 't3_post123',
                      parent_id: 't3_post123',
                      author: 'commenter',
                      body: 'First comment',
                      score: 15,
                      created_utc: 1700000100,
                      subreddit: 'test',
                    },
                  },
                ],
                after: null,
              },
            },
          ]));
          return;
        }

        // 7. Subreddit about
        if (req.url?.startsWith('/r/test/about')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            kind: 't5',
            data: {
              name: 't5_2xxxxx',
              id: '2xxxxx',
              display_name: 'test',
              public_description: 'Test subreddit',
              subscribers: 1000,
              created_utc: 1200000000,
              url: '/r/test/',
            },
          }));
          return;
        }

        // 8. Rate limit response
        if (req.url?.includes('/ratelimit')) {
          res.writeHead(200, {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '0.08',
          });
          res.end(JSON.stringify({ kind: 'Listing', data: { children: [] } }));
          return;
        }

        // 9. Bot challenge
        if (req.url?.includes('/blocked')) {
          res.writeHead(403, { 'content-type': 'text/html' });
          res.end('<html>Access denied</html>');
          return;
        }

        // 10. Auth expired
        if (req.url?.includes('/unauthorized')) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_token' }));
          return;
        }

        // Default 404
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

  it('initializes with correct platform and name', () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    expect(client.name).toBe('reddit');
    expect(client.platform).toBe('reddit');
    expect(client.requiresAuth).toBe(false);
    expect(client.client).toBe('undici');
  });

  it('builds correct User-Agent', () => {
    expect(buildRedditUserAgent('nirholas')).toBe('xactions:reddit-scraper:v1.0.0 by u/nirholas');
    expect(buildRedditUserAgent()).toBe('xactions:reddit-scraper:v1.0.0 (xactions)');
  });

  it('authenticates via OAuth2 client_credentials', async () => {
    const client = new RedditClient({ baseUrl: serverUrl, oauthUrl: `${serverUrl}/api/v1/access_token` });
    const token = await client.authenticate({ clientId: 'test', clientSecret: 'secret' });
    expect(token).toBe('mock_access_token_123');
    expect(client.accessToken).toBe('mock_access_token_123');
    expect(client.tokenExpiresAt).toBeGreaterThan(Date.now());
  });

  it('throws on invalid credentials', async () => {
    const client = new RedditClient({ baseUrl: serverUrl, oauthUrl: `${serverUrl}/api/v1/access_token` });
    await expect(client.authenticate({ clientId: '', clientSecret: '' })).rejects.toThrow(PlatformError);
  });

  it('makes public .json request without auth', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    const res = await client.apiRequest('/r/programming/new', { limit: 5 });
    expect(res.kind).toBe('Listing');
    expect(res.data.children[0].kind).toBe('t3');
  });

  it('includes User-Agent header in requests', async () => {
    const client = new RedditClient({ baseUrl: serverUrl, username: 'testuser' });
    await client.apiRequest('/r/programming/new', { limit: 1 });
    const lastReq = receivedRequests[receivedRequests.length - 1];
    expect(lastReq.headers['user-agent']).toContain('xactions:reddit-scraper');
    expect(lastReq.headers['user-agent']).toContain('u/testuser');
  });

  it('uses apiBaseUrl when authenticated', async () => {
    const client = new RedditClient({
      baseUrl: serverUrl,
      apiBaseUrl: serverUrl,
      oauthUrl: `${serverUrl}/api/v1/access_token`,
      clientId: 'test',
      clientSecret: 'secret',
    });
    await client.init({});
    const res = await client.apiRequest('/r/programming/new', { limit: 1 });
    expect(res.kind).toBe('Listing');
  });

  it('handles rate limit headers', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    const res = await client.apiRequest('/r/programming/new', { limit: 1 });
    expect(res.kind).toBe('Listing');
  });

  it('throws RateLimitError on 429', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    await expect(client.apiRequest('/search', { q: 'ratelimit' })).rejects.toThrow(RateLimitError);
  });

  it('throws BotChallengeError on 403 HTML', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    await expect(client.apiRequest('/blocked')).rejects.toThrow(BotChallengeError);
  });

  it('throws AuthSessionExpiredError on 401', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    await expect(client.apiRequest('/unauthorized')).rejects.toThrow(AuthSessionExpiredError);
  });

  it('throws PlatformError on 404', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    await expect(client.apiRequest('/nonexistent')).rejects.toThrow(PlatformError);
  });

  it('createRedditClient returns RedditClient instance', () => {
    const client = createRedditClient({ baseUrl: serverUrl });
    expect(client).toBeInstanceOf(RedditClient);
  });

  it('uses proxy agent when requiresProxy is set', async () => {
    const fakeAgent = { name: 'fake-agent' };
    const proxy = { host: '127.0.0.1', port: 8080 };
    const proxyPool = {
      getNext: () => proxy,
      getProxyAgent: () => fakeAgent,
      isAllQuarantined: () => false,
    };
    const client = new RedditClient({ baseUrl: serverUrl, requiresProxy: true, proxyPool });
    let capturedAgent = null;
    client.httpClient = async ({ agent }) => {
      capturedAgent = agent;
      return { status: 200, data: { kind: 'Listing', data: { children: [] } }, headers: {} };
    };
    await client.apiRequest('/r/programming/new', { limit: 1 });
    expect(capturedAgent).toBe(fakeAgent);
  });

  it('auto-authenticates via ensureToken when constructed with credentials', async () => {
    const client = new RedditClient({
      baseUrl: serverUrl,
      apiBaseUrl: serverUrl,
      oauthUrl: `${serverUrl}/api/v1/access_token`,
      clientId: 'test',
      clientSecret: 'secret',
    });
    const token = await client.ensureToken();
    expect(token).toBe('mock_access_token_123');
    expect(client.accessToken).toBe('mock_access_token_123');
  });

  it('backs off when x-ratelimit-remaining is low', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    const start = Date.now();
    await client.apiRequest('/ratelimit', {});
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(60);
    expect(elapsed).toBeLessThan(1000);
  });
});
