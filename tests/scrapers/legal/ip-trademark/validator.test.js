import { describe, it, expect } from 'vitest';
import { IpLegalPlatformResponseValidator } from '../../../../src/scrapers/legal/ip-trademark/validator.js';

describe('Story 22.3: IpLegalPlatformResponseValidator', () => {
  const validator = new IpLegalPlatformResponseValidator();

  it('identifies platform as ipvietnam', () => {
    expect(validator.platform).toBe('ipvietnam');
  });

  describe('isRateLimit', () => {
    it('returns true for 429 status', () => {
      expect(validator.isRateLimit({ status: 429 })).toBe(true);
      expect(validator.isRateLimit({ statusCode: 429 })).toBe(true);
    });

    it('returns true for rate limit text markers', () => {
      expect(validator.isRateLimit({ status: 200, body: 'Too many requests' })).toBe(true);
    });

    it('returns false for normal responses', () => {
      expect(validator.isRateLimit({ status: 200, body: 'Danh sách đơn chuyển công bố' })).toBe(false);
    });
  });

  describe('isBotChallenge', () => {
    it('returns true for 403 status', () => {
      expect(validator.isBotChallenge({ status: 403 })).toBe(true);
    });

    it('returns true for challenge markers', () => {
      expect(validator.isBotChallenge({ status: 200, body: 'Cloudflare - Checking your browser' })).toBe(true);
    });

    it('returns false for normal responses', () => {
      expect(validator.isBotChallenge({ status: 200, body: 'Công báo sở hữu công nghiệp' })).toBe(false);
    });
  });

  describe('isValidPayload', () => {
    it('validates authentic IP Vietnam gazette response', () => {
      const sample = `
        <html>
          <body>
            <h1>Danh sách đơn chuyển công bố hàng tuần</h1>
            <p>Cục Sở hữu Trí tuệ công bố danh sách đơn nhãn hiệu và sáng chế</p>
          </body>
        </html>
      `;
      expect(validator.isValidPayload({ status: 200, body: sample })).toBe(true);
      expect(validator.isValidPayload(sample, { status: 200 })).toBe(true);
    });

    it('rejects status >= 400', () => {
      expect(validator.isValidPayload({ status: 404, body: 'Not found' })).toBe(false);
      expect(validator.isValidPayload({ status: 500, body: 'Server error' })).toBe(false);
    });

    it('rejects payload with insufficient matching terms', () => {
      expect(validator.isValidPayload({ status: 200, body: 'Một trang web bất kỳ không liên quan' })).toBe(false);
    });
  });
});
