// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Stateless helpers for Facebook warmup and cancel-friend-request actions.
 *
 * Kept separate from `actions.js` so long-running passive operations do not
 * clutter the social write-action orchestrator.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { assertFacebookUrlLocal } from '../../facebook/core.js';
import { enforceActionDelay } from './batch-runner.js';

/**
 * Max dwell duration for a view-boost scroll session (seconds).
 * @type {number}
 */
export const MAX_WARMUP_SCROLL_DURATION_SECONDS = 300;

/**
 * Default view-boost scroll session length (seconds).
 * @type {number}
 */
export const DEFAULT_WARMUP_SCROLL_DURATION_SECONDS = 60;

/**
 * Max home-feed warming session length (seconds).
 * @type {number}
 */
export const MAX_WARMUP_ACCOUNT_DURATION_SECONDS = 600;

/**
 * Default home-feed warming session length (seconds).
 * @type {number}
 */
export const DEFAULT_WARMUP_ACCOUNT_DURATION_SECONDS = 120;

const WARMUP_HOME_URL = 'https://www.facebook.com/';

const SCROLL_PAUSE_MIN_MS = 800;
const SCROLL_PAUSE_MAX_MS = 2500;
const LONG_PAUSE_MIN_MS = 5000;
const LONG_PAUSE_MAX_MS = 8000;
const LONG_PAUSE_EVERY_N = 3;

const CANCEL_DELAY_MIN_MS = 2000;
const CANCEL_DELAY_MAX_MS = 5000;

/**
 * Validate a Facebook URL and throw a typed PlatformError on failure.
 * @param {string} url
 * @param {string} [label]
 */
function assertFacebookUrl(url, label = 'URL') {
  try {
    assertFacebookUrlLocal(url, label);
  } catch (err) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: err instanceof Error ? err.message : `Invalid ${label}`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'facebook',
    });
  }
}

/**
 * Resolve and clamp a scroll duration.
 * @param {unknown} value
 * @returns {{ effectiveDuration: number, clamped: boolean }}
 */
export function resolveScrollDuration(value) {
  let requested = value;
  if (requested === undefined || requested === null || requested === '') {
    requested = DEFAULT_WARMUP_SCROLL_DURATION_SECONDS;
  }
  const numeric = Number(requested);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'warmupScroll: durationSeconds must be a positive finite number',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'facebook',
    });
  }
  const clamped = numeric > MAX_WARMUP_SCROLL_DURATION_SECONDS;
  const effectiveDuration = clamped ? MAX_WARMUP_SCROLL_DURATION_SECONDS : numeric;
  return { effectiveDuration, clamped };
}

/**
 * Resolve and clamp an account-warming duration.
 * @param {unknown} value
 * @returns {{ effectiveDuration: number, clamped: boolean }}
 */
export function resolveWarmupDuration(value) {
  let requested = value;
  if (requested === undefined || requested === null || requested === '') {
    requested = DEFAULT_WARMUP_ACCOUNT_DURATION_SECONDS;
  }
  const numeric = Number(requested);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'warmupAccount: durationSeconds must be a positive finite number',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'facebook',
    });
  }
  const clamped = numeric > MAX_WARMUP_ACCOUNT_DURATION_SECONDS;
  const effectiveDuration = clamped ? MAX_WARMUP_ACCOUNT_DURATION_SECONDS : numeric;
  return { effectiveDuration, clamped };
}

/**
 * Resolve and clamp reaction probability.
 * @param {unknown} value
 * @returns {{ normalized: number, clamped: boolean }}
 */
export function resolveReactProbability(value) {
  const raw = typeof value === 'number' ? value : 0.05;
  if (!Number.isFinite(raw) || raw <= 0) {
    return { normalized: 0, clamped: false };
  }
  if (raw > 0.2) {
    return { normalized: 0.2, clamped: true };
  }
  return { normalized: raw, clamped: false };
}

/**
 * Parse a "Sent X days ago" / "Đã gửi X ngày trước" string into an age in days.
 * Best-effort: returns null if unparseable (caller errs on the side of including).
 *
 * @param {string|null|undefined} dateSentText
 * @returns {number|null} age in days, or null if unparseable
 */
export function parseRequestAgeDays(dateSentText) {
  if (typeof dateSentText !== 'string' || !dateSentText.trim()) return null;
  const t = dateSentText.toLowerCase();
  if (/hour|giờ|minute|phút|second|giây|just now|vừa xong/.test(t)) return 0;
  const m = t.match(/(\d+)\s*(day|week|month|year|ngày|tuần|tháng|năm)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  if (/week|tuần/.test(unit)) return n * 7;
  if (/month|tháng/.test(unit)) return n * 30;
  if (/year|năm/.test(unit)) return n * 365;
  return n;
}

/**
 * Resolve a limit argument for cancel-friend-requests.
 * @param {unknown} value
 * @param {number} maxBatch
 * @returns {number}
 */
export function resolveCancelLimit(value, maxBatch = 20) {
  const numeric = value === '' ? NaN : Number(value);
  const limit = Number.isFinite(numeric) ? Math.floor(numeric) : 0;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'cancelFriendRequests: limit must be a positive integer',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'facebook',
    });
  }
  if (limit > maxBatch) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: `cancelFriendRequests: limit (${limit}) exceeds maxBatch (${maxBatch})`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'facebook',
    });
  }
  return limit;
}

