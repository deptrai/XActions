// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { MediumClient, createMediumClient, DEFAULT_MEDIUM_BASE_URL, DEFAULT_MEDIUM_USER_AGENT, XSSI_PREFIX } from '../../../../src/scrapers/social/medium/client.js';
import { MediumPlatformResponseValidator } from '../../../../src/scrapers/social/medium/validator.js';
import { PlatformError, RateLimitError, BotChallengeError } from '../../../../src/core/error-envelope.js';

function makeMediumJsonResponse(payload, includePrefix = false) {
  const body = JSON.stringify(payload);
  return includePrefix ? `${XSSI_PREFIX}${body}` : body;
}

function makeRssItem(props) {
  const guid = props.guid || `https://medium.com/p/${props.postId}`;
  return `
    <item>
      <title>${props.title}</title>
      <link>${props.link}</link>
      <guid isPermaLink="true">${guid}</guid>
      <pubDate>${props.pubDate}</pubDate>
      <dc:creator>${props.creator}</dc:creator>
      <category>${props.category || 'programming'}</category>
      <content:encoded><![CDATA[${props.content || ''}]]></content:encoded>
    </item>
  `;
}

describe('MediumClient (RSS-first with JSON fallback)', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const urlObj = new URL(req.url, 'http://127.0.0.1');
      receivedRequests.push({
        method: req.method,
        url: req.url,
        'user-agent': req.headers['user-agent'],
        accept: req.headers.accept,
      });

      // User RSS feed
      if (urlObj.pathname === '/feed/@testuser') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Test User</title>
    ${makeRssItem({
      title: 'First Post',
      postId: 'abc123def456',
      link: 'https://medium.com/@testuser/first-post-abc123def456',
      guid: 'https://medium.com/p/abc123def456',
      pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
      creator: 'Test User',
      category: 'programming',
      content: '<p>Hello world</p><img src="https://cdn.example/hero.jpg" />',
    })}
  </channel>
</rss>`);
        return;
      }

      // Publication RSS feed
      if (urlObj.pathname === '/feed/towards-data-science') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>TDS</title>
    ${makeRssItem({
      title: 'ML Post',
      postId: 'def789abc012',
      link: 'https://medium.com/towards-data-science/ml-post-def789abc012',
      guid: 'https://medium.com/p/def789abc012',
      pubDate: 'Mon, 02 Jan 2024 00:00:00 GMT',
      creator: 'Author One',
      category: 'machine-learning',
      content: '<p>ML content</p>',
    })}
  </channel>
</rss>`);
        return;
      }

      // Publication + tag RSS
      if (urlObj.pathname === '/feed/towards-data-science/tagged/ai') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>TDS AI</title>
    ${makeRssItem({
      title: 'AI Post',
      postId: 'aabbccdd0011',
      link: 'https://medium.com/towards-data-science/ai-post-aabbccdd0011',
      guid: 'https://medium.com/p/aabbccdd0011',
      pubDate: 'Mon, 03 Jan 2024 00:00:00 GMT',
      creator: 'AI Author',
      category: 'artificial-intelligence',
      content: '<p>AI content</p>',
    })}
  </channel>
