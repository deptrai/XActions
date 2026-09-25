// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFun native social crawler tests (Story 20.5).
 * Covers the I/O & Edge-Case Matrix: invalid mint, mint-not-found, rate-limit,
 * dedup, velocity math, KOL seed fallback, livestream set lookup.
 * Real response payload shapes (live-probed 2026-09-25) are used as fixtures.
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';
import { PumpFunClient, SOLANA_MINT_RE } from '../../../../src/scrapers/social/pumpfun/client.js';
import { PumpFunCrawler } from '../../../../src/scrapers/social/pumpfun/crawler.js';
import { computeCommentVelocity } from '../../../../src/scrapers/social/pumpfun/velocity.js';
import { KolscanResolver } from '../../../../src/scrapers/social/pumpfun/kolscan.js';
import { LivestreamPoller } from '../../../../src/scrapers/social/pumpfun/livestream.js';
import { extractTheses, extractTopHolders, normalizeThesis } from '../../../../src/scrapers/social/pumpfun/normalizer.js';

const VALID_MINT = '5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump';

// Real mint-positions position shape (withThesis=true embeds callout).
const POSITION_WITH_THESIS = {
  coinMint: VALID_MINT,
  userId: 'u1',
  userName: 'kol_trader',
  walletAddress: 'KOLWALLET1111111111111111111111111111111111',
  isVerified: true,
  accountKind: 'person',
  amountHeld: 104558111.5,
  pnlUsd: 23217.1,
  pnlPercentage: 1490.4,
  callout: {
    calloutId: 'c1',
    thesis: 'This coin will moon because the community is strong',
    calloutTimestamp: '2026-08-25T10:13:31.128Z',
    likes: 70,
    mediaUrl: null,
  },
};

const POSITION_NO_THESIS = {
  coinMint: VALID_MINT,
  userName: 'holder2',
  walletAddress: 'WALLET22222222222222222222222222222222222222',
  amountHeld: 500,
  pnlUsd: 10,
  pnlPercentage: 2,
};

function makeClient(overrides = {}) {
  const client = new PumpFunClient({});
  // Inject a fake request transport — feeds fixed payloads, no real network.
  client.request = vi.fn(async (method, url) => {
    if (url.includes('/mint-positions/')) {
      return { status: 200, headers: {}, data: { positions: [POSITION_WITH_THESIS, POSITION_NO_THESIS], totalCount: 2, hasMore: false } };
    }
    if (url.includes('/replies/')) {
      return { status: 404, headers: {}, data: { statusCode: 404 } };
    }
    if (url.includes('/coins/currently-live')) {
      return { status: 200, headers: {}, data: [{ mint: VALID_MINT, viewers: 12, roomId: 'r1' }] };
    }
    return { status: 404, headers: {}, data: {} };
  });
  // Inject a fake livechat — no real wss://livechat.pump.fun connection in tests.
  client.livechat = {
    getMessageHistory: vi.fn(async () => ({ messages: [], nextCursor: null })),
    joinRoom: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
  };
  Object.assign(client, overrides);
  return client;
}

function makeCrawler(clientOverrides = {}) {
  const client = makeClient(clientOverrides);
  const kolResolver = new KolscanResolver({ seedPath: 'nonexistent.json', fetchFn: async () => { throw new Error('kolscan down'); } });
  return new PumpFunCrawler({ client, kolResolver, startLivestreamPoller: false });
}

describe('PumpFunClient.assertValidMint', () => {
  it('rejects invalid mint with XACT_4002 before any request', () => {
    const client = makeClient();
    expect(() => client.assertValidMint('bad!')).toThrowError(/Invalid Solana mint/);
    try { client.assertValidMint('bad!'); } catch (e) { expect(e.code).toBe('XACT_4002'); }
    expect(client.request).not.toHaveBeenCalled();
  });

  it('accepts a valid Base58 mint', () => {
    const client = makeClient();
    expect(client.assertValidMint(VALID_MINT)).toBe(VALID_MINT);
    expect(SOLANA_MINT_RE.test(VALID_MINT)).toBe(true);
  });
});

