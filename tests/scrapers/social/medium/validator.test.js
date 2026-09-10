// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import { MediumPlatformResponseValidator, validateMediumPost } from '../../../../src/scrapers/social/medium/validator.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';

const validator = new MediumPlatformResponseValidator();

describe('MediumPlatformResponseValidator', () => {
  it('detects rate limit from HTTP 429 status', () => {
    expect(validator.isRateLimit({ status: 429 })).toBe(true);
  });

  it('detects rate limit from Retry-After header', () => {
    expect(validator.isRateLimit({ status: 200, headers: { 'retry-after': '60' } })).toBe(true);
  });

  it('detects rate limit from body text', () => {
    expect(validator.isRateLimit({ status: 200, data: 'You have hit the rate limit' })).toBe(true);
    expect(validator.isRateLimit({ status: 200, data: 'too many requests' })).toBe(true);
  });

  it('does not flag valid 200 as rate limit', () => {
    expect(validator.isRateLimit({ status: 200, data: { payload: {} } })).toBe(false);
  });

  it('detects Cloudflare bot challenge from 403', () => {
    expect(validator.isBotChallenge({
      status: 403,
      data: '<html>Attention Required! | Cloudflare</html>',
    })).toBe(true);
    expect(validator.isBotChallenge({
      status: 451,
      data: 'checking your browser before accessing',
    })).toBe(true);
  });

  it('detects bot challenge markers in 200 body', () => {
    expect(validator.isBotChallenge({
      status: 200,
      data: 'please enable javascript and cookies to continue',
    })).toBe(true);
  });

  it('does not flag bare 403 as bot challenge', () => {
    expect(validator.isBotChallenge({ status: 403 })).toBe(false);
  });

  it('detects login wall from 401/403 with sign-in markers', () => {
    expect(validator.isLoginWall({
      status: 401,
      data: 'Sign in with Google to continue',
    })).toBe(true);
    expect(validator.isLoginWall({
      status: 403,
      data: 'Sign in to Medium',
    })).toBe(true);
  });

  it('does not treat paywall/member-only as login wall', () => {
    expect(validator.isLoginWall({
      status: 200,
      data: 'Continue reading on Medium for members only',
    })).toBe(false);
  });

  it('accepts valid RSS feed payload', () => {
    expect(validator.isValidPayload({
      status: 200,
      data: '<?xml version="1.0"?><rss><channel><item><title>Post</title></item></channel></rss>',
    })).toBe(true);
  });

  it('accepts valid JSON post payload with value', () => {
    expect(validator.isValidPayload({
      status: 200,
      data: { payload: { value: { id: 'abc123def456', title: 'Post' } } },
    })).toBe(true);
  });

  it('accepts valid JSON feed payload with references.Post', () => {
    expect(validator.isValidPayload({
      status: 200,
      data: {
        payload: {
          references: {
            Post: {
              abc123def456: { id: 'abc123def456', title: 'Post' },
            },
          },
        },
      },
    })).toBe(true);
  });

  it('accepts paywalled/locked content as valid', () => {
    expect(validator.isValidPayload({
      status: 200,
      data: { isSubscriptionLocked: true, visibility: 2 },
    })).toBe(true);
  });

  it('rejects HTML challenge page', () => {
    expect(validator.isValidPayload({
      status: 200,
      data: '<!DOCTYPE html><html><body>just a moment...</body></html>',
    })).toBe(false);
  });

  it('rejects empty object', () => {
    expect(validator.isValidPayload({ status: 200, data: {} })).toBe(false);
    expect(validator.isValidPayload({ status: 200, data: { payload: {} } })).toBe(false);
  });
});

describe('validateMediumPost', () => {
  it('returns true for valid raw post', () => {
    expect(validateMediumPost({
      postId: 'abc123def456',
      title: 'Title',
      link: 'https://medium.com/p/abc123def456',
    })).toBe(true);
  });

  it('throws PlatformError for missing postId/guid/id', () => {
    expect(() => validateMediumPost({ title: 'Title', link: 'https://medium.com/p/abc' })).toThrow(PlatformError);
  });

  it('throws PlatformError for missing title', () => {
    expect(() => validateMediumPost({ postId: 'abc', link: 'https://medium.com/p/abc' })).toThrow(PlatformError);
  });

  it('throws PlatformError for missing link', () => {
    expect(() => validateMediumPost({ postId: 'abc', title: 'Title' })).toThrow(PlatformError);
  });

  it('accepts url as link alias', () => {
    expect(validateMediumPost({
      guid: 'abc',
      title: 'Title',
      url: 'https://medium.com/p/abc',
    })).toBe(true);
  });
});