</rss>`);
        return;
      }

      // Tag RSS feed
      if (urlObj.pathname === '/feed/tag/programming') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Programming</title>
    ${makeRssItem({
      title: 'Code Post',
      postId: '112233445566',
      link: 'https://medium.com/@dev/code-post-112233445566',
      guid: 'https://medium.com/p/112233445566',
      pubDate: 'Mon, 04 Jan 2024 00:00:00 GMT',
      creator: 'Dev Author',
      category: 'programming',
      content: '<p>Code content</p>',
    })}
  </channel>
</rss>`);
        return;
      }

      // User JSON feed
      if (urlObj.pathname === '/@testuser' && urlObj.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(makeMediumJsonResponse({
          payload: {
            references: {
              Post: {
                'abc123def456': {
                  id: 'abc123def456',
                  title: 'JSON Post',
                  mediumUrl: 'https://medium.com/@testuser/json-post-abc123def456',
                  firstPublishedAt: 1704067200000,
                  latestPublishedAt: 1704067200000,
                  creatorId: 'user:u1',
                  content: {
                    subtitle: 'Subtitle',
                    bodyModel: {
                      paragraphs: [{ text: 'Body paragraph' }],
                    },
                  },
                  virtuals: {
                    totalClapCount: 42,
                    responsesCreatedCount: 7,
                    reads: 1234,
                    tags: [{ name: 'programming' }],
                  },
                },
              },
              User: {
                'user:u1': { name: 'Test User', username: 'testuser' },
              },
            },
            paging: {
              next: { to: 'cursor1' },
            },
          },
        }, true));
        return;
      }

      // Publication JSON feed
      if (urlObj.pathname === '/towards-data-science' && urlObj.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(makeMediumJsonResponse({
          payload: {
            references: {
              Post: {
                'def789abc012': {
                  id: 'def789abc012',
                  title: 'TDS JSON Post',
                  mediumUrl: 'https://medium.com/towards-data-science/tds-json-post-def789abc012',
                  firstPublishedAt: 1704153600000,
                  latestPublishedAt: 1704153600000,
                  creatorId: 'user:u2',
                  content: { subtitle: '', bodyModel: { paragraphs: [] } },
                  virtuals: {
                    totalClapCount: 10,
                    responsesCreatedCount: 1,
                    reads: 100,
                    tags: [{ name: 'data-science' }],
                  },
                },
              },
              User: {
                'user:u2': { name: 'TDS Author', username: 'tdsauthor' },
              },
            },
            paging: { next: null },
          },
        }, true));
        return;
      }

      // Single post JSON with optional redirect
      if (urlObj.pathname === '/@testuser/first-post-abc123def456' && urlObj.searchParams.get('format') === 'json') {
        if (urlObj.searchParams.has('redirect')) {
          res.writeHead(301, { location: `/@testuser/renamed-post-abc123def456?format=json` });
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(makeMediumJsonResponse({
          payload: {
            value: {
              id: 'abc123def456',
              title: 'First Post',
              mediumUrl: 'https://medium.com/@testuser/first-post-abc123def456',
              firstPublishedAt: 1704067200000,
              latestPublishedAt: 1704067200000,
              creatorId: 'user:u1',
              content: {
                subtitle: 'First subtitle',
                bodyModel: { paragraphs: [{ text: 'First body' }] },
              },
              virtuals: {
                totalClapCount: 5,
                responsesCreatedCount: 0,
                reads: 42,
                tags: [{ name: 'programming' }],
              },
            },
            references: {
              User: { 'user:u1': { name: 'Test User', username: 'testuser' } },
            },
          },
        }, true));
        return;
      }

      // Redirect target
      if (urlObj.pathname === '/@testuser/renamed-post-abc123def456' && urlObj.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(makeMediumJsonResponse({
          payload: {
            value: {
              id: 'abc123def456',
              title: 'Renamed Post',
              mediumUrl: 'https://medium.com/@testuser/renamed-post-abc123def456',
              firstPublishedAt: 1704067200000,
              latestPublishedAt: 1704067200000,
              creatorId: 'user:u1',
              content: {
                subtitle: 'Renamed subtitle',
                bodyModel: { paragraphs: [{ text: 'Renamed body' }] },
              },
              virtuals: {
                totalClapCount: 8,
                responsesCreatedCount: 0,
                reads: 99,
                tags: [{ name: 'programming' }],
              },
            },
            references: {
              User: { 'user:u1': { name: 'Test User', username: 'testuser' } },
            },
          },
        }, true));
        return;
      }

      // Short post JSON
      if (urlObj.pathname === '/p/abc123def456' && urlObj.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(makeMediumJsonResponse({
          payload: {
            value: {
              id: 'abc123def456',
              title: 'Short Post',
              mediumUrl: 'https://medium.com/p/abc123def456',
              firstPublishedAt: 1704067200000,
              latestPublishedAt: 1704067200000,
              creatorId: 'user:u1',
              content: {
                subtitle: 'Short subtitle',
                bodyModel: { paragraphs: [{ text: 'Short body' }] },
              },
              virtuals: {
                totalClapCount: 3,
                responsesCreatedCount: 0,
                reads: 10,
                tags: [{ name: 'programming' }],
              },
            },
            references: {
              User: { 'user:u1': { name: 'Test User', username: 'testuser' } },
            },
          },
        }, true));
        return;
      }

      // Rate limit test
      if (urlObj.pathname === '/rate-limit') {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'too many requests' }));
        return;
      }

      // Cloudflare bot challenge test
      if (urlObj.pathname === '/bot-challenge') {
        res.writeHead(403, { 'content-type': 'text/html' });
        res.end('<html><body>Attention Required! | Cloudflare</body></html>');
        return;
      }

      // Login wall test
      if (urlObj.pathname === '/login-wall') {
        res.writeHead(401, { 'content-type': 'text/html' });
        res.end('<html><body>Sign in with Google to continue</body></html>');
        return;
      }

      // Empty RSS -> fallback to JSON
      if (urlObj.pathname === '/feed/@emptyuser') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end('<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>');
        return;
      }

      if (urlObj.pathname === '/feed/tag/emptytag') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end('<?xml version="1.0"?><rss version="2.0"><channel><title>Empty Tag</title></channel></rss>');
        return;
      }

      if (urlObj.pathname === '/@emptyuser' && urlObj.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(makeMediumJsonResponse({
          payload: {
            references: {
              Post: {
                'empty0011223': {
                  id: 'empty0011223',
                  title: 'Fallback Post',
                  mediumUrl: 'https://medium.com/@emptyuser/fallback-post-empty0011223',
                  firstPublishedAt: 1704067200000,
                  latestPublishedAt: 1704067200000,
                  creatorId: 'user:u1',
                  content: { subtitle: '', bodyModel: { paragraphs: [{ text: 'Fallback body' }] } },
                  virtuals: { totalClapCount: 0, responsesCreatedCount: 0, reads: 0, tags: [] },
                },
              },
              User: { 'user:u1': { name: 'Empty User', username: 'emptyuser' } },
            },
            paging: { next: null },
          },
        }, true));
        return;
      }

      // Tag JSON feed fallback
      if (urlObj.pathname === '/tag/programming' && urlObj.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(makeMediumJsonResponse({
          payload: {
            references: {
              Post: {
                'tagjson001122': {
                  id: 'tagjson001122',
                  title: 'Tag JSON Post',
                  mediumUrl: 'https://medium.com/tag/programming/tag-json-post-tagjson001122',
                  firstPublishedAt: 1704067200000,
                  latestPublishedAt: 1704067200000,
                  creatorId: 'user:u1',
                  content: { subtitle: '', bodyModel: { paragraphs: [{ text: 'Tag body' }] } },
                  virtuals: { totalClapCount: 2, responsesCreatedCount: 0, reads: 10, tags: [{ name: 'programming' }] },
                },
              },
              User: { 'user:u1': { name: 'Tag Author', username: 'tagauthor' } },
            },
            paging: { next: null },
          },
        }, true));
        return;
      }

      if (urlObj.pathname === '/tag/emptytag' && urlObj.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(makeMediumJsonResponse({
          payload: {
            references: {
              Post: {
                'emptytag001122': {
                  id: 'emptytag001122',
                  title: 'Tag Fallback Post',
                  mediumUrl: 'https://medium.com/tag/emptytag/tag-fallback-post-emptytag001122',
                  firstPublishedAt: 1704067200000,
                  latestPublishedAt: 1704067200000,
                  creatorId: 'user:u1',
                  content: { subtitle: '', bodyModel: { paragraphs: [{ text: 'Tag fallback body' }] } },
                  virtuals: { totalClapCount: 0, responsesCreatedCount: 0, reads: 1, tags: [] },
                },
              },
              User: { 'user:u1': { name: 'Tag Author', username: 'tagauthor' } },
            },
            paging: { next: null },
          },
        }, true));
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => {
    if (server) server.close();
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  it('initializes with correct metadata', () => {
    const client = new MediumClient({
      baseUrl: serverUrl,
      delayMin: 0,
      delayMax: 0,
    });
    expect(client.name).toBe('medium');
    expect(client.platform).toBe('medium');
    expect(client.requiresAuth).toBe(false);
    expect(client.requiresProxy).toBe(false);
    expect(client.client).toBe('undici');
    expect(client.baseUrl).toBe(serverUrl);
  });

  it('defaults to a realistic Chrome User-Agent', () => {
    const client = new MediumClient({ baseUrl: serverUrl });
    expect(client.userAgent).toMatch(/Chrome\/\d+/);
  });

  it('buildUrl preserves absolute URLs and appends query params', () => {
    const client = new MediumClient({ baseUrl: serverUrl });
    expect(client.buildUrl('/feed/@testuser')).toBe(`${serverUrl}/feed/@testuser`);
    expect(client.buildUrl('/post', { format: 'json', source: 'rss' })).toBe(`${serverUrl}/post?format=json&source=rss`);
    expect(client.buildUrl('https://example.com/post?source=track', { format: 'json' })).toBe('https://example.com/post?source=track&format=json');
  });

  it('parses an RSS user feed and returns items', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getUserFeed('testuser');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBe(1);
    const item = result.items[0];
    expect(item.title).toMatch(/First Post/);
    expect(result.paging.next).toBeNull();
  });

  it('falls back to JSON when RSS is empty', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getUserFeed('emptyuser');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toBe('Fallback Post');
  });

  it('fetches a user JSON feed when transport is http', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getUserFeed('testuser', { transport: 'http', limit: 5 });
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toBe('JSON Post');
    expect(result.paging.next).toEqual({ to: 'cursor1' });
  });

  it('fetches a publication RSS feed', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getPublicationFeed('towards-data-science');
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toMatch(/ML Post/);
  });

  it('fetches a publication+tag RSS feed', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getPublicationFeed('towards-data-science', { tag: 'ai' });
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toBe('AI Post');
  });

  it('fetches a tag RSS feed', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getTagFeed('programming');
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toBe('Code Post');
  });

  it('fetches a tag JSON feed when transport is http', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getTagFeed('programming', { transport: 'http', limit: 5 });
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toBe('Tag JSON Post');
  });

  it('falls back to JSON when tag RSS is empty', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getTagFeed('emptytag');
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toBe('Tag Fallback Post');
  });

  it('fetches a single post by full URL', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getPost(`${serverUrl}/@testuser/first-post-abc123def456`);
    expect(result.id).toBe('abc123def456');
    expect(result.title).toBe('First Post');
  });

  it('fetches a single post by raw post id', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getPost('abc123def456');
    expect(result.id).toBe('abc123def456');
    expect(result.title).toBe('Short Post');
  });

  it('follows redirects when resolving a post URL', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const result = await client.getPost(`${serverUrl}/@testuser/first-post-abc123def456?redirect=true`);
    expect(result.title).toBe('Renamed Post');
  });

  it('sends correct Accept headers for RSS and JSON', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    await client.getUserFeed('testuser');
    const rssReq = receivedRequests.find((r) => r.url.startsWith('/feed/@testuser'));
    expect(rssReq.accept).toMatch(/application\/rss\+xml|application\/atom\+xml/);

    await client.getUserFeed('testuser', { transport: 'http' });
    const jsonReq = receivedRequests.find((r) => r.url.startsWith('/@testuser?format=json') || r.url.startsWith('/@testuser?format=json'));
    expect(jsonReq.accept).toBe('application/json');
  });

  it('throttles requests with gaussian delay disabled in test mode', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    const start = Date.now();
    await client.getUserFeed('testuser');
    await client.getUserFeed('testuser', { transport: 'http' });
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('throws PlatformError when post id and url are missing', async () => {
    const client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
    await expect(client.getPost('')).rejects.toThrow(PlatformError);
  });

  it('throws RateLimitError on 429 response', async () => {
    const client = new MediumClient({
      baseUrl: serverUrl,
      delayMin: 0,
      delayMax: 0,
      maxProxyRetries: 1,
      backoffBaseMs: 1,
      backoffMultiplier: 1,
      maxBackoffMs: 1,
    });
    await expect(client.request('GET', `${serverUrl}/rate-limit`)).rejects.toThrow(RateLimitError);
  });

  it('throws BotChallengeError on 403 Cloudflare response', async () => {
    const client = new MediumClient({
      baseUrl: serverUrl,
      delayMin: 0,
      delayMax: 0,
      maxProxyRetries: 1,
      backoffBaseMs: 1,
      backoffMultiplier: 1,
      maxBackoffMs: 1,
    });
    await expect(client.request('GET', `${serverUrl}/bot-challenge`)).rejects.toThrow(BotChallengeError);
  });

  it('merges US/residential preferences only when proxy infrastructure exists', () => {
    const client = new MediumClient({ baseUrl: serverUrl });
    expect(() => client.resolveProxy()).toThrow(PlatformError);

    const proxyProvider = { getProxy: ({ accountId, requiresResidential, pool, consumerId }) => ({ server: 'http://proxy.example', consumerId }) };
    const clientWithProxy = new MediumClient({
      baseUrl: serverUrl,
      proxyProvider,
    });
    const proxy = clientWithProxy.resolveProxy(null, false, false, { consumerId: 'test' });
    expect(proxy).toEqual({ server: 'http://proxy.example', consumerId: 'test' });
  });

  it('sign returns an empty object and init is a no-op', async () => {
    const client = new MediumClient({ baseUrl: serverUrl });
    expect(await client.sign()).toEqual({});
    expect(await client.init()).toBeUndefined();
  });
});
