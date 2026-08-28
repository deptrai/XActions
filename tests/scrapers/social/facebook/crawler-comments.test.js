// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';

/**
 * Tests for Story 14.1 — FacebookCrawler get_comments action.
 */

describe('Story 14.1 — FacebookCrawler get_comments', () => {
  let server;
  let serverUrl;
  let proxyPool;
  let governor;
  let accountPool;
  let sessionManager;
  let storedComments = [];

  const mockStore = {
    storeCommentBatch: async (comments) => {
      storedComments.push(...comments);
    },
  };

  const commentDocIds = {
    COMMENT_ROOTS: 'comment_roots_doc_123',
    COMMENT_REPLIES: 'comment_replies_doc_456',
  };

  const makeCommentNode = (id, parentId = null, feedbackId = `fb_${id}`) => ({
    id,
    parentId,
    message: { text: `Comment ${id}` },
    actors: [{ id: `user_${id}`, name: `Author ${id}` }],
    created_time: 1787680000,
    feedback: {
      id: feedbackId,
      like_count: { count: parentId ? 2 : 5 },
      comment_count: { total_count: id === 'c1' ? 2 : 0 },
      expansion_info: {
        expansion_token: `token_${id}`,
      },
      replies_fields: {
        total_count: id === 'c1' ? 2 : 0,
      },
    },
  });

  beforeAll(async () => {
    proxyPool = new ProxyIpPool({ proxies: ['http://127.0.0.1:8080'] });
    governor = new AdaptiveRateGovernor({ proxyPool });
    accountPool = new AccountPool({ governor });
    sessionManager = new SessionManager();

    sessionManager.set('acc_fb_1', {
      accountId: 'acc_fb_1',
      platform: 'facebook',
      cookies: { c_user: '10001', xs: 'sec_xs_123' },
    });
    accountPool.registerAccounts('facebook', ['acc_fb_1']);

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_Lsd123" />
              <input type="hidden" name="jazoest" value="2953" />
              <script>
                requireLazy(["DTSGInitialData"], function(d) { d.token = "DTSG_456"; });
                window.__spin_r = 1016839210;
                window.__spin_t = 1787681000;
                window.__hsi = "hsi_123";
              </script>
            </body></html>
          `);
          return;
        }

        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');
          const variables = JSON.parse(params.get('variables') || '{}');

          if (docId === commentDocIds.COMMENT_ROOTS) {
            res.writeHead(200, { 'content-type': 'application/json' });
            if (variables.id === Buffer.from('feedback:post_no_comments').toString('base64')) {
              res.end(JSON.stringify({
                data: { node: { comment_rendering_instance_for_feed_location: { comments: { edges: [], page_info: { has_next_page: false, end_cursor: null } } } } },
              }));
              return;
            }
            res.end(JSON.stringify({
              data: {
                node: {
                  comment_rendering_instance_for_feed_location: {
                    comments: {
                      edges: [
                        { node: makeCommentNode('c1') },
                        { node: makeCommentNode('c2') },
                      ],
                      page_info: { has_next_page: false, end_cursor: null },
                    },
                  },
                },
              },
            }));
            return;
          }

          if (docId === commentDocIds.COMMENT_REPLIES) {
            res.writeHead(200, { 'content-type': 'application/json' });
            if (variables.id === 'fb_c1' && variables.expansionToken === 'token_c1') {
              res.end(JSON.stringify({
                data: {
                  node: {
                    replies_connection: {
                      edges: [
                        { node: makeCommentNode('c1_1', 'c1', 'fb_c1_1') },
                        { node: makeCommentNode('c1_2', 'c1', 'fb_c1_2') },
                      ],
                      page_info: { has_next_page: false, end_cursor: null },
                    },
                  },
                },
              }));
              return;
            }
            res.end(JSON.stringify({
              data: { node: { replies_connection: { edges: [], page_info: { has_next_page: false, end_cursor: null } } } },
            }));
            return;
          }

          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('Not Found');
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
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  const createCrawler = () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    return new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
      docIds: commentDocIds,
    });
  };

  it('[P0] should register get_comments action with correct descriptor (AC-4)', () => {
    const crawler = createCrawler();
    const actions = crawler.listActions();
    const action = actions.find((a) => a.action === 'get_comments');

    expect(action).toBeDefined();
    expect(action.requiredArgs).toContain('postId');
    expect(action.optionalArgs).toEqual(expect.arrayContaining(['maxDepth', 'maxComments', 'after']));
    expect(action.outputType).toMatch(/CommentItem/);
  });

  it('[P0] should scrape root comments, normalize to CommentItem[], and persist to store (AC-4)', async () => {
    storedComments = [];
    const crawler = createCrawler();

    const result = await crawler.start({
      action: 'get_comments',
      args: { postId: 'post_123', maxDepth: 0, maxComments: 500 },
      session: { accountId: 'acc_fb_1' },
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.comments)).toBe(true);
    expect(result.comments).toHaveLength(2);

    const first = result.comments[0];
    expect(first.id).toBe('facebook:post_123:c1');
    expect(first.platform).toBe('facebook');
    expect(first.externalId).toBe('c1');
    expect(first.postId).toBe('facebook:post_123');
    expect(first.parentCommentId).toBeUndefined();
    expect(first.depth).toBe(0);
    expect(first.authorName).toBe('Author c1');
    expect(first.content).toBe('Comment c1');
    expect(first.likesCount).toBe(5);
    expect(first.subCommentsCount).toBe(2);
    expect(first.publishedAt).toBeInstanceOf(Date);

    expect(storedComments.length).toBeGreaterThanOrEqual(2);
    expect(storedComments[0].id).toBe('facebook:post_123:c1');
  });

  it('[P0] should recursively fetch nested replies and assign correct depth (AC-1, AC-4)', async () => {
    storedComments = [];
    const crawler = createCrawler();

    const result = await crawler.start({
      action: 'get_comments',
      args: { postId: 'post_123', maxDepth: 3, maxComments: 500 },
      session: { accountId: 'acc_fb_1' },
    });

    const all = result.comments;
    const root = all.find((c) => c.externalId === 'c1');
    const reply1 = all.find((c) => c.externalId === 'c1_1');
    const reply2 = all.find((c) => c.externalId === 'c1_2');

    expect(root).toBeDefined();
    expect(root.depth).toBe(0);

    expect(reply1).toBeDefined();
    expect(reply1.depth).toBe(1);
    expect(reply1.parentCommentId).toBe('facebook:post_123:c1');

    expect(reply2).toBeDefined();
    expect(reply2.depth).toBe(1);
    expect(reply2.parentCommentId).toBe('facebook:post_123:c1');

    // Topological ordering: root appears before its children in the returned array
    const rootIndex = all.findIndex((c) => c.externalId === 'c1');
    const replyIndex = all.findIndex((c) => c.externalId === 'c1_1');
    expect(rootIndex).toBeLessThan(replyIndex);
  });

  it('[P1] should respect maxDepth and not recurse beyond the limit (AC-1)', async () => {
    const crawler = createCrawler();

    const result = await crawler.start({
      action: 'get_comments',
      args: { postId: 'post_123', maxDepth: 0, maxComments: 500 },
      session: { accountId: 'acc_fb_1' },
    });

    expect(result.comments).toHaveLength(2);
    expect(result.comments.some((c) => c.depth > 0)).toBe(false);
  });

  it('[P1] should respect maxComments and stop collecting (AC-1)', async () => {
    const crawler = createCrawler();

    const result = await crawler.start({
      action: 'get_comments',
      args: { postId: 'post_123', maxDepth: 3, maxComments: 1 },
      session: { accountId: 'acc_fb_1' },
    });

    expect(result.comments.length).toBeLessThanOrEqual(1);
  });

  it('[P1] should return empty array when a post has no comments (AC-4)', async () => {
    const crawler = createCrawler();

    const result = await crawler.start({
      action: 'get_comments',
      args: { postId: 'post_no_comments', maxDepth: 3, maxComments: 500 },
      session: { accountId: 'acc_fb_1' },
    });

    expect(result.comments).toEqual([]);
    expect(result.pageInfo).toBeDefined();
    expect(result.pageInfo.has_next_page).toBe(false);
  });

  it('[P2] should handle a full facebook post URL by extracting the post id (Edge case)', async () => {
    const crawler = createCrawler();

    const result = await crawler.start({
      action: 'get_comments',
      args: {
        postId: 'https://www.facebook.com/groups/testgroup/posts/post_123',
        maxDepth: 0,
      },
      session: { accountId: 'acc_fb_1' },
    });

    expect(result.comments[0].postId).toBe('facebook:post_123');
  });

  it('[P1] should reject non-Facebook postId URLs to prevent SSRF', async () => {
    const crawler = createCrawler();

    await expect(
      crawler.start({
        action: 'get_comments',
        args: {
          postId: 'https://evil.attacker.com/share/p/post_123',
          maxDepth: 0,
        },
        session: { accountId: 'acc_fb_1' },
      })
    ).rejects.toThrow();
  });
});
