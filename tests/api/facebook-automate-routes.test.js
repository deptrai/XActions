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
} from './fixtures/test-user.js';

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
  it('POST /api/facebook/automate without auth token → 401', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .send({ action: 'like', urls: ['https://facebook.com/post/1'] });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/facebook/scrape without auth token → 401', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .send({ action: 'profile', url: 'https://facebook.com/somepage' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/facebook/automate with malformed Bearer token → 401', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', 'Bearer not.a.valid.jwt')
      .send({ action: 'like', urls: ['https://facebook.com/post/1'], authCookie: VALID_COOKIE });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

describe('Action validation', () => {
  it.each([
    ['unknown action', { action: 'nonexistent-action', authCookie: VALID_COOKIE }, /action must be one of/],
    ['missing action', { authCookie: VALID_COOKIE }, /action must be one of/],
    ['like missing urls', { action: 'like', authCookie: VALID_COOKIE }, /like.*requires.*URL/],
    ['comment missing text', { action: 'comment', urls: ['https://facebook.com/post/1'], authCookie: VALID_COOKIE }, /comment.*requires.*text/],
    ['post missing text', { action: 'post', authCookie: VALID_COOKIE }, /post.*requires.*text/],
    ['share missing urls', { action: 'share', authCookie: VALID_COOKIE }, /share.*requires/i],
    ['share empty urls', { action: 'share', urls: [], authCookie: VALID_COOKIE }, /share.*requires/i],
    ['schedule missing text', { action: 'schedule', scheduledAt: new Date(Date.now() + 3600000).toISOString(), authCookie: VALID_COOKIE }, /schedule.*requires.*text/],
    ['schedule missing scheduledAt', { action: 'schedule', text: 'Hello world', authCookie: VALID_COOKIE }, /scheduledAt/i],
    ['schedule invalid scheduledAt', { action: 'schedule', text: 'Hello world', scheduledAt: 'not-a-date', authCookie: VALID_COOKIE }, /scheduledAt/i],
    ['join-groups missing groupUrls', { action: 'join-groups', authCookie: VALID_COOKIE }, /join-groups.*requires/i],
    ['join-groups empty groupUrls', { action: 'join-groups', groupUrls: [], authCookie: VALID_COOKIE }, /join-groups.*requires/i],
    ['batch-post-groups missing groupUrls', { action: 'batch-post-groups', text: 'Hello', authCookie: VALID_COOKIE }, /batch-post-groups.*requires.*groupUrls/i],
    ['batch-post-groups missing text', { action: 'batch-post-groups', groupUrls: ['https://facebook.com/groups/test'], authCookie: VALID_COOKIE }, /batch-post-groups.*requires.*text/i],
    ['batch-post-groups empty groupUrls', { action: 'batch-post-groups', groupUrls: [], text: 'Hello', authCookie: VALID_COOKIE }, /batch-post-groups.*requires.*groupUrls/i],
    ['send-friend-requests missing targets', { action: 'send-friend-requests', authCookie: VALID_COOKIE }, /send-friend-requests.*requires/i],
    ['send-friend-requests empty targets', { action: 'send-friend-requests', targets: [], authCookie: VALID_COOKIE }, /send-friend-requests.*requires/i],
    ['warmup-scroll-feed missing targetUrl', { action: 'warmup-scroll-feed', authCookie: VALID_COOKIE }, /warmup-scroll-feed.*requires.*targetUrl/i],
    ['warmup-scroll-feed empty targetUrl', { action: 'warmup-scroll-feed', targetUrl: '   ', authCookie: VALID_COOKIE }, /warmup-scroll-feed.*requires.*targetUrl/i],
  ])('%s → 400', async (desc, body, pattern) => {
    const res = await postAutomate(body);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(pattern);
  });
});

describe('No-required-field actions', () => {
  it('cancel-friend-requests — empty body should NOT return 400 (auth + dryRun only)', async () => {
    const res = await postAutomate({ action: 'cancel-friend-requests', authCookie: VALID_COOKIE });
    expect(res.status).not.toBe(400);
    expect(typeof res.body.ok).toBe('boolean');
  });

  it('cancel-friend-requests — with optional fields should NOT return 400', async () => {
    const res = await postAutomate({
      action: 'cancel-friend-requests',
      olderThanDays: 30,
      limit: 10,
      authCookie: VALID_COOKIE,
    });
    expect(res.status).not.toBe(400);
  });

  it('warmup-account — empty body should NOT return 400 (auth + dryRun only)', async () => {
    const res = await postAutomate({ action: 'warmup-account', authCookie: VALID_COOKIE });
    expect(res.status).not.toBe(400);
    expect(typeof res.body.ok).toBe('boolean');
  });

  it('warmup-account — with optional fields should NOT return 400', async () => {
    const res = await postAutomate({
      action: 'warmup-account',
      durationSeconds: 60,
      allowReactions: true,
      reactProbability: 0.3,
      authCookie: VALID_COOKIE,
    });
    expect(res.status).not.toBe(400);
  });
});

describe('Scrape endpoint validation', () => {
  it('POST /api/facebook/scrape — group-members without url → 400', async () => {
    const res = await postScrape({ action: 'group-members' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url/i);
  });

  it('POST /api/facebook/scrape — group-members with valid url format should NOT return 400', async () => {
    const res = await postScrape({
      action: 'group-members',
      url: 'https://www.facebook.com/groups/123456789/members',
    });
    expect(res.status).not.toBe(400);
  });

  it('POST /api/facebook/automate — missing authCookie entirely → 400', async () => {
    const res = await postAutomate({ action: 'like', urls: ['https://facebook.com/post/1'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/session is required/);
  });
});
