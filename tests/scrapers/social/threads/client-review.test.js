// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { ThreadsClient } from '../../../../src/scrapers/social/threads/client.js';
import { ThreadsPlatformResponseValidator } from '../../../../src/scrapers/social/threads/validator.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../../src/core/error-envelope.js';

describe('Story 15.1 — ThreadsClient review patches', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

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

        if (req.url === '/' || req.url?.startsWith('/@')) {
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

        if (req.url?.startsWith('/api/graphql')) {
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

  beforeEach(() => {
    receivedRequests = [];
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
});
