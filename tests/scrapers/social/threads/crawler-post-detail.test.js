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
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../../src/core/error-envelope.js';
import metadataSchemaRegistry from '../../../../src/core/metadata-schema-registry.js';
import path from 'node:path';

describe('Story 15.1.2 — Threads Hybrid Post Detail & Comment Tree', () => {
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
    saveCheckpoint: async () => {},
  };

  beforeAll(async () => {
    const schemasDir = path.resolve(process.cwd(), 'schemas');
    metadataSchemaRegistry.loadSchemasFromDisk(schemasDir);

    proxyPool = new ProxyIpPool({ proxies: ['http://127.0.0.1:8080'] });
    governor = new AdaptiveRateGovernor({ proxyPool });
    accountPool = new AccountPool({ governor });
    sessionManager = new SessionManager();

    accountPool.registerAccounts('threads', ['threads-guest']);

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // Landing / Token HTML
        if (req.url === '/' || req.url === '/@instagram') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_Lsd123" />
              <script>
                ["DTSGInitialData",[],{"token":"DTSG_456"}];
                window.__spin_r = 1016839210;
              </script>
            </body></html>
          `);
          return;
        }

        // SSR Fallback for /t/<shortcode> or /@user/post/<shortcode>
        if (req.url?.startsWith('/t/') || req.url?.includes('/post/')) {
          if (req.url.includes('404_not_found')) {
            res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
            res.end('<!DOCTYPE html><html><body><h1>Page Not Found</h1></body></html>');
            return;
          }

          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <script type="application/json">
                {
                  "require": [
                    [
                      "RelayPrefetchedStreamCache",
                      "next",
                      [],
                      [
                        {
                          "__bbox": {
                            "result": {
                              "data": {
                                "data": {
                                  "containing_thread": {
                                    "thread_items": [
                                      {
                                        "post": {
                                          "pk": "3141592653589793",
                                          "id": "3141592653589793",
                                          "code": "CuZ7X9_sF9y",
                                          "caption": { "text": "Post resolved via SSR HTML fallback" },
                                          "user": { "pk": "8888", "username": "ssr_author" }
                                        }
                                      }
                                    ]
                                  }
                                }
                              }
                            }
                          }
                        }
                      ]
                    ]
                  ]
                }
              </script>
            </body></html>
          `);
          return;
        }

        // GraphQL Endpoint
        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');
          const variables = JSON.parse(params.get('variables') || '{}');

          // BarcelonaPostPageQuery
          if (docId === '5587632691339264' || docId === DEFAULT_THREADS_DOC_IDS.POST_DETAIL) {
            const requestedId = String(variables.postID || '');
            if (requestedId === '3141592653589793' || requestedId === '3141803346926526322' || requestedId === '99881122') {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({
                data: {
                  data: {
                    containing_thread: {
                      thread_items: [
                        {
                          post: {
                            id: requestedId === '99881122' ? '3141592653589793' : requestedId,
                            pk: requestedId === '99881122' ? '3141592653589793' : requestedId,
                            code: requestedId === '3141803346926526322' ? 'CuZ7X9_sF9y' : 'LKUMKJW0h',
                            caption: { text: 'Deep conversation on Threads Vietnam!' },
                            user: {
                              id: '998877',
                              pk: '998877',
                              username: 'threads_creator',
                              profile_pic_url: 'https://cdn.threads.net/avatar_creator.jpg',
                            },
                            like_count: 1250,
                            text_post_app_info: {
                              direct_reply_count: 15,
                              is_reply: false,
                            },
                            taken_at: 1787680000,
                            media_type: 1,
                            image_versions2: {
                              candidates: [
                                { url: 'https://cdn.threads.net/img_main.jpg', width: 1080, height: 1080 },
                              ],
                            },
                          },
                        },
                      ],
                    },
                    reply_threads: [
                      {
                        thread_items: [
                          {
                            post: {
                              id: '99881122',
                              pk: '99881122',
                              code: 'RPLY101',
                              caption: { text: 'Great thread topic!' },
                              user: { pk: '112233', username: 'replier_one' },
                              like_count: 45,
                              taken_at: 1787680100,
                              text_post_app_info: { direct_reply_count: 0 },
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
            res.end(JSON.stringify({
              data: {
                data: {
                  containing_thread: null,
                  reply_threads: [],
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

  it('[P0] should register post_detail action in ActionRegistry (AC-1)', () => {
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      governor,
      accountPool,
    });

    expect(crawler).toBeInstanceOf(AbstractCrawler);
    const actions = crawler.listActions();
    const action = actions.find((a) => a.action === 'post_detail');
    expect(action).toBeDefined();
    expect(action?.requiredArgs).toContain('postId');
    expect(action?.optionalArgs).toContain('includeReplies');
    expect(action?.outputType).toBe('{ post: PostItem, comments?: CommentItem[], pageInfo?: any }');
  });

  it('[P0] should extract root PostItem for numeric postId without replies (AC-2)', async () => {
    storedPosts = [];
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      store: mockStore,
      governor,
      accountPool,
      sessionManager,
    });

    const result = await crawler.start({
      action: 'post_detail',
      args: { postId: '3141592653589793', includeReplies: false },
      session: { accountId: 'threads-guest' },
    });

    expect(result).toBeDefined();
    expect(result.post).toBeDefined();
    expect(result.post.id).toBe('threads:3141592653589793');
    expect(result.post.externalId).toBe('3141592653589793');
    expect(result.post.authorName).toBe('threads_creator');
    expect(result.post.content).toBe('Deep conversation on Threads Vietnam!');
    expect(result.post.likesCount).toBe(1250);
    expect(result.post.metadata?.sourceMethod).toBe('post_detail');
    expect(result.comments).toBeUndefined();

    expect(storedPosts).toHaveLength(1);
    expect(storedPosts[0].id).toBe('threads:3141592653589793');
  });

  it('[P0] should resolve shortcode and URL format postId correctly (AC-4)', async () => {
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      store: mockStore,
      governor,
      accountPool,
      sessionManager,
    });

    // 1. Shortcode CuZ7X9_sF9y
    const res1 = await crawler.start({
      action: 'post_detail',
      args: { postId: 'CuZ7X9_sF9y' },
      session: { accountId: 'threads-guest' },
    });
    expect(res1.post.id).toBe('threads:3141803346926526322');

    // 2. Full URL with shortcode
    const res2 = await crawler.start({
      action: 'post_detail',
      args: { postId: 'https://www.threads.net/@threads_creator/post/CuZ7X9_sF9y' },
      session: { accountId: 'threads-guest' },
    });
    expect(res2.post.id).toBe('threads:3141803346926526322');

    // 3. Short URL https://www.threads.net/t/CuZ7X9_sF9y
    const res3 = await crawler.start({
      action: 'post_detail',
      args: { postId: 'https://www.threads.net/t/CuZ7X9_sF9y' },
      session: { accountId: 'threads-guest' },
    });
    expect(res3.post.id).toBe('threads:3141803346926526322');
  });

  it('[P0] should fetch reply tree when includeReplies=true and clamp depth when COMMENT_REPLIES is null (AC-3, AC-6)', async () => {
    storedComments = [];
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      docIds: {
        POST_DETAIL: '5587632691339264',
        COMMENT_ROOTS: null,
        COMMENT_REPLIES: null,
      },
      store: mockStore,
      governor,
      accountPool,
      sessionManager,
    });

    const result = await crawler.start({
      action: 'post_detail',
      args: { postId: '3141592653589793', includeReplies: true, maxDepth: 3, maxComments: 50 },
      session: { accountId: 'threads-guest' },
    });

    expect(result.post).toBeDefined();
    expect(result.post.id).toBe('threads:3141592653589793');
    expect(result.comments).toBeDefined();
    expect(Array.isArray(result.comments)).toBe(true);
    expect(result.comments?.length).toBeGreaterThanOrEqual(1);

    const reply = result.comments?.[0];
    expect(reply?.id).toBe('threads:3141592653589793:99881122');
    expect(reply?.content).toBe('Great thread topic!');
    expect(reply?.depth).toBe(0); // Clamped to 0 because COMMENT_REPLIES is null
    expect(storedComments.length).toBeGreaterThanOrEqual(1);
  });

  it('[P1] should throw XACT_4041 PlatformError when post cannot be found / resolved (AC-4)', async () => {
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      governor,
      accountPool,
      sessionManager,
    });

    await expect(crawler.start({
      action: 'post_detail',
      args: { postId: '404_not_found' },
      session: { accountId: 'threads-guest' },
    })).rejects.toMatchObject({
      code: 'XACT_4041',
      type: 'not_found',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  });

  it('[P1] should reject external / invalid URL to prevent SSRF', async () => {
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      governor,
      accountPool,
      sessionManager,
    });

    await expect(crawler.start({
      action: 'post_detail',
      args: { postId: 'http://attacker.com/exploit' },
      session: { accountId: 'threads-guest' },
    })).rejects.toMatchObject({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
    });
  });

  it('[P0] should extract post matching numericPostId even when located in reply_threads', async () => {
    const crawler = new ThreadsCrawler({
      client: new ThreadsClient({ baseUrl: serverUrl }),
      store: mockStore,
      governor,
      accountPool,
      sessionManager,
    });

    const result = await crawler.start({
      action: 'post_detail',
      args: { postId: '99881122' },
      session: { accountId: 'threads-guest' },
    });

    expect(result.post).toBeDefined();
    expect(result.post.id).toBe('threads:99881122');
    expect(result.post.content).toBe('Great thread topic!');
  });
});
