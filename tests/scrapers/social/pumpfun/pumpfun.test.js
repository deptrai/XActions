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
import { PumpFunAuth } from '../../../../src/scrapers/social/pumpfun/auth.js';
import { LivestreamApiClient } from '../../../../src/scrapers/social/pumpfun/livestream-api.js';
import { PumpFunMedia } from '../../../../src/scrapers/social/pumpfun/media.js';
import { globalSessionManager } from '../../../../src/core/session-manager.js';

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

const COIN_META_FIXTURE = {
  mint: VALID_MINT,
  name: 'Foxtilki',
  symbol: 'FOXTILKI',
  description: 'Fox meme on Solana',
  image_uri: 'https://ipfs.io/ipfs/bafkrei...',
  metadata_uri: 'https://ipfs.io/ipfs/bafkreicdj...',
  twitter: 'https://x.com/foxtilki',
  telegram: 'https://t.me/foxtilki',
  website: 'https://foxtilki.com',
  bonding_curve: 'AXiRFmUiojawfUJisJcedzXDyDEeZ57BURbncYvNetQo',
  associated_bonding_curve: 'GUK7feUv1o2saQESQe9stQ6Z6WNNafhtnP517wfoTXuX',
  creator: '2Fez68NcinnEh17ts9o6i2c3PPZWLu3zR85Bwy1UUbgc',
  created_timestamp: 1758013154278,
  complete: false,
  market_cap: 485.3,
  market_cap_usd: 57703.2,
  reply_count: 2029,
  is_currently_live: true,
};

const USER_FIXTURE = {
  address: '2Fez68NcinnEh17ts9o6i2c3PPZWLu3zR85Bwy1UUbgc',
  userId: 'u_dev123',
  username: 'foxtilki_dev',
  is_pump_user: true,
  profile_image: 'https://socialimages.pump.fun/dev.webp',
  followers: 42,
  following: 10,
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
    if (url.match(/\/coins\/[1-9A-HJ-NP-Za-km-z]+/)) {
      return { status: 200, headers: {}, data: COIN_META_FIXTURE };
    }
    if (url.includes('/users/')) {
      return { status: 200, headers: {}, data: USER_FIXTURE };
    }
    if (url.includes('/coins?')) {
      return { status: 200, headers: {}, data: [COIN_META_FIXTURE] };
    }
    return { status: 404, headers: {}, data: {} };
  });
  // Inject a fake livechat — no real wss://livechat.pump.fun connection in tests.
  client.livechat = {
    getMessageHistory: vi.fn(async () => ({ messages: [], nextCursor: null })),
    joinRoom: vi.fn(async () => ({})),
    subscribeRoom: vi.fn(async (mint, opts) => {
      opts.onMessage?.({ id: 'msg1', text: 'hi from stream' });
      opts.onReaction?.({ emoji: '🔥' });
      return { messageCount: 1, durationMs: 100 };
    }),
    close: vi.fn(async () => {}),
  };
  Object.assign(client, overrides);
  return client;
}

function makeCrawler(clientOverrides = {}) {
  const client = makeClient(clientOverrides);
  const kolResolver = new KolscanResolver({ seedPath: 'nonexistent.json', fetchFn: async () => { throw new Error('kolscan down'); } });
  const auth = new PumpFunAuth('test');
  const livestreamApi = new LivestreamApiClient(auth, { fetchFn: vi.fn() });
  return new PumpFunCrawler({
    client,
    kolResolver,
    auth,
    livestreamApi,
    startLivestreamPoller: false,
  });
}

// Seed a valid session for auth tests
function seedAuthSession() {
  globalSessionManager.set('pumpfun:test', {
    accountId: 'pumpfun:test',
    platform: 'pumpfun',
    jwt: 'eyJhbGciOiJFUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.fake',
    cookies: '_cfuvid=test',
    userAgent: 'test-agent',
    userId: 'u_test123',
    walletAddress: 'WALLET123',
  });
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
  it('lists all registered pumpfun actions via listActions', async () => {
    const crawler = makeCrawler();
    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);
    expect(actionNames).toContain('fetch_mint_social');
    expect(actionNames).toContain('resolve_user_wallet');
    expect(actionNames).toContain('fetch_platform_feed');
    expect(actionNames).toContain('stream_mint_chat');
    await crawler.cleanup();
  });
});

describe('Story 20.6: Full Social Intelligence (coinMeta enrichment)', () => {
  it('enriches fetchMintSocial with coinMeta (socialLinks, creator, marketCapUsd)', async () => {
    const crawler = makeCrawler();
    const r = await crawler.fetchMintSocial({ mintAddress: VALID_MINT });
    expect(r.coinMeta).toBeTruthy();
    expect(r.coinMeta.name).toBe('Foxtilki');
    expect(r.coinMeta.creator).toBe('2Fez68NcinnEh17ts9o6i2c3PPZWLu3zR85Bwy1UUbgc');
    expect(r.coinMeta.socialLinks).toEqual({
      twitter: 'https://x.com/foxtilki',
      telegram: 'https://t.me/foxtilki',
      website: 'https://foxtilki.com',
    });
    expect(r.coinMeta.marketCapUsd).toBeCloseTo(57703.2);
    expect(r.coinMeta.replyCount).toBe(2029);
    await crawler.cleanup();
  });

  it('caches getCoin in-memory so repeated calls skip upstream request', async () => {
    const client = makeClient();
    const c1 = await client.getCoin(VALID_MINT);
    const c2 = await client.getCoin(VALID_MINT);
    expect(c1.name).toBe('Foxtilki');
    expect(c2.name).toBe('Foxtilki');
    // Only 1 upstream request should be made due to in-memory TTL cache
    const coinCalls = client.request.mock.calls.filter(([, url]) => url.endsWith(`/coins/${VALID_MINT}`)).length;
    expect(coinCalls).toBe(1);
  });
});

