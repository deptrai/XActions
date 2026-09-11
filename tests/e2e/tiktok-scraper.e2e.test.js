// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// E2E spec for TikTok Scraper Pipeline (Story 15.2).
// by nichxbt

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import {
  scrape,
  createTikTokClient,
  createTikTokCrawler,
  TikTokClient,
  TikTokCrawler,
} from '../../src/scrapers/index.js';

describe('Story 15.2 — TikTok Scraper E2E Pipeline', () => {
  let server;
  let serverUrl;
  const mockSessionCookie = 'msToken=mock_test_token_12345; ttwid=mock_ttwid_cookie_value;';

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;

      // 1. Search Videos
      if (pathname.includes('/api/search/general/full')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          has_more: 1,
          cursor: 20,
          data: [
            {
              type: 1,
              item: {
                id: '7234567890123456795',
                desc: 'Viral dance video on TikTok #dance #viral',
                createTime: 1680000000,
                author: {
                  id: 'author_tiktok_1',
                  uniqueId: 'dancer_pro',
                  nickname: 'Dancer Pro',
                  avatarThumb: 'https://p16.tiktokcdn.com/avatar.jpg',
                },
                video: {
                  playAddr: 'https://v16.tiktokcdn.com/video.mp4',
                  cover: 'https://p16.tiktokcdn.com/cover.jpg',
                  duration: 15,
                  width: 720,
                  height: 1280,
                },
                stats: {
                  diggCount: 154000,
                  shareCount: 12000,
                  commentCount: 3400,
                  playCount: 1200000,
                },
              },
            },
          ],
        }));
        return;
      }

      // 2. Challenge Detail
      if (pathname.includes('/api/challenge/detail')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          challengeInfo: {
            challenge: {
              id: '1600000000000000',
              title: 'foryou',
            },
          },
        }));
        return;
      }

      // 3. Challenge Item List
      if (pathname.includes('/api/challenge/item_list')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          hasMore: true,
          cursor: '20',
          itemList: [
            {
              id: '7234567890123456790',
              desc: 'Hashtag feed trending item #foryou',
              createTime: 1680000050,
              author: {
                id: 'author_tiktok_2',
                uniqueId: 'trendsetter',
                nickname: 'Trend Setter',
              },
              video: {
                playAddr: 'https://v16.tiktokcdn.com/video2.mp4',
                duration: 30,
              },
              stats: {
                diggCount: 50000,
                shareCount: 2000,
                commentCount: 500,
                playCount: 400000,
              },
            },
          ],
        }));
        return;
      }

      // 4. Video Detail
      if (pathname.includes('/api/item/detail')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          itemInfo: {
            itemStruct: {
              id: '7234567890123456789',
              desc: 'Detailed video view test',
              createTime: 1680000000,
              author: {
                id: 'author_tiktok_1',
                uniqueId: 'dancer_pro',
                nickname: 'Dancer Pro',
              },
              video: {
                playAddr: 'https://v16.tiktokcdn.com/video.mp4',
              },
              stats: {
                diggCount: 154000,
              },
            },
          },
        }));
        return;
      }

      // 5. Comments List
      if (pathname.includes('/api/comment/list/reply')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          has_more: 0,
          cursor: 0,
          comments: [],
        }));
        return;
      }

      if (pathname.includes('/api/comment/list')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status_code: 0,
          has_more: 0,
          cursor: 0,
          comments: [
            {
              cid: 'comm_root_101',
              text: 'Awesome moves!',
              create_time: 1680001000,
              digg_count: 42,
              reply_comment_total: 0,
              user: {
                uid: 'user_viewer_99',
                nickname: 'CoolFan',
              },
            },
          ],
        }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status_code: 404, error: 'not found' }));
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    serverUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('exports valid factory functions and classes', () => {
    expect(TikTokClient).toBeDefined();
    expect(TikTokCrawler).toBeDefined();
    expect(typeof createTikTokClient).toBe('function');
    expect(typeof createTikTokCrawler).toBe('function');

    const client = createTikTokClient({ baseUrl: serverUrl });
    expect(client).toBeInstanceOf(TikTokClient);

    const crawler = createTikTokCrawler(client);
    expect(crawler).toBeInstanceOf(TikTokCrawler);
    expect(crawler.client).toBe(client);
  });

  it('scrapes TikTok search videos through the scrape() dispatcher', async () => {
    const res = await scrape('tiktok', 'search', {
      query: 'dance',
      baseUrl: serverUrl,
      cookies: mockSessionCookie,
      store: null,
      requiresProxy: false,
      requiresAuth: false,
    });

    expect(res).toBeDefined();
    expect(res.posts).toHaveLength(1);
    const post = res.posts[0];
    expect(post.id).toBe('tiktok:7234567890123456795');
    expect(post.platform).toBe('tiktok');
    expect(post.authorName).toBe('Dancer Pro');
    expect(post.likesCount).toBe(154000);
    expect(res.pageInfo.has_next_page).toBe(true);
  });

  it('scrapes TikTok hashtag feed through dispatcher alias hashtag', async () => {
    const res = await scrape('tiktok', 'hashtag', {
      tag: 'foryou',
      baseUrl: serverUrl,
      cookies: mockSessionCookie,
      requiresProxy: false,
      requiresAuth: false,
    });

    expect(res).toBeDefined();
    expect(res.posts).toHaveLength(1);
    const post = res.posts[0];
    expect(post.id).toBe('tiktok:7234567890123456790');
    expect(post.content).toContain('Hashtag feed trending item');
    expect(post.likesCount).toBe(50000);
  });

  it('scrapes video details through dispatcher alias video_detail', async () => {
    const res = await scrape('tiktok', 'video_detail', {
      videoId: '7234567890123456789',
      baseUrl: serverUrl,
      cookies: mockSessionCookie,
      requiresProxy: false,
      requiresAuth: false,
    });

    expect(res).toBeDefined();
    expect(res.post).toBeDefined();
    expect(res.post.id).toBe('tiktok:7234567890123456789');
    expect(res.post.content).toBe('Detailed video view test');
  });

  it('scrapes comments tree through dispatcher alias video_comments', async () => {
    const res = await scrape('tiktok', 'video_comments', {
      videoId: '7234567890123456789',
      baseUrl: serverUrl,
      cookies: mockSessionCookie,
      requiresProxy: false,
      requiresAuth: false,
    });

    expect(res).toBeDefined();
    expect(res.comments).toHaveLength(1);
    const comment = res.comments[0];
    expect(comment.id).toBe('tiktok:7234567890123456789:comm_root_101');
    expect(comment.content).toBe('Awesome moves!');
    expect(comment.authorName).toBe('CoolFan');
  });
});
