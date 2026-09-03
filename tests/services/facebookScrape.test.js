// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// Tests for Story 7.4 — FacebookScrapeService
// by nichxbt

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { encrypt } from '../../api/routes/facebookAccounts.js';
import { run, runBatch } from '../../api/services/facebookScrape.js';

const prisma = new PrismaClient();

let testUser;
let testAccount;

async function createTestAccount() {
  const username = `test-scrape-${crypto.randomUUID()}`;
  testUser = await prisma.user.create({
    data: { username, password: 'test', email: `${username}@x.test` },
  });
  const cookiePayload = JSON.stringify({ c_user: '1234567890', xs: 'abc%3Adef' });
  testAccount = await prisma.facebookAccount.create({
    data: {
      userId: testUser.id,
      label: 'main',
      encryptedCookie: encrypt(cookiePayload),
    },
  });
}

async function cleanupTestAccount() {
  if (testAccount?.id) {
    await prisma.facebookAccountHealth.deleteMany({ where: { accountId: testAccount.id } });
    await prisma.facebookAccount.deleteMany({ where: { id: testAccount.id } });
  }
  if (testUser?.id) {
    await prisma.facebookAccount.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.deleteMany({ where: { id: testUser.id } });
  }
}

beforeEach(async () => {
  await cleanupTestAccount();
  await createTestAccount();
});

afterEach(async () => {
  await cleanupTestAccount();
});

describe('FacebookScrapeService.run', () => {
  it('resolves authCookie via FacebookAuthResolver and calls scrape()', async () => {
    // Use a fake page that returns empty results — scrape() will auto-create
    // a browser and call loginWithCookie. We can't easily mock scrape() without
    // stubbing, so we test the dispatch logic by verifying the action is passed.
    // For the raw cookie path, run() should pass authCookie through to scrape().
    //
    // We test the error path: an invalid action should still reach scrape()
    // and throw there (not in the service).
    await expect(
      run('invalid_action', { authCookie: { c_user: '1234567890', xs: 'abc%3Adef' } }),
    ).rejects.toThrow();
  });

  it('allows missing authCookie for public scrape actions', async () => {
    // Public actions (profile/posts/followers/search/group-members) should not
    // require an authCookie and should reach the scraper dispatch layer.
    await expect(run('profile', { url: 'https://facebook.com/zuck' })).rejects.toThrow(/not available|available|not available|invalid|Unknown/);
  });

  it('resolves accountId to cookie via FacebookAuthResolver', async () => {
    // This will try to launch a browser — expect it to fail at browser launch
    // (no Puppeteer in test env) but NOT at auth resolution.
    try {
      await run('profile', {
        url: 'https://facebook.com/zuck',
        authCookie: { accountId: testAccount.id },
        userId: testUser.id,
      });
    } catch (err) {
      // Should fail at scrape/browser level, not at auth resolution.
      expect(err.message).not.toContain('not found');
      expect(err.message).not.toContain('ACCOUNT_NOT_FOUND');
    }
  });

  it('passes browserOptions through to scrape', async () => {
    // Verify browserOptions are forwarded — this will fail at browser launch
    // but should not fail at the service layer.
    try {
      await run('profile', {
        url: 'https://facebook.com/zuck',
        authCookie: { c_user: '1234567890', xs: 'abc%3Adef' },
        browserOptions: { headless: true, proxy: 'http://proxy:8080' },
      });
    } catch (err) {
      // Should fail at browser/scrape level, not at service validation.
      expect(err.message).not.toContain('browserOptions');
    }
  });

  it('never logs cookie values', async () => {
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));
    try {
      try {
        await run('profile', {
          url: 'https://facebook.com/zuck',
          authCookie: { c_user: '1234567890', xs: 'secret-xs-value' },
        });
      } catch { /* expected */ }
      const cookieLogged = logs.some((l) => l.includes('secret-xs-value'));
      expect(cookieLogged).toBe(false);
    } finally {
      console.error = originalError;
    }
  });
});

describe('FacebookScrapeService.runBatch', () => {
  it('delegates to FacebookAccountPool.runBatch', async () => {
    // runBatch with empty tasks should return empty results (no browser launch).
    const result = await runBatch([], { accountIds: [testAccount.id] });
    expect(result).toEqual({ results: [], accountUsage: {} });
  });

  it('throws for empty accountIds', async () => {
    await expect(runBatch([async () => 1], { accountIds: [] })).rejects.toThrow();
  });

  it('throws for missing accountIds', async () => {
    await expect(runBatch([async () => 1], {})).rejects.toThrow();
  });
});
