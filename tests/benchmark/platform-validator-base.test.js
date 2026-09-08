import { describe, it, expect } from 'vitest';
import {
  AbstractPlatformResponseValidator,
  GENERIC_FALSE_200_MARKERS,
  GENERIC_CHECKPOINT_MARKERS,
} from '../../src/core/platform-validator.js';

class DummyValidator extends AbstractPlatformResponseValidator {
  platform = 'dummy';

  isValidPayload(res) {
    return Boolean(res?.data?.success || res?.body?.includes('success'));
  }

  isBotChallenge(res) {
    return Boolean(res?.body?.includes('cf-browser-verification'));
  }

  isRateLimit(res) {
    return res?.status === 429;
  }
}

describe('Story 34.3: AbstractPlatformResponseValidator Base Tests', () => {
  const validator = new DummyValidator();

  it('exports GENERIC_FALSE_200_MARKERS and GENERIC_CHECKPOINT_MARKERS', () => {
    expect(GENERIC_FALSE_200_MARKERS).toBeDefined();
    expect(GENERIC_FALSE_200_MARKERS.length).toBeGreaterThanOrEqual(5);
    expect(GENERIC_CHECKPOINT_MARKERS).toBeDefined();
    expect(GENERIC_CHECKPOINT_MARKERS.length).toBeGreaterThanOrEqual(3);
  });

  it('provides _extractStatus, _extractText, and _extractData helper methods', () => {
    expect(validator._extractStatus({ status: 200 })).toBe(200);
    expect(validator._extractStatus({ statusCode: 404 })).toBe(404);
    expect(validator._extractStatus({ status: 'invalid-nan' })).toBe(200);
    expect(validator._extractStatus(null)).toBe(200);

    expect(validator._extractText('HELLO WORLD')).toBe('hello world');
    expect(validator._extractText({ data: 'Foo Bar' })).toBe('foo bar');
    expect(validator._extractText({ body: Buffer.from('Buffer Data') })).toBe('buffer data');

    expect(validator._extractData({ data: { count: 10 } })).toEqual({ count: 10 });
  });

  it('detects generic False 200 challenge patterns on 2xx responses', () => {
    // Cloudflare challenge
    const cfRes = {
      status: 200,
      data: '<html><head><title>Just a moment...</title></head><body>__cf_chl_jschl_tk__</body></html>',
    };
    expect(validator.isFalse200(cfRes)).toBe(true);

    // Arkose captcha
    const arkoseRes = {
      status: 200,
      data: '<html><script src="https://client-api.arkoselabs.com/fc/api/"></script></html>',
    };
    expect(validator.isFalse200(arkoseRes)).toBe(true);

    // Login wall
    const loginRes = {
      status: 200,
      data: '<html><div id="login">Sign in to continue</div></html>',
    };
    expect(validator.isFalse200(loginRes)).toBe(true);

    // Generic captcha
    const captchaRes = {
      status: 200,
      data: '<html><div>Please verify you are human: captcha</div></html>',
    };
    expect(validator.isFalse200(captchaRes)).toBe(true);

    // Empty JSON wrapper payloads under 200
    expect(validator.isFalse200({ status: 200, data: {} })).toBe(true);
    expect(validator.isFalse200({ status: 200, data: { data: {} } })).toBe(true);
  });

  it('never marks non-2xx responses as False 200', () => {
    const error403 = {
      status: 403,
      data: '<html>__cf_chl_jschl_tk__</html>',
    };
    expect(validator.isFalse200(error403)).toBe(false);

    const error500 = {
      status: 500,
      data: '<html>captcha error</html>',
    };
    expect(validator.isFalse200(error500)).toBe(false);
  });

  it('executes validateResponse returning composite diagnostic object (AD-30)', () => {
    const validRes = {
      status: 200,
      data: { success: true },
    };
    const validDiag = validator.validateResponse(validRes);
    expect(validDiag.isValid).toBe(true);
    expect(validDiag.isFalse200).toBe(false);
    expect(validDiag.isCheckpoint).toBe(false);
    expect(validDiag.isRateLimit).toBe(false);
    expect(validDiag.isAuthExpired).toBe(false);

    const false200Res = {
      status: 200,
      data: '<html><title>Attention Required! | Cloudflare</title>__cf_chl_jschl_tk__</html>',
    };
    const falseDiag = validator.validateResponse(false200Res);
    expect(falseDiag.isValid).toBe(false);
    expect(falseDiag.isFalse200).toBe(true);
    expect(falseDiag.isCheckpoint).toBe(true);

    // HTTP 500 error response with data should not be valid
    const serverErrorRes = {
      status: 500,
      data: { success: true, error: 'Internal Error' },
    };
    const errorDiag = validator.validateResponse(serverErrorRes);
    expect(errorDiag.isValid).toBe(false);
    expect(errorDiag.reason).toBe('http_error');
  });
});
