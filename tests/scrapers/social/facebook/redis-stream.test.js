// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 14.3: FacebookCrawler Checkpoint & Redis Stream Emission
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { RedisStreamPublisher } from '../../../../src/utils/redis-stream-publisher.js';

describe('Story 14.3: FacebookCrawler Checkpoint & Redis Stream Emission', () => {
  let server;
  let serverUrl;
  const originalEnv = process.env.REDIS_STREAM_ENABLED;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // Home HTML for tokens
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><body>
              <input type="hidden" name="lsd" value="AVq_Lsd123" />
              <input type="hidden" name="jazoest" value="2953" />
              <script>
                requireLazy(["DTSGInitialData"], function(d) { d.token = "DTSG_456"; });
                window.__spin_r = 1016839210;
              </script>
            </body></html>
          `);
          return;
        }

        if (req.url === '/api/graphql/') {
          let variables = {};
          try {
            const parsed = new URLSearchParams(body);
            variables = JSON.parse(parsed.get('variables') || '{}');
          } catch {
            variables = {};
          }

          if (variables.groupId) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                data: {
                  group: {
                    id: variables.groupId,
                    feed: {
                      edges: [
                        {
                          node: {
                            id: 'fb_post_group_1',
                            post_id: 'fb_post_group_1',
                            actors: [{ id: 'user_1', name: 'User One' }],
                            comet_sections: {
                              content_story: {
                                story: {
                                  message: { text: 'Group post content' },
                                },
                              },
                            },
                          },
                        },
                      ],
                      page_info: { end_cursor: 'cursor_grp_end', has_next_page: false },
                    },
                  },
                },
              })
            );
            return;
          }

          if (variables.pageId) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                data: {
                  page: {
                    timeline_feed: {
                      edges: [
                        {
                          node: {
                            id: 'fb_post_page_1',
                            post_id: 'fb_post_page_1',
                            actors: [{ id: 'page_admin', name: 'Page Admin' }],
                            message: { text: 'Page post content' },
                          },
                        },
                      ],
                      page_info: { end_cursor: 'cursor_page_end', has_next_page: false },
                    },
                  },
                },
              })
            );
            return;
          }
        }

        // Fallback
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (originalEnv !== undefined) {
      process.env.REDIS_STREAM_ENABLED = originalEnv;
    } else {
      delete process.env.REDIS_STREAM_ENABLED;
    }
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    process.env.REDIS_STREAM_ENABLED = 'true';
  });

  it('groupPosts calls saveCheckpoint and emits thin event pointer with storageRef', async () => {
    const savedCheckpoints = [];
    const publishedEvents = [];

    const mockPublisher = {
      publish: async (item) => {
        publishedEvents.push(item);
        return { ok: true, id: '1700000000000-0' };
      },
    };

    const mockStore = {
      publisher: mockPublisher,
      storeBatch: async () => {},
      saveCheckpoint: async (checkpoint) => {
        savedCheckpoints.push(checkpoint);
        return checkpoint;
      },
    };

    const client = new FacebookClient({
      baseUrl: serverUrl,
      graphqlEndpoint: `${serverUrl}/api/graphql/`,
    });

    const crawler = new FacebookCrawler({
      client,
      store: mockStore,
    });

    const result = await crawler.groupPosts(
      { groupId: 'group_999' },
      { accountId: 'acc_test', cookies: { c_user: '123' } }
    );

    expect(result.posts.length).toBe(1);
    expect(savedCheckpoints.length).toBe(1);
    expect(savedCheckpoints[0].targetType).toBe('group');
    expect(savedCheckpoints[0].targetKey).toBe('group_999');
    expect(savedCheckpoints[0].storageRef).toBe('facebook:fb_post_group_1');
    expect(savedCheckpoints[0].lastCursor).toBe('cursor_grp_end');

    expect(publishedEvents.length).toBe(1);
    expect(publishedEvents[0].id).toBe('facebook:fb_post_group_1');
    expect(publishedEvents[0].platform).toBe('facebook');
    expect(publishedEvents[0].externalId).toBe('fb_post_group_1');
    expect(publishedEvents[0].storageRef).toBe('facebook:fb_post_group_1');
  });

  it('pagePosts calls saveCheckpoint and emits thin event pointer with storageRef', async () => {
    const savedCheckpoints = [];
    const publishedEvents = [];

    const mockPublisher = {
      publish: async (item) => {
        publishedEvents.push(item);
        return { ok: true, id: '1700000000000-1' };
      },
    };

    const mockStore = {
      publisher: mockPublisher,
      storeBatch: async () => {},
      saveCheckpoint: async (checkpoint) => {
        savedCheckpoints.push(checkpoint);
        return checkpoint;
      },
    };

    const client = new FacebookClient({
      baseUrl: serverUrl,
      graphqlEndpoint: `${serverUrl}/api/graphql/`,
    });

    const crawler = new FacebookCrawler({
      client,
      store: mockStore,
    });

    const result = await crawler.pagePosts(
      { pageId: 'page_777' },
      { accountId: 'acc_test', cookies: { c_user: '123' } }
    );

    expect(result.posts.length).toBe(1);
    expect(savedCheckpoints.length).toBe(1);
    expect(savedCheckpoints[0].targetType).toBe('page');
    expect(savedCheckpoints[0].targetKey).toBe('page_777');
    expect(savedCheckpoints[0].storageRef).toBe('facebook:fb_post_page_1');
    expect(savedCheckpoints[0].lastCursor).toBe('cursor_page_end');

    expect(publishedEvents.length).toBe(1);
    expect(publishedEvents[0].id).toBe('facebook:fb_post_page_1');
    expect(publishedEvents[0].platform).toBe('facebook');
    expect(publishedEvents[0].externalId).toBe('fb_post_page_1');
    expect(publishedEvents[0].storageRef).toBe('facebook:fb_post_page_1');
  });
});
