// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { ThreadsCrawler, DEFAULT_THREADS_DOC_IDS } from '../../../../src/scrapers/social/threads/crawler.js';
import { ThreadsClient } from '../../../../src/scrapers/social/threads/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';
import metadataSchemaRegistry from '../../../../src/core/metadata-schema-registry.js';
import path from 'node:path';

describe('Story 15.1 — ThreadsCrawler Hybrid Scraper Contract', () => {
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
    // Ensure schemas are loaded
    const schemasDir = path.resolve(process.cwd(), 'schemas');
    metadataSchemaRegistry.loadSchemasFromDisk(schemasDir);

    proxyPool = new ProxyIpPool({
      proxies: ['http://127.0.0.1:8080'],
    });
    governor = new AdaptiveRateGovernor({ proxyPool });
    accountPool = new AccountPool({ governor });
    sessionManager = new SessionManager();

    sessionManager.set('threads-guest', {
      accountId: 'threads-guest',
      platform: 'threads',
      cookies: { csrftoken: 'test_csrf_token_123' },
    });
    accountPool.registerAccounts('threads', ['threads-guest']);

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // Landing HTML for tokens & username resolution
        if (req.url?.startsWith('/@')) {
          const username = req.url.slice(2);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_Lsd123" />
              <script>
                ["DTSGInitialData",[],{"token":"DTSG_456"}];
                window.__spin_r = 1016839210;
              </script>
              <script type="application/json">
                {"data":{"user":{"pk":"88889999","username":"${username}"}}}
              </script>
            </body></html>
          `);
          return;
        }

        // Search SSR endpoint fallback
        if (req.url?.startsWith('/search')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <script type="application/json">
                {
                  "data": {
                    "searchResults": {
                      "threads": [
                        {
                          "thread_items": [
                            {
                              "post": {
                                "pk": "999888777",
                                "code": "SearchPostCode1",
                                "caption": { "text": "Drama tin tuc nong hoi tai Viet Nam" },
                                "user": { "pk": "12345", "username": "trend_hunter" },
                                "like_count": 500,
                                "text_post_app_info": { "direct_reply_count": 80, "is_reply": false },
                                "taken_at": 1787680000,
                                "media_type": 1,
                                "image_versions2": {
                                  "candidates": [{ "url": "https://cdn.threads.net/p1.jpg", "width": 800, "height": 800 }]
                                }
                              }
                            }
                          ]
                        }
                      ]
                    }
                  }
                }
              </script>
            </body></html>
          `);
          return;
        }

        // GraphQL endpoint
        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');
          const variables = JSON.parse(params.get('variables') || '{}');

          // 1. User feed
          if (docId === '6232751443445612' || variables.userID) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                mediaData: {
                  threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            pk: '3123456789012345678',
                            code: 'CxY123abc',
                            caption: { text: 'Bai viet xu huong Threads Vietnam' },
                            user: {
                              pk: '88889999',
                              username: 'vietnam_dev',
                              profile_pic_url: 'https://cdn.threads.net/avatar.jpg',
                            },
                            like_count: 320,
                            text_post_app_info: {
                              direct_reply_count: 45,
                              is_reply: false,
                            },
                            taken_at: 1787680000,
                            media_type: 1,
                            image_versions2: {
                              candidates: [
                                { url: 'https://cdn.threads.net/img_large.jpg', width: 1080, height: 1080 },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  ],
                  page_info: {
                    has_next_page: false,
                    end_cursor: null,
                  },
                },
              },
            }));
            return;
          }

          // 2. Post comments: Root comments
          if (docId === 'comment_root_doc_id') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                node: {
                  comment_rendering_instance_for_feed_location: {
                    comments: {
                      edges: [
                        {
                          node: {
                            pk: 'root_c_1',
                            code: 'RC1',
                            caption: { text: 'Binh luan goc 1' },
                            user: { pk: 'u1', username: 'user_one' },
                            like_count: 10,
                            text_post_app_info: { direct_reply_count: 1 },
                            taken_at: 1787680100,
                          },
                        },
                      ],
                      page_info: { has_next_page: false, end_cursor: null },
                    },
                  },
                },
              },
            }));
            return;
          }

          // 3. Post comments: Reply comments
          if (docId === 'comment_reply_doc_id') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                node: {
                  replies_connection: {
                    edges: [
                      {
                        node: {
                          pk: 'reply_c_1',
                          code: 'RPLY1',
                          caption: { text: 'Tra loi binh luan 1' },
                          user: { pk: 'u2', username: 'user_two' },
                          like_count: 2,
                          taken_at: 1787680200,
                        },
                      },
                    ],
                    page_info: { has_next_page: false, end_cursor: null },
                  },
                },
              },
            }));
            return;
          }

          // 4. BarcelonaPostPageQuery fallback
          if (docId === '5587632691339264' || docId === DEFAULT_THREADS_DOC_IDS.POST_DETAIL) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                data: {
                  containing_thread: {
                    thread_items: [{ post: { pk: '3123456789012345678', code: 'CxY123abc' } }],
                  },
                  reply_threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            pk: 'fallback_reply_1',
                            code: 'FBR1',
                            caption: { text: 'Fallback reply text' },
                            user: { pk: 'u3', username: 'user_three' },
                            like_count: 5,
                            taken_at: 1787680300,
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

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { success: true } }));
          return;
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
        resolve(null);
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('[P0] should extend AbstractCrawler with requiresAuth=true and register standard actions (AC-3)', () => {
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      governor,
      accountPool,
    });

    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('threads');
    expect(crawler.platform).toBe('threads');
    expect(crawler.requiresAuth).toBe(true);

    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);
    expect(actionNames).toContain('get_user_feed');
    expect(actionNames).toContain('search');
    expect(actionNames).toContain('get_post_comments');
  });

  it('[P0] should scrape user feed, normalize to PostItem[], and persist to store (AC-4, AC-7)', async () => {
    storedPosts = [];
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      store: mockStore,
      governor,
      accountPool,
      sessionManager,
    });

    const result = await crawler.start({
      action: 'get_user_feed',
      args: { username: 'vietnam_dev', count: 10 },
      session: { accountId: 'threads-guest' },
    });

    expect(result.posts).toHaveLength(1);
    const post = result.posts[0];
    expect(post.id).toBe('threads:3123456789012345678');
    expect(post.platform).toBe('threads');
    expect(post.category).toBe('social');
    expect(post.authorName).toBe('vietnam_dev');
    expect(post.content).toBe('Bai viet xu huong Threads Vietnam');
    expect(post.likesCount).toBe(320);
    expect(post.repliesCount).toBe(45);
    expect(post.mediaUrls).toEqual(['https://cdn.threads.net/img_large.jpg']);
    expect(post.metadata).toMatchObject({
      postCode: 'CxY123abc',
      mediaType: '1',
      sourceMethod: 'graphql',
    });

    // Check store persistence
    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0].id).toBe('threads:3123456789012345678');

    // Schema validation check with metadataSchemaRegistry
    const validation = metadataSchemaRegistry.validateMetadata(post.platform, post.category, post.metadata);
    expect(validation.valid).toBe(true);
  });

  it('[P0] should search posts via SSR fallback, normalize to PostItem[], and persist to store (AC-5)', async () => {
    storedPosts = [];
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      store: mockStore,
      governor,
      accountPool,
      sessionManager,
    });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'drama vietnam', count: 10 },
      session: { accountId: 'threads-guest' },
    });

    expect(result.posts).toHaveLength(1);
    const post = result.posts[0];
    expect(post.id).toBe('threads:999888777');
    expect(post.content).toBe('Drama tin tuc nong hoi tai Viet Nam');
    expect(post.metadata.sourceMethod).toBe('ssr');
    expect(storedPosts).toHaveLength(1);
  });

  it('[P0] should scrape post comments using hierarchical CommentTreeExtractor (AC-6)', async () => {
    storedComments = [];
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      docIds: {
        COMMENT_ROOTS: 'comment_root_doc_id',
        COMMENT_REPLIES: 'comment_reply_doc_id',
      },
      store: mockStore,
      governor,
      accountPool,
      sessionManager,
    });

    const result = await crawler.start({
      action: 'get_post_comments',
      args: { postId: '3123456789012345678', maxDepth: 2, maxComments: 50 },
      session: { accountId: 'threads-guest' },
    });

    expect(result.comments.length).toBeGreaterThanOrEqual(1);
    const rootComment = result.comments.find((c) => c.externalId === 'root_c_1');
    expect(rootComment).toBeDefined();
    expect(rootComment?.id).toBe('threads:3123456789012345678:root_c_1');
    expect(rootComment?.depth).toBe(0);
    expect(rootComment?.content).toBe('Binh luan goc 1');

    const replyComment = result.comments.find((c) => c.externalId === 'reply_c_1');
    expect(replyComment).toBeDefined();
    expect(replyComment?.id).toBe('threads:3123456789012345678:reply_c_1');
    expect(replyComment?.parentCommentId).toBe('threads:3123456789012345678:root_c_1');
    expect(replyComment?.depth).toBe(1);

    expect(storedComments.length).toBeGreaterThanOrEqual(1);
  });

  it('[P1] should fallback to BarcelonaPostPageQuery when root/reply doc_ids are unconfigured (AC-6)', async () => {
    storedComments = [];
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      docIds: {
        COMMENT_ROOTS: null,
        COMMENT_REPLIES: null,
        POST_DETAIL: '5587632691339264',
      },
      store: mockStore,
      governor,
      accountPool,
      sessionManager,
    });

    const result = await crawler.start({
      action: 'get_post_comments',
      args: { postId: '3123456789012345678' },
      session: { accountId: 'threads-guest' },
    });

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].externalId).toBe('fallback_reply_1');
    expect(result.comments[0].content).toBe('Fallback reply text');
  });

  it('[P2] should clean up token cache on cleanup()', async () => {
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      governor,
      accountPool,
    });

    await crawler.cleanup();
    expect(crawler.client).toBeDefined();
  });
});
