// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
 * Story 13.2.4 — Twitter Hybrid Media Scraper
 * Red-phase acceptance test scaffold (TDD).
 */

describe('Story 13.2.4 — Twitter Hybrid Media Scraper', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];
  let tmpDir;

  const governor = new AdaptiveRateGovernor();
  const sessionManager = new SessionManager();
  sessionManager.set('twitter-media-user', {
    accountId: 'twitter-media-user',
    cookies: 'auth_token=media_token; ct0=csrf_media',
  });
  const accountPool = new AccountPool();
  accountPool.registerAccounts('twitter', ['twitter-media-user'], {
    credentials: {
      'twitter-media-user': { cookies: 'auth_token=media_token; ct0=csrf_media' },
    },
  });

  const createStore = () => new PrismaStore({ prisma });

  const userResult = {
    data: {
      user: {
        result: {
          __typename: 'User',
          rest_id: '1234567890',
          legacy: {
            screen_name: 'elonmusk',
            name: 'Elon Musk',
            profile_image_url_https: 'https://pbs.twimg.com/elon.jpg',
          },
        },
      },
    },
  };

  const photoEntry = (id) => ({
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
              full_text: 'Photo tweet',
              id_str: id,
              favorite_count: 10,
              retweet_count: 2,
              reply_count: 1,
              quote_count: 0,
              bookmark_count: 0,
              entities: { hashtags: [], urls: [], user_mentions: [] },
              extended_entities: {
                media: [
                  {
                    id_str: `${id}_photo_1`,
                    media_key: `${id}_photo_1_key`,
                    type: 'photo',
                    media_url_https: `https://pbs.twimg.com/media/${id}_photo_1.jpg`,
                    original_info: { width: 1200, height: 800 },
                    sizes: { large: { w: 1200, h: 800 } },
                    ext_alt_text: 'A test photo',
                  },
                ],
              },
              lang: 'en',
            },
            core: {
              user_results: {
                result: {
                  rest_id: 'user_' + id,
                  is_blue_verified: false,
                  legacy: {
                    screen_name: 'postera',
                    name: 'Poster A',
                    profile_image_url_https: 'https://pbs.twimg.com/profile.jpg',
                  },
                },
              },
            },
            views: { count: '1000' },
          },
        },
      },
    },
  });

  const videoEntry = (id) => ({
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
              full_text: 'Video tweet',
              id_str: id,
              favorite_count: 100,
              retweet_count: 20,
              reply_count: 5,
              quote_count: 1,
              bookmark_count: 0,
              entities: { hashtags: [], urls: [], user_mentions: [] },
              extended_entities: {
                media: [
                  {
                    id_str: `${id}_video_1`,
                    media_key: `${id}_video_1_key`,
                    type: 'video',
                    media_url_https: `https://pbs.twimg.com/media/${id}_video_1.jpg`,
                    original_info: { width: 1280, height: 720 },
                    video_info: {
                      aspect_ratio: [16, 9],
                      duration_millis: 15000,
                      variants: [
                        { bitrate: 2176000, content_type: 'video/mp4', url: `https://video.twimg.com/video/${id}_2.mp4` },
                        { bitrate: 832000, content_type: 'video/mp4', url: `https://video.twimg.com/video/${id}_1.mp4` },
                      ],
                    },
                  },
                ],
              },
              lang: 'en',
            },
            core: {
              user_results: {
                result: {
                  rest_id: 'user_' + id,
                  is_blue_verified: false,
                  legacy: {
                    screen_name: 'postera',
                    name: 'Poster A',
                    profile_image_url_https: 'https://pbs.twimg.com/profile.jpg',
                  },
                },
              },
            },
            views: { count: '5000' },
          },
        },
      },
    },
  });

  const gifEntry = (id) => ({
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
              full_text: 'GIF tweet',
              id_str: id,
              favorite_count: 50,
              retweet_count: 10,
              reply_count: 2,
              quote_count: 0,
              bookmark_count: 0,
              entities: { hashtags: [], urls: [], user_mentions: [] },
              extended_entities: {
                media: [
                  {
                    id_str: `${id}_gif_1`,
                    media_key: `${id}_gif_1_key`,
                    type: 'animated_gif',
                    media_url_https: `https://pbs.twimg.com/media/${id}_gif_1.jpg`,
                    original_info: { width: 480, height: 270 },
                    video_info: {
                      aspect_ratio: [16, 9],
                      duration_millis: 3200,
                      variants: [
                        { bitrate: 0, content_type: 'video/mp4', url: `https://video.twimg.com/tweet_video/${id}.mp4` },
                      ],
                    },
                  },
                ],
              },
              lang: 'en',
            },
            core: {
              user_results: {
                result: {
                  rest_id: 'user_' + id,
                  is_blue_verified: false,
                  legacy: {
                    screen_name: 'postera',
                    name: 'Poster A',
                    profile_image_url_https: 'https://pbs.twimg.com/profile.jpg',
                  },
                },
              },
            },
            views: { count: '2000' },
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

  const tweetResultByRestId = (id, media) => ({
    data: {
      tweetResult: {
        result: {
          __typename: 'Tweet',
          rest_id: id,
          legacy: {
            created_at: 'Mon Jan 01 00:00:00 +0000 2024',
            full_text: 'Single tweet with media',
            id_str: id,
            favorite_count: 42,
            retweet_count: 7,
            reply_count: 3,
            quote_count: 1,
            bookmark_count: 0,
            entities: { hashtags: [], urls: [], user_mentions: [] },
            extended_entities: {
              media,
            },
            lang: 'en',
          },
          core: {
            user_results: {
              result: {
                rest_id: 'user_single',
                is_blue_verified: false,
                legacy: {
                  screen_name: 'singleuser',
                  name: 'Single User',
                  profile_image_url_https: 'https://pbs.twimg.com/profile.jpg',
                },
              },
            },
          },
          views: { count: '12345' },
        },
      },
    },
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
    receivedRequests = [];
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xactions-media-'));
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });

        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<html><body>Twitter Media Mock</body></html>');
          return;
        }

        if (req.url?.startsWith('/i/api/graphql/')) {
          const pathParts = req.url.split('/');
          const operationName = pathParts[pathParts.length - 1];
          const params = new URLSearchParams(body);
          const rawVars = params.get('variables') || '{}';
          let variables = {};
          try {
            variables = JSON.parse(rawVars);
          } catch {}

          if (operationName === 'UserByScreenName') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(userResult));
            return;
          }

          if (operationName === 'UserMedia') {
            const entries = [photoEntry('1001'), videoEntry('1002'), gifEntry('1003'), cursorEntry('cursor_media_next')];
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                user: {
                  result: {
                    timeline_v2: {
                      timeline: {
                        instructions: [
                          {
                            type: 'TimelineAddEntries',
                            entries,
                          },
                        ],
                      },
                    },
                  },
                },
              },
            }));
            return;
          }

          if (operationName === 'TweetResultByRestId') {
            const tweetId = variables.tweetId;
            if (tweetId === '1002') {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify(tweetResultByRestId('1002', [
                {
                  id_str: '1002_video_1',
                  media_key: '1002_video_1_key',
                  type: 'video',
                  media_url_https: 'https://pbs.twimg.com/media/1002_video_1.jpg',
                  original_info: { width: 1280, height: 720 },
                  video_info: {
                    aspect_ratio: [16, 9],
                    duration_millis: 15000,
                    variants: [
                      { bitrate: 2176000, content_type: 'video/mp4', url: `${serverUrl}/video/1002_high.mp4` },
                      { bitrate: 832000, content_type: 'video/mp4', url: `${serverUrl}/video/1002_low.mp4` },
                    ],
                  },
                },
              ])));
              return;
            }

            if (tweetId === '1001') {
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify(tweetResultByRestId('1001', [
                {
                  id_str: '1001_photo_1',
                  media_key: '1001_photo_1_key',
                  type: 'photo',
                  media_url_https: 'https://pbs.twimg.com/media/1001_photo_1.jpg',
                  original_info: { width: 1200, height: 800 },
                  sizes: { large: { w: 1200, h: 800 } },
                },
              ])));
              return;
            }

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data: {} }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: {} }));
          return;
        }

        if (req.url?.startsWith('/video/')) {
          const mp4 = Buffer.from('mp4video');
          res.writeHead(200, {
            'content-type': 'video/mp4',
            'content-length': String(mp4.length),
          });
          res.end(mp4);
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

  it('[AC-1] should register media and download_video actions', () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('twitter');

    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);

    expect(actionNames).toContain('media');
    expect(actionNames).toContain('download_video');

    const mediaAction = actions.find((a) => a.action === 'media');
    expect(mediaAction?.optionalArgs).toContain('username');
    expect(mediaAction?.optionalArgs).toContain('tweetId');
    expect(mediaAction?.optionalArgs).toContain('type');
    expect(mediaAction?.optionalArgs).toContain('limit');
    expect(mediaAction?.optionalArgs).toContain('cursor');
    expect(mediaAction?.requiresAuth).toBe(false);

    const downloadAction = actions.find((a) => a.action === 'download_video');
    expect(downloadAction?.requiredArgs).toContain('tweetId');
    expect(downloadAction?.optionalArgs).toContain('quality');
    expect(downloadAction?.optionalArgs).toContain('destPath');
    expect(downloadAction?.requiresAuth).toBe(false);
  });

  it('[AC-2] should fetch user media and return PostItem[] with metadata.media', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const result = await crawler.start({
      action: 'media',
      args: { username: 'elonmusk', limit: 10 },
      session: { accountId: 'twitter-media-user' },
    });

    const posts = result.posts || [];
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);

    const photoPost = posts.find((p) => p.metadata?.media?.[0]?.type === 'photo');
    expect(photoPost).toBeDefined();
    expect(photoPost.id).toBe('twitter:1001');
    expect(photoPost.externalId).toBe('1001');
    expect(photoPost.platform).toBe('twitter');
    expect(photoPost.category).toBe('social');
    expect(photoPost.metadata?.isMedia).toBe(true);
    expect(photoPost.metadata?.media).toBeDefined();
    expect(photoPost.metadata?.media.length).toBeGreaterThan(0);
    expect(photoPost.metadata?.media[0].url).toContain('format=jpg&name=orig');
    expect(photoPost.metadata?.media[0].altText).toBe('A test photo');

    const videoPost = posts.find((p) => p.metadata?.media?.[0]?.type === 'video');
    expect(videoPost).toBeDefined();
    expect(videoPost.metadata?.media[0].variants?.length).toBeGreaterThan(0);
    expect(videoPost.metadata?.media[0].durationMs).toBe(15000);

    const gifPost = posts.find((p) => p.metadata?.media?.[0]?.type === 'animated_gif');
    expect(gifPost).toBeDefined();
  });

  it('[AC-2] should fetch a single tweet by tweetId and filter by type', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const result = await crawler.start({
      action: 'media',
      args: { tweetId: '1001', type: 'photo' },
      session: { accountId: 'twitter-media-user' },
    });

    const posts = result.posts || [];
    expect(posts.length).toBe(1);
    expect(posts[0].externalId).toBe('1001');
    expect(posts[0].metadata?.media?.[0]?.type).toBe('photo');

    const lastGraphqlReq = receivedRequests
      .filter((r) => r.url?.startsWith('/i/api/graphql/'))
      .pop();
    const params = new URLSearchParams(lastGraphqlReq.body);
    const variables = JSON.parse(params.get('variables') || '{}');
    expect(variables.tweetId).toBe('1001');
    expect(variables.includePromotedContent).toBe(false);
    expect(variables.__relay_internal__pv__appviewerisloggedinprovider).toBe(false);
  });

  it('[AC-3] should normalize video variants sorted by bitrate descending', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const result = await crawler.start({
      action: 'media',
      args: { tweetId: '1002' },
      session: { accountId: 'twitter-media-user' },
    });

    const post = result.posts[0];
    const media = post.metadata.media[0];
    expect(media.type).toBe('video');
    expect(media.variants[0].bitrate).toBe(2176000);
    expect(media.variants[1].bitrate).toBe(832000);
    expect(media.url).toBe(media.variants[0].url);
    expect(media.durationMs).toBe(15000);
  });

  it('[AC-4] should download the highest quality video', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const destPath = path.join(tmpDir, '1002_high.mp4');
    const result = await crawler.start({
      action: 'download_video',
      args: { tweetId: '1002', quality: 'highest', destPath },
      session: { accountId: 'twitter-media-user' },
    });

    expect(result.url).toContain('/video/1002_high.mp4');
    expect(result.destPath).toBe(destPath);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.bitrate).toBe(2176000);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.durationMs).toBe(15000);
    expect(result.variants.length).toBe(2);

    const stat = await fs.stat(destPath);
    expect(stat.size).toBe(result.bytes);
  });

  it('[AC-4] should download the lowest quality video', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const destPath = path.join(tmpDir, '1002_low.mp4');
    const result = await crawler.start({
      action: 'download_video',
      args: { tweetId: '1002', quality: 'lowest', destPath },
      session: { accountId: 'twitter-media-user' },
    });

    expect(result.url).toContain('/video/1002_low.mp4');
    expect(result.bitrate).toBe(832000);
  });

  it('[AC-4] should return all variants for quality "all" without downloading', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    const result = await crawler.start({
      action: 'download_video',
      args: { tweetId: '1002', quality: 'all' },
      session: { accountId: 'twitter-media-user' },
    });

    expect(result.destPath).toBeNull();
    expect(result.variants.length).toBe(2);
    expect(result.variants[0].bitrate).toBe(2176000);
  });

  it('[AC-4] should reject download_video for tweets without video', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    await expect(
      crawler.start({
        action: 'download_video',
        args: { tweetId: '1001' },
        session: { accountId: 'twitter-media-user' },
      })
    ).rejects.toThrow(PlatformError);
  });

  it('[AC-5] should persist media PostItems and validate schema', async () => {
    const store = createStore();
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, store, sessionManager });

    const result = await crawler.start({
      action: 'media',
      args: { username: 'elonmusk', limit: 10 },
      session: { accountId: 'twitter-media-user' },
    });

    for (const post of result.posts || []) {
      expect(post.metadata?.tweetId).toBe(post.externalId);
      const validation = metadataSchemaRegistry.validateMetadata('twitter', 'social', post.metadata);
      expect(validation.valid).toBe(true);
    }

    const storedPosts = await prisma.post.findMany({
      where: { platform: 'twitter' },
    });
    expect(storedPosts.length).toBeGreaterThan(0);
    const mediaPost = storedPosts.find((p) => p.metadata && typeof p.metadata === 'object' && 'media' in p.metadata);
    expect(mediaPost).toBeDefined();
    expect(mediaPost?.metadata).toHaveProperty('media');
  });

  it('[AC-6] should update checkpoint for media pagination', async () => {
    const store = createStore();
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, store, sessionManager });

    await crawler.start({
      action: 'media',
      args: { username: 'elonmusk', limit: 10 },
      session: { accountId: 'twitter-media-user' },
    });

    const checkpoint = await prisma.crawlCheckpoint.findFirst({
      where: { platform: 'twitter', targetType: 'media' },
    });
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.targetKey).toContain('elonmusk');
    expect(checkpoint?.lastCursor).toBe('cursor_media_next');
  });

  it('[AC-7] should reject missing username and tweetId for media', async () => {
    const client = new TwitterClient({ baseUrl: serverUrl, governor, accountPool });
    const crawler = new TwitterCrawler({ client, sessionManager });

    await expect(
      crawler.start({
        action: 'media',
        args: {},
        session: { accountId: 'twitter-media-user' },
      })
    ).rejects.toThrow(PlatformError);
  });
});
