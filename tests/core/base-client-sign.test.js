// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { PreSignedTokenRing, SignerWorkerPagePool } from '../../src/core/signer-pool.js';

class TestApiClient extends AbstractApiClient {
  constructor(options = {}) {
    super({ platform: 'test-platform', ...options });
  }
}

describe('Story 13.1 — AbstractApiClient.requestWithSign Integration (AC-3, AC-4, AC-5, AC-6)', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  beforeEach(async () => {
    receivedRequests = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, url: req.url }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('[P0] should inject token from PreSignedTokenRing into headers when signType is token (AC-3)', async () => {
    const ring = new PreSignedTokenRing();
    ring.refill(['bearer_token_xyz']);

    const client = new TestApiClient({ tokenRing: ring });

    const res = await client.requestWithSign('GET', `${serverUrl}/api/test`, {
      signType: 'token',
      location: 'header',
      name: 'authorization',
      prefix: 'Bearer ',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].headers['authorization']).toBe('Bearer bearer_token_xyz');
  });

  it('[P0] should inject token from PreSignedTokenRing into query parameters (AC-3)', async () => {
    const ring = new PreSignedTokenRing();
    ring.refill(['token_query_123']);

    const client = new TestApiClient({ tokenRing: ring });

    const res = await client.requestWithSign('GET', `${serverUrl}/api/test`, {
      signType: 'token',
      location: 'query',
      name: 'token',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].url).toContain('token=token_query_123');
  });

  it('[P1] should inject token from PreSignedTokenRing into cookies and sync client.cookies (AC-6)', async () => {
    const ring = new PreSignedTokenRing();
    ring.refill(['cookie_dtsg_val']);

    const client = new TestApiClient({ tokenRing: ring });

    const res = await client.requestWithSign('POST', `${serverUrl}/api/test`, {
      signType: 'token',
      location: 'cookie',
      name: 'fb_dtsg',
    });

    expect(res.status).toBe(200);
    expect(client.cookies['fb_dtsg']).toBe('cookie_dtsg_val');
    expect(receivedRequests[0].headers['cookie']).toContain('fb_dtsg=cookie_dtsg_val');
  });

  it('[P0] should dispatch to SignerWorkerPagePool when signType is page (AC-3)', async () => {
    const mockPagePool = {
      evaluate: vi.fn(async () => ({
        headers: { 'x-client-transaction-id': 'signed_tx_999' },
        query: { sig: 'dyn_sig_456' },
      })),
    };

    const client = new TestApiClient({ signerPool: mockPagePool });

    const res = await client.requestWithSign('POST', `${serverUrl}/api/graphql`, {
      signType: 'page',
      script: '() => ({ headers: { "x-client-transaction-id": "signed_tx_999" }, query: { sig: "dyn_sig_456" } })',
      args: ['queryId_123'],
    });

    expect(res.status).toBe(200);
    expect(mockPagePool.evaluate).toHaveBeenCalled();
    expect(receivedRequests[0].headers['x-client-transaction-id']).toBe('signed_tx_999');
    expect(receivedRequests[0].url).toContain('sig=dyn_sig_456');
  });

  it('[P1] should fallback to this.sign() when no ring or pool is configured (AC-3)', async () => {
    class CustomSignClient extends TestApiClient {
      async sign(payload) {
        return {
          headers: { 'x-custom-sig': 'custom_signature_abc' },
        };
      }
    }

    const client = new CustomSignClient();
    const res = await client.requestWithSign('GET', `${serverUrl}/api/data`, {
      signType: 'custom',
    });

    expect(res.status).toBe(200);
    expect(receivedRequests[0].headers['x-custom-sig']).toBe('custom_signature_abc');
  });
});