/**
 * Resolve an olderThanDays filter.
 * @param {unknown} value
 * @returns {number}
 */
export function resolveOlderThanDays(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'cancelFriendRequests: olderThanDays must be a non-negative number',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'facebook',
    });
  }
  return n;
}

/**
 * Scroll a Facebook feed URL for a bounded, randomized duration.
 *
 * @param {any} page
 * @param {string} targetUrl
 * @param {number} durationSeconds
 * @returns {Promise<{ dryRun: false, platform: 'facebook', targetUrl: string, durationSeconds: number, scrolls: number }>}
 */
export async function runWarmupScroll(page, targetUrl, durationSeconds) {
  assertFacebookUrl(targetUrl, 'warmupScroll: targetUrl');
  const durationMs = durationSeconds * 1000;

  const maxScrolls = Math.ceil(durationMs / SCROLL_PAUSE_MIN_MS) + 1;

  await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  const start = Date.now();
  let scrolls = 0;

  while (Date.now() - start < durationMs && scrolls < maxScrolls) {
    const amount = 300 + Math.floor(Math.random() * 500);
    await page.evaluate((/** @type {number} */ y) => window.scrollBy(0, y), amount);
    scrolls++;
    await enforceActionDelay(SCROLL_PAUSE_MIN_MS, SCROLL_PAUSE_MAX_MS);
  }

  return {
    dryRun: false,
    platform: 'facebook',
    targetUrl,
    durationSeconds,
    scrolls,
  };
}

/**
 * Find Like button with locale-aware selectors (read-only warmup helper).
 *
 * @param {any} page
 * @returns {Promise<{ element: any, alreadyLiked: boolean } | null>}
 */
async function findLikeButton(page) {
  const likeSelectors = [
    '[aria-label*="Like" i]',
    '[aria-label*="Thích" i]',
    '[aria-label*="Thích" i]',
  ];
  const unlikeSelectors = [
    '[aria-label*="Remove Like" i]',
    '[aria-label*="Unlike" i]',
    '[aria-label*="Bỏ thích" i]',
    '[aria-label*="Bỏ thích" i]',
  ];
  const allSelectors = [...unlikeSelectors, ...likeSelectors].join(', ');

  try {
    await page.waitForSelector(allSelectors, { timeout: 5000 });
  } catch (_) {
    return null;
  }

  for (const selector of unlikeSelectors) {
    const element = await page.$(selector);
    if (element) return { element, alreadyLiked: true };
  }

  for (const selector of likeSelectors) {
    const element = await page.$(selector);
    if (element) return { element, alreadyLiked: false };
  }

  return null;
}

/**
 * Default reaction: find Like button, skip silently if not found, click only if not already liked.
 *
 * @param {any} page
 */
async function defaultReactFn(page) {
  const result = await findLikeButton(page);
  if (!result || result.alreadyLiked) return;
  try {
    await result.element.click();
  } catch {
    // Like click failed (element went stale) — skip silently.
  }
}

/**
 * Warm up a Facebook account with natural newsfeed scrolling and optional light reactions.
 *
 * @param {any} page
 * @param {{ durationSeconds?: number, allowReactions?: boolean, reactProbability?: number, reactFn?: (page: any) => Promise<void> }} [options]
 * @returns {Promise<{ dryRun: false, platform: 'facebook', durationSeconds: number, scrolls: number }>}
 */
