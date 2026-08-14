// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// Tests for Story 7.1 — Facebook Account Health Check
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { checkAccountHealth } from '../../api/services/facebookHealth.js';
import { encrypt } from '../../api/routes/facebookAccounts.js';

const prisma = new PrismaClient();

const FACEBOOK_DTSG_HTML = '<script>{"token":"NAfA2cE5o8k"}</script>';

function makeFetch({ status = 200, html = FACEBOOK_DTSG_HTML, setCookie = [] } = {}) {
  return async () => ({
    status,
    data: html,
    headers: { 'set-cookie': setCookie },
  });
}

let testUser;
let testAccount;

async function createTestAccount() {
  const username = `test-health-${crypto.randomUUID()}`;
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

describe('checkAccountHealth', () => {
  it('returns active when fb_dtsg and cookie jar are present', async () => {
    const result = await checkAccountHealth(testAccount, {
      fetchImpl: makeFetch({
        html: FACEBOOK_DTSG_HTML,
        setCookie: ['c_user=1234567890; Path=/', 'xs=abc%3Adef; Path=/'],
      }),
    });

    expect(result.status).toBe('active');
    expect(result.lastCheckAt).toBeInstanceOf(Date);
  });

  it('caches active result for 5 minutes and returns the same record', async () => {
    const fetchImpl = makeFetch({
      html: FACEBOOK_DTSG_HTML,
      setCookie: ['c_user=1234567890; Path=/', 'xs=abc%3Adef; Path=/'],
    });

    const first = await checkAccountHealth(testAccount, { fetchImpl });
    const second = await checkAccountHealth(testAccount, { fetchImpl });

    expect(first.lastCheckAt).toEqual(second.lastCheckAt);
    expect(first.status).toBe('active');
  });

  it('bypasses cache and refetches when force:true', async () => {
    const fetchImpl = makeFetch({
      html: FACEBOOK_DTSG_HTML,
      setCookie: ['c_user=1234567890; Path=/', 'xs=abc%3Adef; Path=/'],
    });

    const first = await checkAccountHealth(testAccount, { fetchImpl });
    await new Promise((r) => setTimeout(r, 50));
    const second = await checkAccountHealth(testAccount, { fetchImpl, force: true });

    expect(second.lastCheckAt.getTime()).toBeGreaterThanOrEqual(first.lastCheckAt.getTime());
  });

  it('returns dead when fb_dtsg token is missing', async () => {
    const result = await checkAccountHealth(testAccount, {
      fetchImpl: makeFetch({ html: '<html></html>' }),
    });

    expect(result.status).toBe('dead');
    expect(result.reason).toMatch(/missing_token/);
  });

  it('returns dead when cookie jar lacks c_user or xs', async () => {
    const result = await checkAccountHealth(testAccount, {
      fetchImpl: makeFetch({
        html: FACEBOOK_DTSG_HTML,
        setCookie: ['c_user=deleted; Path=/'],
      }),
    });

    expect(result.status).toBe('dead');
  });

  it('returns checkpoint for /checkpoint/ in body', async () => {
    const result = await checkAccountHealth(testAccount, {
      fetchImpl: makeFetch({
        html: '<html>/checkpoint/</html>',
        setCookie: ['c_user=1234567890; Path=/', 'xs=abc%3Adef; Path=/'],
      }),
    });

    expect(result.status).toBe('checkpoint');
  });

  it('returns checkpoint for "confirm you\'re human" text', async () => {
    const result = await checkAccountHealth(testAccount, {
      fetchImpl: makeFetch({
        html: '<html>please confirm you\'re human</html>',
        setCookie: ['c_user=1234567890; Path=/', 'xs=abc%3Adef; Path=/'],
      }),
    });

    expect(result.status).toBe('checkpoint');
  });

  it('returns dead on network failure', async () => {
    const result = await checkAccountHealth(testAccount, {
      fetchImpl: async () => { throw new Error('network'); },
    });

    expect(result.status).toBe('dead');
    expect(result.reason).toBe('network_error');
  });

  it('returns dead and does not throw when cookie JSON is invalid', async () => {
    const badAccount = { id: testAccount.id, encryptedCookie: encrypt('not-json') };
    const result = await checkAccountHealth(badAccount, { fetchImpl: makeFetch() });

    expect(result.status).toBe('dead');
  });

  it('throws when account has no id', async () => {
    await expect(checkAccountHealth({ encryptedCookie: 'x' })).rejects.toThrow('requires an account with id');
  });
});
