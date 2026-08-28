// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { ThreadsClient } from '../../../../src/scrapers/social/threads/client.js';
import { ThreadsPlatformResponseValidator } from '../../../../src/scrapers/social/threads/validator.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../../src/core/error-envelope.js';
import { getProxyAgent } from '../../../../src/proxy/providers.js';

describe('Story 15.1 — ThreadsClient review patches', () => {
  let server;
  let serverUrl;
  let noLsdServer;
  let noLsdServerUrl;
  let receivedRequests = [];
  let noLsdRequests = [];
  let transportRetryHits = 0;
  let proxyRotationHits = 0;

  /**
   * @param {string} url
   * @returns {string}
   */
  const normalizePath = (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    }
    return url;
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const urlPath = normalizePath(req.url);
        receivedRequests.push({
          method: req.method,
          url: urlPath,
          headers: req.headers,
          body,
        });

        if (urlPath === '/' || urlPath?.startsWith('/@')) {
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'set-cookie': 'csrftoken=mock_csrf_threads; Path=/; Domain=.threads.net; Secure',
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

        if (urlPath?.startsWith('/api/graphql')) {
          const params = new URLSearchParams(body);
          const docId = params.get('doc_id');

          if (docId === 'auth_error_doc') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              errors: [{ message: 'Login required', code: 1357001 }],
            }));
            return;
          }

          if (docId === 'doc_rotation_doc') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              errors: [{ message: 'Invalid doc_id', code: 1675004 }],
            }));
            return;
          }

          if (docId === 'html_challenge_doc') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end('<!DOCTYPE html><html><body><h1>verify your account</h1><p>Please log in to continue.</p></body></html>');
            return;
          }

          if (docId === 'transport_retry_doc') {
            transportRetryHits++;
            if (transportRetryHits <= 2) {
              res.writeHead(503, { 'content-type': 'text/plain' });
              res.end('Service Unavailable');
              return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data: { success: true, doc_id: 'transport_retry_doc' } }));
            return;
          }

          if (docId === 'proxy_rotation_doc') {
            proxyRotationHits++;
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data: { success: true, doc_id: 'proxy_rotation_doc', hit: proxyRotationHits } }));
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

    noLsdServer = http.createServer((req, res) => {
      noLsdRequests.push({
        method: req.method,
        url: normalizePath(req.url),
        headers: req.headers,
      });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <body>
            <div data-pressable-container="true"></div>
            <script>window.__user_id = "123456";</script>
          </body>
        </html>
      `);
    });

    await new Promise((resolve) => {
      noLsdServer.listen(0, '127.0.0.1', () => {
        const addr = noLsdServer.address();
        noLsdServerUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (noLsdServer) {
      await new Promise((resolve) => noLsdServer.close(resolve));
    }
  });

  beforeEach(() => {
    receivedRequests = [];
    noLsdRequests = [];
    transportRetryHits = 0;
    proxyRotationHits = 0;
  });

  it('[P1] should honor deps.client and not hard-code got', () => {
    const gotClient = new ThreadsClient({ baseUrl: serverUrl });
    expect(gotClient.client).toBe('got');

    const undiciClient = new ThreadsClient({ baseUrl: serverUrl, client: 'undici' });
    expect(undiciClient.client).toBe('undici');
  });

  it('[P1] should include fb_dtsg in GraphQL body', () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    const tokens = { lsd: 'lsd_value', fb_dtsg: 'dtsg_value' };
    const body = client.buildGraphQlBody('doc_id_123', { foo: 'bar' }, tokens);
    const parsed = new URLSearchParams(body);

    expect(parsed.get('doc_id')).toBe('doc_id_123');
    expect(parsed.get('lsd')).toBe('lsd_value');
    expect(parsed.get('fb_dtsg')).toBe('dtsg_value');
    expect(JSON.parse(parsed.get('variables') || '{}')).toEqual({ foo: 'bar' });
  });

  it('[P1] should send x-fb-dtsg and x-csrftoken headers', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });

    await client.requestGraphQl('header_check_doc', { id: '1' }, { accountId: 'headers-test' });

    const graphqlReq = receivedRequests.find((r) => r.url?.startsWith('/api/graphql') && r.body.includes('header_check_doc'));
    expect(graphqlReq).toBeDefined();
    expect(graphqlReq.headers['x-fb-dtsg']).toBe('THREATS_DTSG_999');
    expect(graphqlReq.headers['x-csrftoken']).toBe('mock_csrf_threads');
  });

  it('[P1] should not override explicit Cookie header with rawCookies', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });

    await client.requestGraphQl(
      'header_check_doc',
      { id: '1' },
      { accountId: 'cookie-dedup-test', headers: { Cookie: 'a=1' }, cookies: 'b=2' },
    );

    const graphqlReq = receivedRequests.find((r) => r.url?.startsWith('/api/graphql') && r.body.includes('header_check_doc'));
    expect(graphqlReq).toBeDefined();
    expect(graphqlReq.headers['cookie']).toBe('a=1');
  });

  it('[P1] should re-fetch tokens when cookies change (cache key is cookie-aware)', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });

    const t1 = await client.ensureLsd('cookie-test', 'csrftoken=old');
    const t2 = await client.ensureLsd('cookie-test', 'csrftoken=new');

    expect(t1).toEqual(t2); // Server returns same tokens; keys differ but values same.
    const homeRequests = receivedRequests.filter((r) => r.url === '/');
    expect(homeRequests.length).toBe(2);
  });

  it('[P1] should clear token cache and map 1357001 to AUTH_EXPIRED', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });

    // Prime the cache.
    await client.ensureLsd('auth-test', '');

    await expect(client.requestGraphQl('auth_error_doc', { id: '1' }, { accountId: 'auth-test' })).rejects.toMatchObject({
      code: 'XACT_4010',
      type: ErrorTypes.AUTH_EXPIRED,
      suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
    });

    // Cache should have been cleared, so the next ensureLsd re-fetches the landing page.
    await client.ensureLsd('auth-test', '');
    const homeRequests = receivedRequests.filter((r) => r.url === '/');
    expect(homeRequests.length).toBe(2);
  });

  it('[P1] should classify HTML soft 200 pages as BotChallengeError', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });

    await expect(client.requestGraphQl('html_challenge_doc', { id: '1' }, { accountId: 'challenge-test' })).rejects.toMatchObject({
      code: 'XACT_4030',
      type: ErrorTypes.BOT_CHALLENGE,
      suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
    });
  });

  it('[P1] should keep 1675004 as XACT_5000 (not session-invalid)', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });

    await expect(client.requestGraphQl('doc_rotation_doc', { id: '1' }, { accountId: 'doc-rotation-test' })).rejects.toMatchObject({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
    });
  });

  it('[P1] validator should return false for data.success === false and unwrap nested data with cycle guard', () => {
    const validator = new ThreadsPlatformResponseValidator();

    expect(validator.isValidPayload({ data: { data: { data: { data: { success: false } } } } })).toBe(false);
    expect(validator.isValidPayload({ data: { data: { data: { data: { mediaData: { threads: [] } } } } } })).toBe(true);

    const cyclic = { data: {} };
    cyclic.data = cyclic;
    // No infinite loop, returns true/false gracefully.
    expect(() => validator.isValidPayload(cyclic)).not.toThrow();
  });

  it('[P1] validator should detect soft 200 challenge strings', () => {
    const validator = new ThreadsPlatformResponseValidator();

    expect(validator.isBotChallenge({ data: '<!DOCTYPE html><html><body>suspicious activity detected</body></html>' })).toBe(true);
    expect(validator.isBotChallenge({ data: '<!DOCTYPE html><html><body>unusual activity</body></html>' })).toBe(true);
    expect(validator.isBotChallenge({ data: '<!DOCTYPE html><html><body>verify your account</body></html>' })).toBe(true);
    expect(validator.isBotChallenge({ data: '<!DOCTYPE html><html><body>log in to continue</body></html>' })).toBe(true);
    expect(validator.isBotChallenge({ data: '<!DOCTYPE html><html><body>role="main" id="root"</body></html>' })).toBe(false);
  });

  it('[P1] should retry transport errors and eventually succeed', async () => {
    const client = new ThreadsClient({ baseUrl: serverUrl });
    client.backoffBaseMs = 10;
    client.maxBackoffMs = 50;

    const result = await client.requestGraphQl('transport_retry_doc', { id: '1' }, { accountId: 'transport-retry' });

    expect(result).toMatchObject({ data: { success: true, doc_id: 'transport_retry_doc' } });

    const graphqlReqs = receivedRequests.filter((r) => r.url?.startsWith('/api/graphql') && r.body.includes('transport_retry_doc'));
    expect(graphqlReqs.length).toBeGreaterThanOrEqual(3);
  });

  it('[P1] should rotate proxy and quarantine on transport error', async () => {
    const proxyCalls = [];
    const quarantined = [];

    const proxyProvider = {
      isAllQuarantined: () => false,
      getProxyAgent: (proxy, options) => getProxyAgent(proxy, options),
      getProxy: (opts = {}) => {
        proxyCalls.push(opts);
        if (opts.forceRotate) {
          return `http://127.0.0.1:${new URL(serverUrl).port}`;
        }
        return 'http://127.0.0.1:65535';
      },
      quarantine: (proxy, _duration) => {
        quarantined.push(proxy);
      },
      getNext: () => `http://127.0.0.1:${new URL(serverUrl).port}`,
    };

    const client = new ThreadsClient({
      baseUrl: 'http://127.0.0.1:65534',
      proxyProvider,
      timeout: 3000,
    });
    client.backoffBaseMs = 10;
    client.maxBackoffMs = 50;

    const result = await client.requestGraphQl('proxy_rotation_doc', { id: '1' }, { accountId: 'proxy-rotate' });

    expect(result).toMatchObject({ data: { success: true, doc_id: 'proxy_rotation_doc' } });
    expect(proxyCalls.some((opts) => opts.forceRotate === true)).toBe(true);
    expect(quarantined.length).toBeGreaterThanOrEqual(1);
    expect(quarantined[0]).toBe('http://127.0.0.1:65535');
  });

  it('[P1] should clear token cache on extraction failure and not cache empty tokens', async () => {
    const client = new ThreadsClient({ baseUrl: noLsdServerUrl, maxTokenFetchRetries: 1 });

    await expect(client.ensureLsd('bad-token', '')).rejects.toMatchObject({
      code: 'XACT_4010',
      type: ErrorTypes.AUTH_EXPIRED,
    });

    expect(noLsdRequests.length).toBeGreaterThanOrEqual(1);

    const previousCount = noLsdRequests.length;

    await expect(client.ensureLsd('bad-token', '')).rejects.toMatchObject({
      code: 'XACT_4010',
      type: ErrorTypes.AUTH_EXPIRED,
    });

    expect(noLsdRequests.length).toBeGreaterThan(previousCount);
  });
});
