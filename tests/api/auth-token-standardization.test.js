// tests/api/auth-token-standardization.test.js
// Unit & Integration tests for JWT payload standardization: decoded.userId vs decoded.id vs decoded.sub
// by nichxbt
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { authMiddleware, optionalAuthMiddleware, resolveUserId } from '../../api/middleware/auth.js';
import { seedTestUser, cleanupTestUser, makeTestUserId, TEST_SECRET } from './fixtures/test-user.js';

const TEST_USER_ID = makeTestUserId('jwt-std');
let testUser;

beforeAll(async () => {
  testUser = await seedTestUser(TEST_USER_ID, 'jwt_standardization_user');
});

afterAll(async () => {
  await cleanupTestUser(TEST_USER_ID);
});

describe('resolveUserId helper', () => {
  it('prefers userId over id over sub', () => {
    expect(resolveUserId({ userId: 'u1', id: 'i1', sub: 's1' })).toBe('u1');
    expect(resolveUserId({ id: 'i1', sub: 's1' })).toBe('i1');
    expect(resolveUserId({ sub: 's1' })).toBe('s1');
  });

  it('returns undefined for non-string identifiers', () => {
    expect(resolveUserId({ userId: 123 })).toBeUndefined();
    expect(resolveUserId({ userId: [] })).toBeUndefined();
    expect(resolveUserId({ userId: {} })).toBeUndefined();
    expect(resolveUserId({ userId: true })).toBeUndefined();
    expect(resolveUserId({ userId: '' })).toBeUndefined();
  });

  it('falls back to a valid string id when userId is non-string', () => {
    expect(resolveUserId({ userId: [], id: 'valid-id' })).toBe('valid-id');
    expect(resolveUserId({ userId: 0, id: 'valid-id' })).toBe('valid-id');
    expect(resolveUserId({ userId: '', id: 'valid-id' })).toBe('valid-id');
  });

  it('returns undefined when no valid identifier is present', () => {
    expect(resolveUserId({})).toBeUndefined();
    expect(resolveUserId({ username: 'foo' })).toBeUndefined();
    expect(resolveUserId(null)).toBeUndefined();
    expect(resolveUserId(undefined)).toBeUndefined();
  });
});

function mockRes() {
  return {
    statusCode: 0,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
}

function makeReq(token) {
  return { headers: { authorization: token ? `Bearer ${token}` : undefined } };
}

describe('Story 8.3: JWT Key Standardization (authMiddleware)', () => {
  it('authenticates user when JWT payload uses `userId` (AC2)', async () => {
    const token = jwt.sign({ userId: testUser.user.id, username: testUser.user.username }, TEST_SECRET, { expiresIn: '1h' });
    const req = makeReq(token);
    let nextCalled = false;
    const res = mockRes();
    const next = () => { nextCalled = true; };

    await authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('authenticates user when JWT payload uses `id` (AC1)', async () => {
    const token = jwt.sign({ id: testUser.user.id, username: testUser.user.username }, TEST_SECRET, { expiresIn: '1h' });
    const req = makeReq(token);
    let nextCalled = false;
    const res = mockRes();
    const next = () => { nextCalled = true; };

    await authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('authenticates user when JWT payload uses `sub`', async () => {
    const token = jwt.sign({ sub: testUser.user.id, username: testUser.user.username }, TEST_SECRET, { expiresIn: '1h' });
    const req = makeReq(token);
    let nextCalled = false;
    const res = mockRes();
    const next = () => { nextCalled = true; };

    await authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('prefers `userId` over `id` when both exist (AC3)', async () => {
    const token = jwt.sign({ userId: testUser.user.id, id: 'other-id', username: testUser.user.username }, TEST_SECRET, { expiresIn: '1h' });
    const req = makeReq(token);
    let nextCalled = false;
    const res = mockRes();
    const next = () => { nextCalled = true; };

    await authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('returns 401 when token has neither userId nor id nor sub (AC4)', async () => {
    const token = jwt.sign({ username: 'missing_id_user' }, TEST_SECRET, { expiresIn: '1h' });
    const req = makeReq(token);
    let nextCalled = false;
    const res = mockRes();
    const next = () => { nextCalled = true; };

    await authMiddleware(req, res, next);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 (not 500) for non-string userId identifiers', async () => {
    const cases = [
      { userId: 123 },
      { userId: [] },
      { userId: {} },
      { userId: true },
      { userId: '' },
      { userId: [], id: 'valid-but-wins-empty-array' },
    ];

    for (const payload of cases) {
      const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '1h' });
      const req = makeReq(token);
      const res = mockRes();
      const next = () => {};

      await authMiddleware(req, res, next);
      expect(res.statusCode).toBe(401);
    }
  });
});

describe('Story 8.3: Optional Auth Middleware (optionalAuthMiddleware)', () => {
  it('populates user when token uses `userId`', async () => {
    const token = jwt.sign({ userId: testUser.user.id }, TEST_SECRET, { expiresIn: '1h' });
    const req = makeReq(token);
    let nextCalled = false;
    const res = {};
    const next = () => { nextCalled = true; };

    await optionalAuthMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('populates user when token uses `id`', async () => {
    const token = jwt.sign({ id: testUser.user.id }, TEST_SECRET, { expiresIn: '1h' });
    const req = makeReq(token);
    let nextCalled = false;
    const res = {};
    const next = () => { nextCalled = true; };

    await optionalAuthMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('sets user to null and continues when token has no valid userId/id', async () => {
    const token = jwt.sign({ username: 'no_id' }, TEST_SECRET, { expiresIn: '1h' });
    const req = makeReq(token);
    let nextCalled = false;
    const res = {};
    const next = () => { nextCalled = true; };

    await optionalAuthMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeNull();
  });
});
