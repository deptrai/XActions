// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect } from 'vitest';
import { BlueskyPlatformResponseValidator } from '../../../../src/scrapers/social/bluesky/validator.js';

describe('BlueskyPlatformResponseValidator (Story 23.5)', () => {
  const validator = new BlueskyPlatformResponseValidator();

  test('valid profile payload', () => {
    const response = {
      status: 200,
      data: {
        did: 'did:plc:abc123',
        handle: 'user.bsky.social',
        displayName: 'User',
        followersCount: 100,
        postsCount: 50,
      },
    };
    expect(validator.isValidPayload(response)).toBe(true);
    expect(validator.isBotChallenge(response)).toBe(false);
    expect(validator.isRateLimit(response)).toBe(false);
    expect(validator.isAuthExpired(response)).toBe(false);
  });

  test('valid feed with posts', () => {
    const response = {
      status: 200,
      data: {
        feed: [{ post: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', author: { did: 'did:plc:abc' } } }],
        cursor: '123',
      },
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid empty feed collection', () => {
    const response = { status: 200, data: { feed: [] } };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid thread payload', () => {
    const response = {
      status: 200,
      data: {
        thread: { post: { uri: 'at://...', author: { did: 'did:plc:abc' } } },
      },
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid URI/CID record', () => {
    const response = {
      status: 200,
      data: { uri: 'at://did:plc:abc/app.bsky.feed.post/1', cid: '...' },
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid raw array of feeds', () => {
    const response = [{ uri: 'at://feed/1' }, { uri: 'at://feed/2' }];
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid empty raw array', () => {
    expect(validator.isValidPayload([])).toBe(true);
  });

  test('valid unwrapped profile object', () => {
    const response = {
      did: 'did:plc:abc',
      handle: 'user.bsky.social',
      displayName: 'User',
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid followers/follows/likes/repostedBy/notifications collections', () => {
    expect(validator.isValidPayload({ status: 200, data: { followers: [] } })).toBe(true);
    expect(validator.isValidPayload({ status: 200, data: { follows: [] } })).toBe(true);
    expect(validator.isValidPayload({ status: 200, data: { likes: [] } })).toBe(true);
    expect(validator.isValidPayload({ status: 200, data: { repostedBy: [] } })).toBe(true);
    expect(validator.isValidPayload({ status: 200, data: { notifications: [] } })).toBe(true);
    expect(validator.isValidPayload({ status: 200, data: { lists: [] } })).toBe(true);
  });

  test('valid actors/profiles without cursor', () => {
    expect(validator.isValidPayload({ status: 200, data: { actors: [] } })).toBe(true);
    expect(validator.isValidPayload({ status: 200, data: { profiles: [] } })).toBe(true);
  });

  test('XRPC NotFound error', () => {
    const response = {
      status: 400,
      data: { error: 'NotFound', message: 'Profile not found' },
    };
    expect(validator.isValidPayload(response)).toBe(false);
    expect(validator.isBotChallenge(response)).toBe(false);
    expect(validator.isRateLimit(response)).toBe(false);
    expect(validator.isAuthExpired(response)).toBe(false);
  });

  test('XRPC InvalidHandle and InvalidRequest are not bot challenges', () => {
    expect(validator.isBotChallenge({ status: 400, data: { error: 'InvalidHandle' } })).toBe(false);
    expect(validator.isBotChallenge({ status: 400, data: { error: 'InvalidRequest' } })).toBe(false);
  });

  test('root-level error object', () => {
    expect(validator.isValidPayload({ error: 'NotFound', message: 'missing' })).toBe(false);
    expect(validator.isAuthExpired({ error: 'AuthenticationRequired' })).toBe(true);
  });

  test('rate limit via status 429', () => {
    const response = { status: 429, data: { error: 'RateLimitExceeded' } };
    expect(validator.isRateLimit(response)).toBe(true);
    expect(validator.isValidPayload(response)).toBe(false);
  });

  test('rate limit via header', () => {
    const response = {
      status: 200,
      headers: { 'RateLimit-Remaining': '0' },
      data: { feed: [] },
    };
    expect(validator.isRateLimit(response)).toBe(true);
  });

  test('rate limit via error name', () => {
    const response = { status: 200, data: { error: 'RateLimited', message: 'Slow down' } };
    expect(validator.isRateLimit(response)).toBe(true);
    expect(validator.isValidPayload(response)).toBe(false);
  });

  test('auth expired via status 401', () => {
    const response = { status: 401, data: { error: 'AuthenticationRequired' } };
    expect(validator.isAuthExpired(response)).toBe(true);
    expect(validator.isValidPayload(response)).toBe(false);
  });

  test('auth expired via error name', () => {
    const response = { status: 200, data: { error: 'ExpiredToken' } };
    expect(validator.isAuthExpired(response)).toBe(true);
  });

  test('bot challenge via status 403', () => {
    const response = { status: 403, data: { error: 'Blocked' } };
    expect(validator.isBotChallenge(response)).toBe(true);
    expect(validator.isValidPayload(response)).toBe(false);
  });

  test('bot challenge via captcha HTML in body', () => {
    const response = { status: 200, body: '<html><body>captcha challenge</body></html>' };
    expect(validator.isBotChallenge(response)).toBe(true);
    expect(validator.isValidPayload(response)).toBe(false);
  });

  test('does not false-positive on post content containing trigger words', () => {
    const response = {
      status: 200,
      data: {
        feed: [{
          post: {
            uri: 'at://did:plc:abc/app.bsky.feed.post/1',
            text: 'I love the 100DaysOfCode challenge. The roads are blocked today!',
            author: { did: 'did:plc:abc' },
          },
        }],
      },
    };
    expect(validator.isBotChallenge(response)).toBe(false);
    expect(validator.isRateLimit(response)).toBe(false);
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('isLoginWall detects adult content and takedown walls', () => {
    expect(validator.isLoginWall({ status: 401, body: '<html>Adult content. Sign in to view.</html>' })).toBe(true);
    expect(validator.isLoginWall({ status: 403, data: { error: 'AccountTakedown' } })).toBe(true);
    expect(validator.isLoginWall({ status: 200, data: { did: 'did:plc:abc', handle: 'x' } })).toBe(false);
  });

  test('empty response is invalid', () => {
    expect(validator.isValidPayload(null)).toBe(false);
    expect(validator.isValidPayload({ status: 200, data: null })).toBe(false);
    expect(validator.isValidPayload({ status: 200, data: {} })).toBe(false);
  });

  test('error in raw body string', () => {
    const response = { status: 200, body: '{"error":"NotFound","message":"Record not found"}' };
    expect(validator.isValidPayload(response)).toBe(false);
    expect(validator.isBotChallenge(response)).toBe(false);
  });
});
