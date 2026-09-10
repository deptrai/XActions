// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MediumPlatformResponseValidator — Medium RSS / JSON / GraphQL response validator.
 * Detects valid feeds, rate-limits, Cloudflare bot challenges, login walls,
 * and paywalled member-only posts.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { asRecord } from './normalizer.js';

const RATE_LIMIT_STATUS = 429;
const FORBIDDEN_STATUS = 403;
const UNAUTHORIZED_STATUS = 401;

const CLOUDFLARE_MARKERS = [
  /__cf_chl_jschl_tk__/i,
  /cf-browser-verification/i,
  /__cf_chl_[\w]+/i,
  /checking your browser/i,
  /just a moment\.\.\./i,
  /attention required! \| cloudflare/i,
  /please enable javascript and cookies/i,
  /cf-im-under-attack/i,
];

const LOGIN_WALL_MARKERS = [
  /sign in to continue/i,
  /sign in with google/i,
  /sign in to medium/i,
  /\/signin/i,
  /class=["'][^"']*\bsignin\b[^"']*["']/i,
  /id=["']signin["']/i,
  /membership/i,
];

const PAYWALL_MARKERS = [
  /continue reading on medium/i,
  /get unlimited access/i,
  /member-only/i,
  /member only/i,
  /this story is for members/i,
  /issubscriptionlocked/i,
];

export class MediumPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'medium';

  /**
   * @param {unknown} response
   * @returns {Record<string, unknown> | null}
   */
  #getRecord(response) {
    if (typeof response === 'object' && response !== null) {
      return asRecord(response);
    }
    return null;
  }

  /**
   * @param {unknown} response
   * @returns {string}
   */
  #getBody(response) {
    if (typeof response === 'string') return response;
    const record = this.#getRecord(response);
    if (typeof record?.data === 'string') return record.data;
    if (typeof record?.body === 'string') return record.body;
    return '';
  }

  /**
   * @param {unknown} response
   * @returns {number | null}
   */
  #getStatus(response) {
    const record = this.#getRecord(response);
    if (typeof record?.status === 'number') return record.status;
    if (typeof record?.statusCode === 'number') return record.statusCode;
    return null;
  }

  /**
   * @param {unknown} response
   * @returns {Record<string, string> | null}
   */
  #getHeaders(response) {
    const record = this.#getRecord(response);
    if (!record) return null;

    const rawHeaders = record.headers;
    if (!rawHeaders || typeof rawHeaders !== 'object') return null;

    /** @type {Record<string, string>} */
    const normalized = {};

    const h = /** @type {Headers & Record<string, unknown>} */ (rawHeaders);
    if (typeof h.entries === 'function') {
      for (const [key, value] of h.entries()) {
        normalized[key.toLowerCase()] = value;
      }
      return normalized;
    }

    if (typeof h.forEach === 'function' && typeof h.get === 'function') {
      h.forEach((value, key) => {
        normalized[key.toLowerCase()] = value;
      });
      return normalized;
    }

    for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (rawHeaders))) {
      normalized[key.toLowerCase()] = typeof value === 'string' ? value : String(value);
    }
    return normalized;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const status = this.#getStatus(response);
    if (status === RATE_LIMIT_STATUS) return true;

    const headers = this.#getHeaders(response);
    if (headers) {
      const retryAfter = headers['retry-after'];
      if (retryAfter && /\d+/.test(retryAfter)) return true;
    }

    const body = this.#getBody(response).toLowerCase();
    if (body.includes('rate limit') || body.includes('too many requests') || body.includes('ratelimit')) {
      return true;
    }

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const status = this.#getStatus(response);
    if (status === FORBIDDEN_STATUS || status === 451) {
      const body = this.#getBody(response).toLowerCase();
      if (CLOUDFLARE_MARKERS.some((re) => re.test(body))) return true;
      if (
        body.includes('access denied') ||
        body.includes('blocked') ||
        body.includes('forbidden') ||
        body.includes('cloudflare')
      ) {
        return true;
      }
    }

    const body = this.#getBody(response).toLowerCase();
    if (CLOUDFLARE_MARKERS.some((re) => re.test(body))) return true;

    const record = this.#getRecord(response);
    if (record?.error && typeof record.error === 'object') {
      const err = asRecord(record.error);
      if (err.status === 403 || err.statusCode === 403 || err.code === 'FORBIDDEN' || err.code === 'BLOCKED') {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isLoginWall(response) {
    const status = this.#getStatus(response);
    const body = this.#getBody(response).toLowerCase();

    if (status === UNAUTHORIZED_STATUS || status === FORBIDDEN_STATUS) {
      if (LOGIN_WALL_MARKERS.some((re) => re.test(body))) return true;
      if (body.includes('sign in to continue') || body.includes('sign in with google') || body.includes('sign in to medium')) {
        return true;
      }
    }

    if (LOGIN_WALL_MARKERS.some((re) => re.test(body))) return true;

    return false;
  }

  /**
   * Determine whether a response payload is a valid Medium payload.
   * Accepts RSS, JSON (`payload`/`references.Post`), and GraphQL `postResult`.
   * Rejects HTML challenge pages and empty objects.
   *
   * @param {unknown} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response) || this.isLoginWall(response)) {
      return false;
    }

    const body = this.#getBody(response);
    if (typeof body === 'string' && body.trim()) {
      const lower = body.toLowerCase();
      if (lower.includes('<!doctype') || lower.includes('<html')) {
        if (
          lower.includes('<rss') ||
          lower.includes('<feed') ||
          lower.includes('<channel')
        ) {
          // It's an RSS/Atom feed disguised in HTML response type; still valid.
        } else if (
          lower.includes('checking your browser') ||
          lower.includes('just a moment') ||
          lower.includes('cloudflare')
        ) {
          return false;
        }
      }
    }

    const record = this.#getRecord(response);
    if (!record) {
      if (typeof body === 'string' && (body.includes('<rss') || body.includes('<feed'))) return true;
      return false;
    }

    const rawData = record.data !== undefined ? record.data : record;
    if (typeof rawData === 'string') {
      if (rawData.includes('<rss') || rawData.includes('<feed')) return true;
      return false;
    }

    const data = asRecord(rawData);

    // RSS envelope: { rss: { channel: { item: [...] } } }
    const rss = asRecord(data.rss);
    const channel = asRecord(rss.channel);
    if (Array.isArray(channel.item) || (channel.item !== undefined && channel.item !== null)) {
      return true;
    }

    // JSON payload: { payload: { value?: ..., references?: { Post?: ... } } }
    const payload = asRecord(data.payload);
    if (data.payload && typeof data.payload === 'object') {
      if (payload.value !== undefined) return true;
      const references = asRecord(payload.references);
      const posts = asRecord(references.Post);
      if (Object.keys(posts).length > 0) return true;
    }

    // Direct payload object from stripped JSON.
    if (data.value !== undefined && data.value !== null) return true;
    const references = asRecord(data.references);
    const posts = asRecord(references.Post);
    if (Object.keys(posts).length > 0) return true;

    // GraphQL envelope: { data: { postResult: { ... } } }
    const graphData = asRecord(data.data);
    if (graphData.postResult && typeof graphData.postResult === 'object') return true;
    if (data.postResult && typeof data.postResult === 'object') return true;

    // Empty but non-challenge object.
    if (typeof data === 'object' && data !== null && Object.keys(data).length > 0) {
      // It might still be a paywalled payload; accept and let the normalizer mark it.
      if (data.isSubscriptionLocked === true) return true;
      if (data.visibility !== undefined) return true;
      return false;
    }

    return false;
  }
}

/**
 * Validate a raw Medium post or RSS item.
 *
 * @param {Record<string, unknown>} raw
 * @returns {true}
 */
export function validateMediumPost(raw) {
  const record = asRecord(raw);

  const hasPostId =
    typeof record.postId === 'string' && record.postId.trim() !== ''
    || typeof record.guid === 'string' && record.guid.trim() !== ''
    || typeof record.id === 'string' && record.id.trim() !== '';

  const hasTitle = typeof record.title === 'string' && record.title.trim() !== '';

  const hasLink =
    typeof record.link === 'string' && record.link.trim() !== ''
    || typeof record.postUrl === 'string' && record.postUrl.trim() !== ''
    || typeof record.url === 'string' && record.url.trim() !== '';

  if (!hasPostId || !hasTitle || !hasLink) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Invalid Medium post: missing postId/guid, title, or link',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'medium',
    });
  }

  return true;
}
