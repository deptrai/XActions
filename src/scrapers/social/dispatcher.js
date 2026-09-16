// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * UniversalActionDispatcher — Multi-platform write actions & interaction dispatcher (Story 30.1).
 * Dispatches write operations (post, like, reply, retweet/repost, follow, unfollow)
 * across multiple social platforms (X/Twitter, Bluesky, Mastodon, Threads) in parallel.
 *
 * Provides fault isolation so individual platform failures do not abort the entire batch.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { scrape } from '../index.js';
import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../core/error-envelope.js';

export const SUPPORTED_WRITE_ACTIONS = new Set([
  'post',
  'publish',
  'like',
  'unlike',
  'reply',
  'retweet',
  'repost',
  'undo_retweet',
  'follow',
  'unfollow',
]);

export const DEFAULT_WRITE_PLATFORMS = [
  'twitter',
  'bluesky',
  'mastodon',
  'threads',
];

/**
 * Resolve target platforms array from input.
 * @param {string | string[]} platform
 * @returns {string[]}
 */
export function resolveTargetPlatforms(platform) {
  if (!platform || platform === 'all') {
    return [...DEFAULT_WRITE_PLATFORMS];
  }
  if (Array.isArray(platform)) {
    const list = platform
      .map((p) => String(p).trim().toLowerCase())
      .filter(Boolean);
    return list.length > 0 ? list : [...DEFAULT_WRITE_PLATFORMS];
  }
  if (typeof platform === 'string') {
    const clean = platform.trim().toLowerCase();
    if (clean === 'all') return [...DEFAULT_WRITE_PLATFORMS];
    if (clean.includes(',')) {
      return clean
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    }
    return [clean];
  }
  return [...DEFAULT_WRITE_PLATFORMS];
}

/**
 * Resolve credentials for a specific platform from options or environment variables.
 * @param {string} platform
 * @param {Record<string, any>} [options={}]
 * @returns {Record<string, any>}
 */
export function resolvePlatformCredentials(platform, options = {}) {
  const explicit = options.credentials?.[platform] || options.credentials || {};

  switch (platform) {
    case 'twitter':
    case 'x':
      return {
        cookies: explicit.cookies || options.cookies || process.env.TWITTER_COOKIES || process.env.XACTIONS_SESSION_COOKIE,
        authToken: explicit.authToken || options.authToken || process.env.TWITTER_AUTH_TOKEN,
        ct0: explicit.ct0 || options.ct0 || process.env.TWITTER_CT0,
        ...explicit,
      };

    case 'bluesky':
    case 'bsky':
      return {
        identifier: explicit.identifier || options.identifier || process.env.BLUESKY_IDENTIFIER || process.env.BSKY_HANDLE,
        password: explicit.password || options.password || process.env.BLUESKY_PASSWORD || process.env.BSKY_APP_PASSWORD,
        accessJwt: explicit.accessJwt || options.accessJwt,
        did: explicit.did || options.did,
        ...explicit,
      };

    case 'mastodon':
    case 'masto':
      return {
        accessToken: explicit.accessToken || options.accessToken || process.env.MASTODON_ACCESS_TOKEN,
        instance: explicit.instance || options.instance || process.env.MASTODON_INSTANCE,
        ...explicit,
      };

    case 'threads':
      return {
        cookies: explicit.cookies || options.cookies || process.env.THREADS_COOKIES,
        accessToken: explicit.accessToken || options.accessToken || process.env.THREADS_ACCESS_TOKEN,
        ...explicit,
      };

    default:
      return explicit;
  }
}

/**
 * Universal Action Dispatcher class for multi-platform write operations.
 */
export class UniversalActionDispatcher {
  /**
   * Execute an action across one or more platforms.
   *
   * @param {Object} command
   * @param {string | string[]} [command.platform='all'] - Target platform(s) or 'all'
   * @param {string} command.action - Action name (post, like, reply, retweet, follow, unfollow)
   * @param {Record<string, any>} [command.args={}] - Arguments for the action
   * @param {Record<string, any>} [command.options={}] - Execution options (dryRun, credentials, timeout)
   * @returns {Promise<{
   *   success: boolean,
   *   action: string,
   *   results: Record<string, any>,
   *   errors: Record<string, any>,
   *   summary: { total: number, succeeded: number, failed: number }
   * }>}
   */
  static async dispatch(command) {
    if (!command || typeof command !== 'object') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Invalid command: command must be an object',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'all',
      });
    }

    const { action, args = {}, options = {} } = command;
    if (!action || typeof action !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing or invalid action in dispatch command',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'all',
      });
    }

    const targetPlatforms = resolveTargetPlatforms(command.platform);
    const dryRun = options.dryRun === true || args.dryRun === true;

    const dispatchPromises = targetPlatforms.map(async (platform) => {
      const credentials = resolvePlatformCredentials(platform, options);
      const executionArgs = {
        ...args,
        ...credentials,
        accountId: args.accountId || credentials.accountId || (dryRun ? `${platform}-dryrun` : `${platform}-account`),
        dryRun,
      };

      try {
        const res = await scrape(platform, action, executionArgs);
        return { platform, success: true, data: res };
      } catch (err) {
        const errorInfo = {
          code: err?.code || 'XACT_5000',
          type: err?.type || ErrorTypes.INTERNAL,
          message: err?.message || String(err),
          statusCode: err?.statusCode || 500,
          suggestedAction: err?.suggestedAction || SuggestedActions.RETRY_AFTER_DELAY,
          platform,
        };
        return { platform, success: false, error: errorInfo };
      }
    });

    const settled = await Promise.allSettled(dispatchPromises);

    /** @type {Record<string, any>} */
    const results = {};
    /** @type {Record<string, any>} */
    const errors = {};
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < settled.length; i++) {
      const entry = settled[i];
      const platform = targetPlatforms[i];

      if (entry.status === 'fulfilled') {
        const value = entry.value;
        if (value.success) {
          results[platform] = value.data;
          succeeded++;
        } else {
          errors[platform] = value.error;
          failed++;
        }
      } else {
        const reason = entry.reason;
        errors[platform] = {
          code: 'XACT_5000',
          type: ErrorTypes.INTERNAL,
          message: reason?.message || String(reason),
          statusCode: 500,
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform,
        };
        failed++;
      }
    }

    return {
      success: succeeded > 0 || (targetPlatforms.length === 0),
      action,
      results,
      errors,
      summary: {
        total: targetPlatforms.length,
        succeeded,
        failed,
      },
    };
  }
}

/**
 * Functional convenience wrapper for UniversalActionDispatcher.dispatch
 * @param {Object} command
 * @returns {Promise<any>}
 */
export async function dispatchAction(command) {
  return await UniversalActionDispatcher.dispatch(command);
}
