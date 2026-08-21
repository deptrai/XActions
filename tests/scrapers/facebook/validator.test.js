// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect } from 'vitest';
import { FacebookPlatformResponseValidator } from '../../../src/scrapers/facebook/validator.js';

describe('FacebookPlatformResponseValidator Contract Tests (Story 11.7 - ATDD Red Phase)', () => {
  const validator = new FacebookPlatformResponseValidator();

  test('should recognize valid mbasic real post HTML page structure', () => {
    const htmlResponse = {
      status: 200,
      data: '<html><body><div id="root"><div role="main"><article data-ft="abc">Post content here</article></div></div></body></html>',
    };

    expect(validator.isValidPayload(htmlResponse)).toBe(true);
    expect(validator.isBotChallenge(htmlResponse)).toBe(false);
    expect(validator.isRateLimit(htmlResponse)).toBe(false);
  });

  test('should identify short login-wall page as invalid payload', () => {
    const loginWallResponse = {
      status: 200,
      data: '<html><body>Log in to Facebook or create a new account</body></html>',
    };

    expect(validator.isValidPayload(loginWallResponse)).toBe(false);
  });

  test('should identify checkpoint redirect URL as bot challenge', () => {
    const checkpointResponse = {
      status: 200,
      url: 'https://mbasic.facebook.com/checkpoint/?next=https%3A%2F%2Fmbasic.facebook.com',
      data: '<html><body>Security checkpoint</body></html>',
    };

    expect(validator.isBotChallenge(checkpointResponse)).toBe(true);
  });

  test('should identify security check / identity confirmation in body as bot challenge', () => {
    const securityCheckResponse = {
      status: 200,
      data: '<html><body>Please confirm your identity. We noticed unusual activity.</body></html>',
    };

    expect(validator.isBotChallenge(securityCheckResponse)).toBe(true);
  });

  test('should identify temporarily blocked message as rate limit', () => {
    const rateLimitResponse = {
      status: 200,
      data: "<html><body>You're temporarily blocked from performing this action because you've been doing it too many times.</body></html>",
    };

    expect(validator.isRateLimit(rateLimitResponse)).toBe(true);
  });

  test('should recognize normalized post array or profile object as valid payload', () => {
    const postArrayResponse = [
      { id: 'post_1', content: 'First post' },
      { id: 'post_2', content: 'Second post' },
    ];

    expect(validator.isValidPayload(postArrayResponse)).toBe(true);
    expect(validator.isBotChallenge(postArrayResponse)).toBe(false);
  });
});
