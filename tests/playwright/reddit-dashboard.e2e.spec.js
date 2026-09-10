// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// Playwright E2E — Story 35.1: Reddit Dashboard UI verification.
// by nichxbt

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.PORT = '0';

let server = null;
let baseUrl = '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-for-local-development';
const TEST_TOKEN = jwt.sign({ userId: 'demo_user_reddit_ui' }, JWT_SECRET, { expiresIn: '1h' });

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
});

test.afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
});

test.describe('Story 35.1 — Reddit Dashboard UI Exposure', () => {
  test('renders Reddit platform header, tabs, and default Subreddit form', async ({ page }) => {
    await page.goto(`${baseUrl}/platforms/reddit`, { waitUntil: 'networkidle' });

    // 1. Verify header
    const title = page.locator('#platform-title');
    await expect(title).toBeVisible();
    await expect(title).toContainText('Reddit Automation');
    await expect(page.locator('#platform-icon')).toContainText('🤖');

    // 2. Verify tabs (Scrape, Monitor)
    const tabBar = page.locator('#tab-bar');
    await expect(tabBar).toContainText('Scrape');
    await expect(tabBar).toContainText('Monitor');

    // 3. Verify quick actions
    const quickActions = page.locator('#qa-scrape');
    await expect(quickActions).toContainText('Subreddit Posts');
    await expect(quickActions).toContainText('Search Reddit');
    await expect(quickActions).toContainText('Post Comments');
    await expect(quickActions).toContainText('User Profile & Posts');
    await expect(quickActions).toContainText('Subreddit Info');

    // 4. Verify default action form is Subreddit Posts with default fields
    const form = page.locator('#form-scrape');
    await expect(form).toContainText('Subreddit Posts');
    await expect(page.locator('#field-name')).toHaveValue('programming');
    await expect(page.locator('#field-limit')).toHaveValue('10');
    await expect(page.locator('#field-sort')).toHaveValue('new');
    await expect(page.locator('#field-transport')).toHaveValue('rss');
  });

  test('switches between Reddit actions dynamically in UI', async ({ page }) => {
    await page.goto(`${baseUrl}/platforms/reddit`, { waitUntil: 'networkidle' });

    // Switch to Search Reddit
    await page.click('#qa-scrape button[data-action="search"]');
    const form = page.locator('#form-scrape');
    await expect(form).toContainText('Search Reddit');
    await expect(page.locator('#field-query')).toBeVisible();
    await expect(page.locator('#field-query')).toHaveValue('machine learning');

    // Switch to Post Comments
    await page.click('#qa-scrape button[data-action="post_comments"]');
    await expect(form).toContainText('Post Comments');
    await expect(page.locator('#field-postId')).toBeVisible();

    // Switch to User Profile & Posts
    await page.click('#qa-scrape button[data-action="user"]');
    await expect(form).toContainText('User Profile & Posts');
    await expect(page.locator('#field-username')).toBeVisible();
    await expect(page.locator('#field-username')).toHaveValue('spez');

    // Switch to Subreddit Info
    await page.click('#qa-scrape button[data-action="subreddit_info"]');
    await expect(form).toContainText('Subreddit Info');
    await expect(page.locator('#field-name')).toBeVisible();
  });
});
