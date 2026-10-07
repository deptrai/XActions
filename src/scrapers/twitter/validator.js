// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TwitterPlatformResponseValidator — recognizes GraphQL and HTML payload shapes.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractPlatformResponseValidator } from '../../core/platform-validator.js';

export class TwitterPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'twitter';

  /**
   * Extract raw body string if available.
   * @param {any} response
   * @returns {string}
   */
  #getBody(response) {
    if (typeof response === 'string') return response;
    if (typeof response?.data === 'string') return response.data;
    if (typeof response?.body === 'string') return response.body;
    if (typeof response?.data?.data === 'string') return response.data.data;
    return '';
  }

  /**
   * Extract lowercased body text.
   * @param {any} response
   * @returns {string}
   */
  #getText(response) {
    return this.#getBody(response).toLowerCase();
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response)) {
      return false;
    }

    // GraphQL response structure - unwrap possible { status, data: { data: ... } } or { data: ... }
    const root = response?.data !== undefined ? response.data : response;
    const data = root?.data !== undefined ? root.data : root;

    if (data && typeof data === 'object') {
      if (data.user?.result?.rest_id && data.user?.result?.legacy) return true;
      if (data.user?.result?.rest_id) return true;
      if (Array.isArray(data.user?.result?.timeline_v2?.timeline?.instructions)) return true;
      if (data.tweetResult?.result?.__typename === 'Tweet' || data.tweetResult?.result?.__typename === 'TweetTombstone' || data.tweetResult?.result?.rest_id) return true;
      if (Array.isArray(data.threaded_conversation_with_injections_v2?.instructions)) return true;
      if (Array.isArray(data.favoriters_timeline?.timeline?.instructions)) return true;
      if (Array.isArray(data.bookmark_timeline_v2?.timeline?.instructions)) return true;
      if (Array.isArray(data.bookmark_timeline?.timeline?.instructions)) return true;
      if (Array.isArray(data.retweeters_timeline?.timeline?.instructions)) return true;
      if (Array.isArray(data.list?.members_timeline?.timeline?.instructions)) return true;
      if (Array.isArray(data.instructions)) return true;

      // General fallback for GraphQL timeline objects with instructions
      for (const val of Object.values(data)) {
        if (val && typeof val === 'object') {
          if (Array.isArray(val.instructions) || Array.isArray(val.timeline?.instructions)) {
            return true;
          }
        }
      }
    }

    if (Array.isArray(response) || Array.isArray(response?.data) || Array.isArray(root)) {
      return true;
    }

    const text = this.#getText(response);
    if (text.includes('<html') && !text.includes('cf-browser-verification') && !text.includes('captcha')) {
      if (
        text.includes('react-root') ||
        text.includes('twitter-site') ||
        text.includes('<article') ||
        text.includes('data-testid') ||
        text.includes('main')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const root = response?.data !== undefined ? response.data : response;
    const errors = root?.errors || root?.data?.errors || response?.errors;
    if (Array.isArray(errors)) {
      for (const err of errors) {
        if (err?.code === 326) return true; // Account locked / challenge required
        const msg = String(err?.message || '').toLowerCase();
        if (msg.includes('challenge') || msg.includes('temporarily locked') || msg.includes('verify your account')) {
          return true;
        }
      }
    }

    if (response?.status === 403) {
      if (Array.isArray(errors) && errors.some((e) => e?.code === 32 || e?.code === 34 || e?.code === 179)) {
        return false;
      }
      return true;
    }

    const text = this.#getText(response);
    if (
      text.includes('cf-browser-verification') ||
      text.includes('incapsula_resource') ||
      text.includes('data-translate="why_captcha"') ||
      text.includes('challenge-running') ||
      text.includes('just a moment...') ||
      text.includes('<title>access denied</title>') ||
      text.includes('<title>attention required! | cloudflare</title>') ||
      text.includes('challenge') ||
      text.includes('captcha')
    ) {
      return true;
    }

    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    if (response?.status === 429) return true;

    const root = response?.data !== undefined ? response.data : response;
    const errors = root?.errors || root?.data?.errors || response?.errors;
    if (Array.isArray(errors)) {
      for (const err of errors) {
        if (err?.code === 88) return true;
        const msg = String(err?.message || '').toLowerCase();
        if (
          msg.includes('rate limit') ||
          msg.includes('too many') ||
          msg.includes('to protect our users from spam')
        ) {
          return true;
        }
      }
    }

    const text = this.#getText(response);
    if (
      text.includes('rate limit') ||
      text.includes('too many requests')
    ) {
      return true;
    }

    return false;
  }
}
