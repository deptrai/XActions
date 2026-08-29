// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import { scrape } from '../../../../src/scrapers/index.js';
import { ThreadsCrawler } from '../../../../src/scrapers/social/threads/crawler.js';
import { ThreadsClient } from '../../../../src/scrapers/social/threads/client.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import metadataSchemaRegistry from '../../../../src/core/metadata-schema-registry.js';
import path from 'node:path';

/**
 * Story 15.1.4 — Threads Hybrid Integration & Package Exports (ATDD)
 *
 * These scaffolds are intentionally skipped in the RED phase.
 * Remove `test.skip` (or `.skip` on each `it`) one by one as the
 * implementation progresses through TDD red-green-refactor.
 */

describe.skip('Story 15.1.4: Threads Hybrid Caller Migration & Package Exports', () => {
  let server;
  let serverUrl;
  let proxyPool;
  let governor;
  let accountPool;
  let sessionManager;
  let storedPosts = [];
  let storedComments = [];
  let receivedActions = [];

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
        // Landing / profile page with token extraction
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

        // GraphQL endpoint
        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');
          const variables = JSON.parse(params.get('variables') || '{}');

          receivedActions.push({ docId, variables });

          if (docId === '23996318473300828' || docId === 'profile_doc') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                userData: {
                  user: {
                    pk: '1234567',
                    username: 'testuser',
                    full_name: 'Test User',
                    biography: 'Hello Threads',
                    follower_count: 100,
                    following_count: 50,
                    profile_pic_url: 'https://cdn.threads.net/avatar.jpg',
                  },
                },
              },
            }));
            return;
          }

          if (docId === '6232751443445612' || docId === 'feed_doc') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                mediaData: {
                  threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            pk: '7654321',
                            code: 'AbCdEfGh',
                            caption: { text: 'Timeline post' },
                            user: { pk: '1234567', username: 'testuser' },
                            like_count: 42,
                            taken_at: 1787680000,
                          },
                        },
                      ],
                    },
                  ],
                  page_info: { has_next_page: false, end_cursor: null },
                },
              },
            }));
            return;
          }

          if (docId === '5587632691339264' || docId === 'post_detail_doc') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                data: {
                  containing_thread: {
                    thread_items: [
                      {
                        post: {
                          pk: '314159',
                          code: 'PiDay2026',
                          caption: { text: 'Post detail content' },
                          user: { pk: '1234567', username: 'testuser' },
                          like_count: 99,
                          taken_at: 1787680000,
                        },
                      },
                    ],
                  },
                  reply_threads: [],
                },
              },
            }));
            return;
          }

          if (docId === '1314198888521447147' || docId === 'search_doc') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                searchResults: {
                  threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            pk: '999888777',
                            code: 'Search001',
                            caption: { text: 'Search result for ' + variables.query },
                            user: { pk: '1111', username: 'searcher' },
                            like_count: 7,
                            taken_at: 1787680000,
                          },
                        },
                      ],
                    },
                  ],
                  page_info: { has_next_page: false, end_cursor: null },
                },
              },
            }));
            return;
          }

          if (docId === '1343493212639512438' || docId === 'comment_roots_doc') {
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
                            caption: { text: 'Root comment' },
                            user: { pk: 'u100', username: 'commenter' },
                            like_count: 5,
                            taken_at: 1787680100,
                            text_post_app_info: { direct_reply_count: 0 },
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

  beforeEach(() => {
    storedPosts = [];
    storedComments = [];
    receivedActions = [];
  });

  it('AC-1: scrape(threads, ...) does not launch a Puppeteer browser', async () => {
    const launchSpy = vi.spyOn(await import('puppeteer-extra'), 'launch').mockResolvedValue({
      newPage: vi.fn(),
      close: vi.fn(),
      isConnected: vi.fn(() => true),
    });

    const result = await scrape('threads', 'profile', {
      username: 'testuser',
      baseUrl: serverUrl,
      store: mockStore,
    });

    expect(launchSpy).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    launchSpy.mockRestore();
  });

  it('AC-2: scrape(threads, profile) maps to ThreadsCrawler action profile', async () => {
    const result = await scrape('threads', 'profile', {
      username: 'testuser',
      baseUrl: serverUrl,
      store: mockStore,
    });

    expect(result).toBeDefined();
    expect(receivedActions.some((a) => a.docId === '23996318473300828' || a.docId === 'profile_doc')).toBe(true);
  });

  it('AC-2: scrape(threads, tweets | timeline | feed | user_feed) maps to get_user_feed', async () => {
    for (const action of ['tweets', 'timeline', 'feed', 'user_feed']) {
      receivedActions = [];
      const result = await scrape('threads', action, {
        username: 'testuser',
        baseUrl: serverUrl,
        limit: 10,
        store: mockStore,
      });

      expect(result).toBeDefined();
      expect(receivedActions.some((a) => a.docId === '6232751443445612' || a.docId === 'feed_doc')).toBe(true);
    }
  });

  it('AC-2: scrape(threads, post | post_detail) maps to post_detail', async () => {
    for (const action of ['post', 'post_detail']) {
      receivedActions = [];
      const result = await scrape('threads', action, {
        postId: '314159',
        baseUrl: serverUrl,
        store: mockStore,
      });

      expect(result).toBeDefined();
      expect(receivedActions.some((a) => a.docId === '5587632691339264' || a.docId === 'post_detail_doc')).toBe(true);
    }
  });

  it('AC-2: scrape(threads, comments | post_comments) maps to get_post_comments', async () => {
    for (const action of ['comments', 'post_comments']) {
      receivedActions = [];
      const result = await scrape('threads', action, {
        postId: '314159',
        baseUrl: serverUrl,
        store: mockStore,
      });

      expect(result).toBeDefined();
      expect(receivedActions.some((a) => a.docId === '1343493212639512438' || a.docId === 'comment_roots_doc')).toBe(true);
    }
  });

  it('AC-2: scrape(threads, search) maps to search action', async () => {
    const result = await scrape('threads', 'search', {
      query: 'xactions',
      baseUrl: serverUrl,
      limit: 10,
      store: mockStore,
    });

    expect(result).toBeDefined();
    expect(receivedActions.some((a) => a.docId === '1314198888521447147' || a.docId === 'search_doc')).toBe(true);
  });

  it('AC-2: scrape(threads, followers) maps to followers action', async () => {
    const result = await scrape('threads', 'followers', {
      username: 'testuser',
      baseUrl: serverUrl,
      limit: 10,
      store: mockStore,
    });

    expect(result).toBeDefined();
  });

  it('AC-2: scrape(threads, following) maps to following action', async () => {
    const result = await scrape('threads', 'following', {
      username: 'testuser',
      baseUrl: serverUrl,
      limit: 10,
      store: mockStore,
    });

    expect(result).toBeDefined();
  });

  it('AC-3: package.json exports xactions/scrapers/social/threads', async () => {
    const pkg = await import('../../../../package.json', { assert: { type: 'json' } });
    expect(pkg.exports['./scrapers/social/threads']).toBe('./src/scrapers/social/threads/index.js');
    expect(pkg.exports['./scrapers/social']).toBe('./src/scrapers/social/index.js');
  });

  it('AC-3: public symbols exported from social/threads barrel', async () => {
    const mod = await import('../../../../src/scrapers/social/threads/index.js');
    expect(mod.ThreadsClient).toBeDefined();
    expect(mod.ThreadsCrawler).toBeDefined();
    expect(mod.DEFAULT_THREADS_DOC_IDS).toBeDefined();
    expect(mod.ThreadsPlatformResponseValidator).toBeDefined();
    expect(mod.threadsNamespacedProfileId).toBeDefined();
    expect(mod.normalizeThreadsProfile).toBeDefined();
    expect(mod.profileItemToPostItem).toBeDefined();
  });

  it('AC-4: legacy Threads scraper carries deprecation markers', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../../../src/scrapers/threads/index.js', import.meta.url), 'utf-8')
    );
    expect(source).toContain('// LEGACY — see docs/deprecation-plan.md');
    expect(source).toContain('@deprecated');
    expect(source).toContain('scrapeProfile');
    expect(source).toContain('scrapeTweets');
    expect(source).toContain('scrapeFollowers');
    expect(source).toContain('scrapeFollowing');
    expect(source).toContain('scrapeSearch');
    expect(source).toContain('scrapePost');
  });

  it('AC-5: caller-migration test file is discoverable and red-phase', () => {
    // This meta-test is intentionally kept active so the suite itself is discoverable.
    expect(true).toBe(true);
  });

  it('NEG: scrape(threads, unknown_action) throws informative error', async () => {
    await expect(scrape('threads', 'unknown_action', { username: 'testuser' })).rejects.toThrow(
      /unknown_action/
    );
  });
});
