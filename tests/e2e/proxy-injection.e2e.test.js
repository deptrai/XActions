// tests/e2e/proxy-injection.e2e.test.js
// Story 35.4 — true end-to-end: real undici transport → real ProxyAgent →
// real local TCP proxy → real local HTTP target. No httpClient seam, no mocks.
// by nichxbt

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { RedditClient } from '../../src/scrapers/social/reddit/client.js';
import { MediumClient } from '../../src/scrapers/social/medium/client.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';

/**
 * Minimal real HTTP forward proxy. Handles both forms a forward proxy sees:
 * - CONNECT host:port → raw TCP tunnel (used for https targets)
 * - GET http://host:port/path → rewrites to origin-form and forwards (http targets)
 * Records every request line in `hits`.
 */
function startForwardProxy() {
  const hits = [];
  const server = net.createServer((clientSock) => {
    clientSock.once('data', (chunk) => {
      const headerEnd = chunk.indexOf('\r\n\r\n');
      if (headerEnd === -1) { clientSock.destroy(); return; }
      const head = chunk.slice(0, headerEnd).toString();
      const rest = chunk.slice(headerEnd + 4);
      const reqLine = head.split('\r\n')[0];
      const sp = reqLine.indexOf(' ');
      const method = reqLine.slice(0, sp);
      const target = reqLine.slice(sp + 1, reqLine.lastIndexOf(' '));
      hits.push(reqLine);

      if (method === 'CONNECT') {
        const [host, port] = target.split(':');
        const upstream = net.connect(Number(port), host, () => {
          clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          upstream.pipe(clientSock);
          clientSock.pipe(upstream);
          if (rest.length) upstream.write(rest);
        });
        upstream.on('error', () => clientSock.destroy());
        return;
      }

      // absolute-form request: GET http://host:port/path HTTP/1.1
      let upstream;
      try {
        const u = new URL(target);
        upstream = net.connect(Number(u.port || 80), u.hostname, () => {
          const originForm = head.replace(target, u.pathname + u.search || '/');
          upstream.write(originForm + '\r\n\r\n');
          if (rest.length) upstream.write(rest);
          upstream.pipe(clientSock);
          clientSock.pipe(upstream);
        });
      } catch {
        clientSock.destroy();
        return;
      }
      upstream.on('error', () => clientSock.destroy());
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, hits });
    });
  });
}

function startTarget() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

describe('proxy-injection e2e — real undici transport through real TCP proxy', () => {
  let proxy, target;

  beforeAll(async () => {
    proxy = await startForwardProxy();
    target = await startTarget();
  });

  afterAll(async () => {
    await new Promise((r) => proxy.server.close(r));
    await new Promise((r) => target.server.close(r));
  });

  it('RedditClient routes the request through the injected ProxyIpPool proxy', async () => {
    const pool = new ProxyIpPool({ validateOnAdd: false });
    pool.add(`http://127.0.0.1:${proxy.port}`);
    const client = new RedditClient({ proxyPool: pool, requiresResidential: false, timeout: 5000 });

    const res = await client.request('GET', `http://127.0.0.1:${target.port}/r/test.json`, { skipResponseValidation: true });
    expect(res.status).toBe(200);
    // The request actually traversed our forward proxy — undici always opens a
    // CONNECT tunnel (even for http:// targets), so assert the tunnel line.
    expect(proxy.hits.some((h) => h === `CONNECT 127.0.0.1:${target.port} HTTP/1.1`)).toBe(true);
  });

  it('MediumClient routes the request through the injected ProxyIpPool proxy', async () => {
    const pool = new ProxyIpPool({ validateOnAdd: false });
    pool.add(`http://127.0.0.1:${proxy.port}`);
    const client = new MediumClient({ proxyPool: pool, requiresResidential: false, timeout: 5000, delayMin: 0, delayMax: 0 });

    const hitsBefore = proxy.hits.length;
    const res = await client.request('GET', `http://127.0.0.1:${target.port}/feed/@x`, { skipResponseValidation: true });
    expect(res.status).toBe(200);
    // New CONNECT tunnel to the target recorded on the proxy.
    expect(proxy.hits.slice(hitsBefore).some((h) => h === `CONNECT 127.0.0.1:${target.port} HTTP/1.1`)).toBe(true);
  });

  it('dead proxy → real ECONNREFUSED → quarantined → retried direct → 200', async () => {
    const dead = new ProxyIpPool({ validateOnAdd: false });
    dead.add('http://127.0.0.1:59997'); // nothing listening
    const client = new RedditClient({ proxyPool: dead, requiresResidential: false, timeout: 5000, maxProxyRetries: 1 });

    const hitsBefore = proxy.hits.length;
    const res = await client.request('GET', `http://127.0.0.1:${target.port}/r/fallback.json`, { skipResponseValidation: true });
    expect(res.status).toBe(200);
    expect(dead.isAllQuarantined()).toBe(true);
    // Retry went direct — the good proxy recorded no new tunnels.
    expect(proxy.hits.length).toBe(hitsBefore);
  });
});