export async function runWarmupAccount(page, options = {}) {
  const durationSeconds = Number(options?.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'runWarmupAccount: durationSeconds must be a positive finite number',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'facebook',
    });
  }
  const {
    allowReactions = false,
    reactProbability = 0,
    reactFn = defaultReactFn,
  } = options;

  const durationMs = durationSeconds * 1000;
  const maxScrolls = Math.ceil(durationMs / SCROLL_PAUSE_MIN_MS) + 1;

  try {
    await page.goto(WARMUP_HOME_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (_) {
    throw new PlatformError({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message: 'warmupAccount: home feed navigation failed (timeout or unreachable)',
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      platform: 'facebook',
    });
  }

  const start = Date.now();
  let scrolls = 0;

  while (Date.now() - start < durationMs && scrolls < maxScrolls) {
    try {
      const amount = 300 + Math.floor(Math.random() * 500);
      await page.evaluate((/** @type {number} */ y) => window.scrollBy(0, y), amount);
    } catch (_) {
      break;
    }
    scrolls++;

    try {
      if (scrolls % LONG_PAUSE_EVERY_N === 0) {
        await enforceActionDelay(LONG_PAUSE_MIN_MS, LONG_PAUSE_MAX_MS);
      } else {
        await enforceActionDelay(SCROLL_PAUSE_MIN_MS, SCROLL_PAUSE_MAX_MS);
      }
    } catch (err) {
      console.warn(`⚠️ warmupAccount: delay threw — ${(err instanceof Error ? err.message : String(err)) ?? err}. Continuing.`);
    }

    if (allowReactions && reactProbability > 0 && Math.random() < reactProbability) {
      await Promise.resolve(reactFn(page)).catch(() => {});
    }
  }

  return {
    dryRun: false,
    platform: 'facebook',
    durationSeconds,
    scrolls,
  };
}

/**
 * Collect pending sent friend requests from `/friends/requests/sent`.
 *
 * @param {any} page
 * @param {number} limit
 * @returns {Promise<Array<{ name: string|null, profileUrl: string, dateSent: string|null }>>}
 */
export async function collectSentRequests(page, limit) {
  await page.goto('https://www.facebook.com/friends/requests/sent', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  await enforceActionDelay(1000, 3000);

  const collected = new Map();
  let stalls = 0;
  while (collected.size < limit && stalls < 5) {
    const before = collected.size;

    if (typeof page.$$eval === 'function') {
      const raw = /** @type {Array<{ name: string|null, profileUrl: string, dateSent: string|null }>} */ (await page.$$eval('div[role="listitem"]', (/** @type {Element[]} */ items) =>
        items.map((/** @type {Element} */ item) => {
          const a = item.querySelector('a[href]');
          const href = a?.getAttribute('href') || '';
          const abs = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
          const idMatch = abs.match(/facebook\.com\/profile\.php\?id=(\d+)/i);
          const segMatch = abs.match(/facebook\.com\/([^/?&#]+)/i);
          let profileUrl = null;
          if (idMatch) {
            profileUrl = `https://www.facebook.com/profile.php?id=${idMatch[1]}`;
          } else if (segMatch && ![
            'friends', 'profile.php', 'photo', 'watch',
            'pages', 'groups', 'events', 'marketplace', 'videos', 'notifications', 'messages',
          ].includes(segMatch[1].toLowerCase())) {
            profileUrl = abs.split('?')[0];
          }
          const name = a?.textContent?.trim() || item.querySelector('span, strong')?.textContent?.trim() || null;
          const dateSent = item.querySelector('span[dir="auto"]:last-of-type, abbr')?.textContent?.trim() || null;
          return { name, profileUrl, dateSent };
        }).filter((/** @type {{name: string|null, profileUrl: string|null, dateSent: string|null}} */ r) => typeof r.profileUrl === 'string'),
      ));
      for (const r of raw) {
        if (!collected.has(r.profileUrl)) collected.set(r.profileUrl, r);
        if (collected.size >= limit) break;
      }
    }

    if (collected.size === before) stalls++; else stalls = 0;

    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    } catch (_) {
      break;
    }
    await enforceActionDelay(1000, 3000);
  }

  return Array.from(collected.values()).slice(0, limit);
}

/**
 * Cancel a single pending friend request by navigating to the profile and
 * clicking "Cancel request" / "Hủy yêu cầu".
 *
 * @param {any} page
 * @param {string} profileUrl
 * @returns {Promise<{ profileUrl: string, cancelled: boolean }>}
 */
export async function cancelSingleRequest(page, profileUrl) {
  try {
    await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (_) {
    throw new PlatformError({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message: 'Cancel-request profile navigation failed; request not cancelled (profile unreachable or timed out)',
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      platform: 'facebook',
    });
  }
  await enforceActionDelay(800, 1500);

  const cancelSelectors = [
    '[aria-label="Cancel request" i]',
    '[aria-label="Hủy yêu cầu" i]',
    'div[role="button"][aria-label*="Cancel request" i]',
    'div[role="button"][aria-label*="Hủy yêu cầu" i]',
  ];

  try {
    await page.waitForSelector(cancelSelectors.join(', '), { timeout: 5000 });
  } catch (err) {
    throw new PlatformError({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message: 'Cancel-request button not found; request already resolved or profile unreachable',
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      platform: 'facebook',
    });
  }

  let cancelBtn = null;
  for (const selector of cancelSelectors) {
    cancelBtn = await page.$(selector);
    if (cancelBtn) break;
  }
  if (!cancelBtn) {
    throw new PlatformError({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message: 'Cancel-request button not found; request already resolved or profile unreachable',
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      platform: 'facebook',
    });
  }
  await cancelBtn.click();
  await enforceActionDelay(800, 1500);

  return { profileUrl, cancelled: true };
}

/**
 * Compute cancel-friend-request counts from a batch result list.
 *
 * @param {Array<Record<string, unknown>>} results
 * @param {number} totalPending
 * @returns {{ cancelled: number, failed: number, remaining: number }}
 */
export function countCancelResults(results, totalPending) {
  let cancelled = 0;
  let failed = 0;
  for (const r of results) {
    if (r.ok === false) {
      failed++;
    } else if (r.cancelled === true) {
      cancelled++;
    }
  }
  const remaining = totalPending - cancelled - failed;
  return { cancelled, failed, remaining };
}
