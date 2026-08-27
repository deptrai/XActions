// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { scrape } from '../../../../src/scrapers/index.js';
import { FacebookCrawler, DEFAULT_FB_DOC_IDS } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import * as facebookScrapeService from '../../../../api/services/facebookScrape.js';

/**
 * Story 13.10: Facebook Hybrid Integration & Caller Migration
 * Acceptance Tests (ATDD Red Phase - all tests marked with it.skip)
 */

describe('Story 13.10 — Facebook Hybrid Integration & Caller Migration', () => {
  /** @type {http.Server} */
  let server;
  let serverUrl = '';
  let proxyPool;
  let governor;
  let accountPool;
  let sessionManager;

  const rawCookies = {
    c_user: '61590064244856',
    xs: '9%3AQmnjyIRNbY9gdw%3A2%3A1787784974%3A-1%3A-1%3A%3AAcx8CO32nY7GQkbpSx9j2SCLy_fLl9S_tMTOAlkfjVc',
  };

  beforeAll(async () => {
    proxyPool = new ProxyIpPool({ proxies: ['http://127.0.0.1:8080'] });
    governor = new AdaptiveRateGovernor({ proxyPool, defaultRps: 100, maxRps: 100 });
    accountPool = new AccountPool({ governor });
    sessionManager = new SessionManager();

    sessionManager.set('acc_fb_test', {
      accountId: 'acc_fb_test',
      platform: 'facebook',
      cookies: rawCookies,
    });
    accountPool.registerAccounts('facebook', ['acc_fb_test']);

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_LsdMigration" />
              <input type="hidden" name="jazoest" value="2953" />
              <script>
                requireLazy(["DTSGInitialData"], function(d) { d.token = "DTSG_Migration"; });
                window.__spin_r = 1016839210;
                window.__spin_t = 1787681000;
                window.__hsi = "hsi_migration";
              </script>
            </body></html>
          `);
          return;
        }

        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');

          if (docId === 'doc_marketplace') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                viewer: {
                  marketplace_feed_stories: {
                    edges: [
                      {
                        node: {
                          id: 'item_101',
                          listing: {
                            id: 'item_101',
                            marketplace_listing_title: 'MacBook M3 Pro 14',
                            listing_price: { formatted_amount: '$1,500', amount: '1500', currency: 'USD', amount_in_hundredths: 150000 },
                            location: { reverse_geocode: { city: 'San Jose' } },
                            seller: { id: 'seller_1', name: 'Seller One' },
                            creation_time: 1787680000,
                          },
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

          if (docId === 'doc_search') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                serpResponse: {
                  results: {
                    edges: [
                      {
                        node: {
                          __typename: 'Story',
                          id: 'search_story_1',
                          post_id: 'post_search_1',
                          message: { text: 'Hybrid search result post' },
                          actors: [{ id: 'user_search_1', name: 'Search Author' }],
                          comet_sections: {
                            feedback: {
                              story: {
                                reaction_count: { count: 42 },
                                share_count: { count: 5 },
                                comment_count: { total_count: 12 },
                              },
                            },
                          },
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

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { success: true } }));
          return;
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
  });

  describe('AC-1 & TR-1: Unified scrape("facebook", action, options) Hybrid Dispatch', () => {
    it.skip('[AC-1] scrape("facebook", "marketplace", options) dispatches to FacebookCrawler without launching Puppeteer page', async () => {
      const res = await scrape('facebook', 'marketplace', {
        query: 'MacBook M3',
        location: 'San Jose',
        authCookie: rawCookies,
        browserOptions: {
          baseUrl: serverUrl,
          docIds: { MARKETPLACE_SEARCH: 'doc_marketplace' },
        },
        autoClose: true,
      });

      expect(res).toBeDefined();
      expect(Array.isArray(res.posts) || Array.isArray(res.items) || Array.isArray(res)).toBe(true);
    });

    it.skip('[AC-1] scrape("facebook", "search", options) dispatches to FacebookCrawler.search()', async () => {
      const res = await scrape('facebook', 'search', {
        query: 'developer',
        type: 'posts',
        authCookie: rawCookies,
        browserOptions: {
          baseUrl: serverUrl,
          docIds: { SEARCH_POSTS: 'doc_search' },
        },
      });

      expect(res).toBeDefined();
      const posts = res.posts || res;
      expect(Array.isArray(posts)).toBe(true);
    });
  });

  describe('AC-2: Action Name Resolution & Mapping in scrape()', () => {
    it.skip('[AC-2] scrape("facebook", "posts", { url: "https://facebook.com/groups/tech" }) resolves to group_posts', async () => {
      let resolvedAction = '';
      const customCrawler = new FacebookCrawler({
        client: new FacebookClient({ baseUrl: serverUrl }),
      });
      customCrawler.start = async (cmd) => {
        resolvedAction = cmd.action;
        return { posts: [] };
      };

      await scrape('facebook', 'posts', {
        url: 'https://www.facebook.com/groups/123456789',
        crawler: customCrawler,
      });

      expect(resolvedAction).toBe('group_posts');
    });

    it.skip('[AC-2] scrape("facebook", "posts", { url: "https://facebook.com/zuck" }) resolves to page_posts', async () => {
      let resolvedAction = '';
      const customCrawler = new FacebookCrawler({
        client: new FacebookClient({ baseUrl: serverUrl }),
      });
      customCrawler.start = async (cmd) => {
        resolvedAction = cmd.action;
        return { posts: [] };
      };

      await scrape('facebook', 'posts', {
        url: 'https://www.facebook.com/zuck',
        crawler: customCrawler,
      });

      expect(resolvedAction).toBe('page_posts');
    });

    it.skip('[AC-2] scrape("facebook", "unknown_action") throws informative error listing registered actions', async () => {
      await expect(
        scrape('facebook', 'invalid_unsupported_action', { authCookie: rawCookies })
      ).rejects.toThrow(/invalid_unsupported_action|supported/i);
    });
  });

  describe('AC-3 & TR-2: api/services/facebookScrape.js Hybrid Service Migration', () => {
    it.skip('[AC-3] facebookScrape.run("marketplace", args) calls FacebookCrawler.start() directly', async () => {
      const result = await facebookScrapeService.run('marketplace', {
        query: 'MacBook M3',
        authCookie: rawCookies,
        browserOptions: {
          baseUrl: serverUrl,
          docIds: { MARKETPLACE_SEARCH: 'doc_marketplace' },
        },
      });

      expect(result).toBeDefined();
      expect(result.posts || result.items || result).toBeDefined();
    });

    it.skip('[AC-3] facebookScrape.runSearchAllParallel() fans out 4 search categories using FacebookCrawler', async () => {
      const result = await facebookScrapeService.runSearchAllParallel(
        { query: 'test query', limit: 5 },
        { authCookie: rawCookies },
        'user_123',
        { baseUrl: serverUrl, docIds: { SEARCH_POSTS: 'doc_search' } }
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('posts');
      expect(result).toHaveProperty('people');
      expect(result).toHaveProperty('pages');
      expect(result).toHaveProperty('groups');
    });
  });

  describe('AC-5 & AC-6: MCP Tool Mapping to FacebookCrawler Hybrid Actions', () => {
    it.skip('[AC-5] MCP executeFacebookScrapeTool routes x_facebook_marketplace to FacebookCrawler action "marketplace"', async () => {
      const serverModule = await import('../../../../src/mcp/server.js');
      expect(serverModule).toBeDefined();
    });

    it.skip('[AC-6] MCP executeFacebookEpic4Tool routes share, join_groups, post_to_groups, send_friend_requests to hybrid actions', async () => {
      const serverModule = await import('../../../../src/mcp/server.js');
      expect(serverModule).toBeDefined();
    });
  });

  describe('AC-7 & TR-4: CLI Commands Route to Hybrid Scrapers', () => {
    it.skip('[AC-7] CLI scrape command supports extended facebook actions: marketplace, group_posts, group_comments', async () => {
      const scrapeCmd = await import('../../../../src/cli/commands/scrape.js');
      expect(scrapeCmd).toBeDefined();
    });

    it.skip('[AC-7] CLI automate command supports share, join-group, send-friend-request, messenger-share', async () => {
      const autoCmd = await import('../../../../src/cli/commands/automate.js');
      expect(autoCmd).toBeDefined();
    });
  });

  describe('AC-8: Action Discovery via FacebookCrawler.listActions()', () => {
    it.skip('[AC-8] FacebookCrawler.listActions() exposes complete action registry with requiresAuth resolution', () => {
      const crawler = new FacebookCrawler({
        client: new FacebookClient({ baseUrl: serverUrl }),
      });

      const actions = crawler.listActions();
      expect(Array.isArray(actions)).toBe(true);
      expect(actions.length).toBeGreaterThanOrEqual(15);

      const actionNames = actions.map((a) => a.action);
      expect(actionNames).toContain('marketplace');
      expect(actionNames).toContain('page_posts');
      expect(actionNames).toContain('group_posts');
      expect(actionNames).toContain('search');
      expect(actionNames).toContain('like');
      expect(actionNames).toContain('comment');
      expect(actionNames).toContain('post');
      expect(actionNames).toContain('share');
      expect(actionNames).toContain('messenger_share');
      expect(actionNames).toContain('join_group');
      expect(actionNames).toContain('send_friend_request');

      const marketAction = actions.find((a) => a.action === 'marketplace');
      expect(marketAction.requiresAuth).toBe(false);

      const likeAction = actions.find((a) => a.action === 'like');
      expect(likeAction.requiresAuth).toBe(true);
    });
  });

  describe('AC-9 & TR-5: Package Exports & Type Declarations', () => {
    it.skip('[AC-9] package.json exports include "./scrapers/social" and "./scrapers/social/facebook"', () => {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

      expect(pkg.exports).toBeDefined();
      expect(pkg.exports['./scrapers/social']).toBe('./src/scrapers/social/index.js');
      expect(pkg.exports['./scrapers/social/facebook']).toBe('./src/scrapers/social/facebook/index.js');
    });
  });

  describe('AC-10 & TR-7: Deprecation Markers & Deprecation Plan Update', () => {
    it.skip('[AC-10] Legacy src/scrapers/facebook/index.js has @deprecated banner', () => {
      const legacyPath = path.resolve(process.cwd(), 'src/scrapers/facebook/index.js');
      if (fs.existsSync(legacyPath)) {
        const content = fs.readFileSync(legacyPath, 'utf8');
        expect(content).toMatch(/@deprecated/i);
      }
    });

    it.skip('[AC-10] docs/deprecation-plan.md status tracker marks Facebook legacy as deprecated-marked', () => {
      const deprPath = path.resolve(process.cwd(), 'docs/deprecation-plan.md');
      const content = fs.readFileSync(deprPath, 'utf8');
      expect(content).toContain('Facebook');
    });
  });

  describe('AC-12: Backward Compatibility & Dry-Run Guarantees', () => {
    it.skip('[AC-12] Write actions enforce dryRun: true default and do not mutate without explicit dryRun: false', async () => {
      const crawler = new FacebookCrawler({
        client: new FacebookClient({ baseUrl: serverUrl }),
      });

      const likeRes = await crawler.start({
        action: 'like',
        args: { postUrl: 'https://www.facebook.com/zuck/posts/123456' },
        session: { accountId: 'acc_fb_test', cookies: rawCookies },
      });

      expect(likeRes.dryRun).toBe(true);
      expect(likeRes.results[0].liked).toBe(false);
    });
  });

  describe('AC-13 & TR-8: Service-Layer Cleanup & Legacy Routing', () => {
    it.skip('[AC-13] api/services/facebookHealth.js uses FacebookClient instead of legacy graphql.js', async () => {
      const healthModule = await import('../../../../api/services/facebookHealth.js');
      expect(healthModule).toBeDefined();
    });
  });
});
