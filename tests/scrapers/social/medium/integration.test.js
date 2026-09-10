// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { scrape, platforms } from '../../../../src/scrapers/index.js';
import { AbstractStore } from '../../../../src/core/base-store.js';

class InMemoryStore extends AbstractStore {
  constructor() {
    super();
    this.checkpoints = [];
  }

  async init() {}

  async storeBatch(posts) {
    return { insertedCount: posts.length, totalCount: posts.length, duplicateCount: 0, schemaValid: true };
  }

  async storeContent(post) {
    return { insertedCount: 1, totalCount: 1, duplicateCount: 0, schemaValid: true };
  }

  async findExistingIds() {
    return [];
  }

  async saveCheckpoint(checkpoint) {
    this.checkpoints.push(checkpoint);
  }

  async storeComment() {}

  async storeCommentBatch() {}
}

describe('Medium Integration (Unified Dispatcher)', () => {
  let server;
  let serverUrl;
  let store;

  beforeAll(async () => {
    process.env.REDIS_STREAM_ENABLED = 'false';
    store = new InMemoryStore();

    server = http.createServer((req, res) => {
      const urlObj = new URL(req.url, 'http://127.0.0.1');

      if (urlObj.pathname === '/feed/@testuser') {
        res.writeHead(200, { 'content-type': 'application/rss+xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Test User</title>
    <item>
      <title>Dispatcher Post</title>
      <link>https://medium.com/@testuser/dispatcher-post-abc123def456</link>
      <guid isPermaLink="true">https://medium.com/p/abc123def456</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <dc:creator>Test User</dc:creator>
      <category>programming</category>
      <content:encoded><![CDATA[<p>Dispatched content</p>]]></content:encoded>
    </item>
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
    <item>
      <title>Dispatcher Publication Post</title>
      <link>https://medium.com/towards-data-science/dispatcher-pub-def789abc012</link>
      <guid isPermaLink="true">https://medium.com/p/def789abc012</guid>
      <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
      <dc:creator>TDS</dc:creator>
      <category>data-science</category>
      <content:encoded><![CDATA[<p>Publication content</p>]]></content:encoded>
    </item>
  </channel>
</rss>`);
        return;
      }

      if (urlObj.pathname === '/p/abc123def456' && urlObj.searchParams.get('format') === 'json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('])}while(1);</x>' + JSON.stringify({
          payload: {
            value: {
              id: 'abc123def456',
              title: 'Dispatcher Single Post',
              mediumUrl: 'https://medium.com/p/abc123def456',
              firstPublishedAt: 1704067200000,
              latestPublishedAt: 1704067200000,
              creatorId: 'user:u1',
              content: { subtitle: '', bodyModel: { paragraphs: [{ text: 'Body' }] } },
              virtuals: { totalClapCount: 1, responsesCreatedCount: 0, reads: 5, tags: [] },
            },
            references: {
              User: { 'user:u1': { name: 'Dispatcher Author' } },
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
  });

  afterAll(() => {
    if (server) server.close();
    process.env.REDIS_STREAM_ENABLED = '';
  });

  it('exposes medium platform and aliases', () => {
    expect(platforms).toHaveProperty('medium');
    expect(platforms).toHaveProperty('md');
  });

  it('scrape() dispatches medium user action', async () => {
    const result = await scrape('medium', 'user', { username: 'testuser', limit: 3, baseUrl: serverUrl, store });
    expect(result).toHaveProperty('posts');
    expect(result.posts.length).toBe(1);
    expect(result.posts[0].platform).toBe('medium');
    expect(result.posts[0].title).toBe('Dispatcher Post');
  });

  it('scrape() dispatches via md alias for publication', async () => {
    const result = await scrape('md', 'publication', { slug: 'towards-data-science', limit: 3, baseUrl: serverUrl, store });
    expect(result.posts).toBeDefined();
    expect(result.posts.length).toBe(1);
    expect(result.posts[0].title).toBe('Dispatcher Publication Post');
  });

  it('scrape() dispatches single post by medium_com alias', async () => {
    const result = await scrape('medium_com', 'post', { postId: 'abc123def456', baseUrl: serverUrl, store });
    expect(result).toHaveProperty('post');
    expect(result.post.id).toBe('medium:abc123def456');
    expect(result.post.title).toBe('Dispatcher Single Post');
  });

  it('scrape() maps action aliases', async () => {
    const authorResult = await scrape('medium', 'author', { username: 'testuser', limit: 3, baseUrl: serverUrl, store });
    expect(authorResult.posts[0].title).toBe('Dispatcher Post');

    const articleResult = await scrape('medium', 'article', { postId: 'abc123def456', baseUrl: serverUrl, store });
    expect(articleResult.post.title).toBe('Dispatcher Single Post');
  });

  it('scrape() rejects unknown action', async () => {
    await expect(scrape('medium', 'nonexistent', { baseUrl: serverUrl, store })).rejects.toThrow();
  });
});
