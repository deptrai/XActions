// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractPlatformResponseValidator — contract for detecting bot/rate-limit payloads (AD-30).
 * Subclasses implement platform-specific logic to decide whether a response is valid,
 * a bot challenge, a rate-limit signal, or a False 200 payload.
 * @author nich (@nichxbt)
 * @license MIT
 */

export const GENERIC_FALSE_200_MARKERS = [
  /__cf_chl_jschl_tk__/i,
  /cf-browser-verification/i,
  /arkose/i,
  /captcha/i,
  /checking your browser before accessing/i,
  /please enable javascript and cookies/i,
  /just a moment\.\.\./i,
  /attention required! \| cloudflare/i,
];

export const GENERIC_CHECKPOINT_MARKERS = [
  /id=["']login["']/i,
  /class=["'][^"']*\blogin\b[^"']*["']/i,
  /sign in to/i,
  /đăng nhập để tiếp tục/i,
  /confirm your identity/i,
  /\/checkpoint\//i,
];

export class AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'base';

  constructor() {
    if (new.target === AbstractPlatformResponseValidator) {
      throw new TypeError('AbstractPlatformResponseValidator is abstract; extend it.');
    }
  }

  /**
   * Helper to extract numeric HTTP status code from varied response structures.
   * @param {any} response
   * @returns {number}
   */
  _extractStatus(response) {
    if (!response || typeof response !== 'object') return 200;
    const s = response.status !== undefined ? response.status : response.statusCode;
    if (s !== undefined) {
      const n = Number(s);
      return Number.isFinite(n) ? n : 200;
    }
    return 200;
  }

  /**
   * Helper to extract body text from string, Buffer, or object response data.
   * @param {any} response
   * @returns {string}
   */
  _extractText(response) {
    if (typeof response === 'string') return response.toLowerCase();
    const raw = response?.data ?? response?.body;
    if (typeof raw === 'string') return raw.toLowerCase();
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) return raw.toString('utf-8').toLowerCase();
    if (raw !== null && typeof raw === 'object') {
      try {
        return JSON.stringify(raw).toLowerCase();
      } catch {
        return '';
      }
    }
    return '';
  }

  /**
   * Helper to extract underlying data payload unwrapping envelope.
   * @param {any} response
   * @returns {any}
   */
  _extractData(response) {
    const root = response?.data !== undefined ? response.data : response;
    return root?.data !== undefined ? root.data : root;
  }

  /**
   * Check if a 2xx response contains challenge or empty wrapper signatures (False 200).
   * @param {any} response
   * @returns {boolean}
   */
  isFalse200(response) {
    const status = this._extractStatus(response);
    if (status < 200 || status >= 300) return false;

    // Check for empty JSON object payloads (e.g. {} or {"data": {}})
    const data = this._extractData(response);
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      const keys = Object.keys(data);
      if (keys.length === 0) return true;
      if (keys.length === 1 && keys[0] === 'data' && data.data && typeof data.data === 'object' && !Array.isArray(data.data) && Object.keys(data.data).length === 0) {
        return true;
      }
    }

    const text = this._extractText(response);
    if (text) {
      const slice = text.length > 65536 ? text.slice(0, 65536) : text;
      if (GENERIC_FALSE_200_MARKERS.some((re) => re.test(slice))) return true;
      if (GENERIC_CHECKPOINT_MARKERS.some((re) => re.test(slice))) return true;
    }
    return false;
  }

  /**
   * Composite validator method producing normalized diagnostic result (AD-30).
   * @param {any} response
   * @returns {{ isValid: boolean, isFalse200: boolean, isCheckpoint: boolean, isRateLimit: boolean, isAuthExpired: boolean, reason?: string }}
   */
  validateResponse(response) {
    const status = this._extractStatus(response);
    const isStatusOk = status < 400;
    const isRate = Boolean(this.isRateLimit(response));
    const isChallenge = Boolean(this.isBotChallenge(response));
    const isLogin = Boolean(this.isLoginWall(response));
    const isExpired = Boolean(this.isAuthExpired(response));
    const isFalse = Boolean(this.isFalse200(response));

    let isCheckpoint = isChallenge || isLogin;
    if (!isCheckpoint && isFalse) {
      const text = this._extractText(response);
      if (text) {
        const slice = text.length > 65536 ? text.slice(0, 65536) : text;
        if (
          GENERIC_CHECKPOINT_MARKERS.some((re) => re.test(slice)) ||
          GENERIC_FALSE_200_MARKERS.some((re) => re.test(slice))
        ) {
          isCheckpoint = true;
        }
      }
    }

    const isValid = isStatusOk && !isRate && !isChallenge && !isLogin && !isExpired && !isFalse && Boolean(this.isValidPayload(response));

    let reason;
    if (isRate) reason = 'rate_limit';
    else if (isChallenge) reason = 'bot_challenge';
    else if (isLogin) reason = 'login_wall';
    else if (isExpired) reason = 'auth_expired';
    else if (isFalse) reason = 'false_200';
    else if (!isStatusOk) reason = 'http_error';
    else if (!isValid) reason = 'invalid_payload';

    return {
      isValid,
      isFalse200: isFalse,
      isCheckpoint,
      isRateLimit: isRate,
      isAuthExpired: isExpired,
      ...(reason ? { reason } : {}),
    };
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    throw new Error('Method not implemented: isValidPayload()');
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    throw new Error('Method not implemented: isBotChallenge()');
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    throw new Error('Method not implemented: isRateLimit()');
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isLoginWall(response) {
    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isAuthExpired(response) {
    return false;
  }
}
