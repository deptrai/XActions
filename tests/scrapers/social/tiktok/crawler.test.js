// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { TikTokClient } from '../../../../src/scrapers/social/tiktok/client.js';
import { TikTokCrawler } from '../../../../src/scrapers/social/tiktok/crawler.js';
import { TikTokPlatformResponseValidator } from '../../../../src/scrapers/social/tiktok/validator.js';

/**
 * Red-phase ATDD tests for TikTokCrawler actions.
 * Uses a local HTTP server so the crawler can be exercised without
 * calling real TikTok endpoints.
 */
describe('Story 15.2 — TikTokCrawler Actions', () => {
  let server;
  let serverUrl;

  beforeAll(async () => {
    process.env.TIKTOK_BROWSER_SIGN = 'false';
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost`);
      const path = url.pathname;
      const params = Object.fromEntries(url.searchParams);

      if (path === '/api/search/general/full/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          status_msg: '',
          item_list: [{
            item: {
              aweme_id: '1234567890',
              desc: 'Crawler search test',
              create_time: 1700000000,
              author: { id: '10', nickname: 'searcher', unique_id: 'searcher' },
              video: { playAddr: { urlList: ['https://example.com/search.mp4'] } },
              statistics: { digg_count: 42, comment_count: 7, share_count: 3 },
            },
          }],
          has_more: false,
          cursor: 12,
        }));
        return;
      }

      if (path === '/api/challenge/detail/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          challengeInfo: {
            challenge: { id: '42164', cha_name: 'foryou' },
          },
        }));
        return;
      }

      if (path === '/api/challenge/item_list/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          itemList: [{
            aweme_id: '9876543210',
            desc: '#foryou crawler test',
            create_time: 1700000000,
            author: { id: '11', nickname: 'hashtester', unique_id: 'hashtester' },
            video: { playAddr: { urlList: ['https://example.com/hashtag.mp4'] } },
            statistics: { digg_count: 100, comment_count: 5, share_count: 3 },
          }],
          has_more: false,
          cursor: 30,
        }));
        return;
      }

      if (path === '/api/item/detail/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          itemInfo: {
            itemStruct: {
              aweme_id: '7325759242735676680',
              desc: 'Crawler detail test',
              create_time: 1700000000,
              author: { id: '12', nickname: 'detailtester', unique_id: 'detailtester' },
              video: { playAddr: { urlList: ['https://example.com/detail.mp4'] } },
              statistics: { digg_count: 1000, comment_count: 50, share_count: 20 },
            },
          },
        }));
        return;
      }

      if (path === '/api/comment/list/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          comments: [{
            cid: 'c1',
            text: 'Root comment',
            create_time: 1700000001,
            user: { id: '20', nickname: 'rootcommenter', unique_id: 'rootcommenter' },
            digg_count: 5,
            reply_comment_total: 1,
          }],
          has_more: false,
          cursor: 1,
        }));
        return;
      }

      if (path === '/api/comment/list/reply/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          comments: [{
            cid: 'c2',
            text: 'Reply comment',
            create_time: 1700000002,
            user: { id: '21', nickname: 'replycommenter', unique_id: 'replycommenter' },
            digg_count: 2,
            reply_comment_total: 0,
          }],
          has_more: false,
          cursor: 1,
        }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ status_code: 404, status_msg: 'not found' }));
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${addr?.port}`;
        resolve(undefined);
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.TIKTOK_BROWSER_SIGN;
  });

  function createCrawler() {
    const client = new TikTokClient({
      baseUrl: serverUrl,
      requiresProxy: false,
      responseValidator: new TikTokPlatformResponseValidator(),
    });
    return new TikTokCrawler({ client });
  }

  it('searches TikTok by keyword and returns normalized posts', async () => {
    const crawler = createCrawler();
    const result = await crawler.start({
      action: 'search',
      args: { query: 'viral', count: 12 },
      session: { accountId: 'tiktok-guest' },
    });

    expect(result.posts).toBeInstanceOf(Array);
    expect(result.posts.length).toBe(1);
    expect(result.posts[0].externalId).toBe('1234567890');
    expect(result.posts[0].platform).toBe('tiktok');
    expect(result.pageInfo.has_next_page).toBe(false);
    expect(result.pageInfo.end_cursor).toBe('12');
  });

  it('fetches a hashtag feed and returns normalized posts', async () => {
    const crawler = createCrawler();
    const result = await crawler.start({
      action: 'hashtag_feed',
      args: { tag: 'foryou', count: 30 },
      session: { accountId: 'tiktok-guest' },
    });

    expect(result.posts).toBeInstanceOf(Array);
    expect(result.posts.length).toBe(1);
    expect(result.posts[0].externalId).toBe('9876543210');
    expect(result.pageInfo.has_next_page).toBe(false);
    expect(result.pageInfo.end_cursor).toBe('30');
  });

  it('fetches a TikTok post detail by video id', async () => {
    const crawler = createCrawler();
    const result = await crawler.start({
      action: 'post_detail',
      args: { videoId: '7325759242735676680' },
      session: { accountId: 'tiktok-guest' },
    });

    expect(result.post).toBeDefined();
    expect(result.post.externalId).toBe('7325759242735676680');
    expect(result.post.platform).toBe('tiktok');
  });

  it('fetches hierarchical comments for a TikTok video', async () => {
    const crawler = createCrawler();
    const result = await crawler.start({
      action: 'get_post_comments',
      args: { videoId: '7325759242735676680', maxDepth: 1, maxComments: 10 },
      session: { accountId: 'tiktok-guest' },
    });

    expect(result.comments).toBeInstanceOf(Array);
    expect(result.comments.length).toBe(2);
    const root = result.comments.find((c) => c.externalId === 'c1');
    const reply = result.comments.find((c) => c.externalId === 'c2');
    expect(root).toBeDefined();
    expect(reply).toBeDefined();
    expect(reply.depth).toBe(1);
    expect(reply.parentCommentId).toBe(root?.id);
  });
});
