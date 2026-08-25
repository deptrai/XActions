// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';

describe('Story 13.3 — FacebookCrawler Hybrid Scraper Contract', () => {
  let server;
  let serverUrl;
  let proxyPool;
  let governor;
  let accountPool;
  let sessionManager;
  let storedItems = [];

  const mockStore = {
    storeBatch: async (items, options) => {
      storedItems.push(...items);
      return { inserted: items.length, updated: 0 };
    },
  };

  beforeAll(async () => {
    proxyPool = new ProxyIpPool({
      proxies: ['http://127.0.0.1:8080'],
    });
    governor = new AdaptiveRateGovernor({ proxyPool });
    accountPool = new AccountPool({ governor });
    sessionManager = new SessionManager();

    // Register a valid session
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
        // Home HTML for tokens
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_Lsd123" />
              <input type="hidden" name="jazoest" value="2953" />
              <script>
                requireLazy(["DTSGInitialData"], function(d) { d.token = "DTSG_456"; });
                window.__spin_r = 1016839210;
              </script>
            </body></html>
          `);
          return;
        }

        // GraphQL endpoint
        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const variables = JSON.parse(params.get('variables') || '{}');

          // Group Feed Mock
          if (variables.groupId) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                group: {
                  id: variables.groupId,
                  feed: {
                    edges: [
                      {
                        node: {
                          id: 'post_grp_999',
                          creation_time: 1787680000,
                          message: { text: 'Post inside tech group' },
                          actors: [{ id: 'user_111', name: 'Alice Smith' }],
                          feedback: {
                            reaction_count: { count: 120 },
                            comment_count: { total_count: 35 },
                            share_count: { count: 8 },
                          },
                          attachments: [{ media: { image: { uri: 'https://cdn.fb.com/grp_pic.jpg' } } }],
                        },
                      },
                    ],
                    page_info: {
                      has_next_page: true,
                      end_cursor: 'cursor_grp_token_next',
                    },
                  },
                },
              },
            }));
            return;
          }

          // Page Feed Mock (with nested comet_sections)
          if (variables.pageId) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                page: {
                  id: variables.pageId,
                  timeline_feed: {
                    edges: [
                      {
                        node: {
                          comet_sections: {
                            content_story: {
                              story: {
                                id: 'post_page_888',
                                creation_time: 1787681000,
                                message: { text: 'Official Page Announcement' },
                                actors: [{ id: 'page_456', name: 'Tech Brand Official' }],
                                feedback: {
                                  reaction_count: { count: 500 },
                                  comment_count: { total_count: 80 },
                                  share_count: { count: 45 },
                                },
                              },
                            },
                          },
                        },
                      },
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

  it('[P0] should extend AbstractCrawler with requiresAuth=true and register group_posts & page_posts (AC-1)', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
    });

    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('facebook');
    expect(crawler.platform).toBe('facebook');
    expect(crawler.requiresAuth).toBe(true);

    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action || a.name);
    expect(actionNames).toContain('group_posts');
    expect(actionNames).toContain('page_posts');
  });

  it('[P0] should scrape group posts, normalize to PostItem[], parse publishedAt, and persist to store (AC-3)', async () => {
    storedItems = [];
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
    });

    const result = await crawler.start({
      action: 'group_posts',
      args: { groupId: 'grp_12345', count: 10, cursor: 'start_cursor' },
      session: { accountId: 'acc_fb_1' },
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts).toHaveLength(1);

    const post = result.posts[0];
    expect(post.id).toBe('facebook:post_grp_999');
    expect(post.externalId).toBe('post_grp_999');
    expect(post.platform).toBe('facebook');
    expect(post.category).toBe('social');
    expect(post.content).toBe('Post inside tech group');
    expect(post.authorName).toBe('Alice Smith');
    expect(post.authorId).toBe('user_111');
    expect(post.likesCount).toBe(120);
    expect(post.repliesCount).toBe(35);
    expect(post.repostsCount).toBe(8);
    expect(post.mediaUrls).toEqual(['https://cdn.fb.com/grp_pic.jpg']);
    expect(post.publishedAt).toBeInstanceOf(Date);
    expect(post.publishedAt?.getTime()).toBe(1787680000 * 1000);

    // Verify pagination pageInfo
    expect(result.pageInfo).toEqual({
      has_next_page: true,
      end_cursor: 'cursor_grp_token_next',
    });

    // Verify stored in PrismaStore
    expect(storedItems).toHaveLength(1);
    expect(storedItems[0].id).toBe('facebook:post_grp_999');
  });

  it('[P0] should scrape page posts with nested comet_sections, normalize to PostItem[], and persist to store (AC-4)', async () => {
    storedItems = [];
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
    });

    // Test direct cookies in session
    const result = await crawler.start({
      action: 'page_posts',
      args: { pageId: 'page_456' },
      session: { cookies: { c_user: '10001', xs: 'sec_xs_123' } },
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts).toHaveLength(1);

    const post = result.posts[0];
    expect(post.id).toBe('facebook:post_page_888');
    expect(post.externalId).toBe('post_page_888');
    expect(post.platform).toBe('facebook');
    expect(post.category).toBe('social');
    expect(post.content).toBe('Official Page Announcement');
    expect(post.authorName).toBe('Tech Brand Official');
    expect(post.likesCount).toBe(500);
    expect(post.publishedAt).toBeInstanceOf(Date);

    expect(storedItems).toHaveLength(1);
    expect(storedItems[0].id).toBe('facebook:post_page_888');
  });

  it('[P2] should execute cleanup() and clear client token cache cleanly', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
    });

    await crawler.client.ensureTokens('acc_1', 'c_user=1');
    await expect(crawler.cleanup()).resolves.toBeUndefined();
  });
});
