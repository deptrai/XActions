// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// Real-API E2E spec for /video page (Story 13.2.4).
// by nichxbt
import { test, expect } from '@playwright/test';

// dom/status/100 is a real public tweet (text only); the API should respond
// quickly and deterministically with "no video found".
const REAL_TWEET = 'https://x.com/dom/status/100';
// A clearly non-existent tweet ID used to exercise the full fallback chain.
const BAD_TWEET = 'https://x.com/elonmusk/status/1900000000000000000';

test.describe('Story 13.2.4 — /video against real /api/video/extract', () => {
  test('should load the /video page and render the form', async ({ page }) => {
    await page.goto('/video');
    await expect(page).toHaveURL('/video');
    await expect(page.locator('#url-input')).toBeVisible();
    await expect(page.locator('#download-btn')).toBeVisible();
  });

  test('should validate an invalid URL client-side without calling API', async ({ page }) => {
    await page.goto('/video');

    let apiCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/video/extract')) apiCalled = true;
    });

    await page.locator('#url-input').fill('https://example.com/not-a-tweet');
    await page.locator('#download-btn').click();

    await expect(page.locator('#error-msg')).toHaveClass(/visible/);
    await expect(page.locator('#error-msg')).toContainText(/invalid url/i);
    expect(apiCalled).toBe(false);
  });

  test('should show a real error when the tweet has no video', async ({ page }) => {
    await page.goto('/video');

    const error = page.locator('#error-msg');
    await page.locator('#url-input').fill(REAL_TWEET);
    await page.locator('#download-btn').click();

    await expect(error).toHaveClass(/visible/, { timeout: 60000 });
    await expect(error).toContainText(/no video found/i);
  });

  test('should show a real error for a non-existent tweet', async ({ page }) => {
    await page.goto('/video');

    const error = page.locator('#error-msg');
    await page.locator('#url-input').fill(BAD_TWEET);
    await page.locator('#download-btn').click();

    await expect(error).toHaveClass(/visible/, { timeout: 60000 });
    await expect(error).toContainText(/no video found/i);
  });
});
