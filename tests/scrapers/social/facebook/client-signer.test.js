// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookBrowserBridge } from '../../../../src/scrapers/social/facebook/signer-bridge.js';
import { PreSignedTokenRing } from '../../../../src/core/signer-pool.js';
import { buildChromeArgs } from '../../../../src/core/cdp-launcher.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';
import { PlaywrightAdapter } from '../../../../src/scrapers/adapters/playwright.js';

describe('Story 13.4 — Facebook Browser-as-Signer Integration (ATDD Red Phase)', () => {
  let server;
  let serverUrl;
  let proxyPool;

  beforeAll(async () => {
    proxyPool = new ProxyIpPool({
      proxies: ['http://127.0.0.1:8080'],
    });

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        // Facebook Landing Page HTML with live DOM tokens
        if (req.url === '/' || req.url === '') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Facebook - Log In or Sign Up</title>
              </head>
              <body>
                <input type="hidden" name="lsd" value="AVq_BrowserLsd999" />
                <input type="hidden" name="jazoest" value="2953" />
                <script>
                  window.__spin_r = 1016839210;
                  window.__spin_t = 1787680000;
                  window.__hsi = "7382910482910";
                  window.__rev = "1016839210";
                  const DTSGInitialData = { token: "NAc_BrowserDtsg888" };
                </script>
              </body>
            </html>
          `);
          return;
        }

        // GraphQL endpoint
        if (req.url?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              viewer: { actor: { id: '61590064244856' } },
              doc_id: docId,
              lsd: params.get('lsd'),
              fb_dtsg: params.get('fb_dtsg'),
            },
          }));
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

  it('[P0] should accept browser bridge and tiered signer dependencies in constructor (AC-1)', () => {
    const tokenRing = new PreSignedTokenRing({ capacity: 10 });
    const bridge = new FacebookBrowserBridge({ baseUrl: serverUrl });
    const client = new FacebookClient({
      baseUrl: serverUrl,
      tokenRing,
      browserBridge: bridge,
      cdpUrl: 'http://127.0.0.1:9222',
      launchChrome: true,
      adapterName: 'playwright',
      headless: true,
      userDataDir: '.data/facebook-profiles/test_user',
    });

    expect(client.browserBridge).toBe(bridge);
    expect(client.cdpUrl).toBe('http://127.0.0.1:9222');
    expect(client.launchChrome).toBe(true);
    expect(client.adapterName).toBe('playwright');
    expect(client.headless).toBe(true);
    expect(client.userDataDir).toBe('.data/facebook-profiles/test_user');
    expect(typeof client.close).toBe('function');
  });

  it('[P0] should extract Facebook tokens via FacebookBrowserBridge and evaluate live page context (AC-2)', async () => {
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter: new PlaywrightAdapter(),
    });

    const tokens = await bridge.extractTokens('fb_user_1', 'c_user=61590064244856; xs=mock_xs_123');

    expect(tokens).toBeDefined();
    expect(tokens.lsd).toBe('AVq_BrowserLsd999');
    expect(tokens.jazoest).toBe('2953');
    expect(tokens.fb_dtsg).toBe('NAc_BrowserDtsg888');
    expect(tokens.spin_r).toBe(1016839210);
    expect(tokens.c_user).toBe('61590064244856');

    await bridge.close();
  });

  it('[P0] should dispatch requestGraphQl using tokens extracted by browser bridge (AC-3)', async () => {
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter: new PlaywrightAdapter(),
    });

    const client = new FacebookClient({
      baseUrl: serverUrl,
      browserBridge: bridge,
    });

    const res = await client.requestGraphQl('8877665544', { query: 'test' }, {
      accountId: '61590064244856',
      cookies: 'c_user=61590064244856; xs=mock_xs_123',
    });

    expect(res).toBeDefined();
    expect(res.data?.doc_id).toBe('8877665544');
    expect(res.data?.lsd).toBe('AVq_BrowserLsd999');
    expect(res.data?.fb_dtsg).toBe('NAc_BrowserDtsg888');

    await client.close();
  });

  it('[P0] should fallback to HTTP token extraction when browser bridge is unconfigured (AC-7)', async () => {
    const client = new FacebookClient({
      baseUrl: serverUrl,
      httpFallback: true,
    });

    const tokens = await client.ensureTokens('guest_user', '');
    expect(tokens).toBeDefined();
    expect(tokens.lsd).toBe('AVq_BrowserLsd999');
    expect(tokens.jazoest).toBe('2953');
    expect(tokens.fb_dtsg).toBe('NAc_BrowserDtsg888');

    await client.close();
  });

  it('[P0] should refill PreSignedTokenRing with lsd string and use tokenRing.next() in buildGraphQlBody (AC-9)', async () => {
    const tokenRing = new PreSignedTokenRing({ capacity: 5 });
    const bridge = new FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapter: new PlaywrightAdapter(),
    });

    const client = new FacebookClient({
      baseUrl: serverUrl,
      tokenRing,
      browserBridge: bridge,
    });

    const tokens = await client.ensureTokens('61590064244856', 'c_user=61590064244856; xs=mock_xs_123');
    expect(tokens.lsd).toBe('AVq_BrowserLsd999');

    // TokenRing should be refilled with lsd string
    expect(tokenRing.size).toBe(1);
    expect(tokenRing.next()).toBe('AVq_BrowserLsd999');

    const body = client.buildGraphQlBody('doc_123', { q: '1' }, tokens);
    expect(body).toContain('lsd=AVq_BrowserLsd999');

    await client.close();
  });

  it('[P1] should preserve FacebookCrawler actions and close browser bridge during cleanup() (AC-10)', async () => {
    const crawler = new FacebookCrawler({
      client: new FacebookClient({
        baseUrl: serverUrl,
        browserBridge: new FacebookBrowserBridge({ baseUrl: serverUrl }),
      }),
    });

    expect(crawler.name).toBe('facebook');
    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action || a.name);
    expect(actionNames).toContain('group_posts');
    expect(actionNames).toContain('page_posts');
    expect(actionNames).toContain('get_comments');

    await crawler.cleanup();
  });

  it('[P1] should build Chrome args with proxy and anti-leak options in cdp-launcher (AC-11)', () => {
    const args = buildChromeArgs({
      port: 9222,
      userDataDir: '.data/facebook-profiles/test_user',
      headless: true,
      proxy: {
        scheme: 'http',
        host: '127.0.0.1',
        port: 8080,
      },
    });

    expect(args).toContain('--remote-debugging-port=9222');
    expect(args).toContain('--user-data-dir=.data/facebook-profiles/test_user');
    expect(args).toContain('--headless=new');
    expect(args.some((a) => a.startsWith('--proxy-server='))).toBe(true);
    expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  });
});
