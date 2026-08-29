// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { TwitterCrawler } from '../../../../src/scrapers/social/twitter/crawler.js';
import { TwitterClient } from '../../../../src/scrapers/social/twitter/client.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';
import metadataSchemaRegistry from '../../../../src/core/metadata-schema-registry.js';

/**
 * Story 13.2.3 — Twitter Hybrid Search, Hashtag & Trending
 * Red-phase acceptance test scaffold (TDD).
 *
 * All tests are skipped because the implementation (src/scrapers/social/twitter/*)
 * does not yet exist. Activating these tests is part of the green phase.
 */

describe('Story 13.2.3 — Twitter Hybrid Search, Hashtag & Trending', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('twitter-search-user', {
    accountId: 'twitter-search-user',
    cookies: 'auth_token=search_token; ct0=csrf_search',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('twitter', ['twitter-search-user'], {
    credentials: {
      'twitter-search-user': { cookies: 'auth_token=search_token; ct0=csrf_search' },
    },
  });

  const createStore = () => new PrismaStore({ prisma });

  const tweetEntry = (id, text, username, cursor = null) => ({
    entryId: `tweet-${id}`,
    sortIndex: '0',
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineTweet',
        tweet_results: {
          result: {
            __typename: 'Tweet',
            rest_id: id,
            legacy: {
              created_at: 'Mon Jan 01 00:00:00 +0000 2024',
              full_text: text,
              id_str: id,
              favorite_count: 42,
              retweet_count: 7,
              reply_count: 3,
              quote_count: 1,
              bookmark_count: 0,
              entities: { hashtags: [{ text: 'AI' }], urls: [], user_mentions: [] },
              lang: 'en',
            },
            core: {
              user_results: {
                result: {
                  rest_id: 'user_' + id,
                  is_blue_verified: false,
                  legacy: {
                    screen_name: username,
                    name: `${username} Display`,
                    profile_image_url_https: 'https://pbs.twimg.com/profile.jpg',
                  },
                },
              },
            },
            views: { count: '1234' },
          },
        },
      },
    },
  });

  const cursorEntry = (cursorValue) => ({
    entryId: 'cursor-bottom-0',
    content: {
      entryType: 'TimelineTimelineCursor',
      value: cursorValue,
    },
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
    receivedRequests = [];
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });

        // Token / bootstrap HTML
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <head>
                <script>window.__INITIAL_STATE__ = {};</script>
              </head>
              <body>Twitter Search Mock</body>
            </html>
          `);
          return;
        }

        // GraphQL SearchTimeline
        if (req.url?.startsWith('/i/api/graphql/')) {
          const pathParts = req.url.split('/');
          const operationName = pathParts[pathParts.length - 1];
          const params = new URLSearchParams(body);
          const rawVars = params.get('variables') || '{}';
          let variables = {};
          try {
            variables = JSON.parse(rawVars);
          } catch {}

          if (operationName === 'SearchTimeline') {
            const product = variables.product || variables.productType || 'Latest';

            // People search
            if (product === 'People') {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({
                data: {
                  search_by_raw_query: {
                    search_timeline: {
                      timeline: {
                        instructions: [
                          {
                            type: 'TimelineAddEntries',
                            entries: [
                              {
                                entryId: 'user-1',
                                content: {
                                  itemContent: {
                                    user_results: {
                                      result: {
                                        __typename: 'User',
                                        rest_id: '111222333',
                                        is_blue_verified: true,
                                        legacy: {
                                          screen_name: 'ailab',
                                          name: 'AI Lab',
                                          profile_image_url_https: 'https://pbs.twimg.com/ailab.jpg',
                                          description: 'AI research updates',
                                          followers_count: 56000,
                                          friends_count: 1200,
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                              cursorEntry('cursor_people_next'),
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              }));
              return;
            }

            // Default: tweet search (Latest / Top)
            const tweets = [
              tweetEntry('10000001', 'First tweet about #AI and #machinelearning', 'postera'),
              tweetEntry('10000002', 'Second tweet about agentic systems #AI', 'posterb'),
            ];

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                search_by_raw_query: {
                  search_timeline: {
                    timeline: {
                      instructions: [
                        {
                          type: 'TimelineAddEntries',
                          entries: [
                            ...tweets,
                            cursorEntry('cursor_search_next'),
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: {} }));
          return;
        }

        // REST trending endpoint
        if (req.url?.startsWith('/1.1/trends/place.json')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify([
            {
              as_of: '2024-01-01T00:00:00Z',
              created_at: '2024-01-01T00:00:00Z',
              locations: [{ name: 'Worldwide', woeid: 1 }],
              trends: [
                { name: '#AI', url: 'http://twitter.com/search?q=%23AI', tweet_volume: 1250000, promoted_content: null },
                { name: '#MachineLearning', url: 'http://twitter.com/search?q=%23MachineLearning', tweet_volume: 890000, promoted_content: null },
                { name: 'Promoted Trend', url: 'http://twitter.com/promoted', tweet_volume: 10000, promoted_content: { ad_tag: 'xyz' } },
              ],
            },
          ]));
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

  it.skip('[AC-1] should inherit AbstractCrawler and register search, hashtag, and trending actions', () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('twitter');
    expect(crawler.platform).toBe('twitter');
    expect(crawler.requiresAuth).toBe(true);

    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);

    expect(actionNames).toContain('search');
    expect(actionNames).toContain('hashtag');
    expect(actionNames).toContain('trending');

    const searchAction = actions.find((a) => a.action === 'search');
    expect(searchAction?.requiredArgs).toContain('query');
    expect(searchAction?.optionalArgs).toContain('type');
    expect(searchAction?.optionalArgs).toContain('limit');
    expect(searchAction?.optionalArgs).toContain('cursor');
    expect(searchAction?.optionalArgs).toContain('since');
    expect(searchAction?.optionalArgs).toContain('until');
    expect(searchAction?.optionalArgs).toContain('from');
    expect(searchAction?.optionalArgs).toContain('minLikes');
    expect(searchAction?.optionalArgs).toContain('minRetweets');
    expect(searchAction?.optionalArgs).toContain('lang');
    expect(searchAction?.optionalArgs).toContain('filter');

    const hashtagAction = actions.find((a) => a.action === 'hashtag');
    expect(hashtagAction?.requiredArgs).toContain('tag');

    const trendingAction = actions.find((a) => a.action === 'trending');
    expect(trendingAction?.optionalArgs).toContain('woeid');
    expect(trendingAction?.optionalArgs).toContain('limit');
  });

  it.skip('[AC-2] should execute global tweet search and return normalized PostItems', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'AI technology', type: 'Latest', limit: 10 },
      session: { accountId: 'twitter-search-user' },
    });

    expect(Array.isArray(result.posts || result)).toBe(true);
    const posts = result.posts || result;
    expect(posts.length).toBeGreaterThan(0);

    const post = posts[0];
    expect(post.id).toMatch(/^twitter:/);
    expect(post.externalId).toBe('10000001');
    expect(post.platform).toBe('twitter');
    expect(post.category).toBe('social');
    expect(post.authorName).toBe('postera Display');
    expect(post.content).toContain('AI');
    expect(post.likesCount).toBe(42);
    expect(post.metadata?.isSearchResult).toBe(true);
    expect(post.metadata?.searchType).toBe('Latest');
    expect(post.metadata?.hashtags).toContain('AI');

    expect(result.pageInfo?.hasNextPage).toBe(true);
    expect(result.pageInfo?.endCursor).toBe('cursor_search_next');
  });

  it.skip('[AC-3] should build advanced query with operators and filters', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    await crawler.start({
      action: 'search',
      args: {
        query: 'agentic systems',
        from: 'nichxbt',
        since: '2024-01-01',
        until: '2024-12-31',
        minLikes: 100,
        minRetweets: 50,
        lang: 'en',
        filter: 'links',
      },
      session: { accountId: 'twitter-search-user' },
    });

    const lastGraphqlReq = receivedRequests
      .filter((r) => r.url?.startsWith('/i/api/graphql/'))
      .pop();

    expect(lastGraphqlReq).toBeDefined();
    const params = new URLSearchParams(lastGraphqlReq.body);
    const variables = JSON.parse(params.get('variables') || '{}');
    const rawQuery = variables.rawQuery || variables.query;

    expect(rawQuery).toContain('agentic systems');
    expect(rawQuery).toContain('from:nichxbt');
    expect(rawQuery).toContain('since:2024-01-01');
    expect(rawQuery).toContain('until:2024-12-31');
    expect(rawQuery).toContain('min_faves:100');
    expect(rawQuery).toContain('min_retweets:50');
    expect(rawQuery).toContain('lang:en');
    expect(rawQuery).toContain('filter:links');
  });

  it.skip('[AC-4] should search users and return normalized account profiles', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'AI Lab', type: 'people', limit: 10 },
      session: { accountId: 'twitter-search-user' },
    });

    const users = result.users || result;
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);

    const user = users[0];
    expect(user.id).toMatch(/^twitter:/);
    expect(user.externalId).toBe('111222333');
    expect(user.platform).toBe('twitter');
    expect(user.authorName).toBe('AI Lab');
    expect(user.username).toBe('ailab');
    expect(user.followersCount).toBe(56000);
    expect(user.metadata?.isSearchResult).toBe(true);
    expect(user.metadata?.resultType).toBe('people');
  });

  it.skip('[AC-5] should scrape hashtag tweets by convenience action', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const result = await crawler.start({
      action: 'hashtag',
      args: { tag: 'AI', type: 'Top', limit: 20 },
      session: { accountId: 'twitter-search-user' },
    });

    const posts = result.posts || result;
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);

    const lastGraphqlReq = receivedRequests
      .filter((r) => r.url?.startsWith('/i/api/graphql/'))
      .pop();

    expect(lastGraphqlReq).toBeDefined();
    const params = new URLSearchParams(lastGraphqlReq.body);
    const variables = JSON.parse(params.get('variables') || '{}');
    const rawQuery = variables.rawQuery || variables.query;

    expect(rawQuery).toContain('#AI');
    expect(posts[0].metadata?.isSearchResult).toBe(true);
    expect(posts[0].metadata?.searchType).toBe('Top');
  });

  it.skip('[AC-5] should support hashtag with and without hash prefix', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    await crawler.start({
      action: 'hashtag',
      args: { tag: '#machinelearning' },
      session: { accountId: 'twitter-search-user' },
    });

    const lastGraphqlReq = receivedRequests
      .filter((r) => r.url?.startsWith('/i/api/graphql/'))
      .pop();

    const params = new URLSearchParams(lastGraphqlReq.body);
    const variables = JSON.parse(params.get('variables') || '{}');
    const rawQuery = variables.rawQuery || variables.query;

    expect(rawQuery).toMatch(/^#machinelearning/);
    expect(rawQuery.match(/#/g).length).toBe(1);
  });

  it.skip('[AC-6] should scrape trending topics by WOEID with promoted filter', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const result = await crawler.start({
      action: 'trending',
      args: { woeid: 1, limit: 50, includePromoted: false },
      session: { accountId: 'twitter-search-user' },
    });

    const trends = result.trends || result;
    expect(Array.isArray(trends)).toBe(true);
    expect(trends.length).toBeGreaterThan(0);

    const trend = trends[0];
    expect(trend.name).toBe('#AI');
    expect(trend.tweetCount).toBe(1250000);
    expect(trend.url).toContain('twitter.com/search');
    expect(trend.category).toBeNull();
    expect(trends.some((t) => t.name === 'Promoted Trend')).toBe(false);
  });

  it.skip('[AC-6] should support custom WOEID and include promoted trends when requested', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const result = await crawler.start({
      action: 'trending',
      args: { woeid: 23424977, includePromoted: true },
      session: { accountId: 'twitter-search-user' },
    });

    const trends = result.trends || result;
    const promoted = trends.find((t) => t.name === 'Promoted Trend');
    expect(promoted).toBeDefined();
    expect(promoted.category).toBe('promoted');

    const restReq = receivedRequests.find((r) =>
      r.url?.startsWith('/1.1/trends/place.json')
    );
    expect(restReq.url).toContain('id=23424977');
  });

  it.skip('[AC-7] should reject invalid search arguments with PlatformError', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    await expect(
      crawler.start({
        action: 'search',
        args: { query: '' },
        session: { accountId: 'twitter-search-user' },
      })
    ).rejects.toThrow(PlatformError);

    await expect(
      crawler.start({
        action: 'search',
        args: { query: 'test', type: 'invalid_product' },
        session: { accountId: 'twitter-search-user' },
      })
    ).rejects.toThrow(PlatformError);

    await expect(
      crawler.start({
        action: 'hashtag',
        args: { tag: '' },
        session: { accountId: 'twitter-search-user' },
      })
    ).rejects.toThrow(PlatformError);
  });

  it.skip('[AC-2] should paginate tweet search with cursor', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const firstPage = await crawler.start({
      action: 'search',
      args: { query: 'AI', type: 'Latest', limit: 2 },
      session: { accountId: 'twitter-search-user' },
    });

    expect(firstPage.pageInfo?.hasNextPage).toBe(true);
    expect(firstPage.pageInfo?.endCursor).toBeDefined();

    const secondPage = await crawler.start({
      action: 'search',
      args: {
        query: 'AI',
        type: 'Latest',
        limit: 2,
        cursor: firstPage.pageInfo.endCursor,
      },
      session: { accountId: 'twitter-search-user' },
    });

    const secondReq = receivedRequests
      .filter((r) => r.url?.startsWith('/i/api/graphql/'))
      .pop();

    const params = new URLSearchParams(secondReq.body);
    const variables = JSON.parse(params.get('variables') || '{}');
    expect(variables.cursor).toBe(firstPage.pageInfo.endCursor);
    expect(Array.isArray(secondPage.posts || secondPage)).toBe(true);
  });

  it.skip('[AC-8] should persist search results and save crawl checkpoint', async () => {
    const store = createStore();
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, store, sessionManager });

    await crawler.start({
      action: 'search',
      args: { query: 'AI', type: 'Latest', limit: 5 },
      session: { accountId: 'twitter-search-user' },
    });

    const storedPosts = await prisma.post.findMany({
      where: { platform: 'twitter' },
    });
    expect(storedPosts.length).toBeGreaterThan(0);
    expect(storedPosts[0].externalId).toBe('10000001');

    const checkpoint = await prisma.crawlCheckpoint.findFirst({
      where: { platform: 'twitter', targetType: 'search' },
    });
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.targetKey).toContain('AI');
    expect(checkpoint?.lastCursor).toBe('cursor_search_next');
  });

  it.skip('[AC-8] should persist trending results without publishedAt', async () => {
    const store = createStore();
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, store, sessionManager });

    await crawler.start({
      action: 'trending',
      args: { woeid: 1, limit: 10 },
      session: { accountId: 'twitter-search-user' },
    });

    const checkpoint = await prisma.crawlCheckpoint.findFirst({
      where: { platform: 'twitter', targetType: 'trending' },
    });
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.targetKey).toContain('woeid:1');
  });

  it.skip('[AC-9] should validate search result metadata against schema registry', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const result = await crawler.start({
      action: 'search',
      args: { query: 'AI Innovation', type: 'all', limit: 10 },
      session: { accountId: 'twitter-search-user' },
    });

    for (const item of result.posts || []) {
      expect(item.metadata?.isSearchResult).toBe(true);
      const validation = metadataSchemaRegistry.validateMetadata('twitter', 'social', item.metadata);
      expect(validation.valid).toBe(true);
    }

    for (const user of result.users || []) {
      expect(user.metadata?.isSearchResult).toBe(true);
      const validation = metadataSchemaRegistry.validateMetadata('twitter', 'social', user.metadata);
      expect(validation.valid).toBe(true);
    }
  });

  it.skip('[AC-9] should validate hashtag and trending metadata', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const hashtagRes = await crawler.start({
      action: 'hashtag',
      args: { tag: 'AI', limit: 5 },
      session: { accountId: 'twitter-search-user' },
    });

    for (const post of hashtagRes.posts || []) {
      expect(post.metadata?.isSearchResult).toBe(true);
      const validation = metadataSchemaRegistry.validateMetadata('twitter', 'social', post.metadata);
      expect(validation.valid).toBe(true);
    }

    const trendingRes = await crawler.start({
      action: 'trending',
      args: { woeid: 1, limit: 5 },
      session: { accountId: 'twitter-search-user' },
    });

    for (const trend of trendingRes.trends || []) {
      expect(trend.metadata?.isSearchResult).toBe(true);
      const validation = metadataSchemaRegistry.validateMetadata('twitter', 'social', trend.metadata);
      expect(validation.valid).toBe(true);
    }
  });
});
