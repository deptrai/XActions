// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import { RedditPlatformResponseValidator } from '../../../../src/scrapers/social/reddit/validator.js';

const validator = new RedditPlatformResponseValidator();

describe('RedditPlatformResponseValidator', () => {
  it('detects rate limit from HTTP 429 status', () => {
    expect(validator.isRateLimit({ status: 429 })).toBe(true);
  });

  it('detects rate limit from x-ratelimit-remaining: 0', () => {
    expect(validator.isRateLimit({
      status: 200,
      headers: { 'x-ratelimit-remaining': '0' },
    })).toBe(true);
  });

  it('detects rate limit from numeric error 429', () => {
    expect(validator.isRateLimit({ status: 200, data: { error: 429 } })).toBe(true);
  });

  it('detects rate limit from HTML body', () => {
    expect(validator.isRateLimit({ status: 200, data: '<html>too many requests</html>' })).toBe(true);
  });

  it('detects auth expired from 401', () => {
    expect(validator.isAuthExpired({ status: 401 })).toBe(true);
  });

  it('detects auth expired from invalid_token', () => {
    expect(validator.isAuthExpired({ status: 200, data: { error: 'invalid_token' } })).toBe(true);
  });

  it('detects auth expired from unauthorized string', () => {
    expect(validator.isAuthExpired({ status: 200, data: { error: 'unauthorized' } })).toBe(true);
  });

  it('detects bot challenge from 403', () => {
    expect(validator.isBotChallenge({ status: 403 })).toBe(true);
  });

  it('detects bot challenge from Cloudflare HTML', () => {
    expect(validator.isBotChallenge({
      status: 200,
      data: '<html>Cloudflare challenge</html>',
    })).toBe(true);
  });

  it('detects login wall from private subreddit', () => {
    expect(validator.isLoginWall({
      status: 403,
      data: { reason: 'private' },
    })).toBe(true);
  });

  it('rejects HTML payload as invalid', () => {
    expect(validator.isValidPayload({
      status: 200,
      data: '<html><body>reddit</body></html>',
    })).toBe(false);
  });

  it('accepts valid Listing payload', () => {
    expect(validator.isValidPayload({
      status: 200,
      data: {
        kind: 'Listing',
        data: {
          children: [
            { kind: 't3', data: { id: '1a2b3c', title: 'hello' } },
          ],
          after: 't3_xxx',
        },
      },
    })).toBe(true);
  });

  it('accepts direct t3 Thing payload', () => {
    expect(validator.isValidPayload({
      status: 200,
      data: {
        kind: 't3',
        data: { id: '1a2b3c', subreddit: 'programming', author: 'spez', score: 42 },
      },
    })).toBe(true);
  });

  it('accepts OAuth token response', () => {
    expect(validator.isValidPayload({
      status: 200,
      data: { access_token: 'abc', token_type: 'bearer', expires_in: 3600 },
    })).toBe(true);
  });

  it('rejects error payload', () => {
    expect(validator.isValidPayload({
      status: 200,
      data: { error: 'some error' },
    })).toBe(false);
  });
});
