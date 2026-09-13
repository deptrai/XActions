// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Legacy platform deprecation proxy (Phase 1).
 * Re-exports the new hybrid barrels while emitting console warnings on access.
 *
 * @deprecated This re-export bridge is only for backward compatibility.
 *             Prefer `xactions/scrapers/social/bluesky` and
 *             `xactions/scrapers/social/mastodon`.
 */

import * as blueskyBarrel from './social/bluesky/index.js';
import * as mastodonBarrel from './social/mastodon/index.js';
import * as twitterBarrel from './social/twitter/index.js';
import * as facebookBarrel from './social/facebook/index.js';
import * as threadsBarrel from './social/threads/index.js';

/**
 * Create a deprecation proxy that warns once per key and forwards to the
 * replacement module.
 * @param {string} legacyName
 * @param {Record<string, unknown>} replacement
 * @returns {Record<string, unknown>}
 */
/** @param {string} legacyName @param {Record<string, any>} replacement @param {Record<string, any>} [fallbacks] */
function createDeprecationProxy(legacyName, replacement, fallbacks = {}) {
  /** @type {Set<string>} */
  const warnedKeys = new Set();

  return new Proxy(replacement, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !warnedKeys.has(prop)) {
        warnedKeys.add(prop);
        console.warn(
          `DEPRECATED: xactions/scrapers/${legacyName}/${prop} is deprecated. Use xactions/scrapers/social/${legacyName} instead.`
        );
      }
      const val = Reflect.get(target, prop, receiver);
      if (val !== undefined) return val;
      if (typeof prop === 'string' && prop in fallbacks) return fallbacks[prop];
      return undefined;
    },
    apply(target, thisArg, args) {
      if (!warnedKeys.has('(call)')) {
        warnedKeys.add('(call)');
        console.warn(
          `DEPRECATED: xactions/scrapers/${legacyName} is deprecated. Use xactions/scrapers/social/${legacyName} instead.`
        );
      }
      if (typeof target === 'function') {
        return Reflect.apply(target, thisArg, args);
      }
      throw new TypeError(`${legacyName} is not a function`);
    },
  });
}

import { createBrowser, createPage, loginWithCookie } from './browser.js';

export const bluesky = createDeprecationProxy('bluesky', blueskyBarrel);
export const mastodon = createDeprecationProxy('mastodon', mastodonBarrel);
export const twitter = createDeprecationProxy('twitter', twitterBarrel, {
  createBrowser,
  createPage,
  loginWithCookie,
});
export const facebook = createDeprecationProxy('facebook', facebookBarrel, {
  createBrowser,
  createPage,
  loginWithCookie,
});
export const threads = createDeprecationProxy('threads', threadsBarrel);
