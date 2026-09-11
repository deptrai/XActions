// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { TwitterCrawler } from '../../../../src/scrapers/social/twitter/crawler.js';
import { TwitterClient } from '../../../../src/scrapers/social/twitter/client.js';
import { AbstractStore } from '../../../../src/core/base-store.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';

/**
 * Story 25.7 — Early Termination in Twitter crawler pagination.
 * Local HTTP server serves deterministic GraphQL pages; InMemoryStore is a
 * real AbstractStore implementation that dedupes ids through internal sets.
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

describe('Story 25.7 — Twitter early termination', () => {
  let server;
  let serverUrl;
  /** @type {Record<string, number>} */
  let requestCounts;

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('tw-et-user', {
    accountId: 'tw-et-user',
    cookies: 'auth_token=et_token; ct0=et_csrf',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('twitter', ['tw-et-user'], {
    credentials: {
      'tw-et-user': { cookies: 'auth_token=et_token; ct0=et_csrf' },
    },
  });

  const tweetEntry = (id, text) => ({
    entryId: `tweet-${id}`,
    sortIndex: '0',
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineTweet',
        tweet_results: {
          result: {
            __typename: 'Tweet',
            rest_id: id,
            legacy: {
              created_at: 'Mon Jan 01 00:00:00 +0000 2024',
              full_text: text,
              id_str: id,
              favorite_count: 5,
              retweet_count: 1,
              reply_count: 0,
              quote_count: 0,
              bookmark_count: 0,
              entities: { hashtags: [], urls: [], user_mentions: [] },
              lang: 'en',
            },
            core: {
              user_results: {
                result: {
                  rest_id: `user_${id}`,
                  is_blue_verified: false,
                  legacy: {
                    screen_name: `poster_${id}`,
                    name: `Poster ${id}`,
                    profile_image_url_https: 'https://pbs.twimg.com/p.jpg',
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const cursorEntry = (value) => ({
    entryId: 'cursor-bottom-0',
    content: {
      entryType: 'TimelineTimelineCursor',
      value,
    },
  });

  const timelineResponse = (entries) => ({
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [{ type: 'TimelineAddEntries', entries }],
          },
        },
      },
    },
  });

  const bookmarksResponse = (entries) => ({
    data: {
      bookmark_timeline_v2: {
        timeline: {
          instructions: [{ type: 'TimelineAddEntries', entries }],
        },
      },
    },
  });

  beforeEach(() => {
    requestCounts = {};
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<html><body>Twitter ET Mock</body></html>');
          return;
        }

        if (req.url?.startsWith('/i/api/graphql/')) {
          const operationName = req.url.split('/').pop() || '';
          const params = new URLSearchParams(body);
          let variables = {};
          try {
            variables = JSON.parse(params.get('variables') || '{}');
          } catch {}
          requestCounts[operationName] = (requestCounts[operationName] || 0) + 1;

          if (operationName === 'SearchTimeline') {
            const cursor = variables.cursor || null;
            const pages = {
              null: [tweetEntry('t1', 'ET page 1 a'), tweetEntry('t2', 'ET page 1 b'), cursorEntry('tc1')],
              tc1: [tweetEntry('t3', 'ET page 2 a'), tweetEntry('t4', 'ET page 2 b'), cursorEntry('tc2')],
              tc2: [tweetEntry('t5', 'ET page 3 a'), tweetEntry('t6', 'ET page 3 b')],
            };
            const entries = pages[cursor ?? 'null'] || pages.null;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(timelineResponse(entries)));
            return;
          }

          if (operationName === 'Bookmarks') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(bookmarksResponse([
              tweetEntry('b1', 'Bookmarked tweet a'),
              tweetEntry('b2', 'Bookmarked tweet b'),
              cursorEntry('bm_next'),
            ])));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: {} }));
          return;
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function createCrawler({ store } = {}) {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    return new TwitterCrawler({ client, store, sessionManager });
  }

  const session = {
    accountId: 'tw-et-user',
    cookies: 'auth_token=et_token; ct0=et_csrf',
  };

  it('fetches all search pages when items are new', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'early termination', limit: 10 },
      session,
    });

    expect(requestCounts['SearchTimeline']).toBe(3);
    expect(result.posts.length).toBe(6);
    expect(result.pageInfo.has_next_page).toBe(false);
  });

  it('breaks the search paginator after page 1 when all items already exist', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    await crawler.start({
      action: 'search',
      args: { query: 'early termination', limit: 10 },
      session,
    });
    const firstRunRequests = requestCounts['SearchTimeline'];

    const second = await crawler.start({
      action: 'search',
      args: { query: 'early termination', limit: 10 },
      session,
    });
    const secondRunRequests = requestCounts['SearchTimeline'] - firstRunRequests;

    expect(secondRunRequests).toBe(1);
    expect(second.posts.length).toBe(2);
    expect(second.pageInfo.has_next_page).toBe(false);
    expect(second.pageInfo.end_cursor).toBe('tc1');
    expect(store.checkpoints.at(-1)?.status).toBe('completed');
  });

  it('masks has_next_page on bookmarks when the page is all duplicates', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    const first = await crawler.start({
      action: 'bookmarks',
      args: {},
      session,
    });
    expect(first.pageInfo.has_next_page).toBe(true);
    expect(store.checkpoints.at(-1)?.status).toBe('has_more');

    const second = await crawler.start({
      action: 'bookmarks',
      args: {},
      session,
    });
    expect(second.pageInfo.has_next_page).toBe(false);
    expect(store.checkpoints.at(-1)?.status).toBe('completed');
    expect(store.checkpoints.at(-1)?.lastCursor).toBe('bm_next');
  });

  it('keeps paginating bookmarks when a run brings new items', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    const result = await crawler.start({
      action: 'bookmarks',
      args: {},
      session,
    });

    expect(result.posts.length).toBe(2);
    expect(result.pageInfo.has_next_page).toBe(true);
  });

  it('works without a store — pagination unchanged', async () => {
    const crawler = createCrawler();

    const result = await crawler.start({
      action: 'search',
      args: { query: 'early termination', limit: 10 },
      session,
    });

    expect(requestCounts['SearchTimeline']).toBe(3);
    expect(result.posts.length).toBe(6);
  });
});
