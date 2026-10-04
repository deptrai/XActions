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
  NOT_FOUND: 'not_found',
  TARGET_NOT_FOUND: 'target_not_found',
  INTERNAL: 'internal',
  DEPRECATED: 'deprecated', // Story 25.4 — unified deprecation error envelope
  DEGRADED_DATA: 'degraded_data', // Story 28.1 — schema drift corrupted data
  BUDGET_CEILING_REACHED: 'budget_ceiling_reached', // Story 40.1 — proxy daily budget exhausted
});

export const ErrorCodes = Object.freeze({
  MISSING_OR_INVALID_ACTION: 'XACT_4001',
  MISSING_REQUIRED_ARGS: 'XACT_4002',
  AUTH_REQUIRED: 'XACT_4003',
  INVALID_AUTH_TOKEN: 'XACT_4010',
  RATE_LIMIT_EXCEEDED: 'XACT_4030',
  NOT_FOUND: 'XACT_4041',
  HIBERNATION: 'XACT_4090',
  CONSUMER_QUOTA_EXCEEDED: 'XACT_4291',
  INTERNAL_ERROR: 'XACT_5000',
  ARTIFACT_ERROR: 'XACT_5002',
});

export const SuggestedActions = Object.freeze({
  RETRY_AFTER_DELAY: 'retry_after_delay',
  ROTATE_PROXY: 'rotate_proxy',
  ROTATE_ACCOUNT: 'rotate_account',
  HIBERNATE_ACCOUNT: 'hibernate_account',
  RATE_LIMIT_BACKOFF: 'rate_limit_backoff',
  RELOGIN: 'relogin',
  WAIT: 'wait',
  REDUCE_RATE: 'reduce_rate',
  CONTACT_SUPPORT: 'contact_support',
  USE_ACTIONS_LIST: 'use_x_actions_list',
  VERIFY_URL: 'verify_url',
  RETRY_WITH_DIFFERENT_ACCOUNT: 'retry_with_different_account',
});

/** @type {Set<string>} */
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
export function isRetryableType(type) {
  return RETRYABLE_TYPES.has(type);
}

export class PlatformError extends Error {
  /**
   * @param {object} opts
   * @param {string} [opts.code]
   * @param {string} [opts.type]
   * @param {string} [opts.message]
   * @param {number} [opts.statusCode]
   * @param {number} [opts.retryAfterMs]
   * @param {string} [opts.suggestedAction]
   * @param {string | null} [opts.accountId]
   * @param {string} [opts.platform]
   * @param {string} [opts.consumerId] - Consumer identity for quota errors (AD-20).
   * @param {Record<string, unknown>} [opts.details]
   * @param {boolean} [opts.isRetryable]
   * @param {unknown} [opts.cause]
   * @param {any} [opts.availableActions]
   * @param {any} [opts.missing]
   * @param {any} [opts.example]
   */
  constructor(opts = {}) {
    super(opts.message || 'Platform error');
    this.name = 'PlatformError';
    this.isPlatformError = true;
    this.code = opts.code || 'XACT_0000';
    this.type = opts.type || ErrorTypes.INTERNAL;
    this.isRetryable = opts.isRetryable ?? isRetryableType(this.type);
    this.statusCode = opts.statusCode ?? 500;
    this.retryAfterMs = opts.retryAfterMs ?? 0;
    this.suggestedAction = opts.suggestedAction || SuggestedActions.CONTACT_SUPPORT;
    this.accountId = opts.accountId;
    this.platform = opts.platform;
    this.consumerId = opts.consumerId;
    this.details = opts.details;
    if (opts.availableActions !== undefined) this.availableActions = opts.availableActions;
    if (opts.missing !== undefined) this.missing = opts.missing;
    if (opts.example !== undefined) this.example = opts.example;
    if (opts.cause !== undefined) this.cause = opts.cause;
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
      // AD-20 additive fields — present only when set, preserving legacy shape.
      ...(this.consumerId ? { consumerId: this.consumerId } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(this.availableActions !== undefined ? { availableActions: this.availableActions } : {}),
      ...(this.missing !== undefined ? { missing: this.missing } : {}),
      ...(this.example !== undefined ? { example: this.example } : {}),
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
