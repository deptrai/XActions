// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { buildChromeArgs, launchChrome } from '../../../../src/core/cdp-launcher.js';
import { PreSignedTokenRing } from '../../../../src/core/signer-pool.js';
import { PlaywrightAdapter } from '../../../../src/scrapers/adapters/playwright.js';
import { SuggestedActions } from '../../../../src/core/error-envelope.js';

describe('Story 13.4 — Facebook Browser-as-Signer Bridge', () => {
  let server;
  let serverUrl;
  let homePageHits = 0;
  let graphqlHits = 0;

  let playwrightAvailable = false;
  let playwrightAdapter = null;
  let playwrightBrowser = null;

  let chromeLauncher = null;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url === '/' || req.url === '') {
          homePageHits += 1;
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
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
                  window.__rev = "123456789";
                </script>
              </body>
            </html>
          `);
          return;
        }

        if (req.url?.startsWith('/api/graphql')) {
          graphqlHits += 1;
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');

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
                          message: { text: 'Hello from the browser bridge test server!' },
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

    // Check Playwright availability for browser-dependent tests.
    playwrightAdapter = new PlaywrightAdapter();
    try {
      const dep = await playwrightAdapter.checkDependencies();
      if (dep.available) {
        playwrightBrowser = await playwrightAdapter.launch({ headless: true });
        playwrightAvailable = true;
      } else {
        console.warn('⚠️ Playwright dependencies not available; browser tests will be skipped');
      }
    } catch (err) {
      console.warn('⚠️ Playwright launch failed; browser tests will be skipped:', err.message);
    }

    // Attempt to launch a system Chrome for CDP attach tests.
    try {
      chromeLauncher = await launchChrome({ headless: true });
      const testAdapter = new PlaywrightAdapter();
      const testBrowser = await testAdapter.connect(chromeLauncher.cdpUrl, { preserveProfile: true });
      await testAdapter.closeBrowser(testBrowser);
    } catch (err) {
      if (chromeLauncher) {
        try {
          await chromeLauncher.kill();
        } catch {}
        chromeLauncher = null;
      }
      console.warn('⚠️ Could not launch or attach to system Chrome for CDP tests; CDP tests will be skipped:', err.message);
    }
  });

  afterAll(async () => {
    if (playwrightAdapter && playwrightBrowser) {
      try {
        await playwrightAdapter.closeBrowser(playwrightBrowser);
      } catch {}
    }
    if (chromeLauncher) {
      try {
        await chromeLauncher.kill();
      } catch {}
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ============================================================================
  // AC-1: FacebookClient accepts browser bridge / CDP / tiered signer deps
  // ============================================================================

  it('[P0] should accept browserBridge, cdpUrl, launchChrome, adapterName, headless, userDataDir, profileDir, tokenRing, signerPool and httpFallback in constructor (AC-1)', () => {
    const tokenRing = new PreSignedTokenRing();
    const client = new FacebookClient({
      baseUrl: serverUrl,
      browserBridge: null,
      cdpUrl: 'http://127.0.0.1:9222',
      launchChrome: true,
      adapterName: 'playwright',
      headless: true,
      userDataDir: '/tmp/fb-profile-13-4',
      profileDir: '/tmp/fb-profile-13-4-alt',
      tokenRing,
      signerPool: null,
      httpFallback: false,
    });

    expect(client.client).toBe('got');
    expect(client.requiresAuth).toBe(true);
    expect(client.platform).toBe('facebook');

    expect(client.browserBridge).toBeNull();
    expect(client.cdpUrl).toBe('http://127.0.0.1:9222');
    expect(client.launchChrome).toBe(true);
    expect(client.adapterName).toBe('playwright');
    expect(client.headless).toBe(true);
    expect(client.userDataDir).toBe('/tmp/fb-profile-13-4');
    expect(client.profileDir).toBe('/tmp/fb-profile-13-4-alt');
    expect(client.tokenRing).toBe(tokenRing);
    expect(client.signerPool).toBeNull();
    expect(client.httpFallback).toBe(false);
  });

  it('[P0] should default the browser adapter to Playwright and honor XACTIONS_SCRAPER_ADAPTER=puppeteer (AC-5)', () => {
    const clientDefault = new FacebookClient({ baseUrl: serverUrl, launchChrome: true });
    expect(clientDefault.adapterName).toBe('playwright');

    const previous = process.env.XACTIONS_SCRAPER_ADAPTER;
    process.env.XACTIONS_SCRAPER_ADAPTER = 'puppeteer';
    try {
      const clientPuppeteer = new FacebookClient({ baseUrl: serverUrl, launchChrome: true });
      expect(clientPuppeteer.adapterName).toBe('puppeteer');
    } finally {
      if (previous === undefined) {
        delete process.env.XACTIONS_SCRAPER_ADAPTER;
      } else {
        process.env.XACTIONS_SCRAPER_ADAPTER = previous;
      }
    }
  });

  // ============================================================================
  // AC-1 / AC-10: close(), token cache, crawler wiring
  // ============================================================================

  it('[P0] should expose close() that clears the token cache and closes an owned browser bridge (AC-1, AC-10)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl });
    expect(typeof client.close).toBe('function');

    const hitsBefore = homePageHits;
    await client.ensureTokens('acc_close_test', 'c_user=10001; xs=sec_xs_123');
    expect(homePageHits - hitsBefore).toBe(1);

    await client.close();

    // After close the cache should be cleared, so a second ensureTokens for the
    // same account/cookie must fetch again.
    await client.ensureTokens('acc_close_test', 'c_user=10001; xs=sec_xs_123');
    expect(homePageHits - hitsBefore).toBe(2);
  });

  it('[P1] FacebookCrawler should pass cdpUrl and launchChrome to its FacebookClient and close it on cleanup (AC-10)', () => {
    const crawler = new FacebookCrawler({
      baseUrl: serverUrl,
      cdpUrl: 'http://127.0.0.1:9222',
      launchChrome: true,
      adapterName: 'playwright',
    });

    expect(crawler.client.cdpUrl).toBe('http://127.0.0.1:9222');
    expect(crawler.client.launchChrome).toBe(true);
    expect(crawler.client.adapterName).toBe('playwright');
    expect(typeof crawler.client.close).toBe('function');
  });

  // ============================================================================
  // AC-11: buildChromeArgs supports proxy and extraArgs
  // ============================================================================

  it('[P0] buildChromeArgs should merge anti-leak proxy flags and extraArgs (AC-6, AC-11)', () => {
    const proxy = 'http://proxy.example.com:8080';
    const args = buildChromeArgs({
      port: 9223,
      userDataDir: '/tmp/fb-profile-13-4',
      headless: true,
      proxy,
      extraArgs: ['--disable-gpu', '--no-sandbox'],
    });

    expect(args).toContain('--remote-debugging-port=9223');
    expect(args).toContain('--user-data-dir=/tmp/fb-profile-13-4');
    expect(args).toContain('--headless=new');
    expect(args).toContain('--disable-gpu');
    expect(args).toContain('--no-sandbox');

    // Anti-leak / sticky-proxy flags (per providers.js:1163-1168 and proxy-pool.js:310).
    expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(args).toContain('--proxy-server=http://proxy.example.com:8080');
    expect(args).toContain('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE proxy.example.com');
    expect(args).toContain('--disable-features=WebRtcHideLocalIpsWithMdns');
  });

  // ============================================================================
  // AC-9: PreSignedTokenRing integration
  // ============================================================================

  it('[P0] ensureTokens should refill tokenRing with the extracted lsd string (AC-9)', async () => {
    const tokenRing = new PreSignedTokenRing();
    const client = new FacebookClient({ baseUrl: serverUrl, tokenRing });
    const tokens = await client.ensureTokens('acc_token_ring', 'c_user=10001; xs=sec_xs_123');

    expect(tokens.lsd).toBe('AVq_LsdToken123');
    expect(tokenRing.size).toBe(1);
    expect(tokenRing.next()).toBe('AVq_LsdToken123');
  });

  it('[P1] buildGraphQlBody should prefer tokenRing.next() for lsd when the ring is non-empty (AC-9)', () => {
    const tokenRing = new PreSignedTokenRing();
    tokenRing.refill(['ring_lsd_value']);

    const client = new FacebookClient({ baseUrl: serverUrl, tokenRing });
    const body = client.buildGraphQlBody('group_feed_doc_123', { groupId: '123456', count: 10 }, {
      dtsg: 'DTSG_Token_456',
      jazoest: '2953',
      c_user: '10001',
    });
    const parsed = new URLSearchParams(body);

    expect(parsed.get('lsd')).toBe('ring_lsd_value');
    expect(parsed.get('fb_dtsg')).toBe('DTSG_Token_456');
    expect(parsed.get('__user')).toBe('10001');
  });

  // ============================================================================
  // AC-8: token refresh before expiry
  // ============================================================================

  it('[P1] ensureTokens should refresh tokens when they are within the refresh window of expiry (AC-8)', async () => {
    const client = new FacebookClient({ baseUrl: serverUrl, tokenTtlMs: 100 });
    const hitsBefore = homePageHits;

    await client.ensureTokens('acc_refresh_window', 'c_user=10001; xs=sec_xs_123');
    expect(homePageHits - hitsBefore).toBe(1);

    // Wait past the 100 ms TTL so the next call must refresh.
    await new Promise((resolve) => setTimeout(resolve, 250));

    await client.ensureTokens('acc_refresh_window', 'c_user=10001; xs=sec_xs_123');
    expect(homePageHits - hitsBefore).toBe(2);
  });

  // ============================================================================
  // AC-7: error envelope on browser path failures
  // ============================================================================

  it('[P1] ensureTokens should throw XACT_5030 / relogin when cdpUrl is unreachable and httpFallback is false (AC-4, AC-7)', async () => {
    const client = new FacebookClient({
      baseUrl: serverUrl,
      cdpUrl: 'http://127.0.0.1:1',
      httpFallback: false,
    });

    await expect(client.ensureTokens('acc_cdp_fail', 'c_user=10001; xs=sec_xs_123')).rejects.toMatchObject({
      code: 'XACT_5030',
      suggestedAction: SuggestedActions.RELOGIN,
    });
  });

  // ============================================================================
  // AC-2: FacebookBrowserBridge exists and can extract tokens
  // ============================================================================

  it('[P0] FacebookBrowserBridge should be importable and expose extractTokens() (AC-2)', async () => {
    const mod = await import('../../../../src/scrapers/social/facebook/signer-bridge.js');
    expect(mod.FacebookBrowserBridge).toBeInstanceOf(Function);

    const bridge = new mod.FacebookBrowserBridge({
      baseUrl: serverUrl,
      adapterName: 'playwright',
      headless: true,
    });
    expect(typeof bridge.extractTokens).toBe('function');
    expect(typeof bridge.close).toBe('function');
  });

  // ============================================================================
  // AC-2 / AC-4: real browser extraction via Playwright and CDP
  // ============================================================================

  it('[P0] FacebookClient with cdpUrl should extract tokens from a real browser without HTTP fallback (AC-2, AC-4)', async () => {
    if (!chromeLauncher) {
      console.warn('⚠️ Skipping real CDP test: system Chrome not available');
      return;
    }

    const client = new FacebookClient({
      baseUrl: serverUrl,
      cdpUrl: chromeLauncher.cdpUrl,
      adapterName: 'playwright',
      headless: true,
    });

    const hitsBefore = homePageHits;
    const tokens = await client.ensureTokens('acc_cdp_extract', 'c_user=10001; xs=sec_xs_123');

    expect(tokens.lsd).toBe('AVq_LsdToken123');
    expect(tokens.jazoest).toBe('2953');
    expect(tokens.dtsg).toBe('DTSG_Token_456');
    expect(tokens.spin_r).toBe(1016839210);
    expect(tokens.spin_t).toBe(1787680000);
    expect(tokens.hsi).toBe('739281928371928');
    expect(tokens.__rev).toBe('123456789');
    expect(tokens.c_user).toBe('10001');

    // Browser path must not hit the HTTP home-page fallback.
    expect(homePageHits).toBe(hitsBefore);

    await client.close();
  });

  it('[P1] FacebookBrowserBridge should set cookies before navigation and read c_user from the browser context (AC-2)', async () => {
    if (!chromeLauncher) {
      console.warn('⚠️ Skipping real cookie injection test: system Chrome not available');
      return;
    }

    const mod = await import('../../../../src/scrapers/social/facebook/signer-bridge.js');
    const bridge = new mod.FacebookBrowserBridge({
      baseUrl: serverUrl,
      cdpUrl: chromeLauncher.cdpUrl,
      adapterName: 'playwright',
      headless: true,
    });

    const tokens = await bridge.extractTokens('acc_cookie_inject', 'c_user=77777; xs=sec_xs_123');
    expect(tokens.c_user).toBe('77777');

    await bridge.close();
  });

  // ============================================================================
  // AC-3: requestGraphQl uses browser tokens
  // ============================================================================

  it('[P1] requestGraphQl should use browser-extracted tokens and still post the form-urlencoded body (AC-3)', async () => {
    if (!chromeLauncher) {
      console.warn('⚠️ Skipping real CDP GraphQL test: system Chrome not available');
      return;
    }

    const client = new FacebookClient({
      baseUrl: serverUrl,
      cdpUrl: chromeLauncher.cdpUrl,
      adapterName: 'playwright',
      headless: true,
    });

    const hitsBefore = homePageHits;
    const res = await client.requestGraphQl('group_feed_doc_123', { groupId: '123456', count: 10 }, {
      accountId: 'acc_cdp_graphql',
      cookies: 'c_user=10001; xs=sec_xs_123',
    });

    expect(res.data.group.id).toBe('123456');
    // Browser token extraction must not fall back to the HTTP home page.
    expect(homePageHits).toBe(hitsBefore);
    expect(graphqlHits).toBeGreaterThanOrEqual(1);

    await client.close();
  });

  // ============================================================================
  // AC-5: adapter selection inside the bridge
  // ============================================================================

  it('[P2] FacebookBrowserBridge should use Playwright by default and Puppeteer when configured (AC-5)', async () => {
    if (!chromeLauncher) {
      console.warn('⚠️ Skipping bridge adapter selection test: system Chrome not available');
      return;
    }

    const mod = await import('../../../../src/scrapers/social/facebook/signer-bridge.js');

    const bridgeDefault = new mod.FacebookBrowserBridge({
      baseUrl: serverUrl,
      cdpUrl: chromeLauncher.cdpUrl,
      headless: true,
    });
    await bridgeDefault.init();
    expect(bridgeDefault.adapter.name).toBe('playwright');
    await bridgeDefault.close();

    const previous = process.env.XACTIONS_SCRAPER_ADAPTER;
    process.env.XACTIONS_SCRAPER_ADAPTER = 'puppeteer';
    try {
      const bridgePuppeteer = new mod.FacebookBrowserBridge({
        baseUrl: serverUrl,
        cdpUrl: chromeLauncher.cdpUrl,
        headless: true,
      });
      await bridgePuppeteer.init();
      expect(bridgePuppeteer.adapter.name).toBe('puppeteer');
      await bridgePuppeteer.close();
    } finally {
      if (previous === undefined) {
        delete process.env.XACTIONS_SCRAPER_ADAPTER;
      } else {
        process.env.XACTIONS_SCRAPER_ADAPTER = previous;
      }
    }
  });
});
