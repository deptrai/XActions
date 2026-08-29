// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  TwitterCrawler,
  TWITTER_GRAPHQL_QUERY_IDS,
} from '../../../../src/scrapers/social/twitter/crawler.js';
import {
  TwitterClient,
  resolveTweetId,
  resolveUsername,
} from '../../../../src/scrapers/social/twitter/client.js';
import {
  normalizeThreadResponse,
  parseTwitterTweetToPostItem,
  reconstructThread,
} from '../../../../src/scrapers/social/twitter/normalize-thread.js';
import { normalizeBookmarksResponse } from '../../../../src/scrapers/social/twitter/normalize-bookmarks.js';
import {
  normalizeLikersResponse,
  profileItemToPostItem,
} from '../../../../src/scrapers/social/twitter/normalize-relationships.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';

/**
 * Story 13.2.2: Twitter Hybrid Thread, Likes & Bookmarks
 * Acceptance Tests (ATDD Red/Green Phase)
 */

describe('Story 13.2.2 — Twitter Hybrid Thread, Likes & Bookmarks', () => {
  /** @type {http.Server} */
  let server;
  let serverUrl = '';
  let storedBatches = [];
  let savedCheckpoints = [];
  const mockStore = {
    storeBatch: async (items) => {
      storedBatches.push(items);
      return { inserted: items.length, updated: 0 };
    },
    saveCheckpoint: async (ckpt) => {
      savedCheckpoints.push(ckpt);
      return ckpt;
    },
  };

  let sessionManager;
  let proxyPool;
  let governor;
  let accountPool;

  const mockTweetResult = (id, authorScreenName = 'tech_author', text = 'Sample tweet', inReplyToId = null) => ({
    __typename: 'Tweet',
    rest_id: String(id),
    core: {
      user_results: {
        result: {
          __typename: 'User',
          rest_id: `author_${authorScreenName}`,
          is_blue_verified: true,
          legacy: {
            screen_name: authorScreenName,
            name: `${authorScreenName} Display`,
            profile_image_url_https: `https://pbs.twimg.com/profile_images/${authorScreenName}_normal.jpg`,
            followers_count: 5000,
            friends_count: 200,
            verified: true,
            protected: false,
          },
        },
      },
    },
    legacy: {
      full_text: text,
      favorite_count: 120,
      retweet_count: 45,
      reply_count: 10,
      quote_count: 5,
      bookmark_count: 18,
      in_reply_to_status_id_str: inReplyToId ? String(inReplyToId) : undefined,
      in_reply_to_user_id_str: inReplyToId ? 'author_tech_author' : undefined,
      in_reply_to_screen_name: inReplyToId ? 'tech_author' : undefined,
      created_at: 'Sat Aug 29 10:00:00 +0000 2026',
      entities: {
        hashtags: [{ text: 'tech' }],
        user_mentions: [{ screen_name: 'reviewer', id_str: '999' }],
      },
    },
  });

  const mockUserResult = (id, screenName = 'alice_liker', name = 'Alice Liker') => ({
    __typename: 'User',
    rest_id: String(id),
    is_blue_verified: true,
    legacy: {
      screen_name: screenName,
      name,
      description: `Bio of ${name}`,
      profile_image_url_https: `https://pbs.twimg.com/profile_images/${id}_normal.jpg`,
      followers_count: 12000,
      friends_count: 450,
      verified: true,
      protected: false,
    },
  });

  beforeAll(async () => {
    proxyPool = new ProxyIpPool({ proxies: ['http://127.0.0.1:8080'] });
    governor = new AdaptiveRateGovernor({ proxyPool, defaultRps: 100, maxRps: 100 });
    accountPool = new AccountPool({ governor });
    sessionManager = new SessionManager();

    sessionManager.set('acc_tw_1', {
      accountId: 'acc_tw_1',
      platform: 'twitter',
      cookies: 'auth_token=tok_secret_123; ct0=csrf_sec_456;',
    });
    accountPool.registerAccounts('twitter', ['acc_tw_1']);

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const url = req.url || '';

        // TweetDetail endpoint (queryId: U0HTv-bAWTBYylwEMT7x5A)
        if (url.includes('/TweetDetail') || url.includes(TWITTER_GRAPHQL_QUERY_IDS.TweetDetail)) {
          const parsedUrl = new URL(url, 'http://127.0.0.1');
          const variables = JSON.parse(parsedUrl.searchParams.get('variables') || '{}');
          const focalTweetId = variables.focalTweetId || '1001';

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              data: {
                threaded_conversation_with_injections_v2: {
                  instructions: [
                    {
                      type: 'TimelineAddEntries',
                      entries: [
                        {
                          entryId: `tweet-${focalTweetId}`,
                          content: {
                            entryType: 'TimelineTimelineItem',
                            itemContent: {
                              tweet_results: {
                                result: mockTweetResult(focalTweetId, 'tech_author', 'Root thread post (1/3)'),
                              },
                            },
                          },
                        },
                        {
                          entryId: `conversationthread-${focalTweetId}`,
                          content: {
                            entryType: 'TimelineTimelineModule',
                            items: [
                              {
                                item: {
                                  itemContent: {
                                    tweet_results: {
                                      result: mockTweetResult('1002', 'tech_author', 'Second thread post (2/3)', focalTweetId),
                                    },
                                  },
                                },
                              },
                              {
                                item: {
                                  itemContent: {
                                    tweet_results: {
                                      result: mockTweetResult('1003', 'reader_bob', 'Bob reply to thread', focalTweetId),
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        },
                        {
                          entryId: 'cursor-bottom-thread-1',
                          content: {
                            cursorType: 'Bottom',
                            value: 'cursor_thread_next_page',
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            })
          );
          return;
        }

        // Favoriters / Likes endpoint (queryId: LLkw5EcVutJL6y-2gkz22A)
        if (url.includes('/Favoriters') || url.includes(TWITTER_GRAPHQL_QUERY_IDS.Favoriters)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              data: {
                favoriters_timeline: {
                  timeline: {
                    instructions: [
                      {
                        type: 'TimelineAddEntries',
                        entries: [
                          {
                            entryId: 'user-u10',
                            content: {
                              itemContent: {
                                user_results: {
                                  result: mockUserResult('u10', 'liker_alice', 'Alice Liker'),
                                },
                              },
                            },
                          },
                          {
                            entryId: 'user-u11',
                            content: {
                              itemContent: {
                                user_results: {
                                  result: mockUserResult('u11', 'liker_bob', 'Bob Enthusiast'),
                                },
                              },
                            },
                          },
                          {
                            entryId: 'cursor-bottom-favoriters-1',
                            content: {
                              cursorType: 'Bottom',
                              value: 'cursor_likes_next_page',
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            })
          );
          return;
        }

        // Bookmarks endpoint (queryId: qToeLeMs43Q8cr7tRYXmaQ)
        if (url.includes('/Bookmarks') || url.includes(TWITTER_GRAPHQL_QUERY_IDS.Bookmarks)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              data: {
                bookmark_timeline_v2: {
                  timeline: {
                    instructions: [
                      {
                        type: 'TimelineAddEntries',
                        entries: [
                          {
                            entryId: 'tweet-2001',
                            content: {
                              entryType: 'TimelineTimelineItem',
                              itemContent: {
                                tweet_results: {
                                  result: mockTweetResult('2001', 'bookmark_author', 'A bookmarked awesome tweet'),
                                },
                              },
                            },
                          },
                          {
                            entryId: 'cursor-bottom-bookmarks-1',
                            content: {
                              cursorType: 'Bottom',
                              value: 'cursor_bookmarks_next_page',
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            })
          );
          return;
        }

        // UserByScreenName profile endpoint
        if (url.includes('/UserByScreenName') || url.includes(TWITTER_GRAPHQL_QUERY_IDS.UserByScreenName)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              data: {
                user: {
                  result: mockUserResult('u_elon', 'elonmusk', 'Elon Musk'),
                },
              },
            })
          );
          return;
        }

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ message: 'Endpoint not found in test mock' }] }));
      });
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  describe('AC-1: Action Registration & Descriptors', () => {
    it('should register thread, likes, bookmarks, and relationships actions in TwitterCrawler', () => {
      const client = new TwitterClient({ baseUrl: serverUrl });
      const crawler = new TwitterCrawler({ client, sessionManager });

      const actions = crawler.listActions();
      const threadAction = actions.find((a) => a.action === 'thread');
      const likesAction = actions.find((a) => a.action === 'likes');
      const likersAction = actions.find((a) => a.action === 'likers');
      const bookmarksAction = actions.find((a) => a.action === 'bookmarks');

      expect(threadAction).toBeDefined();
      expect(threadAction?.requiredArgs).toEqual(['tweetId']);
      expect(threadAction?.optionalArgs).toContain('walkToRoot');
      expect(threadAction?.requiresAuth).toBe(false);

      expect(likesAction).toBeDefined();
      expect(likesAction?.requiredArgs).toEqual(['tweetId']);
      expect(likesAction?.requiresAuth).toBe(true);

      expect(likersAction).toBeDefined();
      expect(likersAction?.requiresAuth).toBe(true);

      expect(bookmarksAction).toBeDefined();
      expect(bookmarksAction?.requiredArgs).toEqual([]);
      expect(bookmarksAction?.optionalArgs).toContain('limit');
      expect(bookmarksAction?.requiresAuth).toBe(true);
    });
  });

  describe('AC-2: Handler thread — Conversation Tree & Parent Linkage', () => {
    it('should scrape conversation thread, reconstruct tree, and emit PostItems with parent linkage', async () => {
      storedBatches = [];
      savedCheckpoints = [];
      const client = new TwitterClient({ baseUrl: serverUrl });
      const crawler = new TwitterCrawler({ client, store: mockStore, sessionManager });

      const result = await crawler.start({
        action: 'thread',
        args: { tweetId: '1001' },
      });

      expect(result).toBeDefined();
      expect(result.posts).toHaveLength(3);

      const rootPost = result.rootTweet;
      expect(rootPost).not.toBeNull();
      expect(rootPost?.id).toBe('twitter:1001');
      expect(rootPost?.externalId).toBe('1001');
      expect(rootPost?.metadata?.tweetId).toBe('1001');
      expect(rootPost?.metadata?.isThread).toBe(true);
      expect(rootPost?.metadata?.parentTweetId).toBeNull();
      expect(rootPost?.metadata?.sourceMethod).toBe('thread');

      // Reply tweet check
      const replyPost = result.posts.find((p) => p.externalId === '1002');
      expect(replyPost).toBeDefined();
      expect(replyPost?.metadata?.parentTweetId).toBe('1001');
      expect(replyPost?.metadata?.isReply).toBe(true);
      expect(replyPost?.metadata?.conversationId).toBe('1001');

      // Author replies vs other conversation
      expect(result.authorReplies).toHaveLength(1);
      expect(result.authorReplies[0]?.externalId).toBe('1002');
      expect(result.conversation).toHaveLength(2);

      // Pagination
      expect(result.pageInfo?.end_cursor).toBe('cursor_thread_next_page');
      expect(result.pageInfo?.has_next_page).toBe(true);

      // Verify store & checkpoint
      expect(storedBatches.length).toBeGreaterThan(0);
      expect(savedCheckpoints.some((c) => c.targetType === 'thread' && c.targetKey === '1001')).toBe(true);
    });

    it('should support resolveTweetId helper with URL and status ID', () => {
      expect(resolveTweetId('1234567890')).toBe('1234567890');
      expect(resolveTweetId('https://x.com/user/status/9876543210')).toBe('9876543210');
      expect(resolveTweetId('https://twitter.com/user/statuses/555444333222')).toBe('555444333222');
      expect(() => resolveTweetId('invalid-url-without-id')).toThrow(PlatformError);
    });
  });

  describe('AC-3: Handler likes — Likers ProfileItems', () => {
    it('should scrape likers (favoriters) and return normalized ProfileItems', async () => {
      storedBatches = [];
      savedCheckpoints = [];
      const client = new TwitterClient({ baseUrl: serverUrl });
      const crawler = new TwitterCrawler({ client, store: mockStore, sessionManager });

      const result = await crawler.start({
        action: 'likes',
        args: { tweetId: '1001', limit: 50 },
        session: { accountId: 'acc_tw_1', cookies: 'auth_token=test; ct0=csrf;' },
      });

      expect(result).toBeDefined();
      expect(result.likers).toHaveLength(2);

      const firstLiker = result.likers[0];
      expect(firstLiker.id).toBe('twitter:u10');
      expect(firstLiker.externalId).toBe('u10');
      expect(firstLiker.username).toBe('liker_alice');
      expect(firstLiker.name).toBe('Alice Liker');
      expect(firstLiker.followersCount).toBe(12000);
      expect(firstLiker.avatar).toContain('400x400');
      expect(firstLiker.metadata?.isLiker).toBe(true);
      expect(firstLiker.metadata?.tweetId).toBe('1001');
      expect(firstLiker.metadata?.sourceMethod).toBe('likes');

      expect(result.pageInfo?.end_cursor).toBe('cursor_likes_next_page');
      expect(result.pageInfo?.has_next_page).toBe(true);

      // Verify store & checkpoint
      expect(storedBatches.length).toBeGreaterThan(0);
      expect(savedCheckpoints.some((c) => c.targetType === 'likes' && c.targetKey === '1001')).toBe(true);
    });

    it('should convert ProfileItem to PostItem with metadata.tweetId for storage', () => {
      const profile = {
        id: 'twitter:u10',
        platform: 'twitter',
        externalId: 'u10',
        username: 'liker_alice',
        name: 'Alice Liker',
        bio: 'Bio',
        avatar: 'https://pbs.twimg.com/avatar_400x400.jpg',
        followersCount: 12000,
        followingCount: 450,
        metadata: { isLiker: true, tweetId: '1001', sourceMethod: 'likes' },
        crawledAt: new Date(),
      };

      const post = profileItemToPostItem(profile);
      expect(post.id).toBe('twitter:u10');
      expect(post.category).toBe('social');
      expect(post.authorName).toBe('Alice Liker');
      expect(post.metadata?.tweetId).toBe('1001');
      expect(post.metadata?.isLiker).toBe(true);
    });
  });

  describe('AC-4: Handler bookmarks — Bookmarked PostItems', () => {
    it('should scrape bookmarks of authenticated user and return PostItems', async () => {
      storedBatches = [];
      savedCheckpoints = [];
      const client = new TwitterClient({ baseUrl: serverUrl });
      const crawler = new TwitterCrawler({ client, store: mockStore, sessionManager });

      const result = await crawler.start({
        action: 'bookmarks',
        args: { limit: 50 },
        session: { accountId: 'acc_tw_1', cookies: 'auth_token=test; ct0=csrf;' },
      });

      expect(result).toBeDefined();
      expect(result.posts).toHaveLength(1);

      const bookmark = result.posts[0];
      expect(bookmark.id).toBe('twitter:2001');
      expect(bookmark.externalId).toBe('2001');
      expect(bookmark.metadata?.tweetId).toBe('2001');
      expect(bookmark.metadata?.isBookmarked).toBe(true);
      expect(bookmark.metadata?.sourceMethod).toBe('bookmarks');

      expect(result.pageInfo?.end_cursor).toBe('cursor_bookmarks_next_page');
      expect(result.pageInfo?.has_next_page).toBe(true);

      // Verify store & checkpoint
      expect(storedBatches.length).toBeGreaterThan(0);
      expect(savedCheckpoints.some((c) => c.targetType === 'bookmarks')).toBe(true);
    });
  });

  describe('AC-5: Namespaced IDs and Metadata Schema', () => {
    it('should enforce namespaced IDs `twitter:${externalId}` for all items', () => {
      const tweet = mockTweetResult('999888', 'author_x', 'Hello world');
      const post = parseTwitterTweetToPostItem(tweet, 'thread', '999888');

      expect(post.id).toBe('twitter:999888');
      expect(post.platform).toBe('twitter');
      expect(post.metadata?.tweetId).toBe('999888');
    });

    it('should validate schemas/twitter/social.json schema fields', () => {
      const schemaPath = path.resolve(process.cwd(), 'schemas/twitter/social.json');
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

      expect(schema.required).toContain('tweetId');
      expect(schema.properties.parentTweetId).toBeDefined();
      expect(schema.properties.isThread).toBeDefined();
      expect(schema.properties.isBookmarked).toBeDefined();
      expect(schema.properties.conversationId).toBeDefined();
    });
  });

  describe('AC-6: Deprecation Markers & Deprecation Plan', () => {
    it('should have @deprecated annotations in legacy scraper files', () => {
      const twitterIndexPath = path.resolve(process.cwd(), 'src/scrapers/twitter/index.js');
      const twitterHttpThreadPath = path.resolve(process.cwd(), 'src/scrapers/twitter/http/thread.js');
      const twitterHttpRelPath = path.resolve(process.cwd(), 'src/scrapers/twitter/http/relationships.js');
      const deprPlanPath = path.resolve(process.cwd(), 'docs/deprecation-plan.md');

      const twitterIndexContent = fs.readFileSync(twitterIndexPath, 'utf8');
      const threadContent = fs.readFileSync(twitterHttpThreadPath, 'utf8');
      const relContent = fs.readFileSync(twitterHttpRelPath, 'utf8');
      const deprPlanContent = fs.readFileSync(deprPlanPath, 'utf8');

      expect(twitterIndexContent).toContain('@deprecated Use TwitterCrawler.thread');
      expect(twitterIndexContent).toContain('@deprecated Use TwitterCrawler.likes');
      expect(twitterIndexContent).toContain('@deprecated Use TwitterCrawler.bookmarks');

      expect(threadContent).toContain('@deprecated Use TwitterCrawler.thread');
      expect(relContent).toContain('@deprecated Use TwitterCrawler.likes');

      expect(deprPlanContent).toContain('twitter:thread');
      expect(deprPlanContent).toContain('twitter:likes');
      expect(deprPlanContent).toContain('twitter:bookmarks');
      expect(deprPlanContent).toContain('Epic 13.2.2');
    });
  });
});
