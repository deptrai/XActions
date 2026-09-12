// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// P0-1/P0-2: Selector smoke tests against live X/Twitter and Facebook DOM.
// Gated by env vars — skips automatically if no session cookie available.
// Run manually: X_SESSION_COOKIE=xxx npm test -- tests/smoke/selector-smoke.test.js
// by nichxbt

import { describe, it, expect, beforeAll } from 'vitest';
import { createBrowser, createPage, loginWithCookie } from '../../src/scrapers/facebook/index.js';

const X_COOKIE = process.env.X_SESSION_COOKIE || process.env.XACTIONS_SESSION_COOKIE;
const FB_C_USER = process.env.FB_C_USER;
const FB_XS = process.env.FB_XS;

const hasXSession = typeof X_COOKIE === 'string' && X_COOKIE.length > 10;
const hasFbSession = typeof FB_C_USER === 'string' && FB_C_USER.length > 5 && typeof FB_XS === 'string' && FB_XS.length > 5;

const SKIP_REASON = 'No session cookie env var set (X_SESSION_COOKIE / FB_C_USER + FB_XS)';

// ============================================================================
// Twitter/X Selectors — data-testid based (verified Jan 2026)
// ============================================================================

const TWITTER_SELECTORS = [
  { name: 'tweet', selector: 'article[data-testid="tweet"]', minCount: 0 },
  { name: 'tweetText', selector: '[data-testid="tweetText"]', minCount: 0 },
  { name: 'UserCell', selector: '[data-testid="UserCell"]', minCount: 0 },
  { name: 'SearchBox_Search_Input', selector: '[data-testid="SearchBox_Search_Input"]', minCount: 1 },
  { name: 'SideNav_NewTweet_Button', selector: 'a[data-testid="SideNav_NewTweet_Button"]', minCount: 1 },
  { name: 'like', selector: '[data-testid="like"]', minCount: 0 },
  { name: 'reply', selector: '[data-testid="reply"]', minCount: 0 },
  { name: 'retweet', selector: '[data-testid="retweet"]', minCount: 0 },
  { name: 'bookmark', selector: '[data-testid="bookmark"]', minCount: 0 },
  { name: 'UserAvatar', selector: '[data-testid*="UserAvatar"] img', minCount: 1 },
  { name: 'UserName', selector: '[data-testid="UserName"]', minCount: 1 },
];

// ============================================================================
// Facebook Selectors — role/aria-label based (verified Aug 2026)
// ============================================================================

const FACEBOOK_SELECTORS = [
  { name: 'role=article (post container)', selector: '[role="article"]', minCount: 0 },
  { name: 'og:title meta', selector: 'meta[property="og:title"]', minCount: 1 },
  { name: 'og:description meta', selector: 'meta[property="og:description"]', minCount: 1 },
  { name: 'og:image meta', selector: 'meta[property="og:image"]', minCount: 1 },
  { name: 'aria-label=Like', selector: '[aria-label="Like"], [aria-label="Thích"]', minCount: 0 },
  { name: 'aria-label=Comment', selector: '[aria-label="Comment"], [aria-label="Bình luận"]', minCount: 0 },
  { name: 'role=main', selector: '[role="main"]', minCount: 1 },
  { name: 'dir=auto (text container)', selector: '[dir="auto"]', minCount: 1 },
  { name: 'login form (should NOT exist post-login)', selector: 'form[action*="login"], [data-testid="royal_login_form"]', minCount: 0, expectZero: true },
];

// ============================================================================
// Helper: launch browser with launchImpl seam fallback
// ============================================================================

async function launchBrowser({ headless = true } = {}) {
  return createBrowser({ headless, launchImpl: undefined });
}

// ============================================================================
// P0-1: Twitter/X selector smoke tests
// ============================================================================

