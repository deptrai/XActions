import { describe, it, expect } from 'vitest';
import { YouTubePlatformResponseValidator } from '../../../../src/scrapers/social/youtube/validator.js';

describe('Story 33.2: YouTubePlatformResponseValidator', () => {
  const validator = new YouTubePlatformResponseValidator();

  it('sets platform to youtube', () => {
    expect(validator.platform).toBe('youtube');
  });

  describe('isRateLimit', () => {
    it('detects HTTP 429 status code', () => {
      expect(validator.isRateLimit({ status: 429 })).toBe(true);
      expect(validator.isRateLimit({ statusCode: 429 })).toBe(true);
    });

    it('detects quotaExceeded in error reasons', () => {
      const quotaErr = {
        error: {
          code: 403,
          message: 'The request cannot be completed because you have exceeded your quota.',
          errors: [{ domain: 'youtube.quota', reason: 'quotaExceeded' }],
        },
      };
      expect(validator.isRateLimit(quotaErr)).toBe(true);
    });

    it('detects rateLimitExceeded keyword in string message', () => {
      expect(validator.isRateLimit('Rate limit exceeded for user')).toBe(true);
    });

    it('returns false for normal responses', () => {
      expect(validator.isRateLimit({ kind: 'youtube#videoListResponse', items: [] })).toBe(false);
    });
  });

  describe('isAuthExpired', () => {
    it('detects HTTP 401 status code', () => {
      expect(validator.isAuthExpired({ status: 401 })).toBe(true);
    });

    it('detects keyInvalid error reason', () => {
      const keyErr = {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          errors: [{ domain: 'global', reason: 'keyInvalid' }],
        },
      };
      expect(validator.isAuthExpired(keyErr)).toBe(true);
    });

    it('detects API key not valid in string message', () => {
      expect(validator.isAuthExpired('API key not valid. Please pass a valid API key.')).toBe(true);
    });

    it('returns false for valid payloads', () => {
      expect(validator.isAuthExpired({ kind: 'youtube#searchListResponse', items: [] })).toBe(false);
    });
  });

  describe('isBotChallenge', () => {
    it('detects Google recaptcha and unusual traffic markers', () => {
      expect(validator.isBotChallenge('Our systems have detected unusual traffic from your computer network.')).toBe(true);
      expect(validator.isBotChallenge({ body: '<html><form action="google.com/recaptcha">Captcha</form></html>' })).toBe(true);
    });

    it('detects 403 with HTML challenge', () => {
      expect(validator.isBotChallenge({ status: 403, body: '<html><title>Just a moment</title>Cloudflare</html>' })).toBe(true);
    });

    it('returns false for valid JSON responses', () => {
      expect(validator.isBotChallenge({ items: [{ id: '1' }] })).toBe(false);
    });
  });

  describe('isLoginWall', () => {
    it('detects privateVideo or commentsDisabled', () => {
      const privateErr = {
        error: {
          code: 403,
          errors: [{ reason: 'privateVideo' }],
        },
      };
      expect(validator.isLoginWall(privateErr)).toBe(true);
    });

    it('detects private video message', () => {
      expect(validator.isLoginWall('This video is private.')).toBe(true);
    });
  });

  describe('isValidPayload', () => {
    it('validates authentic YouTube response with items array', () => {
      expect(validator.isValidPayload({ kind: 'youtube#searchListResponse', items: [{ id: 'v1' }] })).toBe(true);
    });

    it('validates single video or channel object with snippet', () => {
      expect(validator.isValidPayload({ snippet: { title: 'Test Video' } })).toBe(true);
    });

    it('rejects error payloads', () => {
      expect(validator.isValidPayload({ error: { code: 403, message: 'Quota exceeded' } })).toBe(false);
    });

    it('rejects status >= 400', () => {
      expect(validator.isValidPayload({ status: 500, body: 'Internal Server Error' })).toBe(false);
    });

    it('rejects challenge pages', () => {
      expect(validator.isValidPayload({ status: 200, body: '<html>Our systems have detected unusual traffic from your computer network</html>' })).toBe(false);
    });
  });
});
