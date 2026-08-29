// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { TikTokClient } from '../../../../src/scrapers/social/tiktok/client.js';
import { TikTokPlatformResponseValidator } from '../../../../src/scrapers/social/tiktok/validator.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';

/**
 * Red-phase ATDD tests for TikTokClient.
 * When TIKTOK_BROWSER_SIGN is disabled, the client uses the stub signer which
 * produces non-live tokens. Real TikTok will reject them, but a local server
 * allows us to verify the request shape, headers, and validator behavior.
 */
describe('Story 15.2 — TikTokClient Contract & Web API Engine', () => {
  let server;
  let serverUrl;
  /** @type {Array<Record<string, any>>} */
  let receivedRequests = [];

  beforeAll(async () => {
    process.env.TIKTOK_BROWSER_SIGN = 'false';
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

        if (req.url?.startsWith('/api/search/general/full/')) {
          if (req.url.includes('bot=true')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              status_code: 5,
              status_msg: 'anti-bot challenge',
              extra: { fatal_item_ids: [] },
            }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            status_code: 0,
            status_msg: '',
            item_list: [{
              item: {
                aweme_id: '1234567890',
                desc: 'Red phase test post',
                create_time: 1700000000,
                author: { id: '1', nickname: 'tester', unique_id: 'tester' },
                video: { playAddr: { urlList: ['https://example.com/video.mp4'] } },
                statistics: { digg_count: 10, comment_count: 2, share_count: 1 },
              },
            }],
            has_more: false,
            cursor: 12,
          }));
          return;
        }

        if (req.url?.startsWith('/api/challenge/detail/')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            status_code: 0,
            challengeInfo: {
              challenge: { id: '42164', cha_name: 'foryou' },
            },
          }));
          return;
        }

        if (req.url?.startsWith('/api/challenge/item_list/')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            status_code: 0,
            itemList: [{
              aweme_id: '9876543210',
              desc: '#foryou test',
              create_time: 1700000000,
              author: { id: '2', nickname: 'hashtester', unique_id: 'hashtester' },
              video: { playAddr: { urlList: ['https://example.com/hashtag.mp4'] } },
              statistics: { digg_count: 100, comment_count: 5, share_count: 3 },
            }],
            has_more: false,
            cursor: 30,
          }));
          return;
        }

        if (req.url?.startsWith('/api/item/detail/') || req.url?.startsWith('/api/seo/keyword/item_tags/')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            status_code: 0,
            itemInfo: {
              itemStruct: {
                aweme_id: '7325759242735676680',
                desc: 'Detail phase test',
                create_time: 1700000000,
                author: { id: '3', nickname: 'detailtester', unique_id: 'detailtester' },
                video: { playAddr: { urlList: ['https://example.com/detail.mp4'] } },
                statistics: { digg_count: 1000, comment_count: 50, share_count: 20 },
              },
            },
          }));
          return;
        }

        if (req.url?.startsWith('/api/comment/list/')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            status_code: 0,
            comments: [{
              cid: 'c1',
              text: 'First comment',
              create_time: 1700000001,
              user: { id: '4', nickname: 'commenter', unique_id: 'commenter' },
              digg_count: 5,
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
    receivedRequests = [];
  });

  beforeAll(() => {
    receivedRequests = [];
  });

  it('builds a signed search URL with device context and TikTok headers', async () => {
    const client = new TikTokClient({
      baseUrl: serverUrl,
      requiresProxy: false,
    });

    const url = client.buildSearchUrl({ query: 'viral', count: 12, cursor: 0 });
    expect(url).toContain('/api/search/general/full/');
    expect(url).toContain('keyword=viral');
    expect(url).toContain('aid=1988');
    expect(url).toContain('from_page=search');
    // buildSearchUrl does not sign; msToken is added by sign() before the request.
    const signed = await client.sign({ url });
    expect(signed.query).toHaveProperty('msToken');
    expect(typeof signed.query.msToken).toBe('string');
    expect(signed.query.a_bogus).toBeTruthy();
  });

  it('executes search and normalizes results against a real local endpoint', async () => {
    const client = new TikTokClient({
      baseUrl: serverUrl,
      requiresProxy: false,
      responseValidator: new TikTokPlatformResponseValidator(),
    });

    const resp = await client.requestTikTokApi('GET', '/api/search/general/full/', {
      keyword: 'viral',
      count: 12,
      cursor: '0',
    });

    expect(resp).toBeDefined();
    expect(resp.status_code).toBe(0);
    expect(resp.item_list).toBeInstanceOf(Array);
  });

  it('executes hashtag detail and feed', async () => {
    const client = new TikTokClient({
      baseUrl: serverUrl,
      requiresProxy: false,
      responseValidator: new TikTokPlatformResponseValidator(),
    });

    const detail = await client.requestTikTokApi('GET', '/api/challenge/detail/', {
      challengeName: 'foryou',
    });
    expect(detail.challengeInfo.challenge.id).toBe('42164');

    const feed = await client.requestTikTokApi('GET', '/api/challenge/item_list/', {
      challengeID: '42164',
      count: 30,
      cursor: '0',
    });
    expect(feed.itemList).toBeInstanceOf(Array);
  });

  it('fails gracefully on bot challenge status', async () => {
    const client = new TikTokClient({
      baseUrl: serverUrl,
      requiresProxy: false,
      responseValidator: new TikTokPlatformResponseValidator(),
    });

    await expect(client.requestTikTokApi('GET', '/api/search/general/full/', {
      keyword: 'bot',
      bot: 'true',
    })).rejects.toBeInstanceOf(PlatformError);
  });
});
