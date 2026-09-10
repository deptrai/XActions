// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { MediumCrawler } from '../../../../src/scrapers/social/medium/crawler.js';
import { MediumClient } from '../../../../src/scrapers/social/medium/client.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';
import { AbstractStore } from '../../../../src/core/base-store.js';

const XSSI_PREFIX = '])}while(1);</x>';

function makeMediumJsonResponse(payload) {
  return `${XSSI_PREFIX}${JSON.stringify(payload)}`;
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

class InMemoryStore extends AbstractStore {
  constructor({ existingIds = [], insertedCount, totalCount } = {}) {
    super();
    this.existingIds = new Set(existingIds);
    this.insertedCount = insertedCount;
    this.totalCount = totalCount;
    this.checkpoints = [];
    this.batches = [];
    this.storedComments = [];
  }

  async storeBatch(posts) {
    this.batches.push(posts);
    return {
      insertedCount: this.insertedCount ?? posts.length,
      totalCount: this.totalCount ?? posts.length,
      duplicateCount: 0,
      schemaValid: true,
    };
  }

  async storeContent(post) {
    return { insertedCount: 1, totalCount: 1, duplicateCount: 0, schemaValid: true };
  }

  async findExistingIds(ids) {
    return ids.filter((id) => this.existingIds.has(id));
  }

  async saveCheckpoint(checkpoint) {
    this.checkpoints.push(checkpoint);
  }

  async init() {
    // No-op for in-memory test store.
  }

  async storeComment(comment) {
    this.storedComments.push(comment);
  }

  async storeCommentBatch(comments) {
    this.storedComments.push(...comments);
  }
}

describe('MediumCrawler', () => {
  let server;
  let serverUrl;
  let client;

  beforeAll(async () => {
    process.env.REDIS_STREAM_ENABLED = 'false';

    server = http.createServer((req, res) => {
      const urlObj = new URL(req.url, 'http://127.0.0.1');

      if (urlObj.pathname === '/feed/@testuser') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Test User</title>
    ${makeRssItem({
      title: 'Crawler Post',
      postId: 'abc123def456',
      link: 'https://medium.com/@testuser/crawler-post-abc123def456',
      guid: 'https://medium.com/p/abc123def456',
      pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT',
      creator: 'Test User',
      category: 'programming',
      content: '<p>Crawler content</p>',
    })}
  </channel>
</rss>`);
        return;
      }

      if (urlObj.pathname === '/feed/towards-data-science') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>TDS</title>
    ${makeRssItem({
      title: 'TDS Post',
      postId: 'def789abc012',
      link: 'https://medium.com/towards-data-science/tds-post-def789abc012',
      guid: 'https://medium.com/p/def789abc012',
      pubDate: 'Tue, 02 Jan 2024 00:00:00 GMT',
      creator: 'TDS Author',
      category: 'data-science',
      content: '<p>TDS content</p>',
    })}
  </channel>
</rss>`);
        return;
      }

      if (urlObj.pathname === '/feed/towards-data-science/tagged/ai') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>TDS AI</title>
    ${makeRssItem({
      title: 'TDS AI Post',
      postId: 'aabbccdd0011',
      link: 'https://medium.com/towards-data-science/ai-post-aabbccdd0011',
      guid: 'https://medium.com/p/aabbccdd0011',
      pubDate: 'Wed, 03 Jan 2024 00:00:00 GMT',
      creator: 'AI Author',
      category: 'artificial-intelligence',
      content: '<p>AI content</p>',
    })}
  </channel>
</rss>`);
        return;
      }

      if (urlObj.pathname === '/feed/tag/programming') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Programming</title>
    ${makeRssItem({
      title: 'Tag Post',
      postId: '112233445566',
      link: 'https://medium.com/@dev/tag-post-112233445566',
      guid: 'https://medium.com/p/112233445566',
      pubDate: 'Thu, 04 Jan 2024 00:00:00 GMT',
      creator: 'Dev Author',
      category: 'programming',
      content: '<p>Tag content</p>',
    })}
  </channel>
</rss>`);
        return;
      }

      if (urlObj.pathname === '/@testuser' && urlObj.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(makeMediumJsonResponse({
          payload: {
            references: {
              Post: {
                'abc123def456': {
                  id: 'abc123def456',
                  title: 'JSON User Post',
                  mediumUrl: 'https://medium.com/@testuser/json-post-abc123def456',
                  firstPublishedAt: 1704067200000,
                  latestPublishedAt: 1704067200000,
                  creatorId: 'user:u1',
                  content: { subtitle: '', bodyModel: { paragraphs: [{ text: 'JSON body' }] } },
                  virtuals: { totalClapCount: 5, responsesCreatedCount: 0, reads: 42, tags: [] },
                },
              },
              User: { 'user:u1': { name: 'Test User' } },
            },
            paging: { next: urlObj.searchParams.get('to') ? { to: 'cursor2' } : { to: 'cursor1' } },
          },
        }));
        return;
      }

      if (urlObj.pathname === '/p/abc123def456' && urlObj.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(makeMediumJsonResponse({
          payload: {
            value: {
              id: 'abc123def456',
              title: 'Single Post',
              mediumUrl: 'https://medium.com/p/abc123def456',
              firstPublishedAt: 1704067200000,
              latestPublishedAt: 1704067200000,
              creatorId: 'user:u1',
              content: { subtitle: '', bodyModel: { paragraphs: [{ text: 'Single body' }] } },
              virtuals: { totalClapCount: 9, responsesCreatedCount: 1, reads: 99, tags: [] },
            },
            references: {
              User: { 'user:u1': { name: 'Post Author' } },
            },
          },
        }));
        return;
      }

      res.writeHead(404);
      res.end('not found');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;
    client = new MediumClient({ baseUrl: serverUrl, delayMin: 0, delayMax: 0 });
  });

  afterAll(() => {
    if (server) server.close();
    if (client && typeof client.close === 'function') client.close();
    process.env.REDIS_STREAM_ENABLED = '';
  });

  it('registers the expected actions and aliases', () => {
    const crawler = new MediumCrawler({ client });
    const actions = crawler.listActions().map((a) => a.action);
    expect(actions).toContain('user');
    expect(actions).toContain('author');
    expect(actions).toContain('publication');
    expect(actions).toContain('pub');
    expect(actions).toContain('tag');
    expect(actions).toContain('hashtag');
    expect(actions).toContain('post');
    expect(actions).toContain('article');
  });

  it('getUser returns PostItem[] and correct pageInfo', async () => {
    const crawler = new MediumCrawler({ client });
    const result = await crawler.start({ action: 'user', args: { username: 'testuser', limit: 3 } });

    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBe(1);
    expect(result.posts[0].id).toBe('medium:abc123def456');
    expect(result.posts[0].platform).toBe('medium');
    expect(result.pageInfo).toEqual({ end_cursor: null, has_next_page: false });
  });

  it('getUser with http transport returns paginated pageInfo', async () => {
    const crawler = new MediumCrawler({ client });
    const result = await crawler.start({ action: 'user', args: { username: 'testuser', limit: 3, transport: 'http' } });

    expect(result.posts.length).toBe(1);
    expect(result.posts[0].title).toBe('JSON User Post');
    expect(result.pageInfo.end_cursor).toBe(JSON.stringify({ to: 'cursor1' }));
    expect(result.pageInfo.has_next_page).toBe(true);
  });

  it('getPublication returns posts and maps tag targetKey', async () => {
    const store = new InMemoryStore();
    const crawler = new MediumCrawler({ client, store });
    const result = await crawler.start({ action: 'publication', args: { slug: 'towards-data-science', limit: 3 } });

    expect(result.posts.length).toBe(1);
    expect(result.posts[0].title).toBe('TDS Post');
    expect(store.checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(store.checkpoints[0].targetType).toBe('publication');
  });

  it('getPublication with tag returns publication_tag targetKey', async () => {
    const store = new InMemoryStore();
    const crawler = new MediumCrawler({ client, store });
    const result = await crawler.start({ action: 'publication', args: { slug: 'towards-data-science', tag: 'ai', limit: 3 } });

    expect(result.posts[0].title).toBe('TDS AI Post');
    expect(store.checkpoints[0].targetType).toBe('publication_tag');
    expect(store.checkpoints[0].targetKey).toBe('towards-data-science:ai');
  });

  it('getTag returns posts', async () => {
    const crawler = new MediumCrawler({ client });
    const result = await crawler.start({ action: 'tag', args: { tag: 'programming', limit: 3 } });
    expect(result.posts[0].title).toBe('Tag Post');
  });

  it('getPost returns a single normalized post', async () => {
    const store = new InMemoryStore();
    const crawler = new MediumCrawler({ client, store });
    const result = await crawler.start({ action: 'post', args: { postId: 'abc123def456' } });

    expect(result.post.id).toBe('medium:abc123def456');
    expect(result.post.title).toBe('Single Post');
    expect(result.post.authorName).toBe('Post Author');
    expect(store.checkpoints[0].targetType).toBe('post');
  });

  it('uses aliases and normalizes argument names', async () => {
    const crawler = new MediumCrawler({ client });
    const r1 = await crawler.start({ action: 'author', args: { username: 'testuser', limit: 3 } });
    expect(r1.posts[0].title).toBe('Crawler Post');

    const r2 = await crawler.start({ action: 'pub', args: { slug: 'towards-data-science', limit: 3 } });
    expect(r2.posts[0].title).toBe('TDS Post');

    const r3 = await crawler.start({ action: 'hashtag', args: { tag: 'programming', limit: 3 } });
    expect(r3.posts[0].title).toBe('Tag Post');

    const r4 = await crawler.start({ action: 'article', args: { postId: 'abc123def456' } });
    expect(r4.post.title).toBe('Single Post');
  });

  it('stops pagination when all posts are duplicates', async () => {
    const store = new InMemoryStore({
      existingIds: ['medium:abc123def456'],
      insertedCount: 0,
      totalCount: 1,
    });
    const crawler = new MediumCrawler({ client, store });
    const result = await crawler.start({ action: 'user', args: { username: 'testuser', limit: 3, transport: 'http' } });

    expect(result.posts.length).toBe(1);
    expect(result.pageInfo.has_next_page).toBe(false);
  });

  it('validates items and throws on invalid args', async () => {
    const crawler = new MediumCrawler({ client });
    await expect(crawler.start({ action: 'user', args: {} })).rejects.toThrow(PlatformError);
    await expect(crawler.start({ action: 'post', args: {} })).rejects.toThrow(PlatformError);
  });

  it('injects cursor into pageInfo and checkpoint', async () => {
    const store = new InMemoryStore();
    const crawler = new MediumCrawler({ client, store });
    const result = await crawler.start({ action: 'user', args: { username: 'testuser', cursor: 'cursor1', limit: 3, transport: 'http' } });

    expect(result.pageInfo.end_cursor).toBe('cursor1');
    expect(result.pageInfo.has_next_page).toBe(true);
    expect(store.checkpoints[0].lastCursor).toBe('cursor1');
    expect(store.checkpoints[0].status).toBe('has_more');
  });

  it('cleanup closes the client', async () => {
    const crawler = new MediumCrawler({ client });
    await crawler.cleanup();
    expect(crawler.client.bridge).toBeNull();
  });
});
