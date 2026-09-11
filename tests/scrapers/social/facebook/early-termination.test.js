// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { AbstractStore } from '../../../../src/core/base-store.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';

/**
 * Story 25.7 — Early Termination in Facebook crawler pagination.
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

describe('Story 25.7 — Facebook early termination', () => {
  let server;
  let serverUrl;
  /** @type {Record<string, number>} */
  let graphqlCounts;

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('fb-et-user', {
    accountId: 'fb-et-user',
    cookies: 'c_user=61590064244856; xs=et_token',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('facebook', ['fb-et-user'], {
    credentials: {
      'fb-et-user': { cookies: 'c_user=61590064244856; xs=et_token' },
    },
  });

  const searchEdge = (postId) => ({
    node: {
      id: `node_${postId}`,
      story: {
        id: `story_${postId}`,
        post_id: postId,
        message: { text: `Search post ${postId}` },
        actors: [{ id: 'actor1', name: 'ET Tester' }],
        creation_time: 1787700000,
        feedback: { reaction_count: { count: 1 }, share_count: { count: 0 }, comment_count: { total_count: 0 } },
        url: `https://facebook.com/${postId}`,
      },
    },
  });

  const followerEdge = (userId) => ({
    node: { id: userId, name: `User ${userId}`, username: `user_${userId}` },
  });

  beforeEach(() => {
    graphqlCounts = {};
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <html><head><script>
              ["LSD",[],{"token":"TEST_LSD_ET"}];
              ["DTSGInitialData",[],{"token":"TEST_DTSG_ET"}];
            </script></head><body>FB ET Mock</body></html>
          `);
          return;
        }

        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id') || '';
          let variables = {};
          try {
            variables = JSON.parse(params.get('variables') || '{}');
          } catch {}
          graphqlCounts[docId] = (graphqlCounts[docId] || 0) + 1;

          if (docId === 'fb_et_search_doc') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                serpResponse: {
                  results: {
                    edges: [searchEdge('8001'), searchEdge('8002')],
                    page_info: { has_next_page: true, end_cursor: 'c_search_1' },
                  },
                },
              },
            }));
            return;
          }

          if (docId === 'fb_et_followers_doc') {
            const after = variables.after || null;
            const pages = {
              null: { edges: [followerEdge('u1'), followerEdge('u2')], hasNext: true, cursor: 'fc1' },
              fc1: { edges: [followerEdge('u3'), followerEdge('u4')], hasNext: true, cursor: 'fc2' },
              fc2: { edges: [followerEdge('u5')], hasNext: false, cursor: 'fc3' },
            };
            const page = pages[after ?? 'null'] || pages.null;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                user: {
                  followers: {
                    edges: page.edges,
                    page_info: { has_next_page: page.hasNext, end_cursor: page.cursor },
                  },
                },
              },
            }));
            return;
          }

          if (docId === 'fb_et_profile_doc') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                user: { id: '999', name: 'ET Profile', username: 'etprofile' },
              },
            }));
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
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    return new FacebookCrawler({
      client,
      store,
      sessionManager,
      docIds: {
        SEARCH_POSTS: 'fb_et_search_doc',
        FOLLOWERS: 'fb_et_followers_doc',
        PROFILE: 'fb_et_profile_doc',
      },
    });
  }

  const session = { accountId: 'fb-et-user' };

  it('keeps has_next_page true when the page contains new items', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'early termination', type: 'posts', limit: 10 },
      session,
    });

    const posts = result.posts || result;
    expect(posts.length).toBe(2);
    expect(result.pageInfo?.has_next_page).toBe(true);
    expect(store.checkpoints.at(-1)?.status).toBe('has_more');
    expect(store.checkpoints.at(-1)?.lastCursor).toBe('c_search_1');
  });

  it('masks has_next_page when storeBatch reports an all-duplicate page', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    await crawler.start({
      action: 'search',
      args: { query: 'early termination', type: 'posts', limit: 10 },
      session,
    });

    const second = await crawler.start({
      action: 'search',
      args: { query: 'early termination', type: 'posts', limit: 10 },
      session,
    });

    const lastBatch = store.batches.at(-1);
    expect(lastBatch.length).toBe(2);
    expect(second.pageInfo?.has_next_page).toBe(false);
    expect(store.checkpoints.at(-1)?.status).toBe('completed');
    expect(store.checkpoints.at(-1)?.lastCursor).toBe('c_search_1');
  });

  it('breaks the followers pagination loop early on the second run (fewer requests)', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    const first = await crawler.start({
      action: 'followers',
      args: { username: 'etuser', limit: 10 },
      session,
    });
    const firstRunRequests = graphqlCounts['fb_et_followers_doc'];
    expect(firstRunRequests).toBe(3);
    expect(first.followers.length).toBe(5);

    const second = await crawler.start({
      action: 'followers',
      args: { username: 'etuser', limit: 10 },
      session,
    });
    const secondRunRequests = graphqlCounts['fb_et_followers_doc'] - firstRunRequests;

    expect(secondRunRequests).toBe(1);
    expect(second.followers.length).toBe(2);
    expect(second.pageInfo?.has_next_page).toBe(false);
    expect(store.checkpoints.at(-1)?.status).toBe('completed');
    expect(store.checkpoints.at(-1)?.lastCursor).toBe('fc1');
  });

  it('continues paginating normally when items are new (no early break)', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    await crawler.start({
      action: 'followers',
      args: { username: 'etuser', limit: 10 },
      session,
    });

    expect(graphqlCounts['fb_et_followers_doc']).toBe(3);
    expect(store.checkpoints.at(-1)?.lastCursor).toBe('fc2');
  });

  it('does not call findExistingIds for the non-paginated profile action', async () => {
    const store = new InMemoryStore();
    const crawler = createCrawler({ store });

    await crawler.start({
      action: 'profile',
      args: { username: 'etprofile' },
      session,
    });

    expect(store.findExistingIdsCalls).toBe(0);
  });

  it('works without a store — pagination unchanged', async () => {
    const crawler = createCrawler();

    const result = await crawler.start({
      action: 'followers',
      args: { username: 'etuser', limit: 10 },
      session,
    });

    expect(graphqlCounts['fb_et_followers_doc']).toBe(3);
    expect(result.followers.length).toBe(5);
  });
});
