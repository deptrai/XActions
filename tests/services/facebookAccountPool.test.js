// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// Tests for Story 7.1 — Facebook Account Pool
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  buildUserDataDir,
  resolveAccountContext,
  runBatch,
} from '../../api/services/facebookAccountPool.js';
import { encrypt } from '../../api/routes/facebookAccounts.js';
import crypto from 'node:crypto';
import path from 'node:path';

const prisma = new PrismaClient();

let testUser;
let testAccount;

async function createTestAccount({ proxy } = {}) {
  const username = `test-pool-${crypto.randomUUID()}`;
  testUser = await prisma.user.create({
    data: { username, password: 'test', email: `${username}@x.test` },
  });

  const data = {
    userId: testUser.id,
    label: 'main',
    encryptedCookie: encrypt(JSON.stringify({ c_user: '1234567890', xs: 'abc%3Adef' })),
  };
  if (proxy) data.encryptedProxy = encrypt(proxy);

  testAccount = await prisma.facebookAccount.create({ data });
  return testAccount;
}

async function cleanup() {
  if (testAccount?.id) {
    await prisma.facebookAccountHealth.deleteMany({ where: { accountId: testAccount.id } });
    await prisma.facebookAccount.deleteMany({ where: { id: testAccount.id } });
  }
  if (testUser?.id) {
    await prisma.user.deleteMany({ where: { id: testUser.id } });
  }
}

beforeEach(cleanup);
afterEach(cleanup);

function makeFakeBrowser(result = 'ok') {
  const page = {
    authenticate: async () => {},
    goto: async () => {},
    setCookie: async () => {},
    setUserAgent: async () => {},
    setViewport: async () => {},
    evaluateOnNewDocument: async () => {},
    emulateTimezone: async () => {},
    setGeolocation: async () => {},
    url: () => 'https://www.facebook.com/',
    evaluate: async (fn, ...args) => {
      const text = fn?.toString?.() || '';
      if (text.includes('hasLoginForm')) {
        return { hasLoginForm: false, hasLoginButton: false, hasSecurityCheck: false };
      }
      return undefined;
    },
    browserContext: () => ({ overridePermissions: async () => {} }),
    close: async () => {},
  };
  return {
    newPage: async () => page,
    close: async () => {},
  };
}

describe('buildUserDataDir', () => {
  it('creates a profile directory under .data/facebook-profiles/<c_user>', () => {
    const dir = buildUserDataDir('12345');
    expect(dir).toBe(path.resolve(process.cwd(), '.data', 'facebook-profiles', '12345'));
  });

  it('strips non-digit characters from c_user', () => {
    const dir = buildUserDataDir('abc-123-xyz');
    expect(dir).toBe(path.resolve(process.cwd(), '.data', 'facebook-profiles', '123'));
  });
});

describe('resolveAccountContext', () => {
  it('returns null for a dead account', async () => {
    const account = await createTestAccount();
    const ctx = await resolveAccountContext(account, {
      checkAccountHealthImpl: async () => ({ status: 'dead' }),
    });
    expect(ctx).toBeNull();
  });

  it('resolves c_user, xs, and proxy when active', async () => {
    const account = await createTestAccount({ proxy: '127.0.0.1:8080:user:pass' });
    const ctx = await resolveAccountContext(account, {
      checkAccountHealthImpl: async () => ({ status: 'active' }),
    });

    expect(ctx).toMatchObject({
      c_user: '1234567890',
      xs: 'abc%3Adef',
      proxyServer: 'http://127.0.0.1:8080',
      proxyAuth: { username: 'user', password: 'pass' },
    });
  });
});

describe('runBatch', () => {
  it('throws when no accountIds are provided', async () => {
    await expect(runBatch([], {})).rejects.toThrow('accountId');
  });

  it('runs a single task through the fake browser and returns result + usage', async () => {
    const account = await createTestAccount();
    const task = async (page, ctx) => ({ ok: true, ctxId: ctx.id });

    const { results, accountUsage } = await runBatch([task], {
      accountIds: [account.id],
      launchImpl: () => makeFakeBrowser(),
      loginImpl: async () => {},
      resolveAccountContextOptions: { checkAccountHealthImpl: async () => ({ status: 'active' }) },
      checkAccountHealthImpl: async () => ({ status: 'active' }),
    });

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(accountUsage[account.id].tasks).toBe(1);
  });

  it('retries on checkpoint and switches to the next live account', async () => {
    const account1 = await createTestAccount();
    const account2 = await createTestAccount();

    const task = async (page, ctx) => {
      if (ctx.id === account1.id) {
        const err = new Error('Facebook security check detected');
        throw err;
      }
      return { ok: true, ctxId: ctx.id };
    };

    const { results } = await runBatch([task], {
      accountIds: [account1.id, account2.id],
      launchImpl: () => makeFakeBrowser(),
      loginImpl: async () => {},
      resolveAccountContextOptions: { checkAccountHealthImpl: async () => ({ status: 'active' }) },
      checkAccountHealthImpl: async () => ({ status: 'active' }),
      delayBetweenLaunches: 0,
    });

    expect(results[0].ok).toBe(true);
    expect(results[0].ctxId).toBe(account2.id);
  });

  it('caps concurrency at 8', async () => {
    const account = await createTestAccount();
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 12 }, () => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 50));
      running -= 1;
      return 'done';
    });

    await runBatch(tasks, {
      accountIds: [account.id],
      maxConcurrency: 20,
      launchImpl: () => makeFakeBrowser(),
      loginImpl: async () => {},
      resolveAccountContextOptions: { checkAccountHealthImpl: async () => ({ status: 'active' }) },
      checkAccountHealthImpl: async () => ({ status: 'active' }),
      delayBetweenLaunches: 0,
    });

    expect(maxRunning).toBeLessThanOrEqual(8);
  });
});
