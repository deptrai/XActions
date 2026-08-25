// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';

describe('Story 13.3 — FacebookClient Contract & Hybrid GraphQL Engine', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];
  let proxyPool;
  let governor;
  let accountPool;

  beforeAll(async () => {
    proxyPool = new ProxyIpPool({
      proxies: ['http://127.0.0.1:8080', 'http://127.0.0.1:8081'],
    });
    governor = new AdaptiveRateGovernor({ proxyPool });
    accountPool = new AccountPool({ governor });

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
  });

  it('[P0] should build application/x-www-form-urlencoded GraphQL body with doc_id and variables (AC-2, AC-3)', () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    const tokens = {
      lsd: 'AVq_LsdToken123',
      jazoest: '2953',
      dtsg: 'DTSG_Token_456',
      spin_r: 1016839210,
      spin_t: 1787680000,
    };

    const bodyString = client.buildGraphQlBody('group_feed_doc_123', { groupId: '123456', count: 10 }, tokens);
    const parsed = new URLSearchParams(bodyString);

    expect(parsed.get('doc_id')).toBe('group_feed_doc_123');
    expect(parsed.get('lsd')).toBe('AVq_LsdToken123');
    expect(parsed.get('fb_dtsg')).toBe('DTSG_Token_456');
    expect(parsed.get('jazoest')).toBe('2953');
    expect(parsed.get('__spin_r')).toBe('1016839210');
    expect(JSON.parse(parsed.get('variables') || '{}')).toEqual({ groupId: '123456', count: 10 });
  });

  it('[P1] should execute GraphQL request and handle graceful doc_id rotation failure (AC-7)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    
    await expect(client.requestGraphQl('invalid_or_rotated_doc_id', { id: '1' }, {
      accountId: 'acc_fb_1',
      cookies: 'c_user=10001; xs=sec_xs_123',
    })).rejects.toThrow(PlatformError);
  });
});
