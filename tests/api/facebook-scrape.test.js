// tests/api/facebook-scrape.test.js
// Story 7.3 — route-level validation for post_comments, group_posts, group_comments.
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
  makeFacebookGroupUrl,
} from './fixtures/test-user.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'api-facebook-scrape-7-3';
const TEST_USER_ID = makeTestUserId('fb-scrape-7-3');
const VALID_COOKIE = makeValidFacebookCookie();

let authToken;

beforeAll(async () => {
  const result = await seedTestUser(TEST_USER_ID, 'fb_scrape_73_test');
  authToken = result.token;
});

afterAll(async () => {
  await cleanupTestUser(TEST_USER_ID);
});

const postScrape = (body) =>
  request(app).post('/api/facebook/scrape').set('Authorization', `Bearer ${authToken}`).send(body);

describe('POST /api/facebook/scrape — Story 7.3 validations', () => {
  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] recognizes post_comments as a valid action`, async () => {
    // Missing url hits validation before any browser launch.
    const res = await postScrape({
      action: 'post_comments',
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires url/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when post_comments missing url`, async () => {
    const res = await postScrape({ action: 'post_comments', authCookie: VALID_COOKIE });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/requires url/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when group_posts missing url`, async () => {
    const res = await postScrape({ action: 'group_posts', authCookie: VALID_COOKIE });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/requires url/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when group_comments missing url`, async () => {
    const res = await postScrape({ action: 'group_comments', authCookie: VALID_COOKIE });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/requires url/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 for non-numeric limit on post_comments`, async () => {
    const res = await postScrape({
      action: 'post_comments',
      url: makeFacebookPostUrl(),
      limit: 'abc',
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit must be a positive integer/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 for negative limit on group_posts`, async () => {
    const res = await postScrape({
      action: 'group_posts',
      url: makeFacebookGroupUrl(),
      limit: -5,
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit must be a positive integer/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 for non-boolean includeReplies on post_comments`, async () => {
    const res = await postScrape({
      action: 'post_comments',
      url: makeFacebookPostUrl(),
      includeReplies: 'yes',
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/includeReplies must be a boolean/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 for non-boolean includeReplies on group_comments`, async () => {
    const res = await postScrape({
      action: 'group_comments',
      url: makeFacebookGroupUrl().replace('/members', '/posts/1'),
      includeReplies: 'yes',
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/includeReplies must be a boolean/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] ignores includeReplies validation for group_posts`, async () => {
    // includeReplies is a string, which would fail for post_comments/group_comments.
    // For group_posts, limit validation runs first and returns 400 before the scrape layer.
    const res = await postScrape({
      action: 'group_posts',
      url: makeFacebookGroupUrl(),
      includeReplies: 'yes',
      limit: -5,
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit must be a positive integer/);
  });

  // --- group_search validations (Story 7.3 extension) ---

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when group_search missing url`, async () => {
    const res = await postScrape({
      action: 'group_search',
      query: 'macbook pro 14',
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/requires url/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 when group_search missing query`, async () => {
    const res = await postScrape({
      action: 'group_search',
      url: makeFacebookGroupUrl(),
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/requires query/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'API', 'P2')}] returns 400 for non-numeric limit on group_search`, async () => {
    const res = await postScrape({
      action: 'group_search',
      url: makeFacebookGroupUrl(),
      query: 'macbook',
      limit: 'abc',
      authCookie: VALID_COOKIE,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit must be a positive integer/);
  });
});
