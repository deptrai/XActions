// tests/scrapers/social/pumpfun/fetch-coin-meta.test.js
// Story 50.6 — pumpfun fetch_coin_meta lightweight action
// by nichxbt

import { describe, it, expect, vi } from 'vitest';
import { PumpFunCrawler } from '../../../../src/scrapers/social/pumpfun/crawler.js';
import { PumpFunClient } from '../../../../src/scrapers/social/pumpfun/client.js';
import { PumpFunAuth } from '../../../../src/scrapers/social/pumpfun/auth.js';
import { LivestreamApiClient } from '../../../../src/scrapers/social/pumpfun/livestream-api.js';
import { KolscanResolver } from '../../../../src/scrapers/social/pumpfun/kolscan.js';
import pumpfunDescriptor from '../../../../src/scrapers/social/pumpfun/descriptor.js';
import { scrape } from '../../../../src/scrapers/index.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';

const VALID_MINT = '5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump';

const COIN_META_FIXTURE = {
  mint: VALID_MINT,
  name: 'Foxcoin',
  symbol: 'FOX',
  description: 'A test coin',
  image_uri: 'frontend-api-v3.pump.fun fixture',
  twitter: 'https://x.com/foxtilki',
  telegram: 'https://t.test/fox',
  website: 'https://fox.test',
  bonding_curve: 'AXiRFmUiojawfUJisJcedzXDyDEeZ57BURbncYvNetQo',
  creator: '2Fez68NcinnEh17ts9o6i2c3PPZWLu3zR85Bwy1UUbgc',
  created_timestamp: 1758013154278,
  complete: false,
  market_cap: 485.3,
  market_cap_usd: 57703.2,
  reply_count: 2029,
  is_currently_live: true,
  ath_market_cap: 71000,
};

function makeClient(overrides = {}) {
  const client = new PumpFunClient({});
  client.request = vi.fn(async (method, url) => {
    if (url.match(/\/coins\/[1-9A-HJ-NP-Za-km-z]+/)) {
      return { status: 200, headers: {}, data: COIN_META_FIXTURE };
    }
    return { status: 404, headers: {}, data: {} };
  });
  Object.assign(client, overrides);
  return client;
}

function makeCrawler() {
  const client = makeClient();
  return new PumpFunCrawler({
    client,
    kolResolver: new KolscanResolver({ seedPath: 'nonexistent.json', fetchFn: async () => { throw new Error('kolscan down'); } }),
    auth: new PumpFunAuth('test'),
    livestreamApi: new LivestreamApiClient(new PumpFunAuth('test'), { fetchFn: vi.fn() }),
    startLivestreamPoller: false,
  });
}

describe('Story 50.6 — pumpfun fetch_coin_meta action', () => {
  it('P-1: fetchCoinMeta returns {mint, coinMeta} with creator/socials/bondingCurve', async () => {
    const crawler = makeCrawler();
    const r = await crawler.fetchCoinMeta({ mintAddress: VALID_MINT });

    expect(r.mint).toBe(VALID_MINT);
    expect(r.coinMeta).toBeDefined();
    expect(r.coinMeta.creator).toBe('2Fez68NcinnEh17ts9o6i2c3PPZWLu3zR85Bwy1UUbgc');
    expect(r.coinMeta.socialLinks.twitter).toBe('https://x.com/foxtilki');
    expect(r.coinMeta.bondingCurve).toBe('AXiRFmUiojawfUJisJcedzXDyDEeZ57BURbncYvNetQo');
    expect(r.coinMeta.marketCapUsd).toBe(57703.2);
    expect(r.coinMeta.isCurrentlyLive).toBe(true);
    expect(r.coinMeta.athMarketCap).toBe(71000);

    // Only the /coins/{mint} endpoint is hit — never positions/replies/livestream
    const urls = crawler.client.request.mock.calls.map(c => c[1]);
    expect(urls.every(u => u.includes('/coins/'))).toBe(true);
    expect(urls.some(u => u.includes('/mint-positions'))).toBe(false);
    expect(urls.some(u => u.includes('/replies'))).toBe(false);
  });

  it('P-2: alias args mint|address resolve to mintAddress via mapArgs', () => {
    expect(pumpfunDescriptor.mapArgs({ mint: VALID_MINT }).mintAddress).toBe(VALID_MINT);
    expect(pumpfunDescriptor.mapArgs({ address: VALID_MINT }).mintAddress).toBe(VALID_MINT);
  });

  it('P-3: missing mint throws validation error', async () => {
    const crawler = makeCrawler();
    await expect(crawler.fetchCoinMeta({})).rejects.toThrowError(PlatformError);
  });

  it('P-4: unknown mint → XACT_4004 (not generic 500)', async () => {
    const crawler = makeCrawler();
    crawler.client.request = vi.fn(async () => ({ status: 404, headers: {}, data: {} }));
    try {
      await crawler.fetchCoinMeta({ mintAddress: VALID_MINT });
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PlatformError);
      expect(e.code).toBe('XACT_4004');
      expect(e.statusCode).toBe(404);
    }
  });

  it('P-7: action appears in crawler listActions with syncCapable contract', () => {
    const crawler = makeCrawler();
    const listed = crawler.listActions().find(a => a.action === 'fetch_coin_meta');
    expect(listed).toBeDefined();
    expect(listed.requiredArgs).toEqual(['mintAddress']);
    expect(pumpfunDescriptor.syncCapableActions).toContain('fetch_coin_meta');
  });

  it('P-8: actionMap aliases coin_meta/coin/coinMeta/meta resolve to fetch_coin_meta', () => {
    expect(pumpfunDescriptor.actionMap['coin_meta']).toBe('fetch_coin_meta');
    expect(pumpfunDescriptor.actionMap['coin']).toBe('fetch_coin_meta');
    expect(pumpfunDescriptor.actionMap['coinMeta']).toBe('fetch_coin_meta');
    expect(pumpfunDescriptor.actionMap['meta']).toBe('fetch_coin_meta');
  });

  it('P-1e2e: scrape() dispatches coin_meta → fetch_coin_meta through the real descriptor', async () => {
    const crawler = makeCrawler();
    const result = await scrape('pumpfun', 'coin_meta', {
      mint: VALID_MINT,
      client: crawler.client,
      kolResolver: new KolscanResolver({ seedPath: 'nonexistent.json', fetchFn: async () => { throw new Error('kolscan down'); } }),
      startLivestreamPoller: false,
      autoClose: false,
    });
    // scrape() returns the crawler.start() result
    expect(result).toBeDefined();
    const payload = result?.coinMeta ? result : (Array.isArray(result) ? result[0] : result);
    expect(payload.coinMeta || payload.mint).toBeDefined();
  });
});
