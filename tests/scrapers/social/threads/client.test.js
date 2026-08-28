// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { ThreadsClient } from '../../../../src/scrapers/social/threads/client.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../../src/core/error-envelope.js';

describe('Story 15.1 — ThreadsClient Contract & Hybrid GraphQL Engine', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];
  let homePageHits = 0;

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

        // 1. Landing/profile HTML with security tokens
        if (req.url === '/@instagram' || req.url === '/' || req.url === '') {
          homePageHits++;
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'set-cookie': 'csrftoken=csrf_threads_token_xyz; Path=/; Domain=.threads.net',
          });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Threads</title></head>
              <body>
                <input type="hidden" name="lsd" value="AVq_LsdTokenThreads123" />
                <script>
                  ["DTSGInitialData",[],{"token":"DTSG_Threads_456"}];
                  window.__spin_r = 1016839210;
                  window.__spin_t = 1787680000;
                </script>
              </body>
            </html>
          `);
          return;
        }

        // 2. GraphQL Endpoint
        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');

          if (docId === 'invalid_or_rotated_doc_id') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              errors: [{ message: 'GraphQL query execution failed: Invalid doc_id', code: 1675004 }],
            }));
            return;
          }

          if (docId === 'rate_limited_doc_id') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              errors: [{ message: 'Action temporarily blocked', code: 368 }],
            }));
            return;
          }

          if (docId === 'user_feed_doc_123') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                mediaData: {
                  threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            id: '3123456789012345678',
                            pk: '3123456789012345678',
                            code: 'CxY123abc',
                            caption: { text: 'Hello from Threads in Vietnam!' },
                            user: {
                              id: '12345678',
                              pk: '12345678',
                              username: 'vietnam_dev',
                              profile_pic_url: 'https://cdn.threads.net/avatar.jpg',
                            },
                            like_count: 150,
                            text_post_app_info: {
                              direct_reply_count: 25,
                              is_reply: false,
                            },
                            taken_at: 1787680000,
                            media_type: 1,
                            image_versions2: {
                              candidates: [
                                { url: 'https://cdn.threads.net/img_large.jpg', width: 1080, height: 1080 },
                                { url: 'https://cdn.threads.net/img_small.jpg', width: 320, height: 320 },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  ],
                  page_info: {
                    has_next_page: true,
                    end_cursor: 'cursor_threads_next_123',
                  },
                },
              },
            }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: { success: true } }));
          return;
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
        resolve(null);
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('[P0] should extend AbstractApiClient with client="got", requiresAuth=true, platform="threads" (AC-1)', () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(client.name).toBe('threads');
    expect(client.platform).toBe('threads');
    expect(client.requiresAuth).toBe(true);
    expect(client.client).toBe('got');
    expect(client.baseUrl).toBe(serverUrl);
  });

  it('[P0] should extract security tokens (lsd, csrftoken, dtsg) during ensureLsd (AC-1)', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    const initialHits = homePageHits;

    const tokens = await client.ensureLsd('threads-guest');
    expect(tokens).toBeDefined();
    expect(tokens.lsd).toBe('AVq_LsdTokenThreads123');
    expect(tokens.dtsg).toBe('DTSG_Threads_456');
    expect(homePageHits).toBe(initialHits + 1);

    // Second call should hit the in-memory cache without an additional network request
    const cachedTokens = await client.ensureLsd('threads-guest');
    expect(cachedTokens.lsd).toBe('AVq_LsdTokenThreads123');
    expect(homePageHits).toBe(initialHits + 1);
  });

  it('[P1] should deduplicate concurrent in-flight token fetches for the same account (AC-1)', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    client.clearTokenCache();
    const initialHits = homePageHits;

    const [t1, t2] = await Promise.all([
      client.ensureLsd('dedup-account'),
      client.ensureLsd('dedup-account'),
    ]);

    expect(t1.lsd).toBe('AVq_LsdTokenThreads123');
    expect(t2.lsd).toBe('AVq_LsdTokenThreads123');
    expect(homePageHits).toBe(initialHits + 1);
  });

  it('[P0] should build application/x-www-form-urlencoded GraphQL body with doc_id, lsd, and variables (AC-1, AC-2)', () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    const tokens = {
      lsd: 'AVq_LsdTokenThreads123',
      csrftoken: 'csrf_123',
      dtsg: 'DTSG_Threads_456',
    };

    const bodyString = client.buildGraphQlBody('user_feed_doc_123', { userID: '123456', first: 20 }, tokens);
    const parsed = new URLSearchParams(bodyString);

    expect(parsed.get('doc_id')).toBe('user_feed_doc_123');
    expect(parsed.get('lsd')).toBe('AVq_LsdTokenThreads123');
    expect(parsed.get('fb_dtsg')).toBe('DTSG_Threads_456');
    expect(JSON.parse(parsed.get('variables') || '{}')).toEqual({ userID: '123456', first: 20 });
  });

  it('[P0] should dispatch GraphQL request with required headers and parse response (AC-2)', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    const res = await client.requestGraphQl('user_feed_doc_123', { userID: '123456' }, { accountId: 'threads-guest' });

    expect(res).toBeDefined();
    expect(res.data?.mediaData?.threads).toHaveLength(1);
    expect(res.data?.mediaData?.threads[0].thread_items[0].post.pk).toBe('3123456789012345678');
  });

  it('[P1] should execute GraphQL request and handle graceful doc_id rotation failure as XACT_5000 (AC-2)', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });

    await expect(client.requestGraphQl('invalid_or_rotated_doc_id', { id: '1' }, {
      accountId: 'threads-guest',
    })).rejects.toMatchObject({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      platform: 'threads',
    });
  });

  it('[P1] should classify rate limited response as XACT_4290 (RATE_LIMIT) (AC-8)', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });

    await expect(client.requestGraphQl('rate_limited_doc_id', { id: '1' }, {
      accountId: 'threads-guest',
    })).rejects.toMatchObject({
      code: 'XACT_4290',
      type: ErrorTypes.RATE_LIMIT,
      suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
    });
  });
});
