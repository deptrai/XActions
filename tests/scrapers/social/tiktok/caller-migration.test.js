// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { scrape, getPlatform, platforms } from '../../../../src/scrapers/index.js';
import { TikTokClient } from '../../../../src/scrapers/social/tiktok/client.js';
import { TikTokCrawler } from '../../../../src/scrapers/social/tiktok/crawler.js';
import { TikTokPlatformResponseValidator } from '../../../../src/scrapers/social/tiktok/validator.js';
import metadataSchemaRegistry from '../../../../src/core/metadata-schema-registry.js';
import path from 'node:path';

/**
 * Story 15.2 — TikTok Caller Migration & Package Exports (ATDD)
 *
 * Red-phase scaffolds for the unified dispatcher path. When
 * TIKTOK_BROWSER_SIGN is disabled the client uses a stub signer, so live
 * TikTok will reject it, but a local server lets us verify dispatcher wiring,
 * action aliases, option forwarding, default exports, and schema validation.
 */
describe('Story 15.2 — TikTok Caller Migration & Package Exports', () => {
  let server;
  let serverUrl;
  /** @type {Array<Record<string, any>>} */
  let receivedRequests = [];

  beforeAll(async () => {
    const schemasDir = path.resolve(process.cwd(), 'schemas');
    metadataSchemaRegistry.loadSchemasFromDisk(schemasDir);

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
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            status_code: 0,
            status_msg: '',
            item_list: [{
              item: {
                aweme_id: '7325759242735676680',
                desc: 'Migration test post',
                create_time: 1700000000,
                author: { id: '1', nickname: 'migrator', unique_id: 'migrator' },
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
            challengeInfo: { challenge: { id: '42164', cha_name: 'foryou' } },
          }));
          return;
        }

        if (req.url?.startsWith('/api/challenge/item_list/')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            status_code: 0,
            itemList: [{
              aweme_id: '9876543210',
              desc: '#foryou migration test',
              create_time: 1700000000,
              author: { id: '2', nickname: 'hashtagmigrator', unique_id: 'hashtagmigrator' },
              video: { playAddr: { urlList: ['https://example.com/hashtag.mp4'] } },
              statistics: { digg_count: 100, comment_count: 5, share_count: 3 },
            }],
            has_more: false,
            cursor: 30,
          }));
          return;
        }

        if (req.url?.startsWith('/api/item/detail/')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            status_code: 0,
            itemInfo: {
              itemStruct: {
                aweme_id: '7325759242735676680',
                desc: 'Migration detail test',
                create_time: 1700000000,
                author: { id: '3', nickname: 'detailmigrator', unique_id: 'detailmigrator' },
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
              text: 'Migration comment',
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
    delete process.env.TIKTOK_BROWSER_SIGN;
  });

  beforeAll(() => {
    receivedRequests = [];
  });

  it('registers tiktok in platforms and getPlatform', () => {
    expect(platforms.tiktok).toBeTruthy();
    expect(typeof getPlatform('tiktok')).toBe('object');
    expect(typeof getPlatform('tiktok').scrapeTikTok).toBe('function');
    expect(typeof getPlatform('tiktok').TikTokClient).toBe('function');
    expect(typeof getPlatform('tiktok').TikTokCrawler).toBe('function');
  });

  it('dispatches search via scrape() and respects keyword/q aliases', async () => {
    const result = await scrape('tiktok', 'search_videos', {
      q: 'migration',
      baseUrl: serverUrl,
      requiresProxy: false,
      store: {
        storeBatch: async () => ({}),
        storeCommentBatch: async () => ({}),
        saveCheckpoint: async () => {},
      },
      responseValidator: new TikTokPlatformResponseValidator(),
      autoClose: false,
    });

    expect(result).toBeDefined();
    expect(result.posts).toBeInstanceOf(Array);
    expect(result.posts[0].platform).toBe('tiktok');
    expect(result.posts[0].externalId).toBe('7325759242735676680');
  });

  it('dispatches hashtag via scrape() and respects tag alias', async () => {
    const result = await scrape('tiktok', 'hashtag', {
      tag: 'foryou',
      baseUrl: serverUrl,
      requiresProxy: false,
      store: {
        storeBatch: async () => ({}),
        storeCommentBatch: async () => ({}),
        saveCheckpoint: async () => {},
      },
      responseValidator: new TikTokPlatformResponseValidator(),
      autoClose: false,
    });

    expect(result).toBeDefined();
    expect(result.posts).toBeInstanceOf(Array);
    expect(result.posts[0].externalId).toBe('9876543210');
  });

  it('dispatches video detail via scrape() and respects id alias', async () => {
    const result = await scrape('tiktok', 'video_detail', {
      id: '7325759242735676680',
      baseUrl: serverUrl,
      requiresProxy: false,
      store: {
        storeBatch: async () => ({}),
        storeCommentBatch: async () => ({}),
        saveCheckpoint: async () => {},
      },
      responseValidator: new TikTokPlatformResponseValidator(),
      autoClose: false,
    });

    expect(result).toBeDefined();
    expect(result.post?.platform).toBe('tiktok');
    expect(result.post?.externalId).toBe('7325759242735676680');
  });

  it('dispatches video comments via scrape() and respects comments alias', async () => {
    const result = await scrape('tiktok', 'comments', {
      id: '7325759242735676680',
      baseUrl: serverUrl,
      requiresProxy: false,
      store: {
        storeBatch: async () => ({}),
        storeCommentBatch: async () => ({}),
        saveCheckpoint: async () => {},
      },
      responseValidator: new TikTokPlatformResponseValidator(),
      autoClose: false,
    });

    expect(result).toBeDefined();
    expect(result.comments).toBeInstanceOf(Array);
    expect(result.comments[0].platform).toBe('tiktok');
  });

  it('validates post metadata against schemas/tiktok/social.json', () => {
    const post = {
      platform: 'tiktok',
      externalId: '7325759242735676680',
      metadata: {
        sourceMethod: 'api',
        awemeId: '7325759242735676680',
        coverUrl: 'https://example.com/cover.jpg',
      },
    };
    const { valid } = metadataSchemaRegistry.validateMetadata('tiktok', 'social', post.metadata);
    expect(valid).toBe(true);
  });

  it('validates comment metadata against schemas/tiktok/social.json', () => {
    const comment = {
      platform: 'tiktok',
      externalId: 'c1',
      postId: 'tiktok:7325759242735676680',
      metadata: {
        sourceMethod: 'api',
      },
    };
    const { valid } = metadataSchemaRegistry.validateMetadata('tiktok', 'social', comment.metadata);
    expect(valid).toBe(true);
  });

  it('exposes TikTokClient and TikTokCrawler via package subpath', async () => {
    const mod = await import('xactions/scrapers/tiktok');
    expect(typeof mod.TikTokClient).toBe('function');
    expect(typeof mod.TikTokCrawler).toBe('function');
    expect(typeof mod.scrapeTikTok).toBe('function');
  });
});
