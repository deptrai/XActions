// tests/scrapers/proxy-injection.test.js
// Story 35.4 — AC-1..AC-5: unified ProxyProvider injection for Reddit/Medium/Instagram.
// Real implementations only (repo rule): real ProxyIpPool, real DynamicTunnelProvider,
// real clients; transport exercised via the documented httpClient seam.
// by nichxbt

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { RedditClient } from '../../src/scrapers/social/reddit/client.js';
import { MediumClient } from '../../src/scrapers/social/medium/client.js';
import { InstagramClient } from '../../src/scrapers/social/instagram/client.js';
import { ProxyIpPool, globalProxyPool } from '../../src/proxy/proxy-pool.js';
import { DynamicTunnelProvider } from '../../src/proxy/providers.js';

const DEAD_PROXY_URL = 'http://127.0.0.1:59999';
const ENV_PROXY_URL = 'http://127.0.0.1:54321';

/** Quarantine every entry in the env-seeded global pool so it cannot serve. */
function drainGlobalPool() {
  const drained = [];
  for (const entry of globalProxyPool.listAll()) {
    globalProxyPool.quarantine(entry.server);
    drained.push(entry.server);
  }
  return drained;
}

function restoreGlobalPool(servers) {
  for (const server of servers) {
    try { globalProxyPool.release(server); } catch { /* best-effort */ }
  }
}

function makePool() {
  const pool = new ProxyIpPool({ validateOnAdd: false });
  pool.add(DEAD_PROXY_URL);
  return pool;
}

/** Extract a comparable string from whatever proxy shape resolveProxy returns. */
function proxyStr(proxy) {
  if (!proxy) return '';
  if (typeof proxy === 'string') return proxy;
  // Normalized record: { scheme, host, port, username, password, server? } —
  // prefer the auth composite so provider-generated usernames (geo/session
  // tokens like `country-us-sid…`) are captured.
  if (proxy.username) return `${proxy.username}@${proxy.host || ''}:${proxy.port || ''}`;
  return String(proxy.server || proxy.url || proxy.proxy || JSON.stringify(proxy));
}

// ============================================================================
// AC-1/2/3: ProxyIpPool injection routes through resolveProxy on all 3 clients
// ============================================================================

describe('AC-1/2/3 — ProxyIpPool injection (reddit / medium / instagram)', () => {
  it('RedditClient with { proxyPool } resolves a proxy from the pool', () => {
    const client = new RedditClient({ proxyPool: makePool() });
    const proxy = client.resolveProxy('acct1', false, false);
    expect(proxyStr(proxy)).toContain('127.0.0.1');
    expect(proxyStr(proxy)).toContain('59999');
  });

  it('MediumClient with { proxyPool } resolves a proxy from the pool', () => {
    const client = new MediumClient({ proxyPool: makePool() });
    const proxy = client.resolveProxy('acct1', false, false);
    expect(proxyStr(proxy)).toContain('59999');
  });

  it('InstagramClient with { proxyPool } resolves a sticky proxy per account', () => {
    const client = new InstagramClient({ proxyPool: makePool() });
    const p1 = client.resolveProxy('acct-sticky', false, true);
    const p2 = client.resolveProxy('acct-sticky', false, true);
    expect(proxyStr(p1)).toContain('59999');
    expect(proxyStr(p1)).toBe(proxyStr(p2)); // sticky: same account → same proxy
  });

  it('Injected pool counts as explicit proxy configuration', () => {
    const client = new RedditClient({ proxyPool: makePool() });
    expect(client._hasExplicitProxy).toBe(true);
  });
});

// ============================================================================
// AC-1/2: PROXY_URL env fallback when no provider is injected
// ============================================================================

describe('PROXY_URL env fallback (no provider injected)', () => {
  const savedEnv = process.env.PROXY_URL;
  let drained = [];

  beforeEach(() => {
    drained = drainGlobalPool();
    process.env.PROXY_URL = ENV_PROXY_URL;
  });

  afterEach(() => {
    restoreGlobalPool(drained);
    if (savedEnv === undefined) delete process.env.PROXY_URL;
    else process.env.PROXY_URL = savedEnv;
  });

  it('RedditClient falls back to PROXY_URL when pool cannot serve', () => {
    const client = new RedditClient({ requiresProxy: true });
    expect(proxyStr(client.resolveProxy(null, false, false))).toBe(ENV_PROXY_URL);
  });

  it('MediumClient falls back to PROXY_URL when pool cannot serve', () => {
    const client = new MediumClient({ requiresProxy: true });
    expect(proxyStr(client.resolveProxy(null, false, false))).toBe(ENV_PROXY_URL);
  });

  it('InstagramClient falls back to PROXY_URL when pool cannot serve', () => {
    const client = new InstagramClient({ requiresProxy: true });
    expect(proxyStr(client.resolveProxy(null, true, true))).toBe(ENV_PROXY_URL);
  });

  it('no provider + no env → PROXY_EXHAUSTED (XACT_5030), never silent-direct', () => {
    delete process.env.PROXY_URL;
    const client = new RedditClient({ requiresProxy: true });
    expect(() => client.resolveProxy(null, false, false)).toThrowError(/exhausted/i);
  });
});