describe('Story 20.6: resolve_user_wallet', () => {
  it('resolves username to wallet address and user profile', async () => {
    const crawler = makeCrawler();
    const user = await crawler.resolveUserWallet({ username: 'foxtilki_dev' });
    expect(user).toBeTruthy();
    expect(user.username).toBe('foxtilki_dev');
    expect(user.walletAddress).toBe('2Fez68NcinnEh17ts9o6i2c3PPZWLu3zR85Bwy1UUbgc');
    expect(user.userId).toBe('u_dev123');
    expect(user.isPumpUser).toBe(true);
    expect(user.followers).toBe(42);
    await crawler.cleanup();
  });

  it('throws XACT_4002 when username is empty', async () => {
    const crawler = makeCrawler();
    await expect(crawler.resolveUserWallet({ username: '' })).rejects.toMatchObject({ code: 'XACT_4002' });
    await crawler.cleanup();
  });
});

describe('Story 20.6: fetch_platform_feed', () => {
  it('fetches and normalizes coins from platform feeds', async () => {
    const crawler = makeCrawler();
    const feed = await crawler.fetchPlatformFeed({ feedType: 'new_creations', limit: 10 });
    expect(Array.isArray(feed)).toBe(true);
    expect(feed).toHaveLength(1);
    expect(feed[0].mint).toBe(VALID_MINT);
    expect(feed[0].name).toBe('Foxtilki');
    expect(feed[0].socialLinks.twitter).toBe('https://x.com/foxtilki');
    await crawler.cleanup();
  });

  it('supports currently_live feedType from poller/live list', async () => {
    const crawler = makeCrawler();
    const feed = await crawler.fetchPlatformFeed({ feedType: 'currently_live' });
    expect(Array.isArray(feed)).toBe(true);
    expect(feed).toHaveLength(1);
    expect(feed[0].mint).toBe(VALID_MINT);
    await crawler.cleanup();
  });
});

describe('Story 20.6: stream_mint_chat', () => {
  it('subscribes to livechat events and invokes callbacks', async () => {
    const crawler = makeCrawler();
    const messages = [];
    const reactions = [];
    const result = await crawler.streamMintChat({
      mintAddress: VALID_MINT,
      durationMs: 100,
      onMessage: (m) => messages.push(m),
      onReaction: (r) => reactions.push(r),
    });
    expect(result.messageCount).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('hi from stream');
    expect(reactions).toHaveLength(1);
    expect(reactions[0].emoji).toBe('🔥');
    await crawler.cleanup();
  });
});

describe('Story 20.7: Authenticated Live Media & Write Actions', () => {
  it('throws XACT_4010 when no session is active for authenticated actions', async () => {
    globalSessionManager.delete('pumpfun:test');
    const crawler = makeCrawler();
    await expect(crawler.fetchMyProfile({})).rejects.toMatchObject({ code: 'XACT_4010' });
    await expect(crawler.fetchUserFollowing({ userId: 'u1' })).rejects.toMatchObject({ code: 'XACT_4010' });
    await expect(crawler.postMintReply({ mintAddress: VALID_MINT, text: 'hi' })).rejects.toMatchObject({ code: 'XACT_4010' });
    await crawler.cleanup();
  });

  it('fetches authenticated my_profile when session is valid', async () => {
    seedAuthSession();
    const crawler = makeCrawler();
    // Mock livestreamApi.getMyProfile
    crawler.livestreamApi.getMyProfile = vi.fn(async () => ({
      username: 'testuser',
      userId: 'u_test123',
      address: 'WALLET123',
      is_pump_user: true,
      followers: 5,
      following: 10,
    }));
    const profile = await crawler.fetchMyProfile({});
    expect(profile.username).toBe('testuser');
    expect(profile.address).toBe('WALLET123');
    expect(profile.is_pump_user).toBe(true);
    await crawler.cleanup();
  });

  it('fetches user_following with valid session', async () => {
    seedAuthSession();
    const crawler = makeCrawler();
    crawler.livestreamApi.getFollowing = vi.fn(async (uid) => [{ userId: uid, username: 'following_user' }]);
    const following = await crawler.fetchUserFollowing({ userId: 'u_test123' });
    expect(Array.isArray(following)).toBe(true);
    expect(following[0].username).toBe('following_user');
    await crawler.cleanup();
  });

  it('enforces rate limit on post_mint_reply (max 5/min)', async () => {
    seedAuthSession();
    const crawler = makeCrawler();
    crawler.livestreamApi.postMintReply = vi.fn(async () => ({ id: 'c1', timestamp: Date.now() }));

    // Post 5 comments successfully
    for (let i = 0; i < 5; i++) {
      await crawler.postMintReply({ mintAddress: VALID_MINT, text: `test ${i}` });
    }
    // 6th should fail with rate limit
    await expect(crawler.postMintReply({ mintAddress: VALID_MINT, text: 'test 6' })).rejects.toMatchObject({ code: 'XACT_4291' });
    await crawler.cleanup();
  });

  it('posts mint reply with valid session', async () => {
    seedAuthSession();
    const crawler = makeCrawler();
    crawler.livestreamApi.postMintReply = vi.fn(async (mint, text) => ({
      id: 'comment_abc123',
      mint,
      text,
      timestamp: Date.now(),
    }));
    const result = await crawler.postMintReply({ mintAddress: VALID_MINT, text: 'Great token!' });
    expect(result.success).toBe(true);
    expect(result.commentId).toBe('comment_abc123');
    expect(result.mint).toBe(VALID_MINT);
    await crawler.cleanup();
  });
});
