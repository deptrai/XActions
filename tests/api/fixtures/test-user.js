// Shared test fixture for API + E2E tests that need a real DB user + valid JWT.
// by nichxbt
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export const TEST_SECRET = process.env.JWT_SECRET || 'test-secret';

let urlCounter = 0;
let accountIdCounter = 0;
let operationIdCounter = 0;

export function makeFacebookPostUrl(id = '1') {
  return `https://facebook.com/post/${id}`;
}

export function makeFacebookGroupUrl(id = '123456789') {
  return `https://www.facebook.com/groups/${id}/members`;
}

export function makeFacebookProfileUrl(handle = 'somepage') {
  return `https://facebook.com/${handle}`;
}

export function makeAccountId(prefix = 'acct') {
  return `${prefix}${++accountIdCounter}`;
}

export function makeOperationId() {
  return `some-operation-id-${++operationIdCounter}`;
}

let userIdCounter = 0;
export function makeTestUserId(prefix = 'test') {
  // Deterministic per-process counter keeps IDs reproducible across runs
  // while still being unique within a test file/fork.
  return `${prefix}-${String(++userIdCounter).padStart(6, '0')}`;
}

export function makeTestToken(userId, username = 'ghost') {
  return jwt.sign({ userId, username }, TEST_SECRET, { expiresIn: '1h' });
}

let cookieCounter = 0;
function deterministicHex(input, len = 8) {
  return createHash('sha256').update(String(input)).digest('hex').slice(0, len);
}

export function makeValidFacebookCookie(overrides = {}) {
  // Deterministic numeric UID (15 digits) so the cookie passes shape validation
  // but is clearly not tied to a real session. Counter + sha256 keep each cookie
  // unique and reproducible across runs.
  const n = ++cookieCounter;
  const cUser = String(100000000000000 + n).padStart(15, '0');
  return {
    c_user: cUser,
    xs: `xs-${String(n).padStart(8, '0')}-${deterministicHex(n)}`,
    ...overrides,
  };
}

export async function seedTestUser(userId, username = 'api_test_user', options = {}) {
  const email = `${userId}@example.com`;
  const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
  const isAdmin = options.isAdmin === true;

  const user = await prisma.user.upsert({
    where: { id: userId },
    update: { isAdmin },
    create: {
      id: userId,
      username,
      email,
      password: hashedPassword,
      credits: 100,
      isAdmin,
    },
  });
  return {
    ...user,
    token: makeTestToken(user.id, user.username),
  };
}

export async function cleanupTestUser(userId) {
  await prisma.operation.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.schedule.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.facebookAccount.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}
