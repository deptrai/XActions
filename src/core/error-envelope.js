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

export class PlatformError extends Error {
  /**
   * @param {Object} opts
   * @param {string} [opts.code]
   * @param {string} [opts.type]
   * @param {string} [opts.message]
   * @param {number} [opts.retryAfter]
   * @param {string} [opts.suggestedAction]
   * @param {string} [opts.accountId]
   * @param {string} [opts.platform]
   */
  constructor(opts = {}) {
    super(opts.message || 'Platform error');
    this.name = 'PlatformError';
    this.code = opts.code || 'XACT_0000';
    this.type = opts.type || ErrorTypes.INTERNAL;
    this.retryAfter = opts.retryAfter ?? 0;
    this.suggestedAction = opts.suggestedAction || SuggestedActions.CONTACT_SUPPORT;
    this.accountId = opts.accountId;
    this.platform = opts.platform;
  }

  /** @returns {ErrorEnvelope} */
  toEnvelope() {
    return {
      code: this.code,
      type: this.type,
      message: this.message,
      retryAfter: this.retryAfter,
      suggestedAction: this.suggestedAction,
      accountId: this.accountId,
      platform: this.platform,
    };
  }
}

export class RateLimitError extends PlatformError {
  constructor(opts = {}) {
    super({ type: ErrorTypes.RATE_LIMIT, suggestedAction: SuggestedActions.ROTATE_PROXY, ...opts });
    this.name = 'RateLimitError';
  }
}

export class BotChallengeError extends PlatformError {
  constructor(opts = {}) {
    super({ type: ErrorTypes.BOT_CHALLENGE, suggestedAction: SuggestedActions.ROTATE_PROXY, ...opts });
    this.name = 'BotChallengeError';
  }
}

export class AuthSessionExpiredError extends PlatformError {
  constructor(opts = {}) {
    super({ type: ErrorTypes.AUTH_EXPIRED, suggestedAction: SuggestedActions.RELOGIN, ...opts });
    this.name = 'AuthSessionExpiredError';
  }
}

export class ProxyDeadError extends PlatformError {
  constructor(opts = {}) {
    super({ type: ErrorTypes.PROXY_EXHAUSTED, suggestedAction: SuggestedActions.WAIT, ...opts });
    this.name = 'ProxyDeadError';
  }
}
