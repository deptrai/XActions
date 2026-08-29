// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { ThreadsCrawler, DEFAULT_THREADS_DOC_IDS } from '../../../../src/scrapers/social/threads/crawler.js';
import { ThreadsClient } from '../../../../src/scrapers/social/threads/client.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import metadataSchemaRegistry from '../../../../src/core/metadata-schema-registry.js';
import path from 'node:path';

describe('Story 15.1.3: Threads Hybrid DocID Hardening for Search & Comments (ATDD)', () => {
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
        // Token extraction HTML
        if (req.url === '/' || req.url?.startsWith('/@')) {
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

        // SSR search fallback endpoint
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
                                "pk": "888111222",
                                "code": "SSR_FALLBACK_CODE",
                                "caption": { "text": "SSR Search Fallback Result" },
                                "user": { "pk": "4444", "username": "ssr_author" },
                                "like_count": 12,
                                "taken_at": 1787680000
                              }
                            }
                          ]
                        }
                      ],
                      "page_info": { "has_next_page": false, "end_cursor": null }
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

          // 1. Search via GraphQL
          if (docId === 'doc_search_posts_hardened') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                searchResults: {
                  threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            pk: '777666555',
                            code: 'GQL_SEARCH_01',
                            caption: { text: 'GraphQL Search Result' },
                            user: { pk: '5555', username: 'gql_author' },
                            like_count: 88,
                            taken_at: 1787680000,
                            media_type: 1,
                            image_versions2: {
                              candidates: [{ url: 'https://cdn.threads.net/gql_img.jpg', width: 600, height: 600 }],
                            },
                          },
                        },
                      ],
                    },
                  ],
                  page_info: {
                    has_next_page: true,
                    end_cursor: 'cursor_search_page_2',
                  },
                },
              },
            }));
            return;
          }

          // 2. Search GraphQL failure (triggers SSR fallback)
          if (docId === 'doc_search_rotated_fail') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              errors: [{ message: 'GraphQL query execution failed: Invalid doc_id', code: 1675004 }],
            }));
            return;
          }

          // 3. Comment Roots GraphQL query
          if (docId === 'doc_comment_roots_hardened') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                node: {
                  comment_rendering_instance_for_feed_location: {
                    comments: {
                      edges: [
                        {
                          node: {
                            pk: 'root_c_100',
                            code: 'RC100',
                            caption: { text: 'Root Comment 100' },
                            user: { pk: 'u100', username: 'user_100' },
                            like_count: 20,
                            taken_at: 1787680100,
                            text_post_app_info: { direct_reply_count: 1 },
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

          // 4. Comment Replies GraphQL query
          if (docId === 'doc_comment_replies_hardened') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                node: {
                  replies_connection: {
                    edges: [
                      {
                        node: {
                          pk: 'reply_c_200',
                          code: 'RPLY200',
                          caption: { text: 'Nested Reply 200' },
                          user: { pk: 'u200', username: 'user_200' },
                          like_count: 5,
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

          // 5. Post Detail fallback query
          if (docId === '5587632691339264' || docId === DEFAULT_THREADS_DOC_IDS.POST_DETAIL) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                data: {
                  containing_thread: {
                    thread_items: [{ post: { pk: '314159', code: 'MAIN_POST' } }],
                  },
                  reply_threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            pk: 'fallback_root_300',
                            code: 'FB300',
                            caption: { text: 'Fallback Root Comment' },
                            user: { pk: 'u300', username: 'user_300' },
                            like_count: 10,
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

  describe('AC-1: DEFAULT_THREADS_DOC_IDS Configuration', () => {
    it('defines default doc_ids for SEARCH_POSTS, COMMENT_ROOTS, and COMMENT_REPLIES', () => {
      expect(DEFAULT_THREADS_DOC_IDS).toBeDefined();
      expect(DEFAULT_THREADS_DOC_IDS).toHaveProperty('SEARCH_POSTS');
      expect(DEFAULT_THREADS_DOC_IDS).toHaveProperty('COMMENT_ROOTS');
      expect(DEFAULT_THREADS_DOC_IDS).toHaveProperty('COMMENT_REPLIES');
      expect(DEFAULT_THREADS_DOC_IDS).toHaveProperty('POST_DETAIL');
    });
  });

  describe('AC-2: GraphQL-First Search Execution with Fallback', () => {
    it('executes search via GraphQL when SEARCH_POSTS is configured and preserves pageInfo', async () => {
      storedPosts = [];
      const crawler = new ThreadsCrawler({
        client: new ThreadsClient({ baseUrl: serverUrl }),
        docIds: { SEARCH_POSTS: 'doc_search_posts_hardened' },
        store: mockStore,
        governor,
        accountPool,
        sessionManager,
      });

      const result = await crawler.start({
        action: 'search',
        args: { query: 'artificial intelligence', count: 10 },
        session: { accountId: 'threads-guest' },
      });

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].id).toBe('threads:777666555');
      expect(result.posts[0].metadata?.sourceMethod).toBe('graphql');
      expect(result.pageInfo?.has_next_page).toBe(true);
      expect(result.pageInfo?.end_cursor).toBe('cursor_search_page_2');
      expect(storedPosts).toHaveLength(1);
    });

    it('falls back to HTTP SSR search when GraphQL SEARCH_POSTS query fails', async () => {
      storedPosts = [];
      const crawler = new ThreadsCrawler({
        client: new ThreadsClient({ baseUrl: serverUrl }),
        docIds: { SEARCH_POSTS: 'doc_search_rotated_fail' },
        store: mockStore,
        governor,
        accountPool,
        sessionManager,
      });

      const result = await crawler.start({
        action: 'search',
        args: { query: 'fallback test', count: 10 },
        session: { accountId: 'threads-guest' },
      });

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].id).toBe('threads:888111222');
      expect(result.posts[0].metadata?.sourceMethod).toBe('ssr');
      expect(storedPosts).toHaveLength(1);
    });
  });

  describe('AC-3: Multi-Layer GraphQL Comment Tree Execution', () => {
    it('queries COMMENT_ROOTS and COMMENT_REPLIES to build multi-depth comment tree', async () => {
      storedComments = [];
      const crawler = new ThreadsCrawler({
        client: new ThreadsClient({ baseUrl: serverUrl }),
        docIds: {
          COMMENT_ROOTS: 'doc_comment_roots_hardened',
          COMMENT_REPLIES: 'doc_comment_replies_hardened',
        },
        store: mockStore,
        governor,
        accountPool,
        sessionManager,
      });

      const result = await crawler.start({
        action: 'get_post_comments',
        args: { postId: '314159', maxDepth: 2, maxComments: 50 },
        session: { accountId: 'threads-guest' },
      });

      expect(result.comments.length).toBeGreaterThanOrEqual(1);
      const root = result.comments.find((c) => c.externalId === 'root_c_100');
      expect(root).toBeDefined();
      expect(root?.depth).toBe(0);

      const reply = result.comments.find((c) => c.externalId === 'reply_c_200');
      expect(reply).toBeDefined();
      expect(reply?.depth).toBe(1);
      expect(reply?.parentCommentId).toBe('threads:314159:root_c_100');
    });

    it('gracefully degrades to POST_DETAIL fallback when comment doc_ids are unconfigured', async () => {
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
        args: { postId: '314159' },
        session: { accountId: 'threads-guest' },
      });

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].externalId).toBe('fallback_root_300');
    });
  });
});
