// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Error Classes
 * Comprehensive error hierarchy for all Twitter API and scraper errors.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

/** @typedef {import('./api/parsers.js').Raw} Raw */

/**
 * @typedef {Object} ErrorOptions
 * @property {string} [endpoint]
 * @property {number} [httpStatus]
 * @property {Date|null} [rateLimitReset]
 * @property {number} [twitterErrorCode]
 * @property {string} [twitterMessage]
 * @property {number} [retryAfter]
 * @property {number} [limit]
 * @property {number} [remaining]
 * @property {Date|null} [resetAt]
 */

// ============================================================================
// Base Error
// ============================================================================

/**
 * Base error class for all XActions scraper errors.
 */
export class ScraperError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {string} [code='SCRAPER_ERROR'] - Machine-readable error code
   * @param {ErrorOptions} [options={}]
   */
  constructor(message, code = 'SCRAPER_ERROR', options = {}) {
    super(message);
    this.name = 'ScraperError';
    /** @type {string} */
    this.code = code;
    /** @type {string|undefined} */
    this.endpoint = options.endpoint;
    /** @type {number|undefined} */
    this.httpStatus = options.httpStatus;
    /** @type {Date|null} */
    this.rateLimitReset = options.rateLimitReset || null;
    /** @type {number|undefined} */
    this.twitterErrorCode = options.twitterErrorCode;
    /** @type {string|undefined} */
    this.twitterMessage = options.twitterMessage;
  }

  toString() {
    let str = `${this.name} [${this.code}]: ${this.message}`;
    if (this.endpoint) str += ` (endpoint: ${this.endpoint})`;
    if (this.httpStatus) str += ` (HTTP ${this.httpStatus})`;
    return str;
  }
}

// ============================================================================
// Authentication Errors
// ============================================================================

/**
 * Thrown when authentication fails or is required.
 */
export class AuthenticationError extends ScraperError {
  /**
   * @param {string} message
   * @param {string} [code='AUTH_FAILED']
   * @param {ErrorOptions} [options]
   */
  constructor(message, code = 'AUTH_FAILED', options = {}) {
    super(message, code, options);
    this.name = 'AuthenticationError';
  }
}

// ============================================================================
// Rate Limit Errors
// ============================================================================

/**
 * Thrown when a Twitter rate limit is hit.
 */
export class RateLimitError extends ScraperError {
  /**
   * @param {string} message
   * @param {string} [code='RATE_LIMITED']
   * @param {ErrorOptions} [options={}]
   */
  constructor(message, code = 'RATE_LIMITED', options = {}) {
    super(message, code, options);
    this.name = 'RateLimitError';
    /** @type {number|undefined} */
    this.retryAfter = options.retryAfter;
    /** @type {number|undefined} */
    this.limit = options.limit;
    /** @type {number|undefined} */
    this.remaining = options.remaining;
    /** @type {Date|null} */
    this.resetAt = options.resetAt || null;
  }
}

// ============================================================================
// Not Found Errors
// ============================================================================

/**
 * Thrown when a requested resource does not exist.
 */
export class NotFoundError extends ScraperError {
  /**
   * @param {string} message
   * @param {string} [code='NOT_FOUND']
   * @param {ErrorOptions} [options]
   */
  constructor(message, code = 'NOT_FOUND', options = {}) {
    super(message, code, options);
    this.name = 'NotFoundError';
  }
}

// ============================================================================
// Twitter API Errors
// ============================================================================

/**
 * Maps Twitter's internal error codes to structured error classes.
 * @type {Record<number, {ErrorClass: (new (message: string, code?: string, options?: ErrorOptions) => ScraperError), code: string, message: string}>}
 */
