// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../../src/core/error-envelope.js';
import { PreSignedTokenRing } from '../../../../src/core/signer-pool.js';

describe('Story 13.3 — FacebookClient Contract & Hybrid GraphQL Engine', () => {
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

        // 1. Mock Facebook Home Page HTML with Security Tokens
        if (req.url === '/' || req.url === '') {
          homePageHits++;
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'set-cookie': 'datr=test_datr_12345; Path=/; Domain=.facebook.com; HttpOnly',
          });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>Facebook</title></head>
              <body>
                <input type="hidden" name="jazoest" value="2953" />
                <input type="hidden" name="lsd" value="AVq_LsdToken123" />
                <script>
                  requireLazy(["DTSGInitialData"], function(d) { d.token = "DTSG_Token_456"; });
                  window.__spin_r = 1016839210;
                  window.__spin_t = 1787680000;
                  window.__hsi = "739281928371928";
                  window.Env = { USER_ID : "10001", actor_id : 10001 };
                </script>
              </body>
            </html>
          `);
          return;
        }

        // 2. Mock Facebook GraphQL Endpoint
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

          if (docId === 'expired_session_doc_id') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              errors: [{ message: 'Error validating access token: Session has expired', code: 190 }],
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

          if (docId === 'group_feed_doc_123') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              data: {
                group: {
                  id: '123456',
                  feed: {
                    edges: [
                      {
                        node: {
                          id: 'post_1001',
                          creation_time: 1787680000,
                          message: { text: 'Hello Vietnam Developer Community!' },
                          actors: [{ id: 'user_999', name: 'John Doe' }],
                          feedback: {
                            reaction_count: { count: 42 },
                            comment_count: { total_count: 10 },
                            share_count: { count: 5 },
                          },
                          attachments: [{ media: { image: { uri: 'https://cdn.fb.com/pic1.jpg' } } }],
                        },
                      },
                    ],
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

  it('[P0] should extend AbstractApiClient with client="got", requiresAuth=true, platform="facebook" (AC-2)', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(client.name).toBe('facebook');
    expect(client.platform).toBe('facebook');
    expect(client.requiresAuth).toBe(true);
    expect(client.client).toBe('got');
  });

  it('[P0] should extract security tokens (lsd, fb_dtsg, jazoest, spin) during warmup/token fetch (AC-5)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const tokens = await client.ensureTokens('acc_fb_1', 'c_user=10001; xs=sec_xs_123');

    expect(tokens).toBeDefined();
    expect(tokens.lsd).toBe('AVq_LsdToken123');
    expect(tokens.jazoest).toBe('2953');
    expect(tokens.dtsg).toBe('DTSG_Token_456');
    expect(tokens.spin_r).toBe(1016839210);
    expect(tokens.c_user).toBe('10001');
  });

  it('[P1] should extract c_user from spaced/unquoted USER_ID or actor_id when no c_user cookie is present', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const tokens = await client.ensureTokens('acc_fb_no_cookie', '');

    expect(tokens.c_user).toBe('10001');
    expect(tokens.lsd).toBe('AVq_LsdToken123');
    expect(tokens.dtsg).toBe('DTSG_Token_456');
  });

  it('[P1] should deduplicate concurrent in-flight token fetches for the same account', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const hitsBefore = homePageHits;

    const [t1, t2, t3] = await Promise.all([
      client.ensureTokens('acc_dedup_test', { c_user: '888', xs: 'secret' }),
      client.ensureTokens('acc_dedup_test', { c_user: '888', xs: 'secret' }),
      client.ensureTokens('acc_dedup_test', { c_user: '888', xs: 'secret' }),
    ]);

    expect(t1).toEqual(t2);
    expect(t2).toEqual(t3);
    expect(homePageHits - hitsBefore).toBe(1); // Only 1 HTTP request made despite 3 concurrent calls
  });

  it('[P0] should build application/x-www-form-urlencoded GraphQL body with doc_id and variables (AC-2, AC-3)', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const tokens = {
      lsd: 'AVq_LsdToken123',
      jazoest: '2953',
      dtsg: 'DTSG_Token_456',
      spin_r: 1016839210,
      spin_t: 1787680000,
      c_user: '10001',
    };

    const bodyString = client.buildGraphQlBody('group_feed_doc_123', { groupId: '123456', count: 10 }, tokens, { accountId: '10001' });
    const parsed = new URLSearchParams(bodyString);

    expect(parsed.get('doc_id')).toBe('group_feed_doc_123');
    expect(parsed.get('lsd')).toBe('AVq_LsdToken123');
    expect(parsed.get('fb_dtsg')).toBe('DTSG_Token_456');
    expect(parsed.get('jazoest')).toBe('2953');
    expect(parsed.get('__spin_r')).toBe('1016839210');
    expect(parsed.get('__user')).toBe('10001');
    expect(JSON.parse(parsed.get('variables') || '{}')).toEqual({ groupId: '123456', count: 10 });
  });

  it('[P1] should classify session expired GraphQL error as XACT_4010 (AUTH_EXPIRED)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    
    await expect(client.requestGraphQl('expired_session_doc_id', { id: '1' }, {
      accountId: 'acc_fb_expired',
      cookies: 'c_user=10001; xs=expired',
    })).rejects.toMatchObject({
      code: 'XACT_4010',
      type: ErrorTypes.AUTH_EXPIRED,
      suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
    });
  });

  it('[P1] should classify rate limited GraphQL error as XACT_4290 (RATE_LIMIT)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    
    await expect(client.requestGraphQl('rate_limited_doc_id', { id: '1' }, {
      accountId: 'acc_fb_rl',
      cookies: 'c_user=10001; xs=limited',
    })).rejects.toMatchObject({
      code: 'XACT_4290',
      type: ErrorTypes.RATE_LIMIT,
      suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
    });
  });

  it('[P1] should execute GraphQL request and handle graceful doc_id rotation failure as XACT_5000 (AC-7)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });

    await expect(client.requestGraphQl('invalid_or_rotated_doc_id', { id: '1' }, {
      accountId: 'acc_fb_1',
      cookies: { c_user: '10001', xs: 'sec_xs_123' },
    })).rejects.toMatchObject({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
    });
  });

  // ============================================================================
  // Story 13.4 — Browser-as-Signer additions
  // ============================================================================

  it('[P1] should refill tokenRing with the extracted lsd string after token extraction (AC-9)', async () => {
    const tokenRing = new PreSignedTokenRing();
    const client = new FacebookClient({ baseUrl: serverUrl, tokenRing });
    const tokens = await client.ensureTokens('acc_token_ring', 'c_user=10001; xs=sec_xs_123');

    expect(tokens.lsd).toBe('AVq_LsdToken123');
    expect(tokenRing.size).toBe(1);
    expect(tokenRing.next()).toBe('AVq_LsdToken123');
  });

  it('[P1] should refresh tokens before a short TTL expires (AC-8)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl, tokenTtlMs: 100 });
    const hitsBefore = homePageHits;

    await client.ensureTokens('acc_refresh_short_ttl', 'c_user=10001; xs=sec_xs_123');
    expect(homePageHits - hitsBefore).toBe(1);

    // Wait past the 100 ms TTL so the next call must refresh.
    await new Promise((resolve) => setTimeout(resolve, 250));

    await client.ensureTokens('acc_refresh_short_ttl', 'c_user=10001; xs=sec_xs_123');
    expect(homePageHits - hitsBefore).toBe(2);
  });

  it('[P1] should throw XACT_5030 with relogin when cdpUrl is unreachable and httpFallback is false (AC-7)', async () => {
    const client = new FacebookClient({
      baseUrl: serverUrl,
      cdpUrl: 'http://127.0.0.1:1',
      httpFallback: false,
    });

    await expect(client.ensureTokens('acc_cdp_unreachable', 'c_user=10001; xs=sec_xs_123')).rejects.toMatchObject({
      code: 'XACT_5030',
      suggestedAction: SuggestedActions.RELOGIN,
    });
  });

  // ============================================================================
  // Action-Level Granular Auth & Guest Mode tests (2026-08-27)
  // ============================================================================

  it('[P1] buildGraphQlBody supports guest mode when requiresAuth is false', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const bodyStr = client.buildGraphQlBody('marketplace_doc_1', { query: 'macbook' }, { lsd: 'guest_lsd_123' }, { requiresAuth: false });
    const params = new URLSearchParams(bodyStr);

    expect(params.get('__user')).toBe('0');
    expect(params.get('av')).toBe('0');
    expect(params.get('lsd')).toBe('guest_lsd_123');
    expect(params.get('doc_id')).toBe('marketplace_doc_1');
  });

  it('[P1] buildGraphQlBody throws XACT_4010 when requiresAuth is true and userId is missing', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    expect(() => {
      client.buildGraphQlBody('private_doc_1', {}, { lsd: 'lsd_123' }, { requiresAuth: true });
    }).toThrow(PlatformError);
  });

  it('[P1] requestGraphQl executes with accountId=null in guest mode without throwing XACT_4010', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const res = await client.requestGraphQl('group_feed_doc_123', { groupId: '123456', count: 10 }, {
      accountId: null,
      requiresAuth: false,
    });

    expect(res).toBeDefined();
    expect(res?.data?.group?.id).toBe('123456');

    const lastReq = receivedRequests[receivedRequests.length - 1];
    const parsed = new URLSearchParams(lastReq.body);
    expect(parsed.get('doc_id')).toBe('group_feed_doc_123');
    expect(parsed.get('__user')).toBe('0'); // guest mode forces USER_ID to 0
  });
});
