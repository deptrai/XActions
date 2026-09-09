// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// Playwright E2E — Story 35.1: Reddit Scraper browser-level verification.
// by nichxbt

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.PORT = '0';

let server = null;
let baseUrl = process.env.PLAYWRIGHT_BASE_URL || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-for-local-development';
const DEMO_USER_ID = process.env.REDDIT_E2E_USER_ID || 'cmskewokf0000o3r4drq6vx3r';

function makeToken() {
  return jwt.sign({ userId: DEMO_USER_ID }, JWT_SECRET, { expiresIn: '1h' });
}

test.beforeAll(async () => {
  if (!baseUrl) {
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
  }
});

test.afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
});

test.describe('Story 35.1 — Reddit Scraper E2E Browser Verification', () => {
  test('should scrape r/programming via browser fetch and return Reddit PostItem[]', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(`${baseUrl}/health`);
    await expect(page.locator('body')).toContainText('ok', { timeout: 10_000 });

    const result = await page.evaluate(async ({ token }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90_000);

      try {
        const res = await fetch('/api/platform/reddit/scrape', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: 'subreddit',
            name: 'programming',
            limit: 2,
            transport: 'rss',
          }),
        });
        const text = await res.text();
        return { status: res.status, body: JSON.parse(text) };
      } catch (err) {
        return { status: 0, error: err instanceof Error ? err.message : String(err) };
      } finally {
        clearTimeout(timeoutId);
      }
    }, { token: makeToken() });

    expect(result.status).toBe(200);
    expect(result.error).toBeUndefined();
    expect(result.body.ok).toBe(true);
    expect(result.body.platform).toBe('reddit');
    expect(result.body.action).toBe('subreddit');
    expect(Array.isArray(result.body.result.posts)).toBe(true);
    expect(result.body.result.posts.length).toBeGreaterThan(0);

    const firstPost = result.body.result.posts[0];
    expect(firstPost.id).toMatch(/^reddit:/);
    expect(firstPost.platform).toBe('reddit');
    expect(firstPost.category).toBe('social');
    expect(firstPost.authorName).toBeTruthy();
    expect(firstPost.content).toBeTruthy();
    expect(firstPost.postUrl).toMatch(/^https:\/\/www\.reddit\.com\/r\/programming\/comments\//);
  });

  test('should handle unknown reddit action gracefully', async ({ page }) => {
    test.setTimeout(30_000);
    await page.goto(`${baseUrl}/health`);

    const result = await page.evaluate(async ({ token }) => {
      const res = await fetch('/api/platform/reddit/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'nonexistent' }),
      });
      const text = await res.text();
      return { status: res.status, body: text };
    }, { token: makeToken() });

    expect(result.status).toBeGreaterThanOrEqual(400);
  });
});
