import { describe, it, expect } from 'vitest';
import { ZaloPlatformResponseValidator } from '../../../../src/scrapers/social/zalo/validator.js';

describe('Story 33.1: ZaloPlatformResponseValidator', () => {
  const validator = new ZaloPlatformResponseValidator();

  it('sets platform to zalo', () => {
    expect(validator.platform).toBe('zalo');
  });

  describe('isRateLimit', () => {
    it('detects HTTP 429 status code', () => {
      expect(validator.isRateLimit({ status: 429 })).toBe(true);
      expect(validator.isRateLimit({ statusCode: 429 })).toBe(true);
    });

    it('detects Zalo error -211 (out of quota)', () => {
      expect(validator.isRateLimit({ error: -211, message: 'Out of quota' })).toBe(true);
      expect(validator.isRateLimit({ data: { error: -211 } })).toBe(true);
    });

    it('detects rate limit keyword in message', () => {
      expect(validator.isRateLimit({ body: '{"message": "Rate limit exceeded"}' })).toBe(true);
    });

    it('returns false for normal response', () => {
      expect(validator.isRateLimit({ error: 0, message: 'Success' })).toBe(false);
    });
  });

  describe('isAuthExpired', () => {
    it('detects HTTP 401 status code', () => {
      expect(validator.isAuthExpired({ status: 401 })).toBe(true);
      expect(validator.isAuthExpired({ statusCode: 401 })).toBe(true);
    });

    it('detects Zalo error -216 (access token invalid)', () => {
      expect(validator.isAuthExpired({ error: -216, message: 'Access token invalid' })).toBe(true);
      expect(validator.isAuthExpired({ data: { error: -216 } })).toBe(true);
    });

    it('detects token expired message in string body', () => {
      expect(validator.isAuthExpired('Access token is invalid or expired')).toBe(true);
    });

    it('returns false for valid token response', () => {
      expect(validator.isAuthExpired({ error: 0, message: 'Success' })).toBe(false);
    });
  });

  describe('isBotChallenge', () => {
    it('detects HTTP 403 status code', () => {
      expect(validator.isBotChallenge({ status: 403 })).toBe(true);
    });

    it('detects Cloudflare and captcha challenge markers', () => {
      expect(validator.isBotChallenge({ body: '<html><title>Just a moment...</title>Cloudflare checking browser</html>' })).toBe(true);
      expect(validator.isBotChallenge('Verify you are human captcha challenge')).toBe(true);
    });

    it('returns false for standard JSON responses', () => {
      expect(validator.isBotChallenge({ error: 0, data: {} })).toBe(false);
    });
  });

  describe('isLoginWall', () => {
    it('detects OA deactivated (-221) or permission denied (-32)', () => {
      expect(validator.isLoginWall({ error: -221, message: 'OA is deactivated' })).toBe(true);
      expect(validator.isLoginWall({ error: -32, message: 'Permission denied' })).toBe(true);
    });

    it('returns false for normal errors', () => {
      expect(validator.isLoginWall({ error: -201, message: 'Param invalid' })).toBe(false);
    });
  });

  describe('isValidPayload', () => {
    it('returns true for error === 0 response with data', () => {
      expect(validator.isValidPayload({ error: 0, message: 'Success', data: { total: 10 } })).toBe(true);
    });

    it('returns true for JSON string with error 0', () => {
      expect(validator.isValidPayload('{"error": 0, "message": "Success", "data": {"total": 5}}')).toBe(true);
    });

    it('returns false for rate limit error', () => {
      expect(validator.isValidPayload({ error: -211, message: 'Out of quota' })).toBe(false);
    });

    it('returns false for auth expired error', () => {
      expect(validator.isValidPayload({ error: -216, message: 'Access token invalid' })).toBe(false);
    });

    it('returns false for HTTP >= 400', () => {
      expect(validator.isValidPayload({ status: 500, body: 'Internal Server Error' })).toBe(false);
    });

    it('returns false for challenge HTML', () => {
      expect(validator.isValidPayload({ status: 200, body: '<html>Cloudflare challenge verify you are human</html>' })).toBe(false);
    });
  });
});
