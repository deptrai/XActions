// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// E2E Playwright spec for /video (Story 13.2.4 Twitter Hybrid Media Scraper).
// by nichxbt
import { test, expect } from '@playwright/test';

const TEST_TWEET_URL = 'https://x.com/elonmusk/status/1900000000000000000';

const mockExtractResponse = {
  videos: [
    {
      url: 'https://video.twimg.com/video/1900000000000000000_720p.mp4',
      quality: '720p',
      width: 1280,
      height: 720,
      bitrate: 2176000,
      contentType: 'video/mp4',
    },
    {
      url: 'https://video.twimg.com/video/1900000000000000000_480p.mp4',
      quality: '480p',
      width: 854,
      height: 480,
      bitrate: 832000,
      contentType: 'video/mp4',
    },
  ],
  thumbnail: 'https://pbs.twimg.com/media/1900000000000000000.jpg',
  duration: 15000,
  author: 'Elon Musk',
  username: 'elonmusk',
  tweetId: '1900000000000000000',
  text: 'Test video tweet',
};

test.beforeEach(async ({ page }) => {
  // Mock the video extraction API so tests don't hit real Twitter/X.
  await page.route('/api/video/extract', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockExtractResponse),
      });
    }
    return route.continue();
  });

  // Mock the video download proxy to avoid real CDN fetches.
  await page.route('/api/video/download', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const videoUrl = url.searchParams.get('url') || '';

    // Serve a tiny, valid MP4 placeholder.
    const mp4 = Buffer.from('mp4video');
    return route.fulfill({
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-length': String(mp4.length),
        'content-disposition': 'attachment; filename="elonmusk_1900000000000000000.mp4"',
      },
      body: mp4,
    });
  });

  await page.goto('/video');
});

test.describe('Story 13.2.4 — /video E2E', () => {
  test('should load the video downloader page and show the input form', async ({ page }) => {
    await expect(page).toHaveURL('/video');
    await expect(page.getByRole('heading', { name: /download x\/twitter videos/i })).toBeVisible();

    const urlInput = page.getByRole('textbox', { name: /paste tweet url here/i });
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveValue('');

    const downloadBtn = page.getByRole('button', { name: /download/i });
    await expect(downloadBtn).toBeVisible();
    await expect(downloadBtn).toBeEnabled();
  });

  test('should extract a video and display quality options', async ({ page }) => {
    const urlInput = page.locator('#url-input');
    const downloadBtn = page.locator('#download-btn');

    await urlInput.fill(TEST_TWEET_URL);
    await downloadBtn.click();

    // Wait for result card (loading is transient with a mocked fast response)
    const result = page.locator('#result');
    await expect(result).toHaveClass(/visible/, { timeout: 10000 });

    // Author and tweet text
    await expect(page.locator('#result-author')).toHaveText(/@elonmusk/);
    await expect(page.locator('#result-text')).toHaveText('Test video tweet');

    // Quality buttons rendered: best + second quality
    const qualityButtons = page.locator('#quality-options .quality-btn');
    await expect(qualityButtons).toHaveCount(2);
    await expect(qualityButtons.first()).toHaveText('⬇ 720p ★ Best');
    await expect(qualityButtons.nth(1)).toHaveText('⬇ 480p');

    // Thumbnail
    const thumbImg = page.locator('#thumb-img');
    await expect(thumbImg).toHaveAttribute('src', mockExtractResponse.thumbnail);
    await expect(thumbImg).toHaveAttribute('alt', 'Video by @elonmusk');
  });

  test('should show an error when the tweet contains no video', async ({ page }) => {
    await page.route('/api/video/extract', async (route) => {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No video found in this tweet.' }),
      });
    });

    await page.locator('#url-input').fill(TEST_TWEET_URL);
    await page.locator('#download-btn').click();

    const error = page.locator('#error-msg');
    await expect(error).toHaveClass(/visible/, { timeout: 10000 });
    await expect(error).toContainText(/no video found/i);
  });

  test('should validate the tweet URL client-side', async ({ page }) => {
    const urlInput = page.locator('#url-input');
    const downloadBtn = page.locator('#download-btn');

    await urlInput.fill('https://example.com/not-a-tweet');
    await downloadBtn.click();

    const error = page.locator('#error-msg');
    await expect(error).toHaveClass(/visible/);
    await expect(error).toContainText(/invalid url/i);

    // API should not be called because client-side validation stops it.
    // Client-side URL validation should prevent any API call.
    const extractRequest = await page.waitForRequest(
      (req) => req.url().includes('/api/video/extract'),
      { timeout: 500 }
    ).catch(() => null);
    expect(extractRequest).toBeNull();
  });

  test('should save and display recent downloads in localStorage', async ({ page }) => {
    await page.locator('#url-input').fill(TEST_TWEET_URL);
    await page.locator('#download-btn').click();

    await expect(page.locator('#result')).toHaveClass(/visible/, { timeout: 10000 });

    const history = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('xactions_video_history') || '[]');
    });

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      tweetId: '1900000000000000000',
      username: 'elonmusk',
      quality: '720p',
    });

    const recentItem = page.locator('#recent-list .recent-item');
    await expect(recentItem).toBeVisible();
    await expect(recentItem).toContainText('@elonmusk · 720p');
  });

  test('should generate correct download proxy URL for the best quality', async ({ page }) => {
    await page.locator('#url-input').fill(TEST_TWEET_URL);
    await page.locator('#download-btn').click();

    await expect(page.locator('#result')).toHaveClass(/visible/, { timeout: 10000 });

    const bestBtn = page.locator('#quality-options .quality-btn.best');
    await expect(bestBtn).toBeVisible();
    await expect(bestBtn).toHaveText('⬇ 720p ★ Best');
    await expect(bestBtn).toHaveAttribute('href', /\/api\/video\/download\?/);
    await expect(bestBtn).toHaveAttribute('download', 'elonmusk_1900000000000000000.mp4');

    const href = await bestBtn.getAttribute('href');
    const url = new URL(href, 'http://127.0.0.1:3001');
    expect(url.searchParams.get('author')).toBe('elonmusk');
    expect(url.searchParams.get('tweetId')).toBe('1900000000000000000');
    expect(url.searchParams.get('url')).toContain('video.twimg.com');
  });
});
