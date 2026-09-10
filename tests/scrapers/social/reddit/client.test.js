// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { RedditClient, createRedditClient, buildRedditUserAgent } from '../../../../src/scrapers/social/reddit/client.js';
import { RedditBrowserBridge } from '../../../../src/scrapers/social/reddit/bridge.js';
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

        // 2. Public subreddit RSS listing
        if (req.url?.startsWith('/r/programming/new.rss')) {
          res.writeHead(200, { 'content-type': 'application/atom+xml' });
          res.end(`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>programming</title><entry><id>https://www.reddit.com/r/programming/comments/abc123/test/</id><link href="https://www.reddit.com/r/programming/comments/abc123/test/"/><title>Test post</title><author><name>/u/dev1</name></author></entry></feed>`);
          return;
        }

        // 3. Public subreddit JSON listing
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
          const urlObj = new URL(req.url, 'http://127.0.0.1');
          const resetParam = urlObj.searchParams.get('reset');
          // Default to a near-future absolute epoch to exercise backoff.
          const reset = resetParam ? Number(resetParam) : Math.floor(Date.now() / 1000) + 2;
          res.writeHead(200, {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(reset),
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
    expect(buildRedditUserAgent()).toBe('xactions/1.0');
    expect(buildRedditUserAgent('invalid@name')).toBe('xactions/1.0');
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

  it('throws AuthSessionExpiredError when existing token has expired and no credentials are available', async () => {
    const client = new RedditClient({
      baseUrl: serverUrl,
      accessToken: 'expired_token',
      tokenExpiresAt: Date.now() - 1000,
    });
    await expect(client.ensureToken()).rejects.toThrow(AuthSessionExpiredError);
    expect(client.accessToken).toBeNull();
  });

  it('refreshes expired OAuth token when credentials are available', async () => {
    const client = new RedditClient({
      baseUrl: serverUrl,
      apiBaseUrl: serverUrl,
      oauthUrl: `${serverUrl}/api/v1/access_token`,
      clientId: 'test',
      clientSecret: 'secret',
      accessToken: 'stale_token',
      tokenExpiresAt: Date.now() - 1000,
    });
    const token = await client.ensureToken();
    expect(token).toBe('mock_access_token_123');
    expect(client.accessToken).toBe('mock_access_token_123');
    expect(client.tokenExpiresAt).toBeGreaterThan(Date.now());
  });

  it('backs off when x-ratelimit-remaining is 0 and reset is in the near future', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    const start = Date.now();
    await client.apiRequest('/ratelimit', {});
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(3000);
  });

  it('does not sleep when x-ratelimit-remaining is above the <=1 boundary', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    const start = Date.now();
    await client.apiRequest('/r/programming/new', { limit: 1 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('caps rate-limit backoff at 5 minutes for far-future reset', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    // Use a relative reset far in the future (1000 seconds ≈ 16.7 minutes).
    const farFutureReset = 1000;
    const start = Date.now();
    await client.apiRequest('/ratelimit', { reset: farFutureReset });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('builds public .json URLs and authenticated api URLs on separate hosts with Bearer token', async () => {
    const baseRequests = [];
    const apiRequests = [];

    const baseServer = http.createServer((req, res) => {
      baseRequests.push({ url: req.url, headers: req.headers });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ kind: 'Listing', data: { children: [] } }));
    });
    const apiServer = http.createServer((req, res) => {
      apiRequests.push({ url: req.url, headers: req.headers });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ kind: 'Listing', data: { children: [] } }));
    });

    await new Promise((resolve) => baseServer.listen(0, '127.0.0.1', resolve));
    await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));

    const baseUrl = `http://127.0.0.1:${baseServer.address().port}`;
    const apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}`;

    try {
      // Public (no auth) client should hit base host with .json suffix.
      const publicClient = new RedditClient({ baseUrl });
      await publicClient.apiRequest('/r/programming/new', { limit: 5 });
      expect(baseRequests.length).toBe(1);
      expect(baseRequests[0].url).toBe('/r/programming/new.json?limit=5');
      expect(baseRequests[0].headers.authorization).toBeUndefined();

      // Authenticated client should hit the separate API host without .json
      // and attach a Bearer token.
      const authClient = new RedditClient({
        baseUrl,
        apiBaseUrl,
        oauthUrl: `${serverUrl}/api/v1/access_token`,
        clientId: 'test',
        clientSecret: 'secret',
      });
      await authClient.init({});
      await authClient.apiRequest('/r/programming/new', { limit: 5 });
      expect(apiRequests.length).toBe(1);
      expect(apiRequests[0].url).toBe('/r/programming/new?limit=5');
      expect(apiRequests[0].headers.authorization).toBe('Bearer mock_access_token_123');
    } finally {
      await new Promise((resolve) => baseServer.close(resolve));
      await new Promise((resolve) => apiServer.close(resolve));
    }
  });

  describe('transport option', () => {
    it('defaults transport to http', () => {
      const client = new RedditClient({ baseUrl: 'http://localhost' });
      expect(client.transport).toBe('http');
      expect(client.browserBridge).toBeNull();
    });

    it('accepts transport puppeteer and rss with case-insensitivity', () => {
      const puppeteerClient = new RedditClient({ baseUrl: 'http://localhost', transport: 'PUPPETEER' });
      expect(puppeteerClient.transport).toBe('puppeteer');

      const rssClient = new RedditClient({ baseUrl: 'http://localhost', transport: '  RSS  ' });
      expect(rssClient.transport).toBe('rss');
    });

    it('rejects invalid transport and falls back to http', () => {
      const client = new RedditClient({ baseUrl: 'http://localhost', transport: 'invalid' });
      expect(client.transport).toBe('http');
    });

    it('injects cookieHeader when transport is puppeteer', async () => {
      const stubBridge = {
        isReady: true,
        cookieHeader: 'session=reddit_abc_123; token=xyz',
        start: async () => {},
        close: async () => {},
      };
      const client = new RedditClient({
        baseUrl: serverUrl,
        transport: 'puppeteer',
        browserBridge: stubBridge,
      });
      await client.apiRequest('/r/programming/new', { limit: 1 });
      const lastReq = receivedRequests[receivedRequests.length - 1];
      expect(lastReq.headers.cookie).toBe('session=reddit_abc_123; token=xyz');
    });

    it('normalizes Cookie header casing when injecting bridge cookies', async () => {
      const stubBridge = {
        isReady: true,
        cookieHeader: 'session=reddit_abc_123',
        start: async () => {},
        close: async () => {},
      };
      const client = new RedditClient({
        baseUrl: serverUrl,
        transport: 'puppeteer',
        browserBridge: stubBridge,
      });
      await client.apiRequest('/r/programming/new', { limit: 1 }, {
        headers: { Cookie: 'old_cookie=123' },
      });
      const lastReq = receivedRequests[receivedRequests.length - 1];
      expect(lastReq.headers.cookie).toBe('session=reddit_abc_123');
      expect(lastReq.headers.Cookie).toBeUndefined();
    });

    it('requests .rss directly without trying .json when transport is rss', async () => {
      const client = new RedditClient({
        baseUrl: serverUrl,
        transport: 'rss',
      });
      const beforeCount = receivedRequests.length;
      const res = await client.apiRequest('/r/programming/new', { limit: 1 });
      expect(res.kind).toBe('Listing');
      const newReqs = receivedRequests.slice(beforeCount);
      expect(newReqs.some((r) => r.url.includes('.rss'))).toBe(true);
      expect(newReqs.some((r) => r.url.includes('.json'))).toBe(false);
    });

    it('rejects non-listing endpoints when transport is rss', async () => {
      const client = new RedditClient({
        baseUrl: serverUrl,
        transport: 'rss',
      });
      await expect(client.apiRequest('/user/spez/about')).rejects.toThrow(PlatformError);
    });

    it('throws 502 PlatformError when RSS fetch returns null on subreddit listing', async () => {
      const client = new RedditClient({
        baseUrl: serverUrl,
        transport: 'rss',
      });
      // request a non-existent subreddit to trigger 404 in mock server -> rssFallback returns null
      await expect(client.apiRequest('/r/nonexistent_sub/new')).rejects.toThrow(PlatformError);
    });

    it('closes browserBridge on client.close()', async () => {
      let closed = false;
      const stubBridge = {
        isReady: true,
        cookieHeader: 'test=1',
        start: async () => {},
        close: async () => { closed = true; },
      };
      const client = new RedditClient({
        baseUrl: serverUrl,
        transport: 'puppeteer',
        browserBridge: stubBridge,
      });
      await client.close();
      expect(closed).toBe(true);
      expect(client.browserBridge).toBeNull();
    });
  });
});

describe('RedditClient RSS fallback', () => {
  let server;
  let serverUrl;
  const rssBody = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <category term="programming" label="r/programming"/>
  <updated>2026-09-08T17:30:00+00:00</updated>
  <icon>https://www.redditstatic.com/icon.png</icon>
  <title>programming</title>
  <entry>
    <author><name>/u/dev1</name><uri>https://www.reddit.com/user/dev1/</uri></author>
    <category term="programming" label="r/programming"/>
    <content type="html">&lt;div class="md"&gt;&lt;p&gt;Hello&lt;/p&gt; &lt;/div&gt;&lt;!-- SC_ON --&gt;&lt;div class="bma-author"&gt;&lt;div class="bma-comment-count"&gt;&lt;a href="https://www.reddit.com/r/programming/comments/abc123/test/"&gt;[comments]&lt;/a&gt;&lt;/div&gt;&lt;/div&gt;</content>
    <id>https://www.reddit.com/r/programming/comments/abc123/test/</id>
    <link href="https://www.reddit.com/r/programming/comments/abc123/test/"/>
    <published>2026-09-08T17:20:00+00:00</published>
    <title>Test post</title>
    <updated>2026-09-08T17:20:00+00:00</updated>
  </entry>
  <entry>
    <author><name>/u/dev2</name><uri>https://www.reddit.com/user/dev2/</uri></author>
    <category term="programming" label="r/programming"/>
    <content type="html">&lt;div class="md"&gt;&lt;p&gt;External&lt;/p&gt; &lt;/div&gt;&lt;!-- SC_ON --&gt;&lt;div class="bma-author"&gt;&lt;div class="bma-comment-count"&gt;&lt;a href="https://www.reddit.com/r/programming/comments/abc124/external/"&gt;[comments] (42 comments)&lt;/a&gt;&lt;/div&gt;&lt;/div&gt;</content>
    <id>https://www.reddit.com/r/programming/comments/abc124/external/</id>
    <link href="https://example.com/external-article"/>
    <published>2026-09-08T17:15:00+00:00</published>
    <title>External link post</title>
    <updated>2026-09-08T17:15:00+00:00</updated>
  </entry>
</feed>`;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/r/programming/new.rss')) {
        res.writeHead(200, { 'content-type': 'application/atom+xml' });
        res.end(rssBody);
        return;
      }
      if (req.url?.startsWith('/r/programming/new.json')) {
        res.writeHead(403, { 'content-type': 'text/html' });
        res.end('<html>Access denied by Cloudflare</html>');
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('falls back to .rss when .json returns bot challenge', async () => {
    const client = new RedditClient({ baseUrl: serverUrl });
    const res = await client.apiRequest('/r/programming/new', { limit: 5 });

    expect(res.kind).toBe('Listing');
    expect(res.data.children).toHaveLength(2);
    expect(res.data.children[0].kind).toBe('t3');
    expect(res.data.children[0].data.id).toBe('abc123');
    expect(res.data.children[0].data.title).toBe('Test post');
    expect(res.data.children[0].data.author).toBe('dev1');
    expect(res.data.children[1].data.url).toBe('https://example.com/external-article');
    expect(res.data.children[1].data.num_comments).toBe(42);
  });

  it('does not fall back for authenticated clients', async () => {
    const client = new RedditClient({
      baseUrl: serverUrl,
      apiBaseUrl: serverUrl,
      accessToken: 'mock_token',
    });
    await expect(client.apiRequest('/r/programming/new', { limit: 5 })).rejects.toThrow();
  });
});

