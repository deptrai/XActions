// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Playwright E2E — Story 27.3: ChallengeSignatureDetector & Crawler DOM Bot-Detection.
 *
 * Exercises the complete live browser loop:
 *   1. Playwright navigates a real browser to live pages served by a local fixture server:
 *      - Cloudflare Turnstile & challenge-running DOM
 *      - Arkose Labs FunCaptcha DOM
 *      - Twitter / X account_locked DOM
 *      - Clean benign page with keyword mentions (verifying no false positives)
 *   2. Real AbstractCrawler invokes `detectChallengeOnPage(page, { accountId })`.
 *   3. Verifies automated account isolation:
 *      - accountPool.markUnavailable('bot_challenge', suggestedHibernationMs)
 *      - governor.recordBotChallenge(accountId, platform, durationMs)
 *      - healthOrchestrator.recordBotChallenge(platform, accountId)
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { SessionHealthOrchestrator } from '../../src/core/session-health-orchestrator.js';
import { ChallengeSignatureDetector } from '../../src/core/challenge-signature-detector.js';

class E2ETestCrawler extends AbstractCrawler {
  name = 'tw_crawler_e2e';
  requiresAuth = true;

  async init() {}
  async search() { return []; }
  async getPostDetail() { throw new Error('not implemented'); }
  async getComments() { return []; }
  async cleanup() {}
}

let server;
let baseUrl;

const PLATFORM = 'tw_crawler_e2e';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (path === '/cf-turnstile') {
      res.writeHead(200);
      res.end(`<!DOCTYPE html>
        <html>
          <head><title>Just a moment...</title></head>
          <body>
            <div id="cf-challenge-running">Verifying you are human</div>
            <div class="cf-turnstile" data-sitekey="0x4AAAAAA"></div>
            <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
          </body>
        </html>`);
      return;
    }

    if (path === '/arkose') {
      res.writeHead(200);
      res.end(`<!DOCTYPE html>
        <html>
          <head><title>Security Check</title></head>
          <body>
            <script src="https://client-api.arkoselabs.com/v2/api.js"></script>
            <div id="funcaptcha" data-callback="onCompleted"></div>
          </body>
        </html>`);
      return;
    }

    if (path === '/tw-locked') {
      res.writeHead(200);
      res.end(`<!DOCTYPE html>
        <html>
          <head><title>X / Twitter</title></head>
          <body>
            <div data-testid="error-detail">Your account has been account_locked. Verify your account to proceed.</div>
          </body>
        </html>`);
      return;
    }

    if (path === '/clean') {
      res.writeHead(200);
      res.end(`<!DOCTYPE html>
        <html>
          <head><title>Trending Topics</title></head>
          <body>
            <h1>Welcome to the 30-day coding challenge!</h1>
            <p>Discussion on how captcha and bot detection systems have evolved.</p>
          </body>
        </html>`);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test.describe('Story 27.3 E2E — Live Browser Crawler Bot-Detection', () => {
  test('E2E-1: Cloudflare Turnstile page triggers detection and 5min hibernation', async ({ page }) => {
    const accountId = 'turnstile_victim';
    const accountPool = new AccountPool();
    accountPool.registerAccounts(PLATFORM, [accountId]);
    const governor = new AdaptiveRateGovernor();
    const healthOrchestrator = new SessionHealthOrchestrator({ accountPool, governor });
    const detector = new ChallengeSignatureDetector();

    const crawler = new E2ETestCrawler({
      accountPool,
      governor,
      healthOrchestrator,
      challengeDetector: detector,
    });

    await page.goto(`${baseUrl}/cf-turnstile`);
    const result = await crawler.detectChallengeOnPage(page, { accountId });

    expect(result.detected).toBe(true);
    expect(['cloudflare_turnstile', 'cloudflare_managed']).toContain(result.type);
    expect(result.suggestedHibernationMs).toBe(5 * 60 * 1000);

    // Account isolated
    expect(accountPool.getNextAvailable(PLATFORM)).toBeNull();
    expect(governor.isHibernating(`${PLATFORM}:${accountId}`)).toBe(true);
    expect(healthOrchestrator.getHealthScore(PLATFORM, accountId)).toBeLessThan(70);
  });

  test('E2E-2: Arkose FunCaptcha page triggers detection and 30min hibernation', async ({ page }) => {
    const accountId = 'arkose_victim';
    const accountPool = new AccountPool();
    accountPool.registerAccounts(PLATFORM, [accountId]);
    const governor = new AdaptiveRateGovernor();
    const healthOrchestrator = new SessionHealthOrchestrator({ accountPool, governor });
    const detector = new ChallengeSignatureDetector();

    const crawler = new E2ETestCrawler({
      accountPool,
      governor,
      healthOrchestrator,
      challengeDetector: detector,
    });

    await page.goto(`${baseUrl}/arkose`);
    const result = await crawler.detectChallengeOnPage(page, { accountId });

    expect(result.detected).toBe(true);
    expect(result.type).toBe('arkose');
    expect(result.suggestedHibernationMs).toBe(30 * 60 * 1000);

    // Governor records 30min window
    expect(governor.isHibernating(`${PLATFORM}:${accountId}`)).toBe(true);
    expect(accountPool.getNextAvailable(PLATFORM)).toBeNull();
  });

  test('E2E-3: Twitter account_locked in DOM is detected by crawler', async ({ page }) => {
    const accountId = 'locked_victim';
    const accountPool = new AccountPool();
    accountPool.registerAccounts(PLATFORM, [accountId]);
    const governor = new AdaptiveRateGovernor();
    const healthOrchestrator = new SessionHealthOrchestrator({ accountPool, governor });
    const detector = new ChallengeSignatureDetector();

    const crawler = new E2ETestCrawler({
      accountPool,
      governor,
      healthOrchestrator,
      challengeDetector: detector,
    });
    crawler.name = 'twitter'; // match platform signature

    await page.goto(`${baseUrl}/tw-locked`);
    const result = await crawler.detectChallengeOnPage(page, { accountId });

    expect(result.detected).toBe(true);
    expect(result.type).toBe('platform_account_locked');
    expect(result.suggestedHibernationMs).toBe(30 * 60 * 1000);
    expect(governor.isHibernating(`twitter:${accountId}`)).toBe(true);
  });

  test('E2E-4: Clean page with challenge & captcha mentions returns detected: false without penalty', async ({ page }) => {
    const accountId = 'clean_survivor';
    const accountPool = new AccountPool();
    accountPool.registerAccounts(PLATFORM, [accountId]);
    const governor = new AdaptiveRateGovernor();
    const healthOrchestrator = new SessionHealthOrchestrator({ accountPool, governor });
    const detector = new ChallengeSignatureDetector();

    const crawler = new E2ETestCrawler({
      accountPool,
      governor,
      healthOrchestrator,
      challengeDetector: detector,
    });

    await page.goto(`${baseUrl}/clean`);
    const result = await crawler.detectChallengeOnPage(page, { accountId });

    expect(result.detected).toBe(false);
    expect(result.type).toBe('unknown');

    // Account remains fully available
    expect(accountPool.getNextAvailable(PLATFORM)).toBe(accountId);
    expect(governor.isHibernating(`${PLATFORM}:${accountId}`)).toBe(false);
    expect(healthOrchestrator.getHealthScore(PLATFORM, accountId)).toBe(100);
  });
});
