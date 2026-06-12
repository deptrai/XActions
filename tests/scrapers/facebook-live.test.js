// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Epic 5 — Facebook Messenger Port: Live Integration Tests
 *
 * Tests all 4 stories against the real Facebook API using a real session cookie.
 * Skipped by default — only runs when FACEBOOK_LIVE_TESTS=true.
 *
 * Run with:
 *   FACEBOOK_LIVE_TESTS=true FACEBOOK_COOKIE="c_user=...; xs=...; datr=..." \
 *     vitest run tests/scrapers/facebook-live.test.js
 *
 * Requirements:
 *   - Valid Facebook session cookie (c_user + xs + datr minimum)
 *   - Network access to facebook.com
 *
 * Optional proxy tests (Story 5.3):
 *   FACEBOOK_PROXY_KEY_PROXYFB=...
 *   FACEBOOK_PROXY_KEY_TMPROXY=...
 *   FACEBOOK_PROXY_KEY_SHOPLIKE=...
 *
 * ⚠️  Consumes real Facebook rate-limit quota. Run sparingly.
 *     All write-path tests use dryRun=true — no posts or messages are sent.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  getFacebookTokens,
  getPagesFromCookie,
  checkMessengerCTA,
} from '../../src/scrapers/facebook/graphql.js';
import { messengerShareCampaign } from '../../src/scrapers/facebook/messengerShare.js';
import { rotateProxy } from '../../src/scrapers/facebook/proxy.js';
import { executeFacebookAutomateTool } from '../../src/mcp/server.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LIVE = process.env.FACEBOOK_LIVE_TESTS === 'true';
const COOKIE = process.env.FACEBOOK_COOKIE || '';
const PROXY_KEY_PROXYFB  = process.env.FACEBOOK_PROXY_KEY_PROXYFB  || '';
const PROXY_KEY_TMPROXY  = process.env.FACEBOOK_PROXY_KEY_TMPROXY  || '';
const PROXY_KEY_SHOPLIKE = process.env.FACEBOOK_PROXY_KEY_SHOPLIKE || '';

function parseCookieParts(cookie) {
  const get = (key) => {
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
    return m ? m[1] : '';
  };
  return { c_user: get('c_user'), xs: get('xs') };
}

// ===========================================================================
// Suite — skipped unless FACEBOOK_LIVE_TESTS=true
// ===========================================================================

