// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { ThreadsClient } from '../../../../src/scrapers/social/threads/client.js';
import { ThreadsPlatformResponseValidator } from '../../../../src/scrapers/social/threads/validator.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../../src/core/error-envelope.js';

describe('Story 15.1 — ThreadsClient Contract & Meta GraphQL Engine', () => {
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

        // 1. Mock Threads HTML Landing / Profile Page with LSD / CSRF Tokens
        if (req.url === '/' || req.url?.startsWith('/@')) {
          homePageHits++;
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'set-cookie': 'csrftoken=mock_csrf_threads_123; Path=/; Domain=.threads.net; Secure',
          });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Threads</title></head>
              <body>
                <input type="hidden" name="lsd" value="AVq_ThreadsLsdToken" />
                <script>
                  requireLazy(["DTSGInitialData"], function(d) { d.token = "THREATS_DTSG_999"; });
                  window.__spin_r = 1016839210;
                  window.__spin_t = 1787680000;
                  window.__hsi = "739281928371928";
                  window.__user_id = "5432109876";
                </script>
              </body>
            </html>
          `);
          return;
        }

        // 2. Mock Threads GraphQL Endpoint
        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');

          if (docId === 'invalid_or_rotated_threads_doc_id') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              errors: [{ message: 'GraphQL query execution failed: Invalid doc_id', code: 1675004 }],
            }));
            return;
          }

          if (docId === 'expired_threads_session_doc_id') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              errors: [{ message: 'Session expired or checkpointed', code: 190 }],
            }));
            return;
          }

          if (docId === '6232751443445612') {
            // Profile Feed Query
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                mediaData: {
                  threads: [
                    {
                      thread_items: [
                        {
                          post: {
                            id: '3456789012345',
                            pk: '3456789012345',
                            code: 'C_thread_post_code',
                            taken_at: 1787680000,
                            caption: { text: 'Viral Threads Post in Saigon!' },
                            like_count: 350,
                            comment_count: 42,
                            media_repost_count: 18,
                            user: {
                              pk: '5432109876',
                              id: '5432109876',
                              username: 'vietnam_trendsetter',
                              profile_pic_url: 'https://cdn.threads.net/avatar.jpg',
                            },
                            image_versions2: {
                              candidates: [{ url: 'https://cdn.threads.net/image_large.jpg' }],
                            },
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

  it('[P0] should extend AbstractApiClient with client="got", requiresAuth=true, platform="threads" (AC-1)', () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(client.name).toBe('threads');
    expect(client.platform).toBe('threads');
    expect(client.requiresAuth).toBe(true);
    expect(client.client).toBe('got');
  });

  it('[P0] should extract security tokens (lsd, csrftoken, fb_dtsg) via ensureLsd() with TTL and in-flight deduplication (AC-1)', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    const hitsBefore = homePageHits;

    const [t1, t2] = await Promise.all([
      client.ensureLsd('threads-guest'),
      client.ensureLsd('threads-guest'),
    ]);

    expect(t1).toBeDefined();
    expect(t1.lsd).toBe('AVq_ThreadsLsdToken');
    expect(t1).toEqual(t2);
    expect(homePageHits - hitsBefore).toBe(1); // deduplicated
  });

  it('[P0] should build application/x-www-form-urlencoded GraphQL body and headers with x-ig-app-id (AC-1, AC-2)', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    const tokens = {
      lsd: 'AVq_ThreadsLsdToken',
      csrftoken: 'mock_csrf_threads_123',
      fb_dtsg: 'THREATS_DTSG_999',
    };

    const bodyString = client.buildGraphQlBody('6232751443445612', { userID: '5432109876' }, tokens);
    const parsed = new URLSearchParams(bodyString);

    expect(parsed.get('doc_id')).toBe('6232751443445612');
    expect(parsed.get('lsd')).toBe('AVq_ThreadsLsdToken');
    expect(JSON.parse(parsed.get('variables') || '{}')).toEqual({ userID: '5432109876' });
  });

  it('[P1] should execute GraphQL request and handle graceful doc_id rotation failure as XACT_5000 (AC-2, AC-8)', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    
    await expect(client.requestGraphQl('invalid_or_rotated_threads_doc_id', { id: '1' }, {
      accountId: 'threads-guest',
    })).rejects.toMatchObject({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
    });
  });

  it('[P1] should validate Threads platform responses and detect bot challenges and rate limits via ThreadsPlatformResponseValidator (AC-8)', () => {
    const validator = new ThreadsPlatformResponseValidator();
    expect(validator.platform).toBe('threads');
    expect(validator.isValidPayload({ data: { mediaData: { threads: [] } } })).toBe(true);
    expect(validator.isBotChallenge({ status: 403 })).toBe(true);
    expect(validator.isRateLimit({ status: 429 })).toBe(true);
  });
});