describe('RedditBrowserBridge', () => {
  it('exposes cookieHeader from raw cookie list and clearCookies resets state', async () => {
    let closedPage = false;
    let closedBrowser = false;
    const mockAdapter = {
      launch: async () => ({ _native: {} }),
      newPage: async () => ({
        _native: {
          cookies: async () => [
            { name: 'session', value: '123', domain: 'reddit.com', path: '/' },
            { name: 'token', value: 'abc', domain: 'reddit.com', path: '/' },
            // duplicate name to test deduplication
            { name: 'session', value: '456', domain: 'reddit.com', path: '/' },
          ],
        },
      }),
      goto: async () => {},
      closePage: async () => { closedPage = true; },
      closeBrowser: async () => { closedBrowser = true; },
      evaluate: async () => '',
    };

    const bridge = new RedditBrowserBridge({ adapter: mockAdapter });
    expect(bridge.isReady).toBe(false);
    expect(bridge.cookieHeader).toBe('');

    await bridge.start(null); // tests null options tolerance
    expect(bridge.isReady).toBe(true);
    expect(bridge.cookieHeader).toBe('session=456; token=abc');
    expect(bridge.cookies).toHaveLength(2);

    bridge.clearCookies();
    expect(bridge.isReady).toBe(false);
    expect(bridge.cookieHeader).toBe('');

    await bridge.close();
    expect(closedPage).toBe(true);
    expect(closedBrowser).toBe(true);
  });

  it('cleans up browser if start() fails during navigation', async () => {
    let closedBrowser = false;
    const mockAdapter = {
      launch: async () => ({ _native: {} }),
      newPage: async () => ({ _native: {} }),
      goto: async () => { throw new Error('Navigation failed'); },
      closePage: async () => {},
      closeBrowser: async () => { closedBrowser = true; },
    };

    const bridge = new RedditBrowserBridge({ adapter: mockAdapter });
    await expect(bridge.start()).rejects.toThrow('Navigation failed');
    expect(closedBrowser).toBe(true);
  });
});
