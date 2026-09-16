// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  TwitterCrawler,
  TWITTER_GRAPHQL_QUERY_IDS,
  extractPostHandle,
  extractPostDisplayName,
  formatBookmarksAsCSV,
  formatBookmarksAsJSON,
  formatThreadAsMarkdown,
  formatThreadAsText,
  formatThreadAsJSON,
  writeFormattedOutput,
} from '../../../../src/scrapers/social/twitter/crawler.js';
import { TwitterClient } from '../../../../src/scrapers/social/twitter/client.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';

describe('Story 24.2 — Browser Utility Features as Crawler Actions (export_bookmarks & unroll_thread)', () => {
  /** @type {http.Server} */
  let server;
  let serverUrl = '';
  let tmpDir = '';

  const mockStore = {
    storeBatch: async (items) => ({ inserted: items.length, updated: 0 }),
    saveCheckpoint: async (ckpt) => ckpt,
  };

  let sessionManager;
  let proxyPool;
  let governor;
  let accountPool;

  const mockTweetResult = (id, authorScreenName = 'author_user', text = 'Sample tweet content', inReplyToId = null) => ({
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
            name: `${authorScreenName} Name`,
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
      favorite_count: 100,
      retweet_count: 50,
      reply_count: 20,
      quote_count: 5,
      bookmark_count: 15,
      in_reply_to_status_id_str: inReplyToId ? String(inReplyToId) : undefined,
      in_reply_to_user_id_str: inReplyToId ? `author_${authorScreenName}` : undefined,
      in_reply_to_screen_name: inReplyToId ? authorScreenName : undefined,
      created_at: 'Sat Aug 29 10:00:00 +0000 2026',
      entities: {
        hashtags: [],
        user_mentions: [],
      },
    },
  });

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xact-24-2-'));

    proxyPool = new ProxyIpPool({ proxies: ['http://127.0.0.1:8080'] });
    governor = new AdaptiveRateGovernor({ proxyPool, defaultRps: 100, maxRps: 100 });
    accountPool = new AccountPool({ governor });
    sessionManager = new SessionManager();

    sessionManager.set('acc_auth_user', {
      accountId: 'acc_auth_user',
      platform: 'twitter',
      cookies: 'auth_token=tok_valid_test; ct0=csrf_valid_test;',
    });
    accountPool.registerAccounts('twitter', ['acc_auth_user']);

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const url = req.url || '';

        // TweetDetail endpoint
        if (url.includes('/TweetDetail') || url.includes(TWITTER_GRAPHQL_QUERY_IDS.TweetDetail)) {
          const rootTweet = mockTweetResult('1001', 'author_user', 'First tweet in thread');
          const reply1 = mockTweetResult('1002', 'author_user', 'Second tweet in thread', '1001');
          const reply2 = mockTweetResult('1003', 'author_user', 'Third tweet in thread', '1002');

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
                          entryId: 'tweet-1001',
                          content: {
                            __typename: 'TimelineTimelineItem',
                            itemContent: {
                              tweet_results: { result: rootTweet },
                            },
                          },
                        },
                        {
                          entryId: 'conversationthread-1002',
                          content: {
                            __typename: 'TimelineTimelineModule',
                            items: [
                              {
                                item: {
                                  itemContent: {
                                    tweet_results: { result: reply1 },
                                  },
                                },
                              },
                              {
                                item: {
                                  itemContent: {
                                    tweet_results: { result: reply2 },
                                  },
                                },
                              },
                            ],
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

        // Bookmarks endpoint
        if (url.includes('/Bookmarks') || url.includes(TWITTER_GRAPHQL_QUERY_IDS.Bookmarks)) {
          const b1 = mockTweetResult('2001', 'curator_bob', 'Saved bookmark 1\nwith newline');
          const b2 = mockTweetResult('2002', 'curator_alice', 'Saved bookmark 2 "with quotes"');

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
                              __typename: 'TimelineTimelineItem',
                              itemContent: {
                                tweet_results: { result: b1 },
                              },
                            },
                          },
                          {
                            entryId: 'tweet-2002',
                            content: {
                              __typename: 'TimelineTimelineItem',
                              itemContent: {
                                tweet_results: { result: b2 },
                              },
                            },
                          },
                          {
                            entryId: 'cursor-bottom-12345',
                            content: {
                              __typename: 'TimelineTimelineCursor',
                              value: 'next_bm_cursor',
                              cursorType: 'Bottom',
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

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ message: 'Not found' }] }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
    const addr = server.address();
    serverUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function createTestCrawler() {
    const client = new TwitterClient({
      baseUrl: serverUrl,
      requiresAuth: false,
      requiresProxy: false,
      governor,
      sessionManager,
      accountPool,
    });

    return new TwitterCrawler({
      client,
      store: mockStore,
      governor,
      sessionManager,
      accountPool,
    });
  }

  // --- Registration Tests ---
  it('registers export_bookmarks and unroll_thread actions with requiresAuth: true', () => {
    const crawler = createTestCrawler();
    const actions = crawler.listActions();

    const exportBookmarksDesc = actions.find((a) => a.action === 'export_bookmarks');
    expect(exportBookmarksDesc).toBeDefined();
    expect(exportBookmarksDesc?.requiresAuth).toBe(true);

    const unrollThreadDesc = actions.find((a) => a.action === 'unroll_thread');
    expect(unrollThreadDesc).toBeDefined();
    expect(unrollThreadDesc?.requiresAuth).toBe(true);
    expect(unrollThreadDesc?.requiredArgs).toContain('tweetId');
  });

  // --- export_bookmarks Tests ---
  describe('export_bookmarks action', () => {
    it('returns valid JSON when format is json', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };

      const result = await crawler.exportBookmarks({ format: 'json' }, session);
      expect(result.posts).toBeDefined();
      expect(result.posts.length).toBe(2);
      expect(result.json).toBeDefined();
      expect(result.csv).toBeUndefined();

      const parsed = JSON.parse(result.json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
    });

    it('returns CSV with proper headers when format is csv', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };

      const result = await crawler.exportBookmarks({ format: 'csv' }, session);
      expect(result.posts).toBeDefined();
      expect(result.posts.length).toBe(2);
      expect(result.csv).toBeDefined();
      expect(result.json).toBeUndefined();

      const lines = result.csv.split('\n');
      expect(lines[0]).toBe('Handle,DisplayName,Text,URL,Time,Likes,Retweets,Replies,Views');
      expect(lines.length).toBe(3); // header + 2 rows
      expect(lines[1]).toContain('"@curator_bob"');
      expect(lines[2]).toContain('""with quotes""'); // escaped quotes
    });

    it('returns both JSON and CSV when format is both', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };

      const result = await crawler.exportBookmarks({ format: 'both' }, session);
      expect(result.posts).toBeDefined();
      expect(result.json).toBeDefined();
      expect(result.csv).toBeDefined();
      expect(JSON.parse(result.json).length).toBe(2);
      expect(result.csv.startsWith('Handle,DisplayName,Text')).toBe(true);
    });

    it('writes formatted CSV to destPath when provided', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };
      const destPath = path.join(tmpDir, 'exported_bookmarks.csv');

      const result = await crawler.exportBookmarks({ format: 'csv', destPath }, session);
      expect(result.destPath).toBe(destPath);
      expect(result.csv).toBeDefined();

      const fileContent = await fs.readFile(destPath, 'utf-8');
      expect(fileContent).toBe(result.csv);
    });

    it('throws XACT_4001 on invalid format', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };

      await expect(crawler.exportBookmarks({ format: 'xml' }, session)).rejects.toThrow(PlatformError);
      try {
        await crawler.exportBookmarks({ format: 'xml' }, session);
      } catch (err) {
        expect(err.code).toBe('XACT_4001');
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws XACT_4010 when called without auth', async () => {
      const crawler = createTestCrawler();

      await expect(crawler.exportBookmarks({ format: 'json' }, {})).rejects.toThrow(PlatformError);
      try {
        await crawler.exportBookmarks({ format: 'json' }, {});
      } catch (err) {
        expect(err.code).toBe('XACT_4010');
        expect(err.statusCode).toBe(401);
      }
    });
  });

  // --- unroll_thread Tests ---
  describe('unroll_thread action', () => {
    it('returns markdown formatted thread when format is markdown', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };

      const result = await crawler.unrollThread({ tweetId: '1001', format: 'markdown' }, session);
      expect(result.posts).toBeDefined();
      expect(result.posts.length).toBe(3); // root + 2 replies in order
      expect(result.markdown).toBeDefined();
      expect(result.markdown).toContain('# Thread by @author_user');
      expect(result.markdown).toContain('> 3 tweets |');
      expect(result.markdown).toContain('**1/3**');
      expect(result.markdown).toContain('First tweet in thread');
      expect(result.markdown).toContain('**2/3**');
      expect(result.markdown).toContain('Second tweet in thread');
      expect(result.markdown).toContain('**3/3**');
      expect(result.markdown).toContain('Third tweet in thread');
      expect(result.markdown).toContain('[Original Thread]');
    });

    it('returns plain text formatted thread when format is text', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };

      const result = await crawler.unrollThread({ tweetId: '1001', format: 'text' }, session);
      expect(result.posts).toBeDefined();
      expect(result.posts.length).toBe(3);
      expect(result.text).toBeDefined();
      expect(result.text).toContain('Thread by @author_user');
      expect(result.text).toContain('[1/3]');
      expect(result.text).toContain('First tweet in thread');
      expect(result.text).toContain('[2/3]');
      expect(result.text).toContain('Second tweet in thread');
    });

    it('returns JSON formatted thread when format is json', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };

      const result = await crawler.unrollThread({ tweetId: '1001', format: 'json' }, session);
      expect(result.posts).toBeDefined();
      expect(result.json).toBeDefined();

      const parsed = JSON.parse(result.json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);
      expect(parsed[0].content).toBe('First tweet in thread');
    });

    it('writes formatted markdown to destPath when provided', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };
      const destPath = path.join(tmpDir, 'unrolled_thread.md');

      const result = await crawler.unrollThread({ tweetId: '1001', format: 'markdown', destPath }, session);
      expect(result.destPath).toBe(destPath);
      expect(result.markdown).toBeDefined();

      const fileContent = await fs.readFile(destPath, 'utf-8');
      expect(fileContent).toBe(result.markdown);
    });

    it('throws XACT_4001 when tweetId is missing', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };

      await expect(crawler.unrollThread({ format: 'markdown' }, session)).rejects.toThrow(PlatformError);
      try {
        await crawler.unrollThread({ format: 'markdown' }, session);
      } catch (err) {
        expect(err.code).toBe('XACT_4001');
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws XACT_4001 on invalid format', async () => {
      const crawler = createTestCrawler();
      const session = { cookies: 'auth_token=tok_valid_test' };

      await expect(crawler.unrollThread({ tweetId: '1001', format: 'xml' }, session)).rejects.toThrow(PlatformError);
      try {
        await crawler.unrollThread({ tweetId: '1001', format: 'xml' }, session);
      } catch (err) {
        expect(err.code).toBe('XACT_4001');
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws XACT_4010 when called without auth', async () => {
      const crawler = createTestCrawler();

      await expect(crawler.unrollThread({ tweetId: '1001', format: 'markdown' }, {})).rejects.toThrow(PlatformError);
      try {
        await crawler.unrollThread({ tweetId: '1001', format: 'markdown' }, {});
      } catch (err) {
        expect(err.code).toBe('XACT_4010');
        expect(err.statusCode).toBe(401);
      }
    });
  });

  // --- Helper Functions Unit Tests ---
  describe('Formatting & Helper Functions', () => {
    it('extractPostHandle correctly extracts handles across various shapes', () => {
      expect(extractPostHandle({ handle: '@testuser' })).toBe('testuser');
      expect(extractPostHandle({ authorHandle: 'testuser2' })).toBe('testuser2');
      expect(extractPostHandle({ authorUsername: '@testuser3' })).toBe('testuser3');
      expect(extractPostHandle({ metadata: { authorUsername: 'testuser4' } })).toBe('testuser4');
      expect(extractPostHandle({ authorUrl: 'https://x.com/testuser5' })).toBe('testuser5');
      expect(extractPostHandle(null)).toBe('');
    });

    it('extractPostDisplayName extracts display name or falls back to handle', () => {
      expect(extractPostDisplayName({ displayName: 'John Doe' })).toBe('John Doe');
      expect(extractPostDisplayName({ authorDisplayName: 'Jane Doe' })).toBe('Jane Doe');
      expect(extractPostDisplayName({ handle: 'testuser' })).toBe('testuser');
      expect(extractPostDisplayName(null)).toBe('');
    });

    it('formatBookmarksAsCSV formats posts into CSV correctly', () => {
      const posts = [
        {
          handle: 'tester',
          displayName: 'Test User',
          content: 'Hello "world"\nnew line',
          postUrl: 'https://x.com/tester/status/1',
          publishedAt: new Date('2026-09-16T12:00:00Z'),
          likesCount: 10,
          repostsCount: 5,
          repliesCount: 2,
          viewsCount: 100,
        },
      ];
      const csv = formatBookmarksAsCSV(posts);
      expect(csv).toContain('Handle,DisplayName,Text,URL,Time,Likes,Retweets,Replies,Views');
      expect(csv).toContain('"@tester","Test User","Hello ""world"" new line","https://x.com/tester/status/1","2026-09-16",10,5,2,100');
    });

    it('formatThreadAsMarkdown formats images and tweet indexes', () => {
      const posts = [
        {
          handle: 'author',
          content: 'Tweet 1 text',
          mediaUrls: ['https://pbs.twimg.com/media/1.jpg'],
          postUrl: 'https://x.com/author/status/100',
        },
        {
          handle: 'author',
          content: 'Tweet 2 text',
          mediaUrls: [],
          postUrl: 'https://x.com/author/status/101',
        },
      ];
      const md = formatThreadAsMarkdown(posts);
      expect(md).toContain('# Thread by @author');
      expect(md).toContain('**1/2**\n\nTweet 1 text');
      expect(md).toContain('![Image](https://pbs.twimg.com/media/1.jpg)');
      expect(md).toContain('**2/2**\n\nTweet 2 text');
      expect(md).toContain('[Original Thread](https://x.com/author/status/100)');
    });

    it('writeFormattedOutput creates parent directories if needed', async () => {
      const subDirPath = path.join(tmpDir, 'nested', 'deep', 'output.txt');
      await writeFormattedOutput(subDirPath, 'test content');
      const content = await fs.readFile(subDirPath, 'utf-8');
      expect(content).toBe('test content');
    });
  });
});
