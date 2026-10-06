// tests/scrapers/social/facebook/guest-lane.contract.test.js
// Story 50.10 — Facebook Guest/Public Scrape Lane contract tests.
// Verifies auth:'guest' forces the anonymous DOM lane (no cookie, no account
// auto-pick), rejects auth-required actions with FB_REQUIRES_AUTH, and that
// bogus auth values return a clean 400.
// by nichxbt
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../../api/server.js';
import {
  seedTestUser,
  cleanupTestUser,
  makeTestUserId,
  makeFacebookProfileUrl,
} from '../../../api/fixtures/test-user.js';
import { FacebookCrawler } from '../../../../src/scrapers/social/facebook/crawler.js';
import { FacebookClient } from '../../../../src/scrapers/social/facebook/client.js';
import { AdaptiveRateGovernor } from '../../../../src/core/adaptive-governor.js';
import { AccountPool } from '../../../../src/core/account-pool.js';
import { SessionManager } from '../../../../src/core/session-manager.js';
import { ProxyIpPool } from '../../../../src/proxy/proxy-pool.js';

const TEST_USER_ID = makeTestUserId('fb-guest-lane');
/** @type {string} */
let authToken;

beforeAll(async () => {
  const result = await seedTestUser(TEST_USER_ID, 'fb_guest_lane_test');
  authToken = result.token;
});

afterAll(async () => {
  await cleanupTestUser(TEST_USER_ID);
});

/** @param {Record<string, unknown>} body */
const postFbScrape = (body) =>
  request(app).post('/api/facebook/scrape').set('Authorization', `Bearer ${authToken}`).send(body);

/** @param {Record<string, unknown>} body */
const postPlatformScrape = (body) =>
  request(app).post('/api/platform/facebook/scrape').set('Authorization', `Bearer ${authToken}`).send(body);

// ---------------------------------------------------------------------------
// A. Crawler descriptor contract — guest-eligible actions are registered.
// ---------------------------------------------------------------------------
describe('FacebookCrawler — guest-eligible action descriptors', () => {
  it('registers the public read actions that the guest lane may run', () => {
    const proxyPool = new ProxyIpPool({ proxies: [] });
    const governor = new AdaptiveRateGovernor({ proxyPool });
    const client = new FacebookClient({ baseUrl: 'http://127.0.0.1:9' });
    const crawler = new FacebookCrawler({
      client,
      governor,
      accountPool: new AccountPool({ governor }),
      sessionManager: new SessionManager(),
    });

    const names = crawler.listActions().map((a) => a.action);
    for (const action of ['profile', 'page_posts', 'group_posts', 'post_comments', 'search']) {
      expect(names).toContain(action);
    }
  });
});

// ---------------------------------------------------------------------------
// B. POST /api/facebook/scrape — auth flag validation + guest lane.
// ---------------------------------------------------------------------------
describe('POST /api/facebook/scrape — auth: guest lane', () => {
  it('returns 400 for a bogus auth value', async () => {
    const res = await postFbScrape({
      action: 'posts',
      url: makeFacebookProfileUrl('somepublicpage'),
      auth: 'bogus',
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/auth must be 'auto' or 'guest'/);
  });

  it('accepts auth: guest on a public action — does not fail on auth validation', async () => {
    // Guest skips resolveScrapeCookie entirely; the run then proceeds to the
    // scraper dispatch (which cannot launch a real browser in test env → 500).
    // The contract assertion: it must NOT be a 400/auth-validation failure.
    const res = await postFbScrape({
      action: 'posts',
      url: makeFacebookProfileUrl('somepublicpage'),
      auth: 'guest',
    });
    expect(res.status).not.toBe(400);
    expect(res.body.code).not.toBe('FB_REQUIRES_AUTH');
  }, 30000);

  it('returns 400 FB_REQUIRES_AUTH when guest targets an action outside the public set', async () => {
    // 'comments' is a VALID_ACTIONS alias but not in PUBLIC_SCRAPE_ACTIONS.
    const res = await postFbScrape({
      action: 'comments',
      url: 'https://www.facebook.com/somepage/posts/12345',
      auth: 'guest',
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('FB_REQUIRES_AUTH');
  });
});

// ---------------------------------------------------------------------------
// C. POST /api/platform/facebook/scrape — guest gate at the unified gateway.
// ---------------------------------------------------------------------------
describe('POST /api/platform/facebook/scrape — guest gate', () => {
  it('returns 400 for a bogus auth value', async () => {
    const res = await postPlatformScrape({
      action: 'posts',
      url: makeFacebookProfileUrl('somepublicpage'),
      auth: 'bogus',
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/auth must be 'auto' or 'guest'/);
  });

  it('returns 400 FB_REQUIRES_AUTH for an auth-required action in guest mode', async () => {
    const res = await postPlatformScrape({
      action: 'like',
      url: 'https://www.facebook.com/somepage/posts/12345',
      auth: 'guest',
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FB_REQUIRES_AUTH');
    expect(res.body.error.message).toMatch(/requires authentication/);
  });

  it('forwards auth: guest on a public action — no auth-validation rejection', async () => {
    const res = await postPlatformScrape({
      action: 'post_comments',
      url: 'https://www.facebook.com/somepage/posts/12345',
      auth: 'guest',
    });
    // Must pass the guest gate; whatever happens downstream (browser launch
    // fails in test env) is not a 400 validation/auth error.
    expect(res.status).not.toBe(400);
    expect(res.body.code).not.toBe('FB_REQUIRES_AUTH');
  }, 30000);
});

// ---------------------------------------------------------------------------
// D. Service-level: run() with auth:'guest' skips authCookie resolution.
// ---------------------------------------------------------------------------
describe('facebookScrape.run() — guest bypasses resolveFacebookAuth', () => {
  it('does not resolve a stored accountId when auth is guest', async () => {
    const { run } = await import('../../../../api/services/facebookScrape.js');
    // A bogus accountId would throw ACCOUNT_NOT_FOUND during resolution in
    // 'auto' mode. In guest mode the resolver is skipped entirely, so any
    // failure must come from the scrape path itself — never account lookup.
    /** @type {Error | null} */
    let err = null;
    try {
      await run('posts', {
        url: makeFacebookProfileUrl('somepublicpage'),
        auth: 'guest',
        authCookie: { accountId: 'acc_does_not_exist_xyz' },
      });
    } catch (e) {
      err = /** @type {Error} */ (e);
    }
    // If resolution had run, it would have thrown 'Facebook account not found'.
    expect(String(err?.message ?? '')).not.toMatch(/account not found/i);
    expect(String(err?.message ?? '')).not.toMatch(/requires authCookie/i);
  }, 30000);
});