const TWITTER_ERROR_MAP = {
  34:  { ErrorClass: NotFoundError,      code: 'NOT_FOUND',       message: 'Resource not found' },
  50:  { ErrorClass: NotFoundError,      code: 'USER_NOT_FOUND',  message: 'User not found' },
  63:  { ErrorClass: AuthenticationError, code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' },
  64:  { ErrorClass: AuthenticationError, code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' },
  88:  { ErrorClass: RateLimitError,     code: 'RATE_LIMITED',    message: 'Rate limit exceeded' },
  89:  { ErrorClass: AuthenticationError, code: 'INVALID_TOKEN',   message: 'Invalid or expired token' },
  130: { ErrorClass: ScraperError,       code: 'OVER_CAPACITY',   message: 'Twitter is over capacity' },
  131: { ErrorClass: ScraperError,       code: 'INTERNAL_ERROR',  message: 'Twitter internal error' },
  135: { ErrorClass: AuthenticationError, code: 'AUTH_FAILED',     message: 'Could not authenticate you' },
  144: { ErrorClass: NotFoundError,      code: 'TWEET_NOT_FOUND', message: 'Tweet not found' },
  179: { ErrorClass: AuthenticationError, code: 'PROTECTED_TWEETS', message: 'Protected tweets' },
  185: { ErrorClass: RateLimitError,     code: 'RATE_LIMITED',    message: 'User-level tweet limit reached' },
  187: { ErrorClass: ScraperError,       code: 'DUPLICATE_TWEET', message: 'Status is a duplicate' },
  326: { ErrorClass: AuthenticationError, code: 'ACCOUNT_LOCKED',  message: 'Account locked' },
  349: { ErrorClass: ScraperError,       code: 'DM_NOT_ALLOWED',  message: 'Cannot send DM to this user' },
  385: { ErrorClass: ScraperError,       code: 'REPLY_RESTRICTED', message: 'Reply restricted by author' },
};

/**
 * Thrown for general Twitter API errors.
 */
export class TwitterApiError extends ScraperError {
  /**
   * @param {string} message
   * @param {string} [code='API_ERROR']
   * @param {ErrorOptions} [options={}]
   */
  constructor(message, code = 'API_ERROR', options = {}) {
    super(message, code, options);
    this.name = 'TwitterApiError';
    /** @type {number|undefined} */
    this.twitterErrorCode = options.twitterErrorCode;
    /** @type {string|undefined} */
    this.twitterMessage = options.twitterMessage;
  }

  /**
   * Create an error from a Twitter API error response body.
   *
   * Twitter returns errors in multiple formats:
   *   a. { errors: [{ code: 88, message: "Rate limit exceeded" }] }
   *   b. { data: { errors: [{ message: "..." }] } }  (GraphQL)
   *   c. { error: "Not authorized." }
   *
   * @param {Raw} body - Parsed JSON response body
   * @param {ErrorOptions} [context={}]
   * @returns {ScraperError}
   */
  static fromResponse(body, context = {}) {
    if (!body || typeof body !== 'object') {
      return new TwitterApiError('Unknown Twitter API error', 'API_ERROR', context);
    }

    // Format a: { errors: [{ code, message }] }
    const topErrors = /** @type {Raw[]|undefined} */ (body.errors);
    if (Array.isArray(topErrors) && topErrors.length > 0) {
      const first = /** @type {Raw} */ (topErrors[0]);
      const code = /** @type {number} */ (first.code);
      const message = /** @type {string} */ (first.message || 'Unknown error');

      const mapped = TWITTER_ERROR_MAP[code];
      if (mapped) {
        return new mapped.ErrorClass(mapped.message, mapped.code || 'API_ERROR', {
          ...context,
          twitterErrorCode: code,
          twitterMessage: message,
        });
      }

      return new TwitterApiError(message, 'API_ERROR', {
        ...context,
        twitterErrorCode: code,
        twitterMessage: message,
      });
    }

    // Format b: GraphQL errors
    const data = /** @type {Raw|undefined} */ (body.data);
    const dataErrors = /** @type {Raw[]|undefined} */ (data?.errors);
    if (data && Array.isArray(dataErrors) && dataErrors.length > 0) {
      const first = /** @type {Raw} */ (dataErrors[0]);
      const msg = /** @type {string} */ (first.message || 'GraphQL error');
      return new TwitterApiError(msg, 'API_ERROR', {
        ...context,
        twitterMessage: msg,
      });
    }

    // Format c: { error: "string" }
    const errorText = /** @type {unknown} */ (body.error);
    if (typeof errorText === 'string') {
      if (errorText.toLowerCase().includes('not authorized')) {
        return new AuthenticationError(errorText, 'AUTH_FAILED', context);
      }
      return new TwitterApiError(errorText, 'API_ERROR', context);
    }

    return new TwitterApiError('Unknown Twitter API error', 'API_ERROR', context);
  }
}
