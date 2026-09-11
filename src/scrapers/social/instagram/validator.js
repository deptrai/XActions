// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * InstagramPlatformResponseValidator — Instagram GraphQL / web / challenge response validator.
 * Detects valid payloads, rate limits, bot challenges / checkpoints, and login walls.
 * Also provides validatePost() which throws ValidationError on malformed media (AC-8).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';
import { PlatformError, RateLimitError, BotChallengeError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { asRecord } from './normalizer.js';

const RATE_LIMIT_STATUS = 429;
const FORBIDDEN_STATUS = 403;
const UNAUTHORIZED_STATUS = 401;

const CHALLENGE_MARKERS = [
  /challenge_required/i,
  /\/challenge\//i,
  /checkpoint_required/i,
  /suspicious.{0,20}login/i,
  /verify your account/i,
  /unusual activity/i,
  /we detected unusual/i,
  /confirm your identity/i,
];

const RATE_LIMIT_MARKERS = [
  /feedback_required/i,
  /please wait a few minutes/i,
  /rate.?limit/i,
  /too many requests/i,
  /try again later/i,
  /action.?blocked/i,
];

const LOGIN_WALL_MARKERS = [
  /login.{0,10}instagram/i,
  /sign in to instagram/i,
  /\/accounts\/login/i,
  /log in to see/i,
  /you must log in/i,
  /content unavailable.{0,40}log in/i,
];

/**
 * A validation failure for a single Instagram domain object (post / user / comment).
 * Distinct from transport-level PlatformError — signals a malformed payload, not a block.
 */
export class ValidationError extends PlatformError {
  /**
   * @param {object} opts
   * @param {string} [opts.message]
   * @param {string[]} [opts.missing]
   * @param {string} [opts.objectType]
   */
  constructor(opts = {}) {
    super({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'instagram',
      message: opts.message || 'Invalid Instagram object',
      details: { missing: opts.missing || [], objectType: opts.objectType || 'unknown' },
    });
    this.name = 'ValidationError';
    this.missing = opts.missing || [];
    this.objectType = opts.objectType || 'unknown';
  }
}

export class InstagramPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'instagram';

  /**
   * @param {unknown} response
   * @returns {Record<string, unknown> | null}
   */
  #getRecord(response) {
    return typeof response === 'object' && response !== null ? asRecord(response) : null;
  }

  /**
   * @param {unknown} response
   * @returns {number}
   */
  #status(response) {
    const record = this.#getRecord(response);
    const s = record?.status ?? record?.statusCode ?? record?.status_code;
    return typeof s === 'number' ? s : 0;
  }

  /**
   * Flatten a response to a lowercase string for marker matching (HTML or JSON).
   * @param {unknown} response
   * @returns {string}
   */
  #text(response) {
    const record = this.#getRecord(response);
    if (!record) return typeof response === 'string' ? response.toLowerCase() : '';
    const parts = [];
    if (typeof record.body === 'string') parts.push(record.body);
    if (typeof record.data === 'string') parts.push(record.data);
    if (typeof record.message === 'string') parts.push(record.message);
    if (typeof record.error === 'string') parts.push(record.error);
    if (typeof record.error_type === 'string') parts.push(record.error_type);
    if (typeof record.feedback_message === 'string') parts.push(record.feedback_message);
    if (parts.length === 0) { try { parts.push(JSON.stringify(record)); } catch { /* noop */ } }
    return parts.join(' ').toLowerCase();
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const status = this.#status(response);
    const text = this.#text(response);
    if (CHALLENGE_MARKERS.some((re) => re.test(text))) return true;
    const record = this.#getRecord(response);
    const errType = asString(record?.error_type ?? record?.error ?? record?.message);
    if (/challenge_required|checkpoint_required|sentry_block/i.test(errType)) return true;
    // A 403 carrying challenge markers is a challenge, not a plain denial.
    if (status === FORBIDDEN_STATUS && CHALLENGE_MARKERS.some((re) => re.test(text))) return true;
    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const status = this.#status(response);
    const text = this.#text(response);
    if (status === RATE_LIMIT_STATUS) return true;
    const record = this.#getRecord(response);
    const errType = asString(record?.error_type ?? record?.error);
    if (/feedback_required|rate_limit|spam/i.test(errType)) return true;
    return RATE_LIMIT_MARKERS.some((re) => re.test(text));
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isLoginWall(response) {
    const status = this.#status(response);
    const text = this.#text(response);
    if (status === UNAUTHORIZED_STATUS) return true;
    if (LOGIN_WALL_MARKERS.some((re) => re.test(text))) return true;
    const record = this.#getRecord(response);
    const errType = asString(record?.error_type ?? record?.error);
    return /login_required|not_logged_in|access_token/i.test(errType);
  }

  /**
   * A payload is valid when it is not a block page AND carries GraphQL/media shape.
   * @param {unknown} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response) || this.isLoginWall(response)) {
      return false;
    }
    const record = this.#getRecord(response);
    if (!record) return false;
    // GraphQL `{data:{...}}` / `{graphql:{...}}` / REST `{items:[...]}` / `{user:{...}}`
    if (record.data || record.graphql || record.items || record.user || record.media) return true;
    // Direct media object
    if (record.pk !== undefined || record.code !== undefined || record.shortcode !== undefined) return true;
    return false;
  }

  /**
   * AC-8 — validate a raw media object; throws ValidationError listing missing fields.
   * `caption` is optional — legitimately caption-less posts are valid; only flag it when
   * an object claims to be media but carries no content signal at all.
   * @param {unknown} raw
   * @param {object} [opts]
   * @param {boolean} [opts.requireCaption=false] - strict spec mode (AC-8 literal).
   * @returns {boolean}
   */
  validatePost(raw, opts = {}) {
    const record = asRecord(raw);
    /** @type {string[]} */
    const missing = [];
    if (record.pk === undefined && record.id === undefined) missing.push('pk');
    if (record.code === undefined && record.shortcode === undefined) missing.push('code');
    if (record.taken_at === undefined) missing.push('taken_at');
    if (opts.requireCaption === true && record.caption === undefined) missing.push('caption');
    if (missing.length > 0) {
      throw new ValidationError({
        message: `Invalid Instagram media: missing ${missing.join(', ')}`,
        missing,
        objectType: 'media',
      });
    }
    return true;
  }

  /**
   * @param {unknown} raw
   * @returns {boolean}
   */
  validateUser(raw) {
    const record = asRecord(raw);
    const missing = [];
    if (record.pk === undefined && record.id === undefined) missing.push('pk');
    if (typeof record.username !== 'string' || record.username.trim() === '') missing.push('username');
    if (missing.length > 0) {
      throw new ValidationError({
        message: `Invalid Instagram user: missing ${missing.join(', ')}`,
        missing,
        objectType: 'user',
      });
    }
    return true;
  }

  /**
   * @param {unknown} raw
   * @returns {boolean}
   */
  validateComment(raw) {
    const record = asRecord(raw);
    const missing = [];
    if (record.pk === undefined && record.id === undefined) missing.push('pk');
    if (record.text === undefined) missing.push('text');
    if (missing.length > 0) {
      throw new ValidationError({
        message: `Invalid Instagram comment: missing ${missing.join(', ')}`,
        missing,
        objectType: 'comment',
      });
    }
    return true;
  }
}

/**
 * Standalone validator fn for the dispatcher / tests.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function validateInstagramPost(raw) {
  return new InstagramPlatformResponseValidator().validatePost(raw);
}

/** Helper to satisfy the "asString" need without re-exporting from normalizer. */
function asString(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
