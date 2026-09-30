// tests/scrapers/crypto/dexscreener/dexscreener.test.js
// Story 50.7 — dexscreener platform descriptor + 5 keyless actions
// by nichxbt

import { describe, it, expect, vi } from 'vitest';
import { DexscreenerCrawler } from '../../../../src/scrapers/crypto/dexscreener/crawler.js';
import { DexscreenerClient } from '../../../../src/scrapers/crypto/dexscreener/client.js';
import dexscreenerDescriptor from '../../../../src/scrapers/crypto/dexscreener/descriptor.js';
import { scrape, isSyncCapable } from '../../../../src/scrapers/index.js';
import { executeActionListTool } from '../../../../src/scrapers/social/actions-list.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';

const CHAIN = 'solana';
const TOKEN = '5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump';

// Upstream /tokens/v1 shape: array of PAIR objects; socials+websites live
// inside `pair.info` (verified live 2026-09-27 — /tokens/v1 mirrors
// /token-pairs/v1 payload, socials at pair.info.socials[]).
const TOKEN_PROFILE_FIXTURE = [
  {
    chainId: 'solana',
    dexId: 'pumpswap',
    url: 'https://dexscreener.com/solana/xyz',
    pairAddress: 'AXiRFmUiojawfUJisJcedzXDyDEeZ57BURbncYvNetQo',
    baseToken: { address: TOKEN, name: 'Foxcoin', symbol: 'FOX' },
    info: {
      imageUrl: 'https://dd.dexscreener.com/icon.png',
      header: 'https://dd.dexscreener.com/header.png',
      openGraph: 'https://dd.dexscreener.com/og.png',
      websites: [{ label: 'Website', url: 'https://fox.test' }],
      socials: [
        { type: 'twitter', url: 'https://x.com/foxtilki' },
        { type: 'telegram', url: 'https://t.me/fox' },
      ],
    },
  },
];

const ORDERS_FIXTURE = [
  { type: 'tokenProfile', status: 'confirmed', paymentTimestamp: 1758013154278 },
  { type: 'communityTakeover', status: 'processing', paymentTimestamp: 1758013155000 },
];

const PAIRS_FIXTURE = [
  {
    chainId: 'solana',
    dexId: 'raydium',
    pairAddress: 'AXiRFmUiojawfUJisJcedzXDyDEeZ57BURbncYvNetQo',
    url: 'https://dexscreener.com/solana/pair1',
    baseToken: { address: TOKEN, name: 'Foxcoin', symbol: 'FOX' },
    quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
    priceUsd: '0.042',
    priceNative: '0.00042',
    liquidity: { usd: 58000.5 },
    volume: { h24: 12500.7 },
    priceChange: { h24: 12.4 },
    pairCreatedAt: 1758013154000,
  },
];

const BOOSTED_FIXTURE = [
  { tokenAddress: TOKEN, chainId: 'solana', amount: 500, totalAmount: 500, url: 'https://dexscreener.com/x', description: 'boosted', icon: 'https://icon' },
];

const PROFILES_FIXTURE = [
  { tokenAddress: TOKEN, chainId: 'solana', url: 'https://dexscreener.com/x', description: 'new profile', icon: 'https://icon', header: 'https://header', links: [{ type: 'twitter', url: 'https://x.com/new' }] },
];

function makeClient(routeMap = {}) {
  const client = new DexscreenerClient({ tokenBucket: { consume: async () => ({ allowed: true, remaining: 999 }) } });
  client.request = vi.fn(async (method, url) => {
    for (const [pattern, fixture] of Object.entries(routeMap)) {
      if (url.includes(pattern)) {
        return { status: 200, headers: {}, data: fixture };
      }
    }
    return { status: 404, headers: {}, data: {} };
  });
  return client;
}

function makeCrawler(routeMap) {
  return new DexscreenerCrawler({ client: makeClient(routeMap) });
}

