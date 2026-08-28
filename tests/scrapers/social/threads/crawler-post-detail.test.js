// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ATDD Red-Phase Tests — Story 15.1.2: Threads Hybrid Post Detail & Comment Tree
 * Tests for ThreadsCrawler post_detail action, shortcode/numeric resolution, and comment tree integration.
 * Zero mocks; uses local http.createServer to serve Meta GraphQL JSON and SSR HTML pages.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { ThreadsCrawler } from '../../../../src/scrapers/social/threads/crawler.js';
import { ThreadsClient } from '../../../../src/scrapers/social/threads/client.js';

describe('Story 15.1.2: Threads Hybrid Post Detail & Comment Tree ATDD Test Suite', () => {
  let server;
  let serverUrl;
  const originalEnv = process.env.REDIS_STREAM_ENABLED;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const url = req.url || '';

        // 1. Landing page for LSD token extraction
        if (url === '/' || url === '/@instagram') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><body><input type="hidden" name="lsd" value="LSD_token_123" /></body></html>`);
          return;
        }

        // 2. SSR HTML for shortcode resolution /t/CuZ7X9_sF9y
        if (url === '/t/CuZ7X9_sF9y' || url === '/@zuck/post/CuZ7X9_sF9y') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Post by @zuck on Threads</title>
            </head>
            <body>
              <script type="application/json">
                {"require":[["ScheduledServerJS","handle",null,[{"__bbox":{"require":[["RelayPrefetchedStreamCache","next",null,["BarcelonaPostPageQuery",{"data":{"data":{"containing_thread":{"thread_items":[{"post":{"id":"3141803346926526322","pk":"3141803346926526322","code":"CuZ7X9_sF9y","caption":{"text":"Hello Threads world!"},"user":{"id":"98765","username":"zuck"}}}]}}}}]}}]]}
              </script>
              <input type="hidden" name="lsd" value="LSD_token_123" />
            </body>
            </html>
          `);
          return;
        }

        // 3. 404 HTML for unresolvable shortcode / nonexistent post
        if (url === '/t/nonexistent_post' || url === '/@zuck/post/nonexistent_post') {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><body><h1>Sorry, this page isn't available.</h1></body></html>`);
          return;
        }

        // 4. GraphQL Endpoint
        if (url === '/api/graphql') {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');
          let variables = {};
          try {
            variables = JSON.parse(params.get('variables') || '{}');
          } catch {}

          // A. POST_DETAIL (BarcelonaPostPageQuery default 5587632691339264)
          if (docId === '5587632691339264' || docId === 'doc_post_detail_valid') {
            const postID = variables.postID || variables.postId || variables.post_id;
            if (postID === '3141803346926526322' || postID === '314159265358979323' || postID === '9988776655') {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({
                data: {
                  data: {
                    containing_thread: {
                      thread_items: [
                        {
                          post: {
                            id: postID,
                            pk: postID,
                            code: 'CuZ7X9_sF9y',
                            caption: { text: 'Building the open social web with AT Protocol and ActivityPub.' },
                            user: {
                              id: '98765',
                              pk: '98765',
                              username: 'zuck',
                              full_name: 'Mark Zuckerberg',
                              profile_pic_url: 'https://cdn.threads.net/zuck.jpg',
                              is_verified: true,
                            },
                            taken_at: 1718000000,
                            like_count: 42000,
                            reply_count: 1337,
                            text_post_app_info: {
                              direct_reply_count: 1337,
                              repost_count: 450,
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
                              id: 'reply_root_1',
                              pk: 'reply_root_1',
                              caption: { text: 'Top level reply to Zuck' },
                              user: { id: 'user_1', username: 'replier_1' },
                              taken_at: 1718000100,
                              like_count: 120,
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

            // Post not found in GraphQL
            if (postID === '404404404') {
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
          }

          // B. Other or unrecognized doc_id
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { data: {} } }));
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const addr = server.address();
    serverUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
  });

  afterAll(async () => {
    process.env.REDIS_STREAM_ENABLED = originalEnv;
    await new Promise((resolve) => server.close(resolve));
  });

  // ==========================================================================
  // SCN-1: ActionRegistry Registration (AC-1)
  // ==========================================================================
  describe('SCN-1: ActionRegistry Registration (AC-1)', () => {
    it('registers post_detail in ActionRegistry with correct descriptors', () => {
      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({ client });
      const actions = crawler.listActions();

      const postDetailAction = actions.find((a) => a.action === 'post_detail');
      expect(postDetailAction).toBeDefined();
      expect(postDetailAction?.requiredArgs).toEqual(['postId']);
      expect(postDetailAction?.optionalArgs).toContain('includeReplies');
      expect(postDetailAction?.optionalArgs).toContain('maxDepth');
      expect(postDetailAction?.optionalArgs).toContain('maxComments');
      expect(postDetailAction?.category).toBe('social');
      expect(crawler.requiresAuth).toBe(true);
    });
  });

  // ==========================================================================
  // SCN-2: Post ID, Shortcode & URL Resolution (AC-4)
  // ==========================================================================
  describe('SCN-2: Post ID, Shortcode & URL Resolution (AC-4)', () => {
    it('extracts root post when postId is given as numeric id', async () => {
      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({ client });

      const result = await crawler.start({
        action: 'post_detail',
        args: { postId: '9988776655', includeReplies: false },
        session: { accountId: 'threads-guest' },
      });

      expect(result.post).toBeDefined();
      expect(result.post.id).toBe('threads:9988776655');
      expect(result.post.externalId).toBe('9988776655');
      expect(result.post.authorName).toBe('zuck');
      expect(result.post.metadata?.sourceMethod).toBe('post_detail');
    });

    it('resolves shortcode CuZ7X9_sF9y or URL to numeric post id and extracts post', async () => {
      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({ client });

      const resultFromShortcode = await crawler.start({
        action: 'post_detail',
        args: { postId: 'CuZ7X9_sF9y', includeReplies: false },
        session: { accountId: 'threads-guest' },
      });

      expect(resultFromShortcode.post).toBeDefined();
      expect(resultFromShortcode.post.id).toBe('threads:3141803346926526322');

      const resultFromUrl = await crawler.start({
        action: 'post_detail',
        args: { postId: `${serverUrl}/t/CuZ7X9_sF9y`, includeReplies: false },
        session: { accountId: 'threads-guest' },
      });

      expect(resultFromUrl.post).toBeDefined();
      expect(resultFromUrl.post.id).toBe('threads:3141803346926526322');
    });
  });

  // ==========================================================================
  // SCN-3: Storage Persistence, Checkpoint & Redis Thin Event (AC-2, AC-6)
  // ==========================================================================
  describe('SCN-3: Storage Persistence, Checkpoint & Redis Thin Event (AC-2, AC-6)', () => {
    it('persists post to store, saves checkpoint, and emits thin event', async () => {
      process.env.REDIS_STREAM_ENABLED = 'true';

      const storedBatches = [];
      const checkpoints = [];
      const publishedEvents = [];

      const mockStore = {
        storeBatch: async (items) => storedBatches.push(items),
        saveCheckpoint: async (cp) => checkpoints.push(cp),
      };

      const mockPublisher = {
        publish: async (evt) => publishedEvents.push(evt),
      };

      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({
        client,
        store: mockStore,
        redisPublisher: mockPublisher,
      });

      const result = await crawler.start({
        action: 'post_detail',
        args: { postId: '9988776655' },
        session: { accountId: 'threads-guest' },
      });

      expect(result.post).toBeDefined();
      expect(storedBatches.length).toBeGreaterThan(0);
      expect(storedBatches[0][0].id).toBe('threads:9988776655');

      expect(checkpoints.length).toBe(1);
      expect(checkpoints[0].targetType).toBe('post_detail');
      expect(checkpoints[0].targetKey).toBe('9988776655');
      expect(checkpoints[0].storageRef).toBe('threads:9988776655');

      expect(publishedEvents.length).toBe(1);
      expect(publishedEvents[0].id).toBe('threads:9988776655');
      expect(publishedEvents[0].platform).toBe('threads');
      expect(publishedEvents[0].storageRef).toBe('threads:9988776655');
    });
  });

  // ==========================================================================
  // SCN-4: Optional Reply Tree Extraction (AC-3)
  // ==========================================================================
  describe('SCN-4: Optional Reply Tree Extraction (AC-3)', () => {
    it('returns post and top-level comments when includeReplies=true and COMMENT_REPLIES=null', async () => {
      const storedComments = [];
      const mockStore = {
        storeBatch: async () => {},
        storeCommentBatch: async (items) => storedComments.push(items),
        saveCheckpoint: async () => {},
      };

      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({
        client,
        store: mockStore,
        docIds: {
          POST_DETAIL: '5587632691339264',
          COMMENT_ROOTS: null,
          COMMENT_REPLIES: null,
        },
      });

      const result = await crawler.start({
        action: 'post_detail',
        args: { postId: '9988776655', includeReplies: true, maxDepth: 2 },
        session: { accountId: 'threads-guest' },
      });

      expect(result.post).toBeDefined();
      expect(Array.isArray(result.comments)).toBe(true);
      expect(result.comments.length).toBe(1);
      expect(result.comments[0].content).toBe('Top level reply to Zuck');
    });
  });

  // ==========================================================================
  // SCN-5: Error Handling & 404 Not Found (AC-4/Edge)
  // ==========================================================================
  describe('SCN-5: Error Handling & 404 Not Found (AC-4/Edge)', () => {
    it('throws XACT_4041 PlatformError when post does not exist', async () => {
      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({ client });

      await expect(
        crawler.start({
          action: 'post_detail',
          args: { postId: '404404404' },
          session: { accountId: 'threads-guest' },
        })
      ).rejects.toThrow();
    });

    it('throws XACT_4001 PlatformError when postId is missing or empty', async () => {
      const client = new ThreadsClient({ baseUrl: serverUrl });
      const crawler = new ThreadsCrawler({ client });

      await expect(
        crawler.start({
          action: 'post_detail',
          args: { postId: '' },
          session: { accountId: 'threads-guest' },
        })
      ).rejects.toThrow();
    });
  });
});
