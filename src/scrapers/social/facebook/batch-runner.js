// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook Hybrid Batch Runner & Velocity Tracker
 *
 * Implements bounded batch execution with per-item governor check,
 * sliding-window velocity limits, and human-like delay enforcement.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

export const ACCOUNT_RISK_WARNING =
  '⚠️ Performing automated social actions carries account suspension risk. Follow recommended velocity limits and delays.';

/**
 * Standard delay floors and velocity ceilings per action.
 * @type {Record<string, { perHour?: number, perDay?: number, delayMin: number, delayMax: number }>}
 */
export const ACTION_LIMITS = {
  like: { perHour: 30, perDay: 200, delayMin: 1000, delayMax: 3000 },
  comment: { perHour: 10, perDay: 80, delayMin: 3000, delayMax: 7000 },
  group_comment: { perHour: 10, perDay: 60, delayMin: 5000, delayMax: 15000 },
  post: { perHour: 5, perDay: 30, delayMin: 3000, delayMax: 7000 },
  group_post: { perHour: 3, perDay: 20, delayMin: 30000, delayMax: 90000 },
  share: { perHour: 10, perDay: 60, delayMin: 5000, delayMax: 15000 },
  messenger_share: { perHour: 20, perDay: 100, delayMin: 5000, delayMax: 15000 },
  share_link_uid: { perHour: 20, perDay: 100, delayMin: 5000, delayMax: 15000 },
  join_group: { perHour: 5, perDay: 20, delayMin: 30000, delayMax: 90000 },
  send_friend_request: { perHour: 20, perDay: 20, delayMin: 60000, delayMax: 180000 },
};

/**
 * Return the configured limit ceiling/floor for an action.
 * @param {string} action
 * @returns {{ perHour?: number, perDay?: number, delayMin: number, delayMax: number }}
 */
export function getActionLimit(action) {
  return ACTION_LIMITS[action] || { delayMin: 1000, delayMax: 3000 };
}

/**
 * Sliding window action velocity tracker.
 */
export class FacebookActionVelocityTracker {
  /** @type {Map<string, number[]>} */
  #actionHistory = new Map();

  /**
   * Get compound key for account and action.
   * @param {string} accountId
   * @param {string} action
   * @returns {string}
   */
  #getKey(accountId, action) {
    return `${accountId || 'default'}:${action}`;
  }

  /**
   * Check if action can be executed under rate limits.
   * @param {string} accountId
   * @param {string} action
   * @returns {boolean}
   */
  canDoAction(accountId, action) {
    const limits = getActionLimit(action);
    const key = this.#getKey(accountId, action);
    const history = this.#actionHistory.get(key) || [];
    const now = Date.now();

    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const pruned = history.filter((ts) => ts > oneDayAgo);
    if (pruned.length !== history.length) {
      this.#actionHistory.set(key, pruned);
    }

    const countLastHour = pruned.filter((ts) => ts > oneHourAgo).length;
    const countLastDay = pruned.length;

    if (limits.perHour != null && countLastHour >= limits.perHour) {
      return false;
    }
    if (limits.perDay != null && countLastDay >= limits.perDay) {
      return false;
    }
    return true;
  }

  /**
   * Record execution of an action.
   * @param {string} accountId
   * @param {string} action
   */
  recordAction(accountId, action) {
    const key = this.#getKey(accountId, action);
    const history = this.#actionHistory.get(key) || [];
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    // Prune entries older than 24h
    const pruned = history.filter((ts) => ts > oneDayAgo);
    pruned.push(now);
    this.#actionHistory.set(key, pruned);
  }

  /**
   * Return limit configuration for an action.
   * @param {string} action
   * @returns {{ perHour?: number, perDay?: number, delayMin: number, delayMax: number }}
   */
  getActionLimit(action) {
    return getActionLimit(action);
  }

  /**
   * Legacy alias for canDoAction.
   * @param {string} accountId
   * @param {string} action
   * @returns {boolean}
   */
  canExecute(accountId, action) {
    return this.canDoAction(accountId, action);
  }

  /**
   * Legacy alias for recordAction.
   * @param {string} accountId
   * @param {string} action
   */
  record(accountId, action) {
    this.recordAction(accountId, action);
  }

  /**
   * Clear recorded history.
   */
  clear() {
    this.#actionHistory.clear();
  }
}

/**
 * Enforce human-like delay between actions.
 * @param {number} [minMs]
 * @param {number} [maxMs]
 * @returns {Promise<number>} Actual delay waited in ms
 */
export async function enforceActionDelay(minMs, maxMs) {
  const min = minMs != null && !Number.isNaN(Number(minMs)) ? Math.max(0, Number(minMs)) : 1000;
  const max = maxMs != null && !Number.isNaN(Number(maxMs)) ? Math.max(min, Number(maxMs)) : Math.max(min, min * 2);
  if (max === 0) return 0;
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, delay));
  return delay;
}

/**
 * Clamp caller-supplied delay to the action's hard floor/ceiling.
 * @param {string} actionName
 * @param {number} [delayMin]
 * @param {number} [delayMax]
 * @returns {{ delayMin: number, delayMax: number }}
 */
