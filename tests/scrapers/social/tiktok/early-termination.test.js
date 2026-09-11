// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { TikTokClient } from '../../../../src/scrapers/social/tiktok/client.js';
import { TikTokCrawler } from '../../../../src/scrapers/social/tiktok/crawler.js';
import { TikTokPlatformResponseValidator } from '../../../../src/scrapers/social/tiktok/validator.js';
import { AbstractStore } from '../../../../src/core/base-store.js';

/**
 * Story 25.7 — Early Termination in TikTok crawler pagination.
 * Local HTTP server serves deterministic API pages; InMemoryStore is a real
 * AbstractStore implementation that dedupes ids through internal sets.
 */
class InMemoryStore extends AbstractStore {
  constructor() {
    super();
    this.postIds = new Set();
    this.commentIds = new Set();
    this.checkpoints = [];
    this.batches = [];
    this.storedComments = [];
    this.findExistingIdsCalls = 0;
  }

  async init() {}

  async storeBatch(posts) {
    this.batches.push(posts);
    let insertedCount = 0;
    let duplicateCount = 0;
    for (const p of posts) {
      if (p && this.postIds.has(p.id)) {
        duplicateCount += 1;
      } else if (p) {
        this.postIds.add(p.id);
        insertedCount += 1;
      }
    }
    return { insertedCount, duplicateCount, totalCount: posts.length, schemaValid: true };
  }

  async storeContent(post) {
    return this.storeBatch([post]);
  }

  async findExistingIds(ids) {
    this.findExistingIdsCalls += 1;
    return ids.filter((id) => this.postIds.has(id) || this.commentIds.has(id));
  }

  async storeComment(comment) {
    this.storedComments.push(comment);
    if (comment?.id) this.commentIds.add(comment.id);
  }

  async storeCommentBatch(comments) {
    this.storedComments.push(...comments);
    for (const c of comments) {
      if (c?.id) this.commentIds.add(c.id);
    }
  }

  async saveCheckpoint(checkpoint) {
    this.checkpoints.push(checkpoint);
  }

  async getCheckpoint() {
    return null;
  }

  async close() {}
}

describe('Story 25.7 — TikTok early termination', () => {
  let server;
  let serverUrl;
  /** @type {Record<string, number>} */
  let requestCounts;

  const videoItem = (id, desc) => ({
    aweme_id: id,
    desc,
    create_time: 1700000000,
    author: { id: `a_${id}`, nickname: `author_${id}`, unique_id: `author_${id}` },
    video: { playAddr: { urlList: ['https://example.com/v.mp4'] } },
    statistics: { digg_count: 10, comment_count: 2, share_count: 1 },
  });

  const commentItem = (cid, text) => ({
    cid,
    text,
    create_time: 1700000001,
    user: { id: `u_${cid}`, nickname: `user_${cid}`, unique_id: `user_${cid}` },
    digg_count: 1,
    reply_comment_total: 0,
  });

  beforeEach(() => {
    requestCounts = {};
  });

  beforeAll(async () => {
    process.env.TIKTOK_BROWSER_SIGN = 'false';
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const path = url.pathname;
      requestCounts[path] = (requestCounts[path] || 0) + 1;

      if (path === '/api/search/general/full/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          item_list: [
            { item: videoItem('9001', 'ET search post a') },
            { item: videoItem('9002', 'ET search post b') },
          ],
          has_more: true,
          cursor: 42,
        }));
        return;
      }

      if (path === '/api/comment/list/') {
        const cursor = url.searchParams.get('cursor') || '0';
        const pages = {
          '0': { comments: [commentItem('ec1', 'root one'), commentItem('ec2', 'root two')], has_more: 1, cursor: 'cc1' },
          cc1: { comments: [commentItem('ec3', 'root three')], has_more: 0, cursor: 'cc2' },
        };
        const page = pages[cursor] || pages['0'];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status_code: 0, comments: page.comments, has_more: page.has_more, cursor: page.cursor }));
        return;
      }

      if (path === '/api/item/detail/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          itemInfo: {
            itemStruct: videoItem('7777', 'ET detail video'),
          },
        }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status_code: 404, status_msg: 'not found' }));
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${addr?.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.TIKTOK_BROWSER_SIGN;
  });

  function createCrawler({ store } = {}) {
    const client = new TikTokClient({
      baseUrl: serverUrl,
      requiresProxy: false,
      responseValidator: new TikTokPlatformResponseValidator(),
    });
    return new TikTokCrawler({ client, store });
  }

  const session = { accountId: 'tiktok-et' };

  it('keeps has_next_page true when search results are new', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'early termination', count: 10 },
      session,
    });

    expect(result.posts.length).toBe(2);
    expect(result.pageInfo.has_next_page).toBe(true);
    expect(store.checkpoints.at(-1)?.status).toBe('has_more');
  });

  it('masks has_next_page on search when all results already exist', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    await crawler.start({
      action: 'search',
      args: { query: 'early termination', count: 10 },
      session,
    });

    const second = await crawler.start({
      action: 'search',
      args: { query: 'early termination', count: 10 },
      session,
    });

    expect(second.pageInfo.has_next_page).toBe(false);
    expect(store.checkpoints.at(-1)?.status).toBe('completed');
    expect(store.checkpoints.at(-1)?.lastCursor).toBe('42');
  });

  it('stops comment pagination inside fetchLayer on the second run (fewer requests)', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    const first = await crawler.start({
      action: 'get_post_comments',
      args: { videoId: '7777', maxDepth: 0, maxComments: 50 },
      session,
    });
    const firstRunRequests = requestCounts['/api/comment/list/'];
    expect(firstRunRequests).toBe(2);
    expect(first.comments.length).toBe(3);

    const second = await crawler.start({
      action: 'get_post_comments',
      args: { videoId: '7777', maxDepth: 0, maxComments: 50 },
      session,
    });
    const secondRunRequests = requestCounts['/api/comment/list/'] - firstRunRequests;

    expect(secondRunRequests).toBe(1);
    expect(second.comments.length).toBe(2);
    expect(second.pageInfo.has_next_page).toBe(false);
    expect(store.checkpoints.at(-1)?.status).toBe('completed');
  });

  it('does not call findExistingIds for the non-paginated post_detail action', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    await crawler.start({
      action: 'post_detail',
      args: { videoId: '7777' },
      session,
    });

    expect(store.findExistingIdsCalls).toBe(0);
  });

  it('works without a store — pagination unchanged', async () => {
    const crawler = createCrawler();

    const result = await crawler.start({
      action: 'search',
      args: { query: 'early termination', count: 10 },
      session,
    });

    expect(result.posts.length).toBe(2);
    expect(result.pageInfo.has_next_page).toBe(true);
  });
});