describe('Story 50.7 — dexscreener descriptor + 5 actions', () => {
  it('D-1: token_socials returns socials + websites, hits only /tokens/v1/', async () => {
    const crawler = makeCrawler({ '/tokens/v1/': TOKEN_PROFILE_FIXTURE });
    const r = await crawler.fetchTokenSocials({ chainId: CHAIN, tokenAddress: TOKEN });
    expect(r.platform).toBe('dexscreener');
    expect(r.category).toBe('crypto');
    expect(r.type).toBe('token_socials');
    expect(r.data.chain_id).toBe('solana');
    expect(r.data.token_address).toBe(TOKEN);
    expect(r.data.socials).toHaveLength(2);
    expect(r.data.socials[0].type).toBe('twitter');
    expect(r.data.websites).toHaveLength(1);

    const urls = crawler.client.request.mock.calls.map(c => c[1]);
    expect(urls.every(u => u.includes('/tokens/v1/'))).toBe(true);
    expect(urls.some(u => u.includes('/orders/'))).toBe(false);
    expect(urls.some(u => u.includes('/token-pairs/'))).toBe(false);
  });

  it('D-2: token_legitimacy returns orders + boostsActive, hits only /orders/v1/', async () => {
    const crawler = makeCrawler({ '/orders/v1/': ORDERS_FIXTURE });
    const r = await crawler.fetchTokenLegitimacy({ chainId: CHAIN, tokenAddress: TOKEN });
    expect(r.type).toBe('token_legitimacy');
    expect(r.data.orders).toHaveLength(2);
    expect(r.data.orders[0].type).toBe('tokenProfile');
    expect(r.data.boosted).toBe(true);
    expect(r.data.boosts_active).toBe(2);

    const urls = crawler.client.request.mock.calls.map(c => c[1]);
    expect(urls.every(u => u.includes('/orders/v1/'))).toBe(true);
  });

  it('D-3: token_lookup returns pairs with dex_id + price_usd', async () => {
    const crawler = makeCrawler({ '/token-pairs/v1/': PAIRS_FIXTURE });
    const r = await crawler.fetchTokenLookup({ chainId: CHAIN, tokenAddress: TOKEN });
    expect(r.type).toBe('token_lookup');
    expect(r.data.pair_count).toBe(1);
    expect(r.data.pairs[0].dex_id).toBe('raydium');
    expect(r.data.pairs[0].price_usd).toBe(0.042);
    expect(r.data.pairs[0].liquidity_usd).toBe(58000.5);
    expect(r.data.pairs[0].pair_address).toBe('AXiRFmUiojawfUJisJcedzXDyDEeZ57BURbncYvNetQo');

    const urls = crawler.client.request.mock.calls.map(c => c[1]);
    expect(urls.every(u => u.includes('/token-pairs/v1/'))).toBe(true);
  });

  it('D-4: latest_boosted returns normalized boosted tokens', async () => {
    const crawler = makeCrawler({ '/token-boosts/latest/v1': BOOSTED_FIXTURE });
    const r = await crawler.fetchLatestBoosted({});
    expect(Array.isArray(r)).toBe(true);
    expect(r[0].type).toBe('boosted_token');
    expect(r[0].data.token_address).toBe(TOKEN);
    expect(r[0].data.amount).toBe(500);

    const urls = crawler.client.request.mock.calls.map(c => c[1]);
    expect(urls.every(u => u.includes('/token-boosts/latest/v1'))).toBe(true);
  });

  it('D-5: latest_profiles returns normalized profiles with socials', async () => {
    const crawler = makeCrawler({ '/token-profiles/latest/v1': PROFILES_FIXTURE });
    const r = await crawler.fetchLatestProfiles({ limit: 10 });
    expect(Array.isArray(r)).toBe(true);
    expect(r[0].type).toBe('token_profile');
    expect(r[0].data.socials[0].type).toBe('twitter');

    const urls = crawler.client.request.mock.calls.map(c => c[1]);
    expect(urls.every(u => u.includes('/token-profiles/latest/v1'))).toBe(true);
  });

  it('D-6: missing chainId → XACT_4001; missing tokenAddress → XACT_4001; bad solana addr → XACT_4002; 404 → XACT_4004', async () => {
    const crawler = makeCrawler({});
    await expect(crawler.fetchTokenSocials({})).rejects.toThrowError(PlatformError);
    await expect(crawler.fetchTokenSocials({ chainId: CHAIN })).rejects.toThrowError(PlatformError);

    await expect(crawler.fetchTokenSocials({ chainId: CHAIN, tokenAddress: 'not-an-addr' }))
      .rejects.toMatchObject({ code: 'XACT_4002' });

    const nf = makeCrawler({}); // default 404
    try {
      await nf.fetchTokenLookup({ chainId: CHAIN, tokenAddress: TOKEN });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('XACT_4004');
      expect(e.statusCode).toBe(404);
    }
  });

  it('D-7: listActions shows all 5 with category crypto + requiredArgs', () => {
    const crawler = makeCrawler({});
    const actions = crawler.listActions();
    expect(actions).toHaveLength(5);
    for (const a of actions) {
      expect(a.category).toBe('crypto');
    }
    const socials = actions.find(a => a.action === 'token_socials');
    expect(socials.requiredArgs).toEqual(['chainId', 'tokenAddress']);
    const boosted = actions.find(a => a.action === 'latest_boosted');
    expect(boosted.requiredArgs).toEqual([]);
  });

  it('D-8: actionMap aliases resolve (socials/pairs/boosted/profiles → canonical)', () => {
    expect(dexscreenerDescriptor.actionMap['socials']).toBe('token_socials');
    expect(dexscreenerDescriptor.actionMap['pairs']).toBe('token_lookup');
    expect(dexscreenerDescriptor.actionMap['boosted']).toBe('latest_boosted');
    expect(dexscreenerDescriptor.actionMap['profiles']).toBe('latest_profiles');
    expect(dexscreenerDescriptor.actionMap['legitimacy']).toBe('token_legitimacy');
  });

  it('D-9: scrape("dexscreener","socials",{chain,token}) e2e via real descriptor', async () => {
    const crawler = makeCrawler({ '/tokens/v1/': TOKEN_PROFILE_FIXTURE });
    const result = await scrape('dexscreener', 'socials', {
      chain: CHAIN,
      token: TOKEN,
      client: crawler.client,
      autoClose: false,
    });
    expect(result).toBeDefined();
    expect(result.type).toBe('token_socials');
    expect(result.data.socials).toHaveLength(2);
  });

  it('D-10: isSyncCapable true for all 5 dexscreener actions', () => {
    for (const action of ['token_socials', 'token_legitimacy', 'token_lookup', 'latest_boosted', 'latest_profiles']) {
      expect(isSyncCapable('dexscreener', action)).toBe(true);
    }
    // Aliases inherit
    expect(isSyncCapable('dexscreener', 'socials')).toBe(true);
    expect(isSyncCapable('dex', 'pairs')).toBe(true);
  });

  it('D-11: actions-list includes dexscreener category=crypto syncCapable=true', async () => {
    const actions = await executeActionListTool({ platform: 'dexscreener' });
    expect(actions).toHaveLength(5);
    for (const a of actions) {
      expect(a.platform).toBe('dexscreener');
      expect(a.category).toBe('crypto');
      expect(a.syncCapable).toBe(true);
      expect(a.status).toBe('stable');
    }
  });

  it('D-12: bare icon keys are absolutized against the images CDN', async () => {
    const boosted = makeCrawler({
      '/token-boosts/latest/v1': [{ tokenAddress: TOKEN, chainId: 'solana', amount: 1, totalAmount: 1, url: 'https://dexscreener.com/x', description: 'd', icon: 'mWl9YY091RIGUZW5' }],
    });
    const b = await boosted.fetchLatestBoosted({});
    expect(b[0].data.icon).toBe('https://cdn.dexscreener.com/cms/images/mWl9YY091RIGUZW5');

    const profiles = makeCrawler({
      '/token-profiles/latest/v1': [{ tokenAddress: TOKEN, chainId: 'solana', url: 'https://dexscreener.com/x', description: 'd', icon: 'bareKey', header: 'https://header', links: [] }],
    });
    const p = await profiles.fetchLatestProfiles({ limit: 1 });
    expect(p[0].data.icon).toBe('https://cdn.dexscreener.com/cms/images/bareKey');

    // Absolute URLs pass through unchanged
    const abs = makeCrawler({ '/token-boosts/latest/v1': [{ tokenAddress: TOKEN, chainId: 'solana', amount: 1, totalAmount: 1, url: 'x', icon: 'https://cdn.example.com/i.png' }] });
    const a = await abs.fetchLatestBoosted({});
    expect(a[0].data.icon).toBe('https://cdn.example.com/i.png');
  });
});
