// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Error envelope, error types, and PlatformError hierarchy.
 * @author nich (@nichxbt)
 * @license MIT
 */

/** @typedef {import('./types.js').ErrorEnvelope} ErrorEnvelope */

export const ErrorTypes = Object.freeze({
  RATE_LIMIT: 'rate_limit',
  BOT_CHALLENGE: 'bot_challenge',
  AUTH_EXPIRED: 'auth_expired',
  PROXY_EXHAUSTED: 'proxy_exhausted',
  HIBERNATION: 'hibernation',
  INVALID_ARGS: 'invalid_args',
  INTERNAL: 'internal',
});

export const SuggestedActions = Object.freeze({
  RETRY_AFTER_DELAY: 'retry_after_delay',
  ROTATE_PROXY: 'rotate_proxy',
  RELOGIN: 'relogin',
  WAIT: 'wait',
  REDUCE_RATE: 'reduce_rate',
  CONTACT_SUPPORT: 'contact_support',
  USE_ACTIONS_LIST: 'use_x_actions_list',
});

const RETRYABLE_TYPES = new Set([
  ErrorTypes.RATE_LIMIT,
  ErrorTypes.BOT_CHALLENGE,
  ErrorTypes.PROXY_EXHAUSTED,
  ErrorTypes.HIBERNATION,
]);

/**
 * @param {string} type
 * @returns {boolean}
 */
function isRetryableType(type) {
  return RETRYABLE_TYPES.has(type);
}

export class PlatformError extends Error {
  /**
   * @param {Object} opts
   * @param {string} [opts.code]
   * @param {string} [opts.type]
   * @param {string} [opts.message]
   * @param {number} [opts.statusCode]
   * @param {number} [opts.retryAfterMs]
   * @param {string} [opts.suggestedAction]
   * @param {string} [opts.accountId]
   * @param {string} [opts.platform]
   */
  constructor(opts = {}) {
    super(opts.message || 'Platform error');
    this.name = 'PlatformError';
    this.code = opts.code || 'XACT_0000';
    this.type = opts.type || ErrorTypes.INTERNAL;
    this.statusCode = opts.statusCode ?? 500;
    this.retryAfterMs = opts.retryAfterMs ?? 0;
    this.suggestedAction = opts.suggestedAction || SuggestedActions.CONTACT_SUPPORT;
    this.accountId = opts.accountId;
    this.platform = opts.platform;
  }

  /** @returns {boolean} */
  get isRetryable() {
    return isRetryableType(this.type);
  }

  /** @returns {number} */
  get retryAfter() {
    return Math.ceil(this.retryAfterMs / 1000);
  }

  /** @returns {ErrorEnvelope} */
  toEnvelope() {
    return {
      code: this.code,
      type: this.type,
      message: this.message,
      statusCode: this.statusCode,
      isRetryable: this.isRetryable,
      retryAfterMs: this.retryAfterMs,
      retryAfter: this.retryAfter,
      suggestedAction: this.suggestedAction,
      accountId: this.accountId,
      platform: this.platform,
    };
  }
}

export class RateLimitError extends PlatformError {
  constructor(opts = {}) {
    super({
      type: ErrorTypes.RATE_LIMIT,
      statusCode: 429,
      suggestedAction: SuggestedActions.ROTATE_PROXY,
      ...opts,
    });
    this.name = 'RateLimitError';
  }
}

export class BotChallengeError extends PlatformError {
  constructor(opts = {}) {
    super({
      type: ErrorTypes.BOT_CHALLENGE,
      statusCode: 403,
      suggestedAction: SuggestedActions.ROTATE_PROXY,
      ...opts,
    });
    this.name = 'BotChallengeError';
  }
}

export class AuthSessionExpiredError extends PlatformError {
  constructor(opts = {}) {
    super({
      type: ErrorTypes.AUTH_EXPIRED,
      statusCode: 401,
      suggestedAction: SuggestedActions.RELOGIN,
      ...opts,
    });
    this.name = 'AuthSessionExpiredError';
  }
}

export class ProxyDeadError extends PlatformError {
  constructor(opts = {}) {
    super({
      type: ErrorTypes.PROXY_EXHAUSTED,
      statusCode: 503,
      suggestedAction: SuggestedActions.WAIT,
      ...opts,
    });
    this.name = 'ProxyDeadError';
  }
}
