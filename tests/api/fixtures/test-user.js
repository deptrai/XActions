// Shared test fixture for API + E2E tests that need a real DB user + valid JWT.
// by nichxbt
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export const TEST_SECRET = process.env.JWT_SECRET || 'test-secret';

export function makeTestUserId(prefix = 'test') {
  // Keep deterministic-ish per run but unique enough to avoid collisions
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export function makeTestToken(userId, username = 'ghost') {
  return jwt.sign({ userId, username }, TEST_SECRET, { expiresIn: '1h' });
}

export function makeValidFacebookCookie(overrides = {}) {
  return {
    c_user: '100000000000001',
    xs: 'test-xs-value',
    ...overrides,
  };
}

export async function seedTestUser(userId, username = 'api_test_user') {
  const email = `${userId}@example.com`;
  const hashedPassword = await bcrypt.hash('TestPassword123!', 10);

  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      username,
      email,
      password: hashedPassword,
      credits: 100,
    },
  });

  return { user, token: makeTestToken(user.id, user.username), password: 'TestPassword123!' };
}

export async function cleanupTestUser(userId) {
  await prisma.operation.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.schedule.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.facebookAccount.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}