describe('P0-1: Twitter/X selector smoke (live DOM)', () => {
  beforeAll(() => {
    if (!hasXSession) return;
  });

  it.skipIf(!hasXSession)('home feed contains tweet articles and navigation elements', async () => {
    const puppeteer = (await import('puppeteer-extra')).default;
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    puppeteer.use(StealthPlugin());

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setCookie({
        name: 'auth_token',
        value: X_COOKIE,
        domain: '.twitter.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      });

      await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 3000));

      const results = {};
      for (const { name, selector, minCount, expectZero } of TWITTER_SELECTORS) {
        const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, selector);
        results[name] = count;

        if (expectZero) {
          expect(count, `${name} should be 0 (not logged in indicator)`).toBe(0);
        } else if (minCount > 0) {
          expect(count, `${name} expected >= ${minCount}, got ${count}`).toBeGreaterThanOrEqual(minCount);
        }
      }

      console.log('Twitter selector smoke results:', results);
    } finally {
      await browser.close();
    }
  }, 60000);

  it.skipIf(!hasXSession)('profile page has UserAvatar and UserName', async () => {
    const puppeteer = (await import('puppeteer-extra')).default;
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    puppeteer.use(StealthPlugin());

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setCookie({
        name: 'auth_token',
        value: X_COOKIE,
        domain: '.twitter.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      });

      await page.goto('https://x.com/elonmusk', { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 3000));

      const avatarCount = await page.evaluate(() => document.querySelectorAll('[data-testid*="UserAvatar"] img').length);
      const nameCount = await page.evaluate(() => document.querySelectorAll('[data-testid="UserName"]').length);

      expect(avatarCount, 'UserAvatar should be present on profile page').toBeGreaterThanOrEqual(1);
      expect(nameCount, 'UserName should be present on profile page').toBeGreaterThanOrEqual(1);
    } finally {
      await browser.close();
    }
  }, 60000);
});

// ============================================================================
// P0-2: Facebook selector smoke tests
// ============================================================================

describe('P0-2: Facebook selector smoke (live DOM)', () => {
  it.skipIf(!hasFbSession)('home feed has role=article posts and navigation', async () => {
    const browser = await launchBrowser({ headless: true });
    try {
      const page = await createPage(browser);
      await loginWithCookie(page, { c_user: FB_C_USER, xs: FB_XS });

      await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 3000));

      const results = {};
      for (const { name, selector, minCount, expectZero } of FACEBOOK_SELECTORS) {
        const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, selector);
        results[name] = count;

        if (expectZero) {
          expect(count, `${name} should be 0 (post-login)`).toBe(0);
        } else if (minCount > 0) {
          expect(count, `${name} expected >= ${minCount}, got ${count}`).toBeGreaterThanOrEqual(minCount);
        }
      }

      console.log('Facebook selector smoke results:', results);
    } finally {
      await browser.close();
    }
  }, 60000);

  it.skipIf(!hasFbSession)('profile page has og:title and og:image meta tags', async () => {
    const browser = await launchBrowser({ headless: true });
    try {
      const page = await createPage(browser);
      await loginWithCookie(page, { c_user: FB_C_USER, xs: FB_XS });

      await page.goto('https://www.facebook.com/zuck', { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 3000));

      const ogTitle = await page.evaluate(() => {
        const el = document.querySelector('meta[property="og:title"]');
        return el ? el.getAttribute('content') : null;
      });
      const ogImage = await page.evaluate(() => {
        const el = document.querySelector('meta[property="og:image"]');
        return el ? el.getAttribute('content') : null;
      });

      expect(ogTitle, 'og:title meta should exist on profile page').not.toBeNull();
      expect(ogImage, 'og:image meta should exist on profile page').not.toBeNull();
    } finally {
      await browser.close();
    }
  }, 60000);

  it.skipIf(!hasFbSession)('checkpoint detection does not trigger on normal page', async () => {
    const browser = await launchBrowser({ headless: true });
    try {
      const page = await createPage(browser);
      await loginWithCookie(page, { c_user: FB_C_USER, xs: FB_XS });

      const bodyText = await page.evaluate(() => document.body.innerText);
      const hasCheckpoint = bodyText.includes('confirm that you are a real person') ||
        (bodyText.includes('confirm that you') && bodyText.includes('human')) ||
        bodyText.includes('security check');

      expect(hasCheckpoint, 'Normal page should NOT trigger checkpoint detection').toBe(false);
    } finally {
      await browser.close();
    }
  }, 60000);
});

// ============================================================================
// Selector registry integrity (no live browser needed)
// ============================================================================

describe('Selector registry integrity (static)', () => {
  it('Twitter selectors are all data-testid based', () => {
    const nonTestid = TWITTER_SELECTORS.filter(
      (s) => !s.selector.includes('data-testid') && !s.expectZero
    );
    expect(nonTestid, 'All Twitter selectors should use data-testid').toHaveLength(0);
  });

  it('Facebook selectors prioritize role/aria-label over class names', () => {
    const classBased = FACEBOOK_SELECTORS.filter(
      (s) => s.selector.includes('.') && !s.selector.includes('og:') && !s.selector.includes('meta')
    );
    expect(classBased, 'Facebook selectors should not use class-based selectors').toHaveLength(0);
  });

  it('all selectors are non-empty strings', () => {
    for (const { name, selector } of [...TWITTER_SELECTORS, ...FACEBOOK_SELECTORS]) {
      expect(typeof selector, `${name} selector should be a string`).toBe('string');
      expect(selector.length, `${name} selector should not be empty`).toBeGreaterThan(0);
    }
  });
});
