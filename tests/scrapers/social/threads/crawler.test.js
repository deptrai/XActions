// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { ThreadsCrawler } from '../../../../src/scrapers/social/threads/crawler.js';
import { ThreadsClient } from '../../../../src/scrapers/social/threads/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';

describe('Story 15.1 — ThreadsCrawler Hybrid Scraper Contract & Actions', () => {
  let server;
  let serverUrl;
  let proxyPool;
  let governor;
  let accountPool;
  let sessionManager;
  let storedPosts = [];
  let storedComments = [];

  const mockStore = {
    storeBatch: async (items) => {
      storedPosts.push(...items);
      return { inserted: items.length, updated: 0 };
    },
    storeCommentBatch: async (items) => {
      storedComments.push(...items);
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

    // Register synthetic threads-guest account
    accountPool.registerAccounts('threads', ['threads-guest']);

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // Mock User Profile HTML page with User ID
        if (req.url?.startsWith('/@vietnam_trendsetter')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_Lsd123" />
              <script>
                window.__user_id = "5432109876";
                window.__userId = "5432109876";
                const userData = { user: { pk: "5432109876", id: "5432109876", username: "vietnam_trendsetter" } };
              </script>
            </body></html>
          `);
          return;
        }

        // Mock Home HTML for tokens
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_Lsd123" />
              <script>window.__spin_r = 1016839210;</script>
            </body></html>
          `);
          return;
        }

        // GraphQL endpoint
        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');
          const variables = JSON.parse(params.get('variables') || '{}');

          // User Feed Mock
          if (docId === '6232751443445612' || variables.userID === '5432109876') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                mediaData: {
                  threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            id: '9988776655',
                            pk: '9988776655',
                            code: 'DE_trending_threads',
                            taken_at: 1787680000,
                            caption: { text: 'Hot trend discussion on Threads Vietnam' },
                            like_count: 890,
                            comment_count: 75,
                            media_repost_count: 24,
                            user: {
                              pk: '5432109876',
                              id: '5432109876',
                              username: 'vietnam_trendsetter',
                              profile_pic_url: 'https://cdn.threads.net/avatar.jpg',
                            },
                            image_versions2: {
                              candidates: [{ url: 'https://cdn.threads.net/pic_large.jpg' }],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            }));
            return;
          }

          // Search Mock
          if (docId === 'search_doc_mock' || variables.query === 'saigon') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                mediaData: {
                  threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            id: '777888999',
                            pk: '777888999',
                            code: 'SEARCH_saigon_01',
                            taken_at: 1787682000,
                            caption: { text: 'Best coffee spots in Saigon this weekend' },
                            like_count: 120,
                            comment_count: 15,
                            user: {
                              pk: '11223344',
                              username: 'saigon_foodie',
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            }));
            return;
          }

          // Comments Post Page Mock (containing thread + reply threads)
          if (docId === '5587632691339264' || variables.post_id === '9988776655' || variables.postId === '9988776655') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                data: {
                  containing_thread: {
                    thread_items: [
                      {
                        post: {
                          id: '9988776655',
                          pk: '9988776655',
                          caption: { text: 'Main root thread post' },
                        },
                      },
                    ],
                  },
                  reply_threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            id: 'comment_node_101',
                            pk: 'comment_node_101',
                            taken_at: 1787680500,
                            caption: { text: 'First reply comment on this thread!' },
                            like_count: 25,
                            user: {
                              pk: '66778899',
                              username: 'commenter_one',
                            },
                          },
                        },
                      ],
                    },
                  ],
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

  it('[P0] should extend AbstractCrawler with requiresAuth=true and register get_user_feed, search, get_post_comments (AC-3)', () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    const crawler = new ThreadsCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
    });

    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('threads');
    expect(crawler.platform).toBe('threads');
    expect(crawler.requiresAuth).toBe(true);

    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action || a.name);
    expect(actionNames).toContain('get_user_feed');
    expect(actionNames).toContain('search');
    expect(actionNames).toContain('get_post_comments');
  });

  it('[P0] should crawl get_user_feed(username), resolve numeric ID, normalize to PostItem[], and persist to store (AC-4, AC-7)', async () => {
    storedPosts = [];
    const client = new ThreadsClient({ baseUrl: serverUrl });
    const crawler = new ThreadsCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
    });

    const result = await crawler.start({
      action: 'get_user_feed',
      args: { username: 'vietnam_trendsetter', count: 10 },
      session: { accountId: 'threads-guest' },
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThanOrEqual(1);

    const post = result.posts[0];
    expect(post.id).toBe('threads:9988776655');
    expect(post.externalId).toBe('9988776655');
    expect(post.platform).toBe('threads');
    expect(post.category).toBe('social');
    expect(post.authorName).toBe('vietnam_trendsetter');
    expect(post.authorId).toBe('5432109876');
    expect(post.content).toBe('Hot trend discussion on Threads Vietnam');
    expect(post.likesCount).toBe(890);
    expect(post.repliesCount).toBe(75);
    expect(post.publishedAt).toBeInstanceOf(Date);
    expect(post.metadata?.postCode).toBe('DE_trending_threads');

    // Stored verification
    expect(storedPosts.length).toBeGreaterThanOrEqual(1);
    expect(storedPosts[0].id).toBe('threads:9988776655');
  });

  it('[P0] should crawl search(query) and normalize PostItem[] (AC-5)', async () => {
    storedPosts = [];
    const client = new ThreadsClient({ baseUrl: serverUrl });
    const crawler = new ThreadsCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
      docIds: { SEARCH_POSTS: 'search_doc_mock' },
    });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'saigon', count: 5 },
      session: { accountId: 'threads-guest' },
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts[0].id).toBe('threads:777888999');
    expect(result.posts[0].content).toContain('Saigon');
  });

  it('[P0] should crawl get_post_comments(postId) and extract CommentItem[] hierarchy (AC-6, AC-7)', async () => {
    storedComments = [];
    const client = new ThreadsClient({ baseUrl: serverUrl });
    const crawler = new ThreadsCrawler({
      client,
      governor,
      accountPool,
      sessionManager,
      store: mockStore,
    });

    const result = await crawler.start({
      action: 'get_post_comments',
      args: { postId: '9988776655', maxDepth: 2, maxComments: 50 },
      session: { accountId: 'threads-guest' },
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.comments)).toBe(true);
    expect(result.comments.length).toBeGreaterThanOrEqual(1);

    const comment = result.comments[0];
    expect(comment.id).toBe('threads:9988776655:comment_node_101');
    expect(comment.postId).toBe('threads:9988776655');
    expect(comment.authorName).toBe('commenter_one');
    expect(comment.content).toBe('First reply comment on this thread!');
  });
});
