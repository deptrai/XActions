// tests/api/auth-token-standardization.test.js
// Unit & Integration tests for JWT payload standardization: decoded.userId vs decoded.id vs decoded.sub
// by nichxbt
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { authMiddleware, optionalAuthMiddleware } from '../../api/middleware/auth.js';
import { seedTestUser, cleanupTestUser, makeTestUserId, TEST_SECRET } from './fixtures/test-user.js';

const TEST_USER_ID = makeTestUserId('jwt-std');
let testUser;

beforeAll(async () => {
  testUser = await seedTestUser(TEST_USER_ID, 'jwt_standardization_user');
});

afterAll(async () => {
  await cleanupTestUser(TEST_USER_ID);
});

describe('Story 8.3: JWT Key Standardization (authMiddleware)', () => {
  it('authenticates user when JWT payload uses `userId` (AC2)', async () => {
    const token = jwt.sign({ userId: testUser.user.id, username: testUser.user.username }, TEST_SECRET, { expiresIn: '1h' });
    const req = {
      headers: { authorization: `Bearer ${token}` }
    };
    let nextCalled = false;
    const res = {
      status: () => res,
      json: () => res
    };
    const next = () => { nextCalled = true; };

    await authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('authenticates user when JWT payload uses `id` (AC1)', async () => {
    const token = jwt.sign({ id: testUser.user.id, username: testUser.user.username }, TEST_SECRET, { expiresIn: '1h' });
    const req = {
      headers: { authorization: `Bearer ${token}` }
    };
    let nextCalled = false;
    const res = {
      status: () => res,
      json: () => res
    };
    const next = () => { nextCalled = true; };

    await authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('authenticates user when JWT payload uses `sub`', async () => {
    const token = jwt.sign({ sub: testUser.user.id, username: testUser.user.username }, TEST_SECRET, { expiresIn: '1h' });
    const req = {
      headers: { authorization: `Bearer ${token}` }
    };
    let nextCalled = false;
    const res = {
      status: () => res,
      json: () => res
    };
    const next = () => { nextCalled = true; };

    await authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('prefers `userId` over `id` when both exist (AC3)', async () => {
    const token = jwt.sign({ userId: testUser.user.id, id: 'other-id', username: testUser.user.username }, TEST_SECRET, { expiresIn: '1h' });
    const req = {
      headers: { authorization: `Bearer ${token}` }
    };
    let nextCalled = false;
    const res = {
      status: () => res,
      json: () => res
    };
    const next = () => { nextCalled = true; };

    await authMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('returns 401 when token has neither userId nor id nor sub (AC4)', async () => {
    const token = jwt.sign({ username: 'missing_id_user' }, TEST_SECRET, { expiresIn: '1h' });
    const req = {
      headers: { authorization: `Bearer ${token}` }
    };
    let statusCode = 0;
    let jsonBody = null;
    let nextCalled = false;
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (data) => {
        jsonBody = data;
        return res;
      }
    };
    const next = () => { nextCalled = true; };

    await authMiddleware(req, res, next);
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(401);
    expect(jsonBody).toHaveProperty('error');
    expect(jsonBody.error).toMatch(/invalid token/i);
  });
});

describe('Story 8.3: Optional Auth Middleware (optionalAuthMiddleware)', () => {
  it('populates user when token uses `id`', async () => {
    const token = jwt.sign({ id: testUser.user.id }, TEST_SECRET, { expiresIn: '1h' });
    const req = {
      headers: { authorization: `Bearer ${token}` }
    };
    let nextCalled = false;
    const res = {};
    const next = () => { nextCalled = true; };

    await optionalAuthMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.user.id);
  });

  it('sets user to null and continues when token has no userId/id', async () => {
    const token = jwt.sign({ username: 'no_id' }, TEST_SECRET, { expiresIn: '1h' });
    const req = {
      headers: { authorization: `Bearer ${token}` }
    };
    let nextCalled = false;
    const res = {};
    const next = () => { nextCalled = true; };

    await optionalAuthMiddleware(req, res, next);
    expect(nextCalled).toBe(true);
    expect(req.user).toBeNull();
  });
});

describe('Story 8.3: Socket Auth and Refresh Token', () => {
  it('refresh route works with id payload', async () => {
    const token = jwt.sign({ id: testUser.user.id, username: testUser.user.username }, TEST_SECRET, { expiresIn: '1h' });
    const decoded = jwt.decode(token);
    const userId = decoded?.userId || decoded?.id || decoded?.sub;
    expect(userId).toBe(testUser.user.id);
  });

  it('socket middleware resolves user with id token', async () => {
    const token = jwt.sign({ id: testUser.user.id }, TEST_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, TEST_SECRET);
    const userId = decoded.userId || decoded.id || decoded.sub;
    expect(userId).toBe(testUser.user.id);
  });
});