// ============================================================================
// AC-4: proxy connection failure → quarantine (5 min) + direct fallback
// ============================================================================

describe('AC-4 — dead proxy quarantined, request retried direct', () => {
  it('RedditClient: ECONNREFUSED through proxy → quarantine + direct retry', async () => {
    const pool = makePool();
    const calls = [];
    const httpClient = async (opts) => {
      calls.push({ proxy: opts.proxy || null, hasAgent: Boolean(opts.agent) });
      if (opts.proxy) {
        const err = new Error(`connect ECONNREFUSED 127.0.0.1:59999`);
        err.code = 'ECONNREFUSED';
        throw err;
      }
      return { status: 200, headers: {}, data: { ok: true } };
    };
    // requiresResidential:false — the local dead proxy is not residential-tagged;
    // requiresProxy left unset so _requiresProxyExplicit stays false and the
    // injected pool counts as the active proxy route.
    const client = new RedditClient({ proxyPool: pool, httpClient, requiresResidential: false, maxProxyRetries: 1 });

    const res = await client.request('GET', 'https://www.reddit.com/r/test.json', { skipResponseValidation: true });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
    expect(calls[0].proxy).toBeTruthy();   // first attempt routed through the pool proxy
    expect(calls[1].proxy).toBeNull();     // retry went direct (disableProxy)
    expect(pool.isAllQuarantined()).toBe(true); // dead proxy quarantined
  });

  it('MediumClient: ECONNREFUSED through proxy → quarantine + direct retry', async () => {
    const pool = makePool();
    const calls = [];
    const httpClient = async (opts) => {
      calls.push({ proxy: opts.proxy || null });
      if (opts.proxy) {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:59999');
        err.code = 'ECONNREFUSED';
        throw err;
      }
      return { status: 200, headers: {}, data: { ok: true } };
    };
    const client = new MediumClient({ proxyPool: pool, httpClient, requiresResidential: false, maxProxyRetries: 1, delayMin: 0, delayMax: 0 });

    const res = await client.request('GET', 'https://medium.com/feed/@x', { skipResponseValidation: true });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
    expect(calls[0].proxy).toBeTruthy();
    expect(calls[1].proxy).toBeNull();
    expect(pool.isAllQuarantined()).toBe(true);
  });

  it('requiresProxy: true → quarantine + rethrow, never silent direct', async () => {
    const pool = makePool();
    const httpClient = async (opts) => {
      if (opts.proxy) {
        const err = new Error('connect ETIMEDOUT 127.0.0.1:59999');
        err.code = 'ETIMEDOUT';
        throw err;
      }
      return { status: 200, headers: {}, data: {} };
    };
    const client = new RedditClient({ proxyPool: pool, httpClient, requiresProxy: true, requiresResidential: false, maxProxyRetries: 1 });
    // Transport error surfaces as ProxyDeadError (XACT_5030, "server error 503")
    // with the original error under details.error — either wrapper matches.
    await expect(client.request('GET', 'https://www.reddit.com/r/test.json', { skipResponseValidation: true }))
      .rejects.toThrowError(/ETIMEDOUT|server error 503|exhausted/i);
    expect(pool.isAllQuarantined()).toBe(true);
  });
});

// ============================================================================
// AC-5: country geo-targeting forwarded to provider-class pools
// ============================================================================

describe('AC-5 — country/isp hints reach DynamicTunnelProvider', () => {
  function makeProvider() {
    return new DynamicTunnelProvider({
      gatewayUrl: 'http://gateway-user:gateway-pass@127.0.0.1:59998',
      provider: 'custom',
      template: 'gw-{country}-sid{sessionId}',
      rotatePerRequest: true,
    });
  }

  it('RedditClient forwards country hint into provider.getProxy → country token in proxy auth', () => {
    const client = new RedditClient({ proxyProvider: makeProvider() });
    const proxy = client.resolveProxy('acct-gb', false, false, { country: 'gb' });
    expect(proxyStr(proxy)).toContain('gb');
  });

  it('InstagramClient defaults country to us and keeps sticky sessionId per account', () => {
    const client = new InstagramClient({ proxyProvider: makeProvider() });
    const proxy = client.resolveProxy('acct-9', true, true);
    expect(proxyStr(proxy)).toContain('us');
    expect(proxyStr(proxy)).toContain('acct-9');
  });

  it('MediumClient forwards explicit country override', () => {
    const client = new MediumClient({ proxyProvider: makeProvider() });
    const proxy = client.resolveProxy('acct1', false, false, { country: 'vn' });
    expect(proxyStr(proxy)).toContain('vn');
  });
});
