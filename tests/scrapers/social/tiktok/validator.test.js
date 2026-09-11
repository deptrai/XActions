import { describe, it, expect } from 'vitest';
import { TikTokPlatformResponseValidator } from '../../../../src/scrapers/social/tiktok/validator.js';

describe('TikTokPlatformResponseValidator', () => {
  const validator = new TikTokPlatformResponseValidator();

  it('validates a standard JSON response with status_code 0', () => {
    const payload = {
      status_code: 0,
      item_list: [{ id: '123' }],
    };
    expect(validator.isValidPayload(payload)).toBe(true);
    expect(validator.isBotChallenge(payload)).toBe(false);
    expect(validator.isRateLimit(payload)).toBe(false);
  });

  it('detects rate limit status codes', () => {
    const payload = { status_code: 10029, status_msg: 'Too many requests' };
    expect(validator.isValidPayload(payload)).toBe(false);
    expect(validator.isRateLimit(payload)).toBe(true);
  });

  it('detects bot challenge from HTML or status_msg', () => {
    const htmlPayload = { body: '<!DOCTYPE html><html><body>Captcha</body></html>' };
    expect(validator.isValidPayload(htmlPayload)).toBe(false);
    expect(validator.isBotChallenge(htmlPayload)).toBe(true);

    const captchaPayload = { status_code: 10001, status_msg: 'verification required' };
    expect(validator.isBotChallenge(captchaPayload)).toBe(true);
  });

  it('detects login wall', () => {
    const loginPayload = { status_msg: 'Please log in to continue' };
    expect(validator.isLoginWall(loginPayload)).toBe(true);
  });

  it('does NOT false-positive on valid video response with "verify" in video description', () => {
    const validVideo = {
      status_code: 0,
      itemInfo: {
        itemStruct: {
          id: '7234567890123456789',
          desc: 'Watch this tutorial to verify your email address quickly! #verify #tutorial',
        },
      },
    };
    expect(validator.isBotChallenge(validVideo)).toBe(false);
    expect(validator.isValidPayload(validVideo)).toBe(true);
  });
});
