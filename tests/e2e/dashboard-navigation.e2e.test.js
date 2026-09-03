// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Playwright E2E — core dashboard navigation, platform routing, and analytics load.
 * Uses the real Express app from api/server.js to test against actual HTML and API responses.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

// Force test mode so server.js does not call httpServer.listen on import.
process.env.NODE_ENV = 'test';
process.env.PORT = '0';

let server = null;
let baseUrl = '';
let authToken = '';
let testUsername = '';

async function getOrCreateUser(baseUrl, prefix) {
  const username = `${prefix}_${Date.now()}`;
  const password = 'testpass123';
  const email = `e2e_${Date.now()}@x.local`;

  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email }),
  });

  if (regRes.ok) {
    const regData = await regRes.json();
    return { username, token: regData.token };
  }

  // User may already exist from a previous run — try logging in.
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password }),
  });
  if (!loginRes.ok) {
    const err = await loginRes.text();
    throw new Error(`Could not register or login test user: ${err}`);
  }
  const loginData = await loginRes.json();
  return { username, token: loginData.token };
}

test.beforeAll(async () => {
  const { default: app } = await import('../../api/server.js');
  server = createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  const { username, token } = await getOrCreateUser(baseUrl, 'e2e');
  testUsername = username;
  authToken = token;

  const {
    saveAccountSnapshot,
    saveDailyEngagement,
    saveTweetSnapshot,
    getDatabase,
  } = await import('../../src/analytics/historyStore.js');

  // Clean any stale snapshots for this test user so the latest value is deterministic.
  const db = getDatabase();
  for (const table of ['account_snapshots', 'engagement_daily', 'tweet_snapshots']) {
    db.prepare(`DELETE FROM ${table} WHERE username = ?`).run(username.toLowerCase());
  }

  const today = new Date().toISOString().split('T')[0];

  saveAccountSnapshot(username, {
    followers_count: 15276,
    following_count: 3260,
    tweet_count: 583,
    listed_count: 10,
    verified: true,
    snapshot_at: `${today}T12:00:00.000Z`,
  });

  // Add an earlier snapshot so the dashboard can compute a positive change.
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  saveAccountSnapshot(username, {
    followers_count: 15000,
    following_count: 3250,
    tweet_count: 580,
    listed_count: 10,
    verified: true,
    snapshot_at: `${yesterday}T12:00:00.000Z`,
  });

  saveDailyEngagement(username, {
    date: today,
    avg_engagement_rate: 4.98,
    total_impressions: 437096,
    total_engagements: 21750,
    top_tweet_id: 'tweet_sample_001',
  });

  saveTweetSnapshot(username, 'tweet_sample_001', {
    likes: 1234,
    retweets: 567,
    replies: 89,
    quotes: 45,
    views: 45000,
    bookmarkCount: 12,
  });
});

test.afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
});

// Desktop viewport so the left sidebar is visible.
test.use({ viewport: { width: 1280, height: 720 } });

test.describe('Dashboard navigation and routing', () => {
  test('index loads with sidebar and main content', async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.sidebar-left', { state: 'visible', timeout: 10000 });
    await expect(page.locator('.sidebar-left')).toBeVisible();
    await expect(page.locator('#main-content')).toContainText('XActions Automation');
  });

  test('platform page detects /platforms/x and renders X actions', async ({ page }) => {
    await page.goto(`${baseUrl}/platforms/x`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#platform-title', { state: 'visible' });
    await expect(page.locator('#platform-title')).toContainText('X / Twitter Automation');
    await expect(page.locator('#tab-bar')).toContainText('Actions');
    await expect(page.locator('#form-actions')).toContainText('Like Tweets');
  });

  test('platform page falls back to facebook for unknown platform', async ({ page }) => {
    await page.goto(`${baseUrl}/platforms/unknown`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#platform-title', { state: 'visible' });
    await expect(page.locator('#platform-title')).toContainText('Facebook Automation');
  });

  test('run page loads and shows scripts section', async ({ page }) => {
    await page.goto(`${baseUrl}/run`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('One-Click Scripts');
    await expect(page.locator('#main-content')).toContainText('Run via Dashboard');
  });
});

test.describe('Authenticated analytics dashboard', () => {
  test('analytics loads real data when authenticated', async ({ page }) => {
    // Seed the auth token into the page's localStorage before navigation so it is
    // available when sidebar.js and config.js run.
    await page.goto(`${baseUrl}/analytics-dashboard`);
    await page.evaluate((token) => localStorage.setItem('authToken', token), authToken);

    // Reload so sidebar/config pick up the token.
    await page.goto(`${baseUrl}/analytics-dashboard`, { waitUntil: 'networkidle' });

    await page.fill('#username-input', testUsername);
    await page.click('#load-btn');

    await expect(page.locator('#card-followers')).toContainText('15,276', { timeout: 10000 });
    await expect(page.locator('#card-followers-change')).toContainText('+', { timeout: 5000 });
  });

  test('sidebar active state highlights current page', async ({ page }) => {
    await page.goto(`${baseUrl}/analytics-dashboard`, { waitUntil: 'networkidle' });
    const active = page.locator('.nav-item.active');
    await expect(active).toHaveCount(1);
    await expect(active).toContainText('Analytics');
  });
});
