// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { PrismaClient } from '@prisma/client';

/**
 * ATDD Red-Phase Acceptance Tests for Story 13.7:
 * Facebook Hybrid Post & Group Comments (AC-1 to AC-10).
 */

describe('Story 13.7 — Facebook Hybrid Post & Group Comments', () => {
  let server;
  let serverUrl;
  let proxyPool;
  let governor;
  let accountPool;
  let sessionManager;
  let prisma;
  let store;

  const commentDocIds = {
    COMMENT_ROOTS: 'fb_comment_roots_doc',
    COMMENT_REPLIES: 'fb_comment_replies_doc',
  };

  const makeCommentNode = (id, parentId = null, feedbackId = `fb_${id}`) => ({
    id,
    parentId,
    message: { text: `User comment ${id} contact me at test@example.com or +1 555-123-4567` },
    actors: [{ id: `user_${id}`, name: `John Doe 0901234567` }],
    created_time: 1787680000,
    feedback: {
      id: feedbackId,
      like_count: { count: parentId ? 2 : 15 },
      comment_count: { total_count: id === 'root_1' ? 1 : 0 },
      expansion_info: {
        expansion_token: `token_${id}`,
      },
      replies_fields: {
        total_count: id === 'root_1' ? 1 : 0,
      },
    },
  });

  beforeAll(async () => {
    proxyPool = new ProxyIpPool({ proxies: ['http://127.0.0.1:8080'] });
    governor = new AdaptiveRateGovernor({ proxyPool });
    accountPool = new AccountPool({ governor });
    sessionManager = new SessionManager();
    prisma = new PrismaClient();
    store = new PrismaStore({ prisma });

    sessionManager.set('acc_fb_1', {
      accountId: 'acc_fb_1',
      platform: 'facebook',
      cookies: { c_user: '61590064244856', xs: 'sec_xs_123' },
    });
    accountPool.registerAccounts('facebook', ['acc_fb_1']);

    await prisma.post.upsert({
      where: { id: 'facebook:101010101' },
      update: {},
      create: {
        id: 'facebook:101010101',
        externalId: '101010101',
        platform: 'facebook',
        category: 'social',
        content: 'Test Post',
        authorId: 'user_1',
        authorName: 'Test Author',
        crawledAt: new Date(),
      },
    });

    await prisma.post.upsert({
      where: { id: 'facebook:999888777' },
      update: {},
      create: {
        id: 'facebook:999888777',
        externalId: '999888777',
        platform: 'facebook',
        category: 'social',
        content: 'Test Group Post',
        authorId: 'user_2',
        authorName: 'Group Author',
        crawledAt: new Date(),
      },
    });

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
            const isPaginated = Boolean(variables.commentsAfterCursor);
            res.end(JSON.stringify({
              data: {
                node: {
                  comment_rendering_instance_for_feed_location: {
                    comments: {
                      edges: isPaginated
                        ? [
                            { node: makeCommentNode('root_3') },
                          ]
                        : [
                            { node: makeCommentNode('root_1') },
                            { node: makeCommentNode('root_2') },
                          ],
                      page_info: {
                        has_next_page: !isPaginated,
                        end_cursor: 'cursor_root_page_1',
                      },
                    },
                  },
                },
              },
            }));
            return;
          }

          if (docId === commentDocIds.COMMENT_REPLIES) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                node: {
                  replies_connection: {
                    edges: [
                      { node: makeCommentNode('reply_1_1', 'root_1') },
                    ],
                    page_info: {
                      has_next_page: false,
                      end_cursor: null,
                    },
                  },
                },
              },
            }));
            return;
          }

          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ errors: [{ message: 'Unknown doc_id in test' }] }));
        }
      });
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  });

  it('[AC-1] should register post_comments and group_comments actions in FacebookCrawler', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({ client, sessionManager });

    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);

    expect(actionNames).toContain('post_comments');
    expect(actionNames).toContain('group_comments');
    expect(actionNames).toContain('get_comments'); // Backward compatibility (14.1)

    const postAction = actions.find((a) => a.action === 'post_comments');
    expect(postAction?.requiredArgs).toContain('url');

    const groupAction = actions.find((a) => a.action === 'group_comments');
    expect(groupAction?.requiredArgs).toContain('url');
  });

  it('[AC-2 & AC-6] should crawl post comments, strip PII, normalize to CommentItem[], and save checkpoint', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      store,
      sessionManager,
      docIds: commentDocIds,
    });

    const res = await crawler.start({
      action: 'post_comments',
      args: {
        url: 'https://www.facebook.com/zuck/posts/101010101',
        includeReplies: true,
        limit: 10,
      },
      session: { accountId: 'acc_fb_1' },
    });

    expect(res).toBeDefined();
    const comments = res.comments || res;
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBeGreaterThanOrEqual(2);

    const rootComment = comments.find((c) => c.externalId === 'root_1');
    expect(rootComment).toBeDefined();
    expect(rootComment?.id).toBe('facebook:101010101:root_1');
    expect(rootComment?.depth).toBe(0);

    // AC-6: PII Stripping check
    expect(rootComment?.content).not.toContain('test@example.com');
    expect(rootComment?.content).not.toContain('+1 555-123-4567');
    expect(rootComment?.authorName).not.toContain('0901234567');
    expect(rootComment?.metadata?.sourceMethod).toBeDefined();

    // Checkpoint check
    const checkpoint = await prisma.crawlCheckpoint.findFirst({
      where: {
        platform: 'facebook',
        targetType: 'post_comments',
      },
    });
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.targetKey).toContain('101010101');
  });

  it('[AC-3 & AC-7] should crawl group comments and reject non-group URLs', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      store,
      sessionManager,
      docIds: commentDocIds,
    });

    // Valid group comments
    const res = await crawler.start({
      action: 'group_comments',
      args: {
        url: 'https://www.facebook.com/groups/reactjs/posts/999888777/',
        limit: 5,
      },
      session: { accountId: 'acc_fb_1' },
    });

    const comments = res.comments || res;
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBeGreaterThanOrEqual(1);

    // Invalid non-group URL rejection
    await expect(crawler.start({
      action: 'group_comments',
      args: {
        url: 'https://www.facebook.com/zuck/posts/101010101',
      },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);
  });

  it('[AC-4] should respect includeReplies=false and return only root comments', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: commentDocIds,
    });

    const res = await crawler.start({
      action: 'post_comments',
      args: {
        url: 'https://www.facebook.com/zuck/posts/101010101',
        includeReplies: false,
      },
      session: { accountId: 'acc_fb_1' },
    });

    const comments = res.comments || res;
    expect(Array.isArray(comments)).toBe(true);
    for (const c of comments) {
      expect(c.depth).toBe(0);
      expect(c.parentCommentId).toBeUndefined();
    }
  });

  it('[AC-5] should support initial pagination cursor with after parameter', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      sessionManager,
      docIds: commentDocIds,
    });

    const res = await crawler.start({
      action: 'post_comments',
      args: {
        url: 'https://www.facebook.com/zuck/posts/101010101',
        after: 'cursor_offset_123',
      },
      session: { accountId: 'acc_fb_1' },
    });

    expect(res.pageInfo).toBeDefined();
    expect(res.pageInfo?.end_cursor).toBe('cursor_root_page_1');
  });

  it('[AC-7] should reject empty URL and non-Facebook domains to prevent SSRF', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new FacebookCrawler({ client, sessionManager });

    // Empty URL
    await expect(crawler.start({
      action: 'post_comments',
      args: { url: '' },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);

    // SSRF URL
    await expect(crawler.start({
      action: 'post_comments',
      args: { url: 'https://attacker.com/posts/123' },
      session: { accountId: 'acc_fb_1' },
    })).rejects.toThrow(PlatformError);
  });
});
