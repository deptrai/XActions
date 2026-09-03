// tests/api/facebook-routes-integration.test.js
// Integration tests for facebook.js route handlers using a real DB user.
// by nichxbt
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';
import {
  seedTestUser,
  cleanupTestUser,
  makeTestUserId,
  makeValidFacebookCookie,
  makeFacebookPostUrl,
  makeFacebookProfileUrl,
  makeFacebookGroupUrl,
  makeAccountId,
} from './fixtures/test-user.js';
import { nextTestId } from '../utils/test-ids.js';
const TEST_SCOPE = 'api-facebook-routes-integration';

const TEST_USER_ID = makeTestUserId('fb-routes-int');
const VALID_COOKIE = makeValidFacebookCookie();

let authToken;

beforeAll(async () => {
  const result = await seedTestUser(TEST_USER_ID, 'fb_routes_test');
  authToken = result.token;
});

afterAll(async () => {
  await cleanupTestUser(TEST_USER_ID);
});

const postAutomate = (body) =>
  request(app).post('/api/facebook/automate').set('Authorization', `Bearer ${authToken}`).send(body);

const postScrape = (body) =>
  request(app).post('/api/facebook/scrape').set('Authorization', `Bearer ${authToken}`).send(body);

describe('POST /api/facebook/scrape — integration', () => {
  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 for invalid action`, async () => {
    const res = await postScrape({ action: 'invalid-action', url: makeFacebookProfileUrl("test") });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/action must be one of/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 for missing action`, async () => {
    const res = await postScrape({ url: makeFacebookProfileUrl("test") });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action must be one of/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when profile action missing url`, async () => {
    const res = await postScrape({ action: 'profile' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires url/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when posts action missing url`, async () => {
    const res = await postScrape({ action: 'posts', url: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires url/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when followers action missing url`, async () => {
    const res = await postScrape({ action: 'followers' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires url/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when group-members action missing url`, async () => {
    const res = await postScrape({ action: 'group-members' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires url/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when search action missing query`, async () => {
    const res = await postScrape({ action: 'search' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires query/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when search action has empty query`, async () => {
    const res = await postScrape({ action: 'search', query: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires query/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when search action has invalid type`, async () => {
    const res = await postScrape({ action: 'search', query: 'hello', type: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/search type must be one of/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when search action has non-numeric limit`, async () => {
    const res = await postScrape({ action: 'search', query: 'hello', limit: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit must be a positive integer/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when search action has negative limit`, async () => {
    const res = await postScrape({ action: 'search', query: 'hello', limit: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit must be a positive integer/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when search action has non-string location`, async () => {
    const res = await postScrape({ action: 'search', query: 'hello', location: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/location must be a string/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when search action has non-boolean parallel`, async () => {
    const res = await postScrape({ action: 'search', query: 'hello', parallel: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parallel must be a boolean/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 for an invalidly shaped raw cookie`, async () => {
    const res = await postScrape({
      action: 'profile',
      url: makeFacebookProfileUrl("test"),
      authCookie: { c_user: 'invalid', xs: 'invalid' },
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/c_user must be a numeric Facebook UID/i);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 for an unknown stored accountId`, async () => {
    const res = await postScrape({
      action: 'search',
      query: 'hello',
      authCookie: { accountId: makeAccountId() },
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/not found/i);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] allows public search without an account`, async () => {
    const res = await postScrape({
      action: 'search',
      query: 'hello',
    });
    // The request must not be rejected for missing auth; runtime success depends
    // on valid Facebook doc_ids / tokens, which are placeholder in this test env.
    expect(res.status).not.toBe(401);
    expect(res.body.error).not.toMatch(/No active Facebook account/i);
    // When real tokens are unavailable, the route returns a controlled 500.
    if (res.status !== 200) {
      expect(res.body.ok).toBe(false);
    }
  });
});

describe('POST /api/facebook/automate — integration', () => {
  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when missing Facebook cookie`, async () => {
    const res = await postAutomate({ action: 'like', urls: [makeFacebookPostUrl()] });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/session is required/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 for invalid action`, async () => {
    const res = await postAutomate({ action: 'invalid', authCookie: VALID_COOKIE });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/action must be one of/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] normalizes "messenger" alias to "messenger-share" and validates it`, async () => {
    const res = await postAutomate({ action: 'messenger', authCookie: VALID_COOKIE, dryRun: true });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/action must be one of/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when like action missing urls`, async () => {
    const res = await postAutomate({ action: 'like', authCookie: VALID_COOKIE });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when comment action missing text`, async () => {
    const res = await postAutomate({
      action: 'comment',
      urls: [makeFacebookPostUrl()],
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] accepts accountId in authCookie for dry-run`, async () => {
    const res = await postAutomate({
      action: 'like',
      urls: [makeFacebookPostUrl()],
      authCookie: { accountId: makeTestUserId('fake') },
      dryRun: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] accepts accountIds array for dry-run`, async () => {
    const res = await postAutomate({
      action: 'like',
      urls: [makeFacebookPostUrl()],
      accountIds: [makeAccountId(), makeAccountId()],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] dryRun=true for like action returns a preview`, async () => {
    const res = await postAutomate({
      action: 'like',
      urls: [makeFacebookPostUrl(), makeFacebookPostUrl(2)],
      authCookie: VALID_COOKIE,
      dryRun: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dryRun).toBe(true);
    expect(res.body).toHaveProperty('preview');
  });
});
