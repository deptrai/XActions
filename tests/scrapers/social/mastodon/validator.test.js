// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect } from 'vitest';
import { MastodonPlatformResponseValidator } from '../../../../src/scrapers/social/mastodon/validator.js';

describe('MastodonPlatformResponseValidator (Story 23.5)', () => {
  const validator = new MastodonPlatformResponseValidator();

  test('valid account profile', () => {
    const response = {
      status: 200,
      data: {
        id: '123',
        username: 'user',
        display_name: 'User',
        acct: 'user',
        url: 'https://mastodon.social/@user',
        created_at: '2024-01-01T00:00:00.000Z',
      },
    };
    expect(validator.isValidPayload(response)).toBe(true);
    expect(validator.isBotChallenge(response)).toBe(false);
    expect(validator.isRateLimit(response)).toBe(false);
    expect(validator.isAuthExpired(response)).toBe(false);
  });

  test('valid unwrapped account object', () => {
    const response = {
      id: '123',
      username: 'user',
      display_name: 'User',
      acct: 'user',
      url: 'https://mastodon.social/@user',
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid unwrapped status object', () => {
    const response = {
      id: '123',
      content: '<p>Hello</p>',
      created_at: '2024-01-01T00:00:00.000Z',
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid status', () => {
    const response = {
      status: 200,
      data: {
        id: '123',
        content: '<p>Hello</p>',
        created_at: '2024-01-01T00:00:00.000Z',
        reblogs_count: 0,
        favourites_count: 1,
        url: 'https://mastodon.social/@user/123',
      },
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid search result', () => {
    const response = {
      status: 200,
      data: {
        accounts: [{ id: '1', username: 'user' }],
        statuses: [],
        hashtags: [{ name: 'news' }],
      },
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid empty search result', () => {
    const response = {
      status: 200,
      data: {
        accounts: [],
        statuses: [],
        hashtags: [],
      },
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid array timeline', () => {
    const response = { status: 200, data: [{ id: '1', content: 'Hi' }, { id: '2', content: 'Bye' }] };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid empty array timeline', () => {
    expect(validator.isValidPayload({ status: 200, data: [] })).toBe(true);
    expect(validator.isValidPayload([])).toBe(true);
  });

  test('valid context payload', () => {
    const response = {
      status: 200,
      data: {
        ancestors: [],
        descendants: [{ id: '2', content: 'Reply' }],
      },
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid instance metadata', () => {
    const response = {
      status: 200,
      data: {
        domain: 'mastodon.social',
        title: 'Mastodon',
        version: '4.2.0',
        rules: [{ id: '1', text: 'Be nice' }],
      },
    };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid relationship object', () => {
    const response = { status: 200, data: { id: '123', following: true, followed_by: false } };
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('valid raw response array', () => {
    const response = [{ id: '1' }, { id: '2' }];
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('401 invalid token is auth expired', () => {
    const response = {
      status: 401,
      data: { error: 'The access token is invalid' },
    };
    expect(validator.isAuthExpired(response)).toBe(true);
    expect(validator.isValidPayload(response)).toBe(false);
  });

  test('RFC 6750 invalid_token error', () => {
    const response = { status: 401, data: { error: 'invalid_token' } };
    expect(validator.isAuthExpired(response)).toBe(true);
  });

  test('401 via error_description', () => {
    const response = {
      status: 200,
      data: { error: 'invalid_grant', error_description: 'The access token is invalid' },
    };
    expect(validator.isAuthExpired(response)).toBe(true);
    expect(validator.isValidPayload(response)).toBe(false);
  });

  test('403 forbidden is bot challenge', () => {
    const response = {
      status: 403,
      data: { error: 'This action is not allowed' },
    };
    expect(validator.isBotChallenge(response)).toBe(true);
    expect(validator.isValidPayload(response)).toBe(false);
  });

  test('429 too many requests is rate limit', () => {
    const response = {
      status: 429,
      data: { error: 'Too many requests' },
    };
    expect(validator.isRateLimit(response)).toBe(true);
    expect(validator.isValidPayload(response)).toBe(false);
  });

  test('rate limit via header', () => {
    const response = {
      status: 200,
      headers: { 'X-RateLimit-Remaining': '0' },
      data: [{ id: '1' }],
    };
    expect(validator.isRateLimit(response)).toBe(true);
  });

  test('rate limit via message only', () => {
    const response = {
      status: 200,
      data: { error: 'Throttled', error_description: 'rate limit reached' },
    };
    expect(validator.isRateLimit(response)).toBe(true);
  });

  test('error in body string', () => {
    const response = { status: 200, body: '{"error":"Record not found"}' };
    expect(validator.isValidPayload(response)).toBe(false);
    expect(validator.isBotChallenge(response)).toBe(false);
    expect(validator.isAuthExpired(response)).toBe(false);
  });

  test('empty response is invalid', () => {
    expect(validator.isValidPayload(null)).toBe(false);
    expect(validator.isValidPayload({ status: 200, data: null })).toBe(false);
    expect(validator.isValidPayload({ status: 200, data: {} })).toBe(false);
  });

  test('HTML bot challenge body', () => {
    const response = { status: 200, body: '<html><title>Access Denied</title></html>' };
    expect(validator.isBotChallenge(response)).toBe(true);
    expect(validator.isValidPayload(response)).toBe(false);
  });

  test('does not false-positive on status content with trigger words', () => {
    const response = {
      status: 200,
      data: {
        id: '1',
        content: '<p>#100DaysOfCode challenge. Roads blocked. Too many requests today!</p>',
        created_at: '2024-01-01T00:00:00.000Z',
      },
    };
    expect(validator.isBotChallenge(response)).toBe(false);
    expect(validator.isRateLimit(response)).toBe(false);
    expect(validator.isValidPayload(response)).toBe(true);
  });

  test('isLoginWall detects authorized fetch wall', () => {
    expect(validator.isLoginWall({ status: 401, body: '<html>This API requires an authenticated user</html>' })).toBe(true);
    expect(validator.isLoginWall({ status: 403, data: { error: 'This API requires an authenticated user' } })).toBe(true);
    expect(validator.isLoginWall({ status: 200, data: { id: '123', username: 'x' } })).toBe(false);
  });
});