describe('PumpFunCrawler.fetchMintSocial', () => {
  it('returns theses + topHolders + velocity + kolActivity + livestream shape', async () => {
    const crawler = makeCrawler();
    const r = await crawler.fetchMintSocial({ mintAddress: VALID_MINT });
    expect(r.mint).toBe(VALID_MINT);
    expect(r.id).toBe(`pumpfun:${VALID_MINT}`);
    expect(Array.isArray(r.theses)).toBe(true);
    expect(Array.isArray(r.topHolders)).toBe(true);
    expect(r.commentVelocity).toMatchObject({ last1m: 0, last5m: 0 });
    expect(r.kolActivity).toMatchObject({ isKolPresent: expect.any(Boolean), kolCount: expect.any(Number) });
    expect(r.livestream).toMatchObject({ isActive: expect.any(Boolean), viewers: expect.any(Number) });
    await crawler.cleanup();
  });

  it('extracts theses from position.callout.thesis with pnlUsd→pnlSol mapping', async () => {
    const crawler = makeCrawler();
    const r = await crawler.fetchMintSocial({ mintAddress: VALID_MINT });
    const t = r.theses.find((x) => x.wallet === POSITION_WITH_THESIS.walletAddress);
    expect(t).toBeTruthy();
    expect(t.content).toContain('moon');
    expect(t.pnlUsd).toBeCloseTo(23217.1);
    expect(t.holdings).toBeCloseTo(104558111.5);
    await crawler.cleanup();
  });

  it('treats mint-positions 404 as XACT_4004 (mint not found)', async () => {
    const crawler = makeCrawler();
    crawler.client.request = vi.fn(async () => ({ status: 404, headers: {}, data: {} }));
    await expect(crawler.fetchMintSocial({ mintAddress: VALID_MINT })).rejects.toMatchObject({ code: 'XACT_4004' });
    await crawler.cleanup();
  });

  it('graceful-degrades commentVelocity to 0 when replies endpoint 404s and livechat is empty', async () => {
    const crawler = makeCrawler();
    const r = await crawler.fetchMintSocial({ mintAddress: VALID_MINT });
    expect(r.commentVelocity.last1m).toBe(0);
    expect(r.commentVelocity.sampleSize).toBe(0);
    expect(r.comments).toEqual([]);
    await crawler.cleanup();
  });

  it('falls back to livechat getMessageHistory when REST /replies 404s', async () => {
    const crawler = makeCrawler();
    const now = Date.now();
    crawler.client.livechat.getMessageHistory = vi.fn(async () => ({
      messages: [
        { id: 'm1', message: 'gm', username: 'alice', userAddress: 'W1', timestamp: new Date(now - 30_000).toISOString() },
        { id: 'm2', message: 'send it', username: 'bob', userAddress: 'W2', timestamp: new Date(now - 120_000).toISOString() },
      ],
      nextCursor: null,
    }));
    const r = await crawler.fetchMintSocial({ mintAddress: VALID_MINT });
    expect(crawler.client.livechat.getMessageHistory).toHaveBeenCalledWith(
      VALID_MINT,
      expect.objectContaining({ limit: expect.any(Number) }),
    );
    expect(r.comments).toHaveLength(2);
    expect(r.comments[0].authorName).toBe('alice');
    expect(r.comments[0].platform).toBe('pumpfun');
    expect(r.commentVelocity.sampleSize).toBe(2);
    await crawler.cleanup();
  });
});

describe('dedup (in-flight request deduplication)', () => {
  it('shares one upstream call across concurrent callers for the same mint', async () => {
    const crawler = makeCrawler();
    const spy = crawler.client.request;
    const [a, b, c] = await Promise.all([
      crawler.fetchMintSocial({ mintAddress: VALID_MINT }),
      crawler.fetchMintSocial({ mintAddress: VALID_MINT }),
      crawler.fetchMintSocial({ mintAddress: VALID_MINT }),
    ]);
    const mintPosCalls = spy.mock.calls.filter(([, url]) => url.includes('/mint-positions/')).length;
    expect(mintPosCalls).toBe(1);
    expect(a.mint).toBe(b.mint);
    await crawler.cleanup();
  });
});

describe('computeCommentVelocity', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const replies = [
    { timestamp: '2026-09-25T11:59:30Z' }, // 30s ago
    { timestamp: '2026-09-25T11:59:00Z' }, // 1m ago
    { timestamp: '2026-09-25T11:58:00Z' }, // 2m ago
    { timestamp: '2026-09-25T11:57:00Z' }, // 3m ago
    { timestamp: '2026-09-25T11:56:00Z' }, // 4m ago
    { timestamp: '2026-09-25T11:40:00Z' }, // 20m ago (outside both windows)
  ];
  it('computes last1m and last5m via time-delta', () => {
    const v = computeCommentVelocity(replies, now);
    expect(v.sampleSize).toBe(6);
    expect(v.last1m).toBe(2); // 30s + 60s ago
    expect(v.last5m).toBe(1); // 5 within 5m / 5 = 1
  });
  it('returns zeros for empty sample', () => {
    expect(computeCommentVelocity([])).toMatchObject({ last1m: 0, last5m: 0, sampleSize: 0 });
  });
});

describe('KolscanResolver (KOL seed fallback)', () => {
  it('falls back to seed file when kolscan.io is unreachable', async () => {
    const resolver = new KolscanResolver({ seedPath: 'nonexistent.json', fetchFn: async () => { throw new Error('down'); } });
    const r = await resolver.matchKols(['anywallet']);
    expect(r.isKolPresent).toBe(false);
    expect(r.matchedKols).toEqual([]);
  });
  it('matches a KOL wallet when present in the resolved set', async () => {
    const resolver = new KolscanResolver({
      seedPath: 'nonexistent.json',
      fetchFn: async () => ({ ok: true, json: async () => [{ wallet: 'KOLWALLET1111111111111111111111111111111111', name: 'KOL' }] }),
    });
    const r = await resolver.matchKols(['KOLWALLET1111111111111111111111111111111111']);
    expect(r.isKolPresent).toBe(true);
    expect(r.kolCount).toBe(1);
  });
});

describe('LivestreamPoller (0ms in-memory lookup)', () => {
  it('resolves isLive from the poller set without a per-mint request', async () => {
    const client = makeClient();
    const poller = new LivestreamPoller({ client, autoStart: false });
    // Manually populate the live set (simulating a poll tick).
    poller._live.set(VALID_MINT, { viewers: 42, roomId: 'room9' });
    const status = poller.isLive(VALID_MINT);
    expect(status.isActive).toBe(true);
    expect(status.viewers).toBe(42);
    expect(status.roomId).toBe('room9');
    expect(poller.isLive('othermint')).toMatchObject({ isActive: false, viewers: 0 });
    poller.stop();
  });
});

describe('scrape() dispatcher integration', () => {
  it('lists fetch_mint_social via listActions', async () => {
    const crawler = makeCrawler();
    const actions = crawler.listActions();
    expect(actions.map((a) => a.action)).toContain('fetch_mint_social');
    const desc = actions.find((a) => a.action === 'fetch_mint_social');
    expect(desc.category).toBe('social');
    expect(desc.requiredArgs).toContain('mintAddress');
    await crawler.cleanup();
  });
});