describe.skipIf(!LIVE)('Epic 5 — Facebook Live Integration Tests', () => {
  let tokens = null;
  let pages  = [];

  beforeAll(async () => {
    if (!COOKIE) {
      throw new Error(
        'FACEBOOK_COOKIE env var required.\n' +
        'Format: "c_user=XXXXXXXX; xs=XXXXXXXXXX; datr=XXXXX; ..."',
      );
    }
    tokens = await getFacebookTokens(COOKIE);
  }, 30_000);

  // =========================================================================
  // Story 5.1 — Token scraper (getFacebookTokens)
  // =========================================================================

  describe('Story 5.1 — getFacebookTokens (real HTTP to facebook.com)', () => {
    it('returns all 6 tokens from a live logged-in session', () => {
      expect(tokens).not.toBeNull();
      expect(tokens.fb_dtsg).toBeTruthy();
      expect(tokens.lsd).toBeTruthy();
      expect(tokens.jazoest).toBeTruthy();
      expect(tokens.hsi).toBeTruthy();
      expect(tokens.spin_r).toBeTruthy();
      expect(tokens.spin_t).toBeTruthy();
    });

    it('fb_dtsg starts with NAf prefix (standard session token shape)', () => {
      expect(tokens?.fb_dtsg?.startsWith('NAf')).toBe(true);
    });

    it('lsd is a short alphanumeric string', () => {
      expect(tokens?.lsd).toMatch(/^[A-Za-z0-9_-]{5,40}$/);
    });

    it('spin_t is a recent Unix timestamp (within last 30 days)', () => {
      const spinT = Number(tokens?.spin_t);
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      expect(spinT).toBeGreaterThan(thirtyDaysAgo);
    });
  });

  // =========================================================================
  // Story 5.1 — Page list (getPagesFromCookie)
  // =========================================================================

  describe('Story 5.1 — getPagesFromCookie (real Graph API)', () => {
    beforeAll(async () => {
      pages = await getPagesFromCookie(COOKIE);
    }, 30_000);

    it('returns an array (empty is valid for personal accounts)', () => {
      expect(Array.isArray(pages)).toBe(true);
    });

    it('each page entry has pageId, name, accessToken shape', () => {
      for (const p of pages) {
        expect(typeof p.pageId).toBe('string');
        expect(typeof p.name).toBe('string');
        expect(typeof p.accessToken).toBe('string');
      }
    });
  });

  // =========================================================================
  // Story 5.1 — Messenger CTA eligibility (checkMessengerCTA)
  // =========================================================================

  describe('Story 5.1 — checkMessengerCTA (real GraphQL, only if pages exist)', () => {
    it('returns { eligible: boolean } for first page if available', async () => {
      if (pages.length === 0) {
        console.log('⚠️  No pages found for this account — CTA check skipped');
        return;
      }
      const { c_user } = parseCookieParts(COOKIE);
      const result = await checkMessengerCTA(pages[0].pageId, c_user, tokens);
      expect(result).toHaveProperty('eligible');
      expect(typeof result.eligible).toBe('boolean');
    }, 15_000);
  });

  // =========================================================================
  // Story 5.2 — Messenger share campaign dry-run (no browser launched)
  // =========================================================================

  describe('Story 5.2 — messengerShareCampaign dry-run (no browser)', () => {
    it('returns runGuardedBatch preview shape with dryRun=true', async () => {
      const campaign = {
        postUrl: 'https://www.facebook.com/permalink/1234567890',
        recipients: ['Page Alpha', 'Page Beta'],
        content: 'Check this out **also this variant',
      };
      const result = await messengerShareCampaign(null, campaign, { dryRun: true });
      expect(result).toBeDefined();
      expect(result.dryRun).toBe(true);
      expect(Array.isArray(result.targets)).toBe(true);
      expect(result.targets).toHaveLength(2);
    }, 10_000);

    it('dry-run targets length matches recipients count', async () => {
      const campaign = {
        postUrl: 'https://www.facebook.com/permalink/1234567890',
        recipients: ['Alpha', 'Beta', 'Gamma'],
        content: 'Hello world',
      };
      const result = await messengerShareCampaign(null, campaign, { dryRun: true });
      expect(result.targets).toHaveLength(3);
    }, 10_000);
  });

  // =========================================================================
  // Story 5.3 — Proxy rotation (real provider APIs, optional)
  // =========================================================================

  describe('Story 5.3 — rotateProxy (real provider API, requires env key)', () => {
    it('proxyfb: returns normalized descriptor', async () => {
      if (!PROXY_KEY_PROXYFB) {
        return console.log('⚠️  FACEBOOK_PROXY_KEY_PROXYFB not set — skipped');
      }
      const result = await rotateProxy('proxyfb', PROXY_KEY_PROXYFB);
      expect(result.proxy).toMatch(/^[\d.]+:\d+$/);
      expect(result.server).toMatch(/^https?:\/\//);
      expect(typeof result.username).toBe('string');
      expect(typeof result.password).toBe('string');
    }, 15_000);

    it('tmproxy: returns normalized descriptor', async () => {
      if (!PROXY_KEY_TMPROXY) {
        return console.log('⚠️  FACEBOOK_PROXY_KEY_TMPROXY not set — skipped');
      }
      const result = await rotateProxy('tmproxy', PROXY_KEY_TMPROXY);
      expect(result.proxy).toMatch(/^[\d.]+:\d+$/);
      expect(result.server).toMatch(/^https?:\/\//);
    }, 15_000);

    it('shoplike: returns normalized descriptor', async () => {
      if (!PROXY_KEY_SHOPLIKE) {
        return console.log('⚠️  FACEBOOK_PROXY_KEY_SHOPLIKE not set — skipped');
      }
      const result = await rotateProxy('shoplike', PROXY_KEY_SHOPLIKE);
      expect(result.proxy).toMatch(/^[\d.]+:\d+$/);
      expect(result.server).toMatch(/^https?:\/\//);
    }, 15_000);
  });

  // =========================================================================
  // Story 5.4 — MCP surface dry-run (executeFacebookAutomateTool)
  // =========================================================================

  describe('Story 5.4 — executeFacebookAutomateTool dry-run (MCP surface)', () => {
    it('messenger action dry-run returns preview without launching browser', async () => {
      const { c_user, xs } = parseCookieParts(COOKIE);
      if (!c_user || !xs) throw new Error('FACEBOOK_COOKIE must contain c_user and xs');

      const result = await executeFacebookAutomateTool({
        action: 'messenger',
        authCookie: { c_user, xs },
        postUrl: 'https://www.facebook.com/permalink/1234567890',
        recipients: ['Test Page'],
        content: 'Live smoke test — dry-run',
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.dryRun).toBe(true);
    }, 15_000);

    it('like action dry-run returns preview without launching browser', async () => {
      const { c_user, xs } = parseCookieParts(COOKIE);

      const result = await executeFacebookAutomateTool({
        action: 'like',
        authCookie: { c_user, xs },
        urls: ['https://www.facebook.com/permalink/1234567890'],
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.dryRun).toBe(true);
    }, 15_000);
  });
});
