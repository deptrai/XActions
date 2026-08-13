// tests/api/facebook-automate-routes.test.js
// Validation-guard tests for Facebook automate + scrape endpoints.
// Uses a real DB user so auth passes deterministically.
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

const TEST_USER_ID = makeTestUserId('fb-automate');
const VALID_COOKIE = makeValidFacebookCookie();

let authToken;

beforeAll(async () => {
  const result = await seedTestUser(TEST_USER_ID, 'fb_automate_user');
  authToken = result.token;
});

afterAll(async () => {
  await cleanupTestUser(TEST_USER_ID);
});

const postAutomate = (body) =>
  request(app).post('/api/facebook/automate').set('Authorization', `Bearer ${authToken}`).send(body);

const postScrape = (body) =>
  request(app).post('/api/facebook/scrape').set('Authorization', `Bearer ${authToken}`).send(body);

describe('Auth guard', () => {
  it(`[${nextTestId('API', 'P2')}] POST /api/facebook/automate without auth token → 401`, async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .send({ action: 'like', urls: [makeFacebookPostUrl()] });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId('API', 'P2')}] POST /api/facebook/scrape without auth token → 401`, async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .send({ action: 'profile', url: makeFacebookProfileUrl() });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId('API', 'P2')}] POST /api/facebook/automate with malformed Bearer token → 401`, async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', 'Bearer not.a.valid.jwt')
      .send({ action: 'like', urls: [makeFacebookPostUrl()], authCookie: VALID_COOKIE });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

describe('Action validation', () => {
  it.each([
    [nextTestId('API', 'P1'), 'unknown action', { action: 'nonexistent-action', authCookie: VALID_COOKIE }, /action must be one of/],
    [nextTestId('API', 'P1'), 'missing action', { authCookie: VALID_COOKIE }, /action must be one of/],
    [nextTestId('API', 'P1'), 'like missing urls', { action: 'like', authCookie: VALID_COOKIE }, /like.*requires.*URL/],
    [nextTestId('API', 'P1'), 'comment missing text', { action: 'comment', urls: [makeFacebookPostUrl()], authCookie: VALID_COOKIE }, /comment.*requires.*text/],
    [nextTestId('API', 'P1'), 'post missing text', { action: 'post', authCookie: VALID_COOKIE }, /post.*requires.*text/],
    [nextTestId('API', 'P1'), 'share missing urls', { action: 'share', authCookie: VALID_COOKIE }, /share.*requires/i],
    [nextTestId('API', 'P1'), 'share empty urls', { action: 'share', urls: [], authCookie: VALID_COOKIE }, /share.*requires/i],
    [nextTestId('API', 'P1'), 'schedule missing text', { action: 'schedule', scheduledAt: new Date(Date.now() + 3600000).toISOString(), authCookie: VALID_COOKIE }, /schedule.*requires.*text/],
    [nextTestId('API', 'P1'), 'schedule missing scheduledAt', { action: 'schedule', text: 'Hello world', authCookie: VALID_COOKIE }, /scheduledAt/i],
    [nextTestId('API', 'P1'), 'schedule invalid scheduledAt', { action: 'schedule', text: 'Hello world', scheduledAt: 'not-a-date', authCookie: VALID_COOKIE }, /scheduledAt/i],
    [nextTestId('API', 'P1'), 'join-groups missing groupUrls', { action: 'join-groups', authCookie: VALID_COOKIE }, /join-groups.*requires/i],
    [nextTestId('API', 'P1'), 'join-groups empty groupUrls', { action: 'join-groups', groupUrls: [], authCookie: VALID_COOKIE }, /join-groups.*requires/i],
    [nextTestId('API', 'P1'), 'batch-post-groups missing groupUrls', { action: 'batch-post-groups', text: 'Hello', authCookie: VALID_COOKIE }, /batch-post-groups.*requires.*groupUrls/i],
    [nextTestId('API', 'P1'), 'batch-post-groups missing text', { action: 'batch-post-groups', groupUrls: [makeFacebookGroupUrl("test")], authCookie: VALID_COOKIE }, /batch-post-groups.*requires.*text/i],
    [nextTestId('API', 'P1'), 'batch-post-groups empty groupUrls', { action: 'batch-post-groups', groupUrls: [], text: 'Hello', authCookie: VALID_COOKIE }, /batch-post-groups.*requires.*groupUrls/i],
    [nextTestId('API', 'P1'), 'send-friend-requests missing targets', { action: 'send-friend-requests', authCookie: VALID_COOKIE }, /send-friend-requests.*requires/i],
    [nextTestId('API', 'P1'), 'send-friend-requests empty targets', { action: 'send-friend-requests', targets: [], authCookie: VALID_COOKIE }, /send-friend-requests.*requires/i],
    [nextTestId('API', 'P1'), 'warmup-scroll-feed missing targetUrl', { action: 'warmup-scroll-feed', authCookie: VALID_COOKIE }, /warmup-scroll-feed.*requires.*targetUrl/i],
    [nextTestId('API', 'P1'), 'warmup-scroll-feed empty targetUrl', { action: 'warmup-scroll-feed', targetUrl: '   ', authCookie: VALID_COOKIE }, /warmup-scroll-feed.*requires.*targetUrl/i],
  ])(`[%s] %s → 400`, async (id, desc, body, pattern) => {
    const res = await postAutomate(body);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(pattern);
  });
});

describe('No-required-field actions', () => {
  // cancel-friend-requests dry-run would need a real Facebook session and page,
  // so the unit tests in tests/services/facebook-cancel-friend-requests.test.js
  // already cover the action logic. Route-level validation is handled above.

  it(`[${nextTestId('API', 'P2')}] warmup-account — empty body → 200 dry-run`, async () => {
    const res = await postAutomate({ action: 'warmup-account', authCookie: VALID_COOKIE });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dryRun).toBe(true);
  });

  it(`[${nextTestId('API', 'P2')}] warmup-account — with optional fields → 200 dry-run`, async () => {
    const res = await postAutomate({
      action: 'warmup-account',
      durationSeconds: 60,
      allowReactions: true,
      reactProbability: 0.3,
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('Scrape endpoint validation', () => {
  it(`[${nextTestId('API', 'P2')}] POST /api/facebook/scrape — group-members without url → 400`, async () => {
    const res = await postScrape({ action: 'group-members' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });


  // group-members with a valid public URL hits the real Facebook network and is
  // slow/flaky; the scraper logic is covered by tests/scrapers/facebook-index.test.js.

  it(`[${nextTestId('API', 'P2')}] POST /api/facebook/automate — missing authCookie entirely → 400`, async () => {
    const res = await postAutomate({ action: 'like', urls: [makeFacebookPostUrl()] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/session is required/);
  });
});
