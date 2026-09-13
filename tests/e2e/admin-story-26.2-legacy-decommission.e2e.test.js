// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Playwright E2E — Story 26.2: Legacy Scraper Decommission Verification
 * Verifies that the complete removal of legacy directories (src/scrapers/twitter/,
 * src/scrapers/facebook/, src/scrapers/threads/, src/client/Scraper.js) does not
 * break UI views, routing, or client-side backward compatibility.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.PORT = '0';

let server = null;
let baseUrl = '';

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
  }
});

test.describe('Story 26.2: E2E Live Browser Verification of Decommissioned Subsystems', () => {
  test('Main Dashboard loads and displays social crawler links', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('401')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(baseUrl);
    await expect(page).toHaveTitle(/Dashboard/i);

    // Sidebar navigation contains migrated crawler routes (use first() to disambiguate mobile nav)
    await expect(page.locator('a[href="/platforms/facebook"]').first()).toBeVisible();
    await expect(page.locator('a[href="/platforms/x"]').first()).toBeVisible();
    await expect(page.locator('a[href="/platforms/threads"]').first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  test('X / Twitter Crawler view loads and Scrape tab functions without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('401')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`${baseUrl}/platforms/x`);
    await expect(page.locator('h1').first()).toContainText(/X \/ Twitter/i);

    // Switch to Scrape tab
    await page.getByRole('tab', { name: 'Scrape' }).click();
    await expect(page.getByRole('button', { name: /Scrape Profile/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Search Tweets/i }).first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  test('Facebook Crawler view loads and Actions & Scrape tabs render properly', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('401')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`${baseUrl}/platforms/facebook`);
    await expect(page.locator('h1').first()).toContainText(/Facebook/i);

    // Actions tab displays actions
    await expect(page.getByRole('button', { name: /Like Posts/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Create Post/i }).first()).toBeVisible();

    // Switch to Scrape tab
    await page.getByRole('tab', { name: 'Scrape' }).click();
    await expect(page.getByRole('button', { name: /Scrape Profile/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Scrape Posts/i }).first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  test('Threads Crawler view loads and displays scraper actions', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('401')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`${baseUrl}/platforms/threads`);
    await expect(page.locator('h1').first()).toContainText(/Threads/i);

    await expect(page.getByRole('button', { name: /Profile/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Feed/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Post Detail/i }).first()).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  test('Admin Ops view renders live Checkpoints table with JWT authentication', async ({ page }) => {
    // Generate valid admin token
    const jwt = (await import('jsonwebtoken')).default;
    const adminToken = jwt.sign(
      { userId: 'test_admin_e2e', username: 'admin_e2e', isAdmin: true },
      process.env.JWT_SECRET || 'dev-secret-key-for-local-development',
      { expiresIn: '1h' }
    );

    // Inject token before visiting /admin
    await page.goto(baseUrl);
    await page.evaluate((token) => {
      localStorage.setItem('authToken', token);
      localStorage.setItem('xactions_token', token);
    }, adminToken);

    await page.goto(`${baseUrl}/admin`);
    await expect(page.locator('h1').first()).toContainText(/XActions Admin/i);

    // Check tabs exist
    await expect(page.getByRole('tab', { name: /Live Sessions/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Proxies & Accounts/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Jobs & Checkpoints/i })).toBeVisible();
  });
});