function clampActionDelay(actionName, delayMin, delayMax) {
  const limits = getActionLimit(actionName);
  const callerMin = Number(delayMin);
  const callerMax = Number(delayMax);
  const effectiveMin = Number.isFinite(callerMin) ? Math.max(limits.delayMin, callerMin) : limits.delayMin;
  const effectiveMax = Number.isFinite(callerMax)
    ? Math.max(effectiveMin, Math.min(limits.delayMax, callerMax))
    : limits.delayMax;
  return { delayMin: effectiveMin, delayMax: effectiveMax };
}

/**
 * @param {unknown} err
 * @param {unknown} item
 * @param {string} actionName
 * @param {string} [accountId]
 * @returns {PlatformError}
 */
function wrapItemError(err, item, actionName, accountId = '') {
  if (err instanceof PlatformError) {
    const anyErr = /** @type {any} */ (err);
    if (!('item' in anyErr)) anyErr.item = item;
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  const wrapped = new PlatformError({
    code: 'XACT_5000',
    type: ErrorTypes.INTERNAL,
    message: `${actionName} item failed: ${message}`,
    suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
    platform: 'facebook',
    accountId,
    details: { item, originalError: message },
    cause: err,
  });
  Object.assign(wrapped, { ok: false, item, error: wrapped.message });
  return wrapped;
}

/**
 * Run a guarded batch of social actions with per-item governor check and jitter.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number, ctx: { page?: any }) => Promise<R>} fn
 * @param {Object} [options={}]
 * @param {string} [options.actionName='like']
 * @param {string} [options.accountId='default']
 * @param {any} [options.governor]
 * @param {FacebookActionVelocityTracker} [options.velocityTracker]
 * @param {number} [options.delayMin]
 * @param {number} [options.delayMax]
 * @param {boolean} [options.dryRun=true]
 * @param {number} [options.maxBatch]
 * @param {any} [options.page]
 * @param {(progress: { current: number, total: number, result: R }) => void} [options.progressCallback]
 * @returns {Promise<R[]>}
 */
export async function runGuardedActionBatch(items, fn, options = {}) {
  const {
    actionName = 'like',
    accountId = 'default',
    governor,
    velocityTracker,
    delayMin,
    delayMax,
    dryRun = true,
    maxBatch,
    page,
    progressCallback,
  } = options;

  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const { delayMin: effectiveDelayMin, delayMax: effectiveDelayMax } = clampActionDelay(actionName, delayMin, delayMax);

  let batch = items.slice();
  if (maxBatch != null) {
    const n = Number(maxBatch);
    if (Number.isFinite(n) && n > 0) {
      batch = batch.slice(0, Math.max(1, Math.floor(n)));
    }
  }

  const results = [];

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];

    // Check governor per item (await if async)
    if (governor && typeof governor.canAccountRequest === 'function') {
      const allowed = await Promise.resolve(governor.canAccountRequest(accountId, 'facebook'));
      if (!allowed) {
        throw new PlatformError({
          code: 'XACT_4291',
          type: ErrorTypes.HIBERNATION,
          message: `Account ${accountId} is hibernating or restricted by rate governor.`,
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'facebook',
          accountId,
        });
      }
    }

    // Check velocity tracker per action
    if (velocityTracker && typeof velocityTracker.canDoAction === 'function') {
      if (!velocityTracker.canDoAction(accountId, actionName)) {
        throw new PlatformError({
          code: 'XACT_4291',
          type: ErrorTypes.RATE_LIMIT,
          message: `Action velocity limit exceeded for ${actionName} on account ${accountId}. ${ACCOUNT_RISK_WARNING}`,
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'facebook',
          accountId,
        });
      }
    }

    // Execute item handler with per-item error isolation
    let result;
    try {
      if (page && typeof page === 'object') {
        page.__actionName = actionName;
      }
      result = await fn(item, i, { page });
      results.push(result);
    } catch (err) {
      const wrapped = wrapItemError(err, item, actionName, accountId);
      results.push(/** @type {any} */ (wrapped));
      continue;
    }

    // Record request in governor and tracker only on success (no throw, no explicit error)
    const anyResult = /** @type {any} */ (result);
    if (!dryRun && result && !anyResult.error && anyResult.ok !== false) {
      if (governor && typeof governor.recordRequest === 'function') {
        await Promise.resolve(governor.recordRequest(accountId, 'facebook'));
      }
      if (velocityTracker && typeof velocityTracker.recordAction === 'function') {
        velocityTracker.recordAction(accountId, actionName);
      }
    }

    if (typeof progressCallback === 'function') {
      try {
        const res = /** @type {any} */ (progressCallback({ current: i + 1, total: batch.length, result }));
        if (res && typeof res === 'object' && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      } catch {}
    }

    // Apply inter-item delay if more items remain and not dry-run
    if (i < batch.length - 1 && !dryRun) {
      await enforceActionDelay(effectiveDelayMin, effectiveDelayMax);
    }
  }

  return results;
}
