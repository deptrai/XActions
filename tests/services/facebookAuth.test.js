// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// Tests for Story 7.4 — FacebookAuthResolver
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { encrypt } from '../../api/routes/facebookAccounts.js';
import { resolve } from '../../api/services/facebookAuth.js';

const prisma = new PrismaClient();

let testUser;
let testAccount;
let otherUser;

async function createTestAccounts() {
  const username = `test-auth-${crypto.randomUUID()}`;
  testUser = await prisma.user.create({
    data: { username, password: 'test', email: `${username}@x.test` },
  });

  const otherUsername = `test-auth-other-${crypto.randomUUID()}`;
  otherUser = await prisma.user.create({
    data: { username: otherUsername, password: 'test', email: `${otherUsername}@x.test` },
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

async function cleanupTestAccounts() {
  if (testAccount?.id) {
    await prisma.facebookAccountHealth.deleteMany({ where: { accountId: testAccount.id } });
    await prisma.facebookAccount.deleteMany({ where: { id: testAccount.id } });
  }
  if (testUser?.id) {
    await prisma.facebookAccount.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.deleteMany({ where: { id: testUser.id } });
  }
  if (otherUser?.id) {
    await prisma.facebookAccount.deleteMany({ where: { userId: otherUser.id } });
    await prisma.user.deleteMany({ where: { id: otherUser.id } });
  }
}

beforeEach(async () => {
  await cleanupTestAccounts();
  await createTestAccounts();
});

afterEach(async () => {
  await cleanupTestAccounts();
});

describe('FacebookAuthResolver.resolve', () => {
  it('passes through raw { c_user, xs } cookie', async () => {
    const result = await resolve({ c_user: '1234567890', xs: 'abc%3Adef' });
    expect(result).toEqual({
      c_user: '1234567890',
      xs: 'abc%3Adef',
      userId: null,
      accountId: null,
    });
  });

  it('trims whitespace from raw cookie values', async () => {
    const result = await resolve({ c_user: '  1234567890  ', xs: '  abc%3Adef  ' });
    expect(result.c_user).toBe('1234567890');
    expect(result.xs).toBe('abc%3Adef');
  });

  it('resolves accountId to decrypted cookie', async () => {
    const result = await resolve({ accountId: testAccount.id }, testUser.id);
    expect(result.c_user).toBe('1234567890');
    expect(result.xs).toBe('abc%3Adef');
    expect(result.userId).toBe(testUser.id);
    expect(result.accountId).toBe(testAccount.id);
  });

  it('throws ACCOUNT_NOT_FOUND for unknown accountId', async () => {
    try {
      await resolve({ accountId: 'does-not-exist' }, testUser.id);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe('ACCOUNT_NOT_FOUND');
    }
  });

  it('throws ACCOUNT_NOT_FOUND when accountId belongs to another user', async () => {
    try {
      await resolve({ accountId: testAccount.id }, otherUser.id);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe('ACCOUNT_NOT_FOUND');
    }
  });

  it('resolves accountId without userId (MCP path — userId optional per AC2.12)', async () => {
    const result = await resolve({ accountId: testAccount.id });
    expect(result.c_user).toBe('1234567890');
    expect(result.xs).toBe('abc%3Adef');
    expect(result.userId).toBe(testUser.id);
    expect(result.accountId).toBe(testAccount.id);
  });

  it('throws when authCookie is missing both c_user/xs and accountId', async () => {
    await expect(resolve({})).rejects.toThrow();
    await expect(resolve(null)).rejects.toThrow();
    await expect(resolve(undefined)).rejects.toThrow();
  });

  it('throws when authCookie is not an object', async () => {
    await expect(resolve('not-an-object')).rejects.toThrow();
    await expect(resolve(123)).rejects.toThrow();
  });

  it('never logs cookie values', async () => {
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));
    try {
      await resolve({ c_user: '1234567890', xs: 'secret-xs-value' });
      await resolve({ accountId: testAccount.id }, testUser.id);
      const cookieLogged = logs.some((l) => l.includes('secret-xs-value') || l.includes('abc%3Adef'));
      expect(cookieLogged).toBe(false);
    } finally {
      console.error = originalError;
    }
  });
});
