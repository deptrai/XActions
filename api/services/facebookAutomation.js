// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt

import {
  loginWithCookie,
  createBrowser,
  createPage,
} from '../../src/scrapers/facebook/index.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// Delay seam — injectable in tests via options.delay
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const randomDelay = (min = 1000, max = 3000) => {
  if (min > max) throw new Error(`randomDelay: min (${min}) must be <= max (${max})`);
  return sleep(min + Math.random() * (max - min));
};

// ============================================================================
// Shared URL guard (SSRF-safe) — used by shareFacebookPosts (4.2) + warmupScrollFeed (4.3)
// ============================================================================

/**
 * Assert that `url` is a navigable facebook.com http(s) URL — reject before any
 * page navigation. Blocks SSRF vectors (file:/, javascript:, internal hosts).
 *
 * @param {string} url - URL to validate
 * @param {string} [label='URL'] - Prefix for the thrown error (caller context)
 * @throws {Error} If url is not a valid http(s) facebook.com URL
 */
export function assertFacebookUrl(url, label = 'URL') {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error(`❌ ${label} must be a non-empty string`);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    throw new Error(`❌ ${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`❌ ${label} must be an http(s) URL`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) {
    throw new Error(`❌ ${label} must be a facebook.com URL`);
  }
}

// ============================================================================
// Account-risk warning (surfaced before every real write batch)
// ============================================================================

export const ACCOUNT_RISK_WARNING =
  '⚠️ WARNING: Real writes enabled. Automated actions risk account restriction or lock. ' +
  'Use a test account. Proceeding with dryRun=false batch.';

// ============================================================================
// Guardrail helper — single chokepoint for all Facebook write loops
// ============================================================================

/**
 * Run a bounded, guarded batch of write actions on Facebook.
 *
 * @param {Array} items - Targets to act on (e.g. post URLs, user IDs)
 * @param {Function} actionFn - async (item) => any — called per item when dryRun=false
 * @param {Object} options
 * @param {boolean} [options.dryRun=true] - Default true; no real write unless explicitly false
 * @param {Function} [options.delay=randomDelay] - Injectable delay seam; pass () => {} in tests
 * @param {number}  [options.delayMin=1000] - Min ms for inter-item delay (Story 4.4); default preserves prior behavior
 * @param {number}  [options.delayMax=3000] - Max ms for inter-item delay (Story 4.4); must be >= delayMin
 * @param {number}  [options.maxBatch=20] - Hard cap on batch size (enforced in both dry-run and real)
 * @param {number}  [options.maxRetry=1] - Max retries per item on failure (0 = no retry)
 * @param {Function} [options.shouldStop] - (results: Array) => boolean — called after each item; return true to abort
 * @param {Function} [options.onProgress] - Called after each item: ({ attempted, total })
 * @returns {Promise<Object>} Structured result (AC4 shape)
 */
export async function runGuardedBatch(items, actionFn, options = {}) {
  if (!Array.isArray(items)) {
    throw new Error('❌ runGuardedBatch: items must be an array');
  }

  const {
    dryRun = true,
    delay = randomDelay,
    delayMin = 1000,
    delayMax = 3000,
    maxBatch = 20,
    maxRetry = 1,
    shouldStop,
    onProgress,
  } = options;

  if (typeof maxBatch !== 'number' || !Number.isFinite(maxBatch) || maxBatch < 1) {
    throw new Error(`❌ runGuardedBatch: maxBatch must be a finite number >= 1, got ${maxBatch}`);
  }

  // maxRetry must be finite & non-negative — Infinity would hang the loop on persistent failures
  if (typeof maxRetry !== 'number' || !Number.isFinite(maxRetry) || maxRetry < 0) {
    throw new Error(`❌ runGuardedBatch: maxRetry must be a finite number >= 0, got ${maxRetry}`);
  }

  // delayMin/delayMax: configurable inter-item delay range (Story 4.4 / PRD Open Question #1).
  // Defaults 1000/3000 preserve every existing caller's behavior byte-for-byte. The helper
  // stays generic (any min/max); per-cluster floors (e.g. group 30s) are enforced by the CALLER.
  if (typeof delayMin !== 'number' || !Number.isFinite(delayMin) || delayMin < 0) {
    throw new Error(`❌ runGuardedBatch: delayMin must be a finite number >= 0, got ${delayMin}`);
  }
  if (typeof delayMax !== 'number' || !Number.isFinite(delayMax) || delayMax < delayMin) {
    throw new Error(`❌ runGuardedBatch: delayMax must be a finite number >= delayMin (${delayMin}), got ${delayMax}`);
  }

  // maxBatch enforced in both dry-run and real — preview must reflect real constraints
  if (items.length > maxBatch) {
    throw new Error(
      `❌ Batch size ${items.length} exceeds maxBatch limit of ${maxBatch}. ` +
      `Split into smaller batches or raise maxBatch explicitly.`
    );
  }

  // Strict dry-run gate: anything except explicit `false` stays in dry-run.
  // JS destructuring only substitutes the default for `undefined`, so `dryRun: null`
  // would otherwise be falsy and trigger real writes — unsafe for an automation guardrail.
  const isRealRun = dryRun === false;

  // --- dry-run branch ---
  if (!isRealRun) {
    const preview = items.map((item) => ({ target: item, action: 'pending' }));
    return {
      dryRun: true,
      platform: 'facebook',
      attempted: 0,
      succeeded: 0,
      failed: 0,
      preview,
      results: [],
      warning: null,
    };
  }

  // --- real-write branch ---

  // Validate actionFn before any real write — otherwise null/non-function actionFn
  // is silently caught per-item, marking every target failed with an opaque TypeError.
  if (typeof actionFn !== 'function') {
    throw new Error('❌ runGuardedBatch: actionFn must be a function for real writes');
  }

  // Surface account-risk warning before first real write (AC2.7)
  console.warn(ACCOUNT_RISK_WARNING);

  const results = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Skip null/undefined items rather than passing them to actionFn
    if (item == null) {
      results.push({ target: item, ok: false, error: 'null/undefined item skipped' });
      failed++;
    } else {
      let lastErr = null;
      let attempts = 0;
      const totalAttempts = 1 + Math.max(0, Math.floor(maxRetry));

      while (attempts < totalAttempts) {
        try {
          await actionFn(item);
          results.push({ target: item, ok: true });
          succeeded++;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          attempts++;
        }
      }

      if (lastErr !== null) {
        results.push({ target: item, ok: false, error: lastErr?.message ?? String(lastErr) });
        failed++;
      }
    }

    // onProgress — guarded against non-function and throwing callbacks
    if (typeof onProgress === 'function') {
      try {
        onProgress({ attempted: i + 1, total: items.length });
      } catch (_) {
        // onProgress errors must not corrupt batch state
      }
    }

    // shouldStop — caller can abort remaining items. Receives an immutable summary
    // (not the live results accumulator) so a predicate can't mutate batch state.
    if (typeof shouldStop === 'function') {
      const stop = shouldStop({
        attempted: results.length,
        succeeded,
        failed,
        lastResult: results[results.length - 1] ?? null,
      });
      if (stop) break;
    }

    // Delay between actions except after the last item (range from options; default 1000/3000)
    if (i < items.length - 1) {
      try {
        await delay(delayMin, delayMax);
      } catch (err) {
        // delay errors must not abort batch; log and continue
        console.warn(`⚠️ runGuardedBatch: delay threw — ${err?.message ?? err}. Continuing.`);
      }
    }
  }

  return {
    dryRun: false,
    platform: 'facebook',
    attempted: results.length,
    succeeded,
    failed,
    preview: [],
    results,
    warning: ACCOUNT_RISK_WARNING,
  };
}

// ============================================================================
// Re-export login/browser helpers (convenience — callers don't need two imports)
// ============================================================================

export { loginWithCookie, createBrowser, createPage };

// ============================================================================
// Facebook Like Automation (Story 2.2)
// ============================================================================

/**
 * Find Like button with locale-aware selectors.
 * Single chokepoint for locale strings (AC2.5).
 *
 * @param {Object} page - Puppeteer page
 * @returns {Promise<{element: Object, alreadyLiked: boolean}>}
 * @throws {Error} If Like button not found (locale unsupported or post unreachable)
 */
export async function findLikeButton(page) {
  // Supported locales: en, vi (from docs/agents/selectors-facebook.md)
  const likeSelectors = [
    '[aria-label="Like"]',      // en
    '[aria-label="Thích"]',     // vi
  ];

  const unlikeSelectors = [
    '[aria-label="Remove Like"]', // en
    '[aria-label="Bỏ thích"]',    // vi
  ];

  // Single combined wait: block until ANY like/unlike button renders.
  // Fixes (a) the race where page.$ missed a slow-loading already-liked button
  // (causing a spurious re-like), and (b) the 5s×N sequential timeouts on
  // unsupported locales — now one 5s wait total, not one per selector.
  const allSelectors = [...unlikeSelectors, ...likeSelectors].join(', ');
  try {
    await page.waitForSelector(allSelectors, { timeout: 5000 });
  } catch (_) {
    throw new Error(
      `❌ Like button not found; locale unsupported or post unreachable`
    );
  }

  // Reaction area has rendered — now check already-liked state first (no race).
  for (const selector of unlikeSelectors) {
    const element = await page.$(selector);
    if (element) {
      return { element, alreadyLiked: true };
    }
  }

  // Otherwise it is in the unliked state.
  for (const selector of likeSelectors) {
    const element = await page.$(selector);
    if (element) {
      return { element, alreadyLiked: false };
    }
  }

  // Combined selector matched but neither specific selector resolved (defensive)
  throw new Error(
    `❌ Like button not found; locale unsupported or post unreachable`
  );
}

/**
 * Like a single Facebook post (AC2).
 * Internal helper for likeFacebookPosts.
 *
 * @param {Object} page - Puppeteer page
 * @param {string} postUrl - Full URL to Facebook post
 * @returns {Promise<{liked: boolean, alreadyLiked: boolean}>}
 * @throws {Error} If Like button not found
 */
async function likeSinglePost(page, postUrl) {
  // Navigate to post (AC2.4)
  await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  // Small delay for stability (AC2.4 mentions delay seam if available)
  await sleep(500);

  // Find Like button with locale-aware lookup (AC2.5)
  const { element, alreadyLiked } = await findLikeButton(page);

  // If already liked, return without clicking (AC2.6)
  if (alreadyLiked) {
    return { liked: false, alreadyLiked: true };
  }

  // Click to like (AC2.4)
  await element.click();

  // Brief wait for click to register
  await sleep(300);

  return { liked: true, alreadyLiked: false };
}

/**
 * Auto-like one or more Facebook posts with dry-run preview (Story 2.2).
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {string[]} postUrls - Array of Facebook post URLs to like
 * @param {Object} options - Configuration options
 * @param {boolean} [options.dryRun=true] - Preview mode (default); set false for real writes
 * @param {Function} [options.delay] - Injectable delay between actions
 * @param {number} [options.maxBatch=20] - Max posts per batch
 * @param {number} [options.maxRetry=1] - Retry attempts per post on failure
 * @param {Function} [options.likeFn] - Injectable like function (for testing); defaults to likeSinglePost
 * @returns {Promise<Object>} Result with dryRun, preview, results, attempted, succeeded, failed
 */
export async function likeFacebookPosts(page, postUrls, options = {}) {
  // Nullish-coalesce so an explicit `likeFn: null` falls back to the default
  // (JS destructuring defaults apply only to `undefined`) — same class of guard
  // as the dryRun gate. Otherwise every item fails with an opaque TypeError.
  const { likeFn: likeFnOpt, ...guardedOptions } = options;
  const likeFn = likeFnOpt ?? likeSinglePost;

  // Capture return values from likeFn via closure (AC3.9)
  const capturedResults = new Map();

  // Build actionFn that wraps likeFn with page (AC1.2)
  const actionFn = async (postUrl) => {
    const result = await likeFn(page, postUrl);
    // Capture the return value so we can merge it into results later
    capturedResults.set(postUrl, result);
    return result;
  };

  // Route through runGuardedBatch — single chokepoint (AC1.2)
  const batchResult = await runGuardedBatch(postUrls, actionFn, guardedOptions);

  // Post-process real-run results to include alreadyLiked field (AC3.9)
  if (!batchResult.dryRun && batchResult.results.length > 0) {
    batchResult.results = batchResult.results.map((r) => {
      const captured = capturedResults.get(r.target);
      // Only add alreadyLiked for successful results where we have captured data
      if (captured && r.ok) {
        return { ...r, alreadyLiked: captured.alreadyLiked };
      }
      return r;
    });
  }

  return batchResult;
}

// ============================================================================
// Facebook Comment Automation (Story 2.3)
// ============================================================================

/**
 * Find comment input with locale-aware selectors.
 *
 * @param {Object} page - Puppeteer page
 * @returns {Promise<Object>} Comment input element
 * @throws {Error} If comment input not found (locale unsupported or post unreachable)
 */
async function findCommentInput(page) {
  // Supported locales: en, vi (from docs/agents/selectors-facebook.md)
  const commentSelectors = [
    '[aria-label*="Write a comment"]',      // en
    '[placeholder*="Write a comment"]',     // en fallback
    '[aria-label*="Viết bình luận"]',       // vi
    '[placeholder*="Viết bình luận"]',      // vi fallback
  ];

  // Combined wait: block until ANY locale selector renders (one 5s wait total,
  // not 5s × N sequential timeouts on unsupported locales — same fix as findLikeButton).
  try {
    await page.waitForSelector(commentSelectors.join(', '), { timeout: 5000 });
  } catch (_) {
    throw new Error(`❌ Comment input not found; locale unsupported or post unreachable`);
  }

  for (const selector of commentSelectors) {
    const element = await page.$(selector);
    if (element) return element;
  }

  throw new Error(`❌ Comment input not found; locale unsupported or post unreachable`);
}

/**
 * Comment on a single Facebook post (AC2).
 * Internal helper for commentOnFacebookPosts.
 *
 * @param {Object} page - Puppeteer page
 * @param {string} postUrl - Full URL to Facebook post
 * @param {string} commentText - User-provided comment content
 * @returns {Promise<{commented: boolean}>}
 * @throws {Error} If comment input not found
 */
async function commentSinglePost(page, postUrl, commentText) {
  // Navigate to post (AC2.5)
  await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  // Small delay for stability
  await sleep(500);

  // Find comment input with locale-aware lookup (AC2.6)
  const inputElement = await findCommentInput(page);

  // Click to focus
  await inputElement.click();
  await sleep(200);

  // Type comment text (AC2.6)
  await page.keyboard.type(commentText);

  // Submit via Enter key (AC2.7)
  await page.keyboard.press('Enter');

  // Brief wait for comment to post
  await sleep(500);

  return { commented: true };
}

/**
 * Auto-comment on one or more Facebook posts with dry-run preview (Story 2.3).
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {string[]} postUrls - Array of Facebook post URLs to comment on
 * @param {string} commentText - User-provided comment content
 * @param {Object} options - Configuration options
 * @param {boolean} [options.dryRun=true] - Preview mode (default); set false for real writes
 * @param {Function} [options.delay] - Injectable delay between actions
 * @param {number} [options.maxBatch=20] - Max posts per batch
 * @param {number} [options.maxRetry=1] - Retry attempts per post on failure
 * @param {Function} [options.commentFn] - Injectable comment function (for testing); defaults to commentSinglePost
 * @returns {Promise<Object>} Result with dryRun, preview, results, attempted, succeeded, failed
 */
export async function commentOnFacebookPosts(page, postUrls, commentText, options = {}) {
  // Nullish-coalesce so explicit `commentFn: null` falls back to default (same guard class as dryRun/likeFn).
  const { commentFn: commentFnOpt, ...guardedOptions } = options;
  const commentFn = commentFnOpt ?? commentSinglePost;

  // Validate comment content — empty text would type nothing then submit a blank comment.
  if (typeof commentText !== 'string' || !commentText.trim()) {
    throw new Error('❌ commentOnFacebookPosts: commentText must be a non-empty string');
  }

  // Build actionFn that wraps commentFn with page and commentText (AC1.2)
  const actionFn = async (postUrl) => {
    return await commentFn(page, postUrl, commentText);
  };

  // Route through runGuardedBatch — single chokepoint (AC1.2)
  const batchResult = await runGuardedBatch(postUrls, actionFn, guardedOptions);

  // Enhance dry-run preview with comment text (AC3.9)
  if (batchResult.dryRun && batchResult.preview.length > 0) {
    batchResult.preview = batchResult.preview.map((p) => ({
      ...p,
      previewComment: commentText,
    }));
  }

  // Enhance real-run results with comment text (AC3.10)
  if (!batchResult.dryRun && batchResult.results.length > 0) {
    batchResult.results = batchResult.results.map((r) => ({
      ...r,
      commentText,
    }));
  }

  return batchResult;
}

// ============================================================================
// Facebook Post Creation (Story 2.4)
// ============================================================================

/**
 * Find post composer with locale-aware selectors.
 *
 * @param {Object} page - Puppeteer page
 * @returns {Promise<Object>} Post composer element
 * @throws {Error} If post composer not found (locale unsupported or page unreachable)
 */
async function findPostComposer(page) {
  // Supported locales: en, vi (from docs/agents/selectors-facebook.md)
  const composerSelectors = [
    '[aria-label*="What\'s on your mind"]',      // en
    '[role="textbox"][data-text*="What\'s on your mind"]',  // en fallback
    '[aria-label*="Bạn đang nghĩ gì"]',          // vi
    '[role="textbox"][data-text*="Bạn đang nghĩ gì"]',      // vi fallback
  ];

  for (const selector of composerSelectors) {
    try {
      const element = await page.waitForSelector(selector, { timeout: 5000 });
      if (element) {
        return element;
      }
    } catch (_) {
      // Continue to next selector
    }
  }

  // Composer not found in any locale
  throw new Error(
    `❌ Post composer not found; locale unsupported or page unreachable`
  );
}

/**
 * Find post submit button with locale-aware selectors.
 *
 * @param {Object} page - Puppeteer page
 * @returns {Promise<Object>} Submit button element
 * @throws {Error} If submit button not found
 */
async function findPostSubmitButton(page) {
  const submitSelectors = [
    '[aria-label="Post"]',     // en
    '[aria-label="Đăng"]',     // vi
  ];

  for (const selector of submitSelectors) {
    try {
      const element = await page.waitForSelector(selector, { timeout: 3000 });
      if (element) {
        return element;
      }
    } catch (_) {
      // Continue to next selector
    }
  }

  throw new Error(`❌ Post submit button not found`);
}

/**
 * Create a single Facebook post (AC2).
 * Internal helper for createFacebookPost.
 *
 * @param {Object} page - Puppeteer page
 * @param {string} content - User-provided post content
 * @returns {Promise<{posted: boolean, postUrl?: string}>}
 * @throws {Error} If post composer or submit button not found
 */
async function createSinglePost(page, content) {
  // Navigate to Facebook home (AC2.5)
  await page.goto('https://facebook.com/', { waitUntil: 'networkidle2', timeout: 30000 });

  // Small delay for stability
  await sleep(500);

  // Find post composer with locale-aware lookup (AC2.6)
  const composerElement = await findPostComposer(page);

  // Click to focus composer
  await composerElement.click();
  await sleep(300);

  // Type post content (AC2.6)
  await page.keyboard.type(content);
  await sleep(200);

  // Find and click submit button (AC2.7)
  const submitElement = await findPostSubmitButton(page);
  await submitElement.click();

  // Wait for post to be created
  await sleep(2000);

  // Try to extract post URL from current page location
  const currentUrl = page.url();
  const postUrl = currentUrl.includes('/posts/') || currentUrl.includes('/permalink/') 
    ? currentUrl 
    : undefined;

  return { posted: true, postUrl };
}

/**
 * Create a Facebook text post with dry-run preview (Story 2.4).
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {string} content - User-provided post content
 * @param {Object} options - Configuration options
 * @param {boolean} [options.dryRun=true] - Preview mode (default); set false for real writes
 * @param {Function} [options.delay] - Injectable delay (not used for single post)
 * @param {number} [options.maxBatch=20] - Max batch size (enforced even for single item)
 * @param {number} [options.maxRetry=1] - Retry attempts on failure
 * @param {Function} [options.createPostFn] - Injectable create function (for testing); defaults to createSinglePost
 * @returns {Promise<Object>} Result with dryRun, preview, results, attempted, succeeded, failed
 */
export async function createFacebookPost(page, content, options = {}) {
  // Nullish-coalesce so explicit `createPostFn: null` falls back to default (same guard class as dryRun/likeFn).
  const { createPostFn: createPostFnOpt, ...guardedOptions } = options;
  const createPostFn = createPostFnOpt ?? createSinglePost;

  // Validate content — empty content would type nothing then submit a blank post.
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('❌ createFacebookPost: content must be a non-empty string');
  }

  // Capture per-item return values (e.g. postUrl) — runGuardedBatch discards actionFn
  // return values, so surface them via a side-channel Map keyed by content (same
  // pattern as likeFacebookPosts).
  const captured = new Map();
  const actionFn = async (contentItem) => {
    const r = await createPostFn(page, contentItem);
    captured.set(contentItem, r);
    return r;
  };

  // Route through runGuardedBatch with single-item array — ensures guardrail consistency (AC4.13)
  const batchResult = await runGuardedBatch([content], actionFn, guardedOptions);

  // Enhance dry-run preview with content preview (AC3.9)
  if (batchResult.dryRun && batchResult.preview.length > 0) {
    batchResult.preview = batchResult.preview.map((p) => ({
      ...p,
      previewContent: p.target,
    }));
  }

  // Enhance real-run results with content + captured postUrl (AC3.10)
  if (!batchResult.dryRun && batchResult.results.length > 0) {
    batchResult.results = batchResult.results.map((r) => {
      const cap = captured.get(r.target);
      return {
        ...r,
        content: r.target,
        // postUrl best-effort: Facebook composer submits via XHR without navigating,
        // so postUrl is frequently undefined even on success (see deferred-work).
        ...(cap && r.ok ? { postUrl: cap.postUrl ?? null } : {}),
      };
    });
  }

  return batchResult;
}

// ============================================================================
// Facebook Scheduled Post (Story 4.1)
// ============================================================================

/**
 * Schedule a Facebook post to publish at a specific datetime.
 *
 * The `page` param is accepted for signature consistency with the other automate
 * functions but is NOT used at schedule time — the worker acquires its own
 * session at execution (see facebookScheduler.js). It MAY be null.
 *
 * @param {Object|null} page - Accepted but NOT used (may be null)
 * @param {Object} params
 * @param {string} params.content - Post content (non-empty)
 * @param {string[]} [params.mediaUrls] - Media URLs (JSON-serialised; reserved for future use)
 * @param {string} params.scheduledAt - ISO-8601 future datetime (>= now + 60s)
 * @param {string} [params.facebookAccountId] - Saved FacebookAccount id to post from
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=true] - Default true; only explicit false creates a DB record
 * @param {string} [options.userId] - Required when dryRun:false; MUST come from the authenticated caller
 * @returns {Promise<Object>} Preview (dry-run) or { scheduleId, scheduledAt, status } (real)
 */
export async function scheduleFacebookPost(
  page,
  { content, mediaUrls, scheduledAt, facebookAccountId } = {},
  options = {},
) {
  const { dryRun = true, userId } = options;

  // Non-empty content guard — story 2.4 HIGH review finding (empty content = blank post)
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('❌ scheduleFacebookPost: content must be a non-empty string');
  }

  // Parse and validate scheduledAt as ISO-8601
  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) {
    throw new Error('❌ scheduleFacebookPost: scheduledAt must be a valid ISO-8601 datetime');
  }

  // Reject past or within-next-tick (< now + 60s) — a schedule that can never fire is a bug
  if (scheduledDate.getTime() < Date.now() + 60_000) {
    throw new Error('❌ scheduleFacebookPost: scheduledAt must be at least 60 seconds in the future');
  }

  // Strict dry-run gate: anything except explicit `false` stays in dry-run (mirrors runGuardedBatch)
  const isRealRun = dryRun === false;

  // userId is mandatory for real runs — never create an unscoped record (AC4 #10)
  if (isRealRun && !userId) {
    throw new Error('❌ scheduleFacebookPost: options.userId is required for dryRun:false');
  }

  // --- dry-run branch: preview only, NO DB write (AC3) ---
  if (!isRealRun) {
    return {
      dryRun: true,
      platform: 'facebook',
      preview: {
        content,
        mediaUrls: mediaUrls ?? null,
        scheduledAt: scheduledDate.toISOString(),
        willFireAt: scheduledDate.toLocaleString(),
      },
    };
  }

  // --- real run: persist one Schedule row scoped by userId (AC4) ---
  const schedule = await prisma.schedule.create({
    data: {
      userId,
      content,
      mediaUrls: mediaUrls ? JSON.stringify(mediaUrls) : null,
      scheduledAt: scheduledDate,
      status: 'pending',
      facebookAccountId: facebookAccountId ?? null,
    },
  });

  return {
    dryRun: false,
    platform: 'facebook',
    scheduleId: schedule.id,
    scheduledAt: schedule.scheduledAt.toISOString(),
    status: schedule.status,
  };
}

// ============================================================================
// Facebook Share Automation (Story 4.2 — FR-16)
// ============================================================================

/**
 * Share a single Facebook post to the operator's own timeline (AC2).
 * Internal helper for shareFacebookPosts.
 *
 * DOM flow: navigate → open Share dialog → click "Share now"/"Chia sẻ ngay"
 * (share-to-Feed). The Share *button* selector is VERIFIED (reused from
 * messengerShare.js); the "Share now" action is UNVERIFIED — wrapped in a
 * fallback chain with a clear throw if none resolve.
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {string} postUrl - Full URL to Facebook post
 * @returns {Promise<{shared: boolean, alreadyShared?: boolean}>}
 * @throws {Error} If Share button or "Share now" action not found (PII-free)
 */
async function shareSinglePost(page, postUrl) {
  // Navigate to post (mirror likeSinglePost)
  await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(500);

  // --- Locate + click the Share button ---
  // VERIFIED selector from messengerShare.js (Story 5.2). The aria-label *substring*
  // fallbacks were removed: `[aria-label*="Share"]` / `[aria-label*="Chia sẻ"]` also
  // match "Share to Story", "Share to Reel", header-nav Share, "Chia sẻ lên Tin", etc.,
  // and waitForSelector resolving on the first match could click the wrong button
  // (silent no-op share). The data-attr selectors are precise and sufficient.
  const shareButtonSelectors = [
    'div[data-ad-rendering-role="share_button"]', // verified
    '[data-ad-renderingrole="share_button"]',     // verified (alt attribute spelling)
  ];

  try {
    await page.waitForSelector(shareButtonSelectors.join(', '), { timeout: 5000 });
  } catch (_) {
    throw new Error('❌ Share button not found; locale unsupported or post unreachable');
  }

  let shareButton = null;
  for (const selector of shareButtonSelectors) {
    shareButton = await page.$(selector);
    if (shareButton) break;
  }
  if (!shareButton) {
    throw new Error('❌ Share button not found; locale unsupported or post unreachable');
  }
  await shareButton.click();
  await sleep(500); // let the share dialog/menu render

  // --- Locate + click the "Share now" (share-to-Feed) action ---
  // ⚠️ UNVERIFIED FLOW: messengerShare.js (live-verified 2026-06) shows the share_button
  // opens a Messenger recipient dialog; the share-to-Feed entry point + "Share now" item
  // are NOT yet confirmed on a live session. Selectors below are best-effort scaffold —
  // see docs/agents/selectors-facebook.md verify-checklist. The real path may throw until
  // verified; that is expected and recorded by runGuardedBatch as a per-item failure.
  const shareNowSelectors = [
    '[aria-label="Share now"]',     // en
    '[aria-label="Chia sẻ ngay"]',  // vi
    'div[role="menuitem"][aria-label*="Share now"]',
    'div[role="menuitem"][aria-label*="Chia sẻ ngay"]',
  ];

  let shareNowEl = null;
  try {
    await page.waitForSelector(shareNowSelectors.join(', '), { timeout: 5000 });
    for (const selector of shareNowSelectors) {
      shareNowEl = await page.$(selector);
      if (shareNowEl) break;
    }
  } catch (err) {
    // Only a selector TIMEOUT means "not present yet" → fall through to text lookup.
    // A detached frame / destroyed context (e.g. a redirect) is a real error — re-throw
    // it instead of masking it behind the generic "Share now not found" below.
    if (!/timeout|waiting for selector/i.test(err?.message ?? '')) throw err;
  }

  // Text/role fallback: find a clickable menuitem/button whose text EXACTLY equals the
  // share-now label. Strict equality (not includes) + interactive roles only — `includes`
  // over-matched container nodes ("Don't Share now") and non-interactive inner spans.
  if (!shareNowEl) {
    const SHARE_NOW_TEXT = ['Share now', 'Chia sẻ ngay'];
    const handle = await page.evaluateHandle((labels) => {
      const nodes = Array.from(document.querySelectorAll('[role="menuitem"], [role="button"]'));
      const hit = nodes.find((n) => labels.includes((n.textContent || '').trim()));
      return hit || null;
    }, SHARE_NOW_TEXT);
    // evaluateHandle always returns a JSHandle (truthy even when it wraps null);
    // asElement() returns the ElementHandle, or null when the wrapped value is null.
    shareNowEl = handle.asElement();
  }

  if (!shareNowEl) {
    throw new Error('❌ "Share now" action not found; share dialog layout changed or share unavailable');
  }

  await shareNowEl.click();
  await sleep(500); // let the share submit

  // Best-effort outcome check: a real success/error indicator selector is UNVERIFIED
  // (needs a live session). We cannot confirm the share actually succeeded, so surface
  // that uncertainty rather than asserting success silently (story 4.1 P2 lesson). The
  // result is still reported ok by runGuardedBatch; a verify pass must replace this warn
  // with a real success/error check.
  console.warn(`⚠️ shareSinglePost: share click fired but success is UNVERIFIED (no confirmed indicator selector yet)`);

  return { shared: true };
}

/**
 * Auto-share one or more Facebook posts to the operator's timeline with
 * dry-run preview (Story 4.2). Clones the likeFacebookPosts shape — routes
 * postUrls through runGuardedBatch; the only difference is the per-URL action.
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {string[]} postUrls - Array of Facebook post URLs to share
 * @param {Object} options - Configuration options
 * @param {boolean} [options.dryRun=true] - Preview mode (default); set false for real shares
 * @param {Function} [options.delay] - Injectable delay between actions
 * @param {number} [options.maxBatch=20] - Max posts per batch
 * @param {number} [options.maxRetry=1] - Retry attempts per post on failure
 * @param {Function} [options.shareFn] - Injectable share function (for testing); defaults to shareSinglePost
 * @returns {Promise<Object>} Result with dryRun, preview, results, attempted, succeeded, failed
 */
export async function shareFacebookPosts(page, postUrls, options = {}) {
  // Validate postUrls before opening anything (AC4) — fail before browser.
  if (!Array.isArray(postUrls) || postUrls.length === 0) {
    throw new Error('❌ shareFacebookPosts: postUrls must be a non-empty array of strings');
  }
  if (postUrls.some((u) => typeof u !== 'string' || !u.trim())) {
    throw new Error('❌ shareFacebookPosts: every postUrl must be a non-empty string');
  }
  // Reject duplicate URLs up front — capturedResults is keyed by URL, so duplicates
  // would collide (last-write-wins) and corrupt per-URL result merging.
  if (new Set(postUrls).size !== postUrls.length) {
    throw new Error('❌ shareFacebookPosts: postUrls must not contain duplicates');
  }
  // Validate scheme + host before navigation (AC4.10 + SSRF guard): only http(s)
  // facebook.com URLs may be navigated — never file:/ javascript:/ internal hosts.
  // Shared helper (Story 4.3) — single SSRF-safe guard for 4.2 + 4.3.
  for (const u of postUrls) {
    assertFacebookUrl(u, 'shareFacebookPosts: postUrl');
  }

  // Nullish-coalesce so an explicit `shareFn: null` falls back to the default
  // (destructuring defaults only catch `undefined`) — same guard as likeFn/commentFn.
  const { shareFn: shareFnOpt, ...guardedOptions } = options;
  const shareFn = shareFnOpt ?? shareSinglePost;

  // Capture per-URL return values (e.g. alreadyShared) via closure Map (AC3.9).
  const capturedResults = new Map();

  const actionFn = async (postUrl) => {
    const result = await shareFn(page, postUrl);
    capturedResults.set(postUrl, result);
    return result;
  };

  // Route through runGuardedBatch — single chokepoint (AC1.2).
  const batchResult = await runGuardedBatch(postUrls, actionFn, guardedOptions);

  // Post-process real-run results to surface alreadyShared (AC3.9).
  // NOTE: the real shareSinglePost does not yet detect already-shared state (that
  // needs a live-verified "Remove Share"/shared indicator selector — deferred). This
  // merge is forward-compatible: it activates automatically once shareSinglePost
  // returns `alreadyShared`. Tests exercise it via an injected shareFn seam.
  if (!batchResult.dryRun && batchResult.results.length > 0) {
    batchResult.results = batchResult.results.map((r) => {
      const captured = capturedResults.get(r.target);
      if (captured && r.ok && captured.alreadyShared !== undefined) {
        return { ...r, alreadyShared: captured.alreadyShared };
      }
      return r;
    });
  }

  return batchResult;
}

// ============================================================================
// Facebook View Boost — scroll simulation (Story 4.3 — FR-17)
// ============================================================================

// Max dwell duration: a single view-boost session is clamped to 5 minutes.
export const MAX_DURATION_SECONDS = 300;
const DEFAULT_DURATION_SECONDS = 60;

/**
 * Default Operation persistence seam (real Prisma path). Injectable in tests via
 * options.createOperation so the unit tests stay DB-free.
 * @returns {Promise<{id: string}>}
 */
async function defaultCreateOperation({ userId, targetUrl, durationSeconds }) {
  const op = await prisma.operation.create({
    data: {
      userId,
      type: 'facebook_view_boost',
      status: 'running',
      startedAt: new Date(),
      // PII-free config — targetUrl is not a secret; no cookie/session here (NFR3)
      config: JSON.stringify({ targetUrl, durationSeconds }),
    },
  });
  return op;
}

/**
 * Default Operation update seam (real Prisma path). Injectable in tests via
 * options.updateOperation so the success/failure update stays DB-free.
 */
async function defaultUpdateOperation(id, data) {
  await prisma.operation.update({ where: { id }, data });
}

/**
 * Simulate natural scrolling on a Facebook page/post to generate passive
 * view/dwell signals (FR-17). Performs ZERO social actions (no click/like/
 * comment/share) — scroll only. NOT a runGuardedBatch case (no item list, no
 * write action — explicitly excluded from NFR-7/NFR-8).
 *
 * @param {Object|null} page - Puppeteer page (authenticated); MAY be null in dry-run
 * @param {string} targetUrl - facebook.com page/post URL to scroll
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=true] - Default true; only explicit false drives the browser
 * @param {number} [options.durationSeconds=60] - Dwell time; clamped to MAX_DURATION_SECONDS (300)
 * @param {string} [options.userId] - If provided on a real run, an Operation is recorded
 * @param {Function} [options.delay=randomDelay] - Injectable pause seam between scrolls.
 *   ⚠️ COUPLED WITH `now`: if you override `delay` with a non-sleeping fn (e.g. tests pass
 *   `() => {}`), you MUST also override `now` with a fake clock that advances — otherwise the
 *   wall-clock loop would busy-spin. An iteration backstop bounds the damage, but the contract
 *   is: override both together or neither.
 * @param {Function} [options.now] - Injectable clock (default () => Date.now()); see `delay`.
 * @param {Function} [options.createOperation] - Injectable Operation persistence seam
 * @returns {Promise<Object>} Preview (dry-run) or run summary (real)
 */
export async function warmupScrollFeed(page, targetUrl, options = {}) {
  const {
    dryRun = true,
    durationSeconds,
    userId,
    delay = randomDelay,
    now = () => Date.now(),
    createOperation = defaultCreateOperation,
    updateOperation = defaultUpdateOperation,
  } = options;

  // Validate targetUrl BEFORE touching the browser (AC4, SSRF-safe shared guard).
  assertFacebookUrl(targetUrl, 'warmupScrollFeed: targetUrl');

  // Resolve duration: default when missing, reject <=0/non-finite, clamp over-limit.
  let requested = durationSeconds;
  if (requested === undefined || requested === null) {
    requested = DEFAULT_DURATION_SECONDS;
  }
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
    throw new Error('❌ warmupScrollFeed: durationSeconds must be a positive finite number');
  }
  const clamped = requested > MAX_DURATION_SECONDS;
  const effectiveDuration = clamped ? MAX_DURATION_SECONDS : requested;

  // Strict dry-run gate: anything except explicit `false` stays dry-run (mirror runGuardedBatch).
  const isRealRun = dryRun === false;

  // --- dry-run branch: validate + compute only, NO page.* call, NO Operation (AC3) ---
  if (!isRealRun) {
    return {
      dryRun: true,
      platform: 'facebook',
      preview: {
        targetUrl,
        durationSeconds: effectiveDuration,
        clamped,
      },
    };
  }

  // --- real run ---
  const durationMs = effectiveDuration * 1000;

  // Randomized inter-scroll pause bounds (named so the iteration cap below stays in sync).
  const SCROLL_PAUSE_MIN_MS = 800;
  const SCROLL_PAUSE_MAX_MS = 2500;

  // Iteration backstop (review HIGH): the loop terminates by wall-clock, but if a caller
  // injects a no-op `delay` WITHOUT also overriding `now` (the clock would then barely
  // advance per iteration), the time loop would busy-spin hundreds of thousands of
  // page.evaluate calls and starve the event loop. The most scrolls a legitimate run can
  // do is durationMs / minPause, so cap there (+1 slack). This never cuts a real run short
  // (real randomDelay/now), but bounds the misuse to a sane number.
  const maxScrolls = Math.ceil(durationMs / SCROLL_PAUSE_MIN_MS) + 1;

  // Operation record only when a userId is supplied (AC5) — skip silently otherwise.
  let operation = null;
  if (userId) {
    operation = await createOperation({ userId, targetUrl, durationSeconds: effectiveDuration });
  }

  let scrolls = 0;
  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const start = now();
    // Loop until elapsed wall-clock reaches the clamped duration. NO social action.
    while (now() - start < durationMs && scrolls < maxScrolls) {
      // Randomized scroll amount — passive view signal, scroll only.
      const amount = 300 + Math.floor(Math.random() * 500); // 300–800px
      await page.evaluate((y) => window.scrollBy(0, y), amount);
      scrolls++;
      // Randomized pause between scrolls via injectable delay seam.
      await delay(SCROLL_PAUSE_MIN_MS, SCROLL_PAUSE_MAX_MS);
    }

    if (operation) {
      await Promise.resolve(
        updateOperation(operation.id, {
          status: 'completed', completedAt: new Date(), result: JSON.stringify({ scrolls }),
        }),
      );
    }

    return {
      dryRun: false,
      platform: 'facebook',
      targetUrl,
      durationSeconds: effectiveDuration,
      scrolls,
      operationId: operation?.id ?? null,
    };
  } catch (err) {
    // PII-bounded error: preserve both code AND a truncated message (Puppeteer nav errors
    // carry the actionable detail in message). targetUrl is not a secret (AC5.10); no cookie
    // is in scope here. Truncated so it can never grow unbounded.
    const safeError = err?.code
      ? `${err.code}: ${(err?.message ?? '').slice(0, 150)}`
      : (err?.name && err.name !== 'Error' ? err.name : (err?.message ?? 'unknown error').slice(0, 200));
    if (operation) {
      // Promise.resolve() so a synchronously-throwing injected updateOperation can't bypass
      // the catch and mask the original err.
      await Promise.resolve(
        updateOperation(operation.id, {
          status: 'failed', completedAt: new Date(), error: safeError,
        }),
      ).catch(() => {});
    }
    throw err;
  }
}

// ============================================================================
// Facebook Group Join (Story 4.4 — FR-18, Cluster-1 medium risk)
// ============================================================================

// NFR-6 safety floor: group actions are paced >= 30s apart. A user CANNOT
// configure a shorter delay — join-spam is a top checkpoint trigger.
export const GROUP_ACTION_DELAY_FLOOR_MS = 30000;
const GROUP_ACTION_DELAY_MAX_MS = 90000;

/**
 * Join a single Facebook group (AC4). Internal helper for joinFacebookGroups.
 *
 * Navigates to the group and clicks the Join button (locale-aware, UNVERIFIED
 * selectors — fallback chain + clear PII-free throw). A group requiring admin
 * approval returns status:'pending' (NOT a failure — FR-18).
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {string} groupUrl - facebook.com group URL
 * @returns {Promise<{joined: boolean, status: 'joined'|'pending'}>}
 * @throws {Error} If the Join button is not found (PII-free)
 */
async function joinSingleGroup(page, groupUrl) {
  await page.goto(groupUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(500);

  // Join button — UNVERIFIED locale-aware selectors (en/vi) + aria fallbacks.
  const joinSelectors = [
    '[aria-label="Join group"]',   // en
    '[aria-label="Join Group"]',   // en (alt casing)
    '[aria-label="Tham gia nhóm"]',// vi
    'div[role="button"][aria-label*="Join"]',
    'div[role="button"][aria-label*="Tham gia"]',
  ];

  // Pending indicator — already requested / awaiting approval (NOT a failure).
  const pendingSelectors = [
    '[aria-label="Cancel request"]', // en
    '[aria-label="Requested"]',      // en
    '[aria-label="Đã yêu cầu"]',     // vi
    '[aria-label="Hủy yêu cầu"]',    // vi
  ];

  // Combined single wait: block until ANY join/pending indicator renders
  // (one wait for the joined list, never Nx sequential — findLikeButton lesson).
  try {
    await page.waitForSelector([...pendingSelectors, ...joinSelectors].join(', '), { timeout: 5000 });
  } catch (_) {
    throw new Error('❌ Join button not found; locale unsupported or group unreachable');
  }

  // Already-requested state first (no race) → pending, do not click.
  for (const selector of pendingSelectors) {
    if (await page.$(selector)) {
      return { joined: false, status: 'pending' };
    }
  }

  // Otherwise locate + click the Join button.
  let joinButton = null;
  for (const selector of joinSelectors) {
    joinButton = await page.$(selector);
    if (joinButton) break;
  }
  if (!joinButton) {
    throw new Error('❌ Join button not found; locale unsupported or group unreachable');
  }
  await joinButton.click();
  await sleep(800); // let the join/approval state settle

  // After clicking, a pending indicator means admin-approval is required.
  for (const selector of pendingSelectors) {
    if (await page.$(selector)) {
      return { joined: true, status: 'pending' };
    }
  }

  return { joined: true, status: 'joined' };
}

/**
 * Default keyword-search seam (AC3 keyword mode). Navigates the group-search
 * surface and scroll-collects up to `limit` group URLs. Injectable via
 * options.searchFn so tests never hit the network.
 *
 * @param {Object} page - Puppeteer page
 * @param {string} keyword - search term
 * @param {number} limit - max group URLs to collect
 * @returns {Promise<string[]>}
 */
async function defaultGroupSearch(page, keyword, limit) {
  const url = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(keyword)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  const collected = new Set();
  let stalls = 0;
  // Bounded scroll-collect: dedupe group links until limit or exhausted.
  while (collected.size < limit && stalls < 5) {
    const before = collected.size;
    const links = await page.$$eval('a[href*="/groups/"]', (as) =>
      as.map((a) => a.href).filter((h) => /\/groups\/[^/]+\/?$/.test(h)),
    );
    for (const href of links) {
      collected.add(href.split('?')[0]);
      if (collected.size >= limit) break;
    }
    if (collected.size === before) stalls++; else stalls = 0;
    await page.evaluate(() => window.scrollBy(0, 1000));
    await randomDelay(1000, 3000);
  }
  return Array.from(collected).slice(0, limit);
}

/**
 * Join Facebook groups by URL or keyword search (Story 4.4 — FR-18).
 * Cluster-1 batch write: routes through runGuardedBatch (NFR-7) with the
 * mandatory account-risk warning (NFR-8) and a 30s inter-join delay floor (NFR-6).
 *
 * @param {Object} page - Puppeteer page (authenticated); may be null for URL-mode dry-run
 * @param {Object} input - `{ groupUrls: string[] }` (URL mode) or `{ keyword, limit }` (keyword mode)
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=true] - Default true; only explicit false sends real joins
 * @param {number} [options.delayMin] - Clamped UP to GROUP_ACTION_DELAY_FLOOR_MS (30s) — cannot go lower
 * @param {number} [options.delayMax] - Defaults to 90s
 * @param {Function} [options.delay] - Injectable delay seam (tests pass a spy)
 * @param {Function} [options.joinFn] - Injectable per-group join (default joinSingleGroup)
 * @param {Function} [options.searchFn] - Injectable keyword search (default defaultGroupSearch)
 * @param {number} [options.maxBatch] - Inherited from runGuardedBatch (default 20)
 * @returns {Promise<Object>} runGuardedBatch result, with per-URL status merged in
 */
export async function joinFacebookGroups(page, input, options = {}) {
  const {
    joinFn: joinFnOpt,
    searchFn: searchFnOpt,
    delayMin: delayMinOpt,
    delayMax: delayMaxOpt,
    ...rest
  } = options;
  const joinFn = joinFnOpt ?? joinSingleGroup;
  const searchFn = searchFnOpt ?? defaultGroupSearch;

  // --- Resolve mode + batch items (validate before any browser write) ---
  if (!input || typeof input !== 'object') {
    throw new Error('❌ joinFacebookGroups: input must be { groupUrls } or { keyword, limit }');
  }

  let groupUrls;
  if (Array.isArray(input.groupUrls)) {
    // URL mode
    if (input.groupUrls.length === 0) {
      throw new Error('❌ joinFacebookGroups: groupUrls must be a non-empty array');
    }
    for (const u of input.groupUrls) {
      assertFacebookUrl(u, 'joinFacebookGroups: groupUrl');
    }
    groupUrls = input.groupUrls;
  } else if (typeof input.keyword === 'string' && input.keyword.trim()) {
    // Keyword mode: resolve URLs via the (injectable) search seam, then validate.
    const limit = Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : 10;
    groupUrls = await searchFn(page, input.keyword.trim(), limit);
    if (!Array.isArray(groupUrls) || groupUrls.length === 0) {
      // Empty search results → return an empty dry-run-style result, do NOT throw (AC3).
      return {
        dryRun: options.dryRun === false ? false : true,
        platform: 'facebook',
        attempted: 0, succeeded: 0, failed: 0,
        preview: [], results: [], warning: null,
      };
    }
    for (const u of groupUrls) {
      assertFacebookUrl(u, 'joinFacebookGroups: resolved groupUrl');
    }
  } else {
    throw new Error('❌ joinFacebookGroups: provide either { groupUrls } or { keyword, limit }');
  }

  // --- NFR-6 delay floor: clamp UP to 30s, never below; default 30s/90s ---
  const delayMin = Math.max(GROUP_ACTION_DELAY_FLOOR_MS, delayMinOpt ?? GROUP_ACTION_DELAY_FLOOR_MS);
  const delayMax = Math.max(delayMin, delayMaxOpt ?? GROUP_ACTION_DELAY_MAX_MS);

  const guardedOptions = { ...rest, delayMin, delayMax };

  // Capture per-URL status (joined/pending) for the post-batch merge (AC4) —
  // same closure-Map pattern as 4.2's alreadyShared.
  const captured = new Map();
  const actionFn = async (groupUrl) => {
    const result = await joinFn(page, groupUrl);
    captured.set(groupUrl, result);
    return result;
  };

  const batchResult = await runGuardedBatch(groupUrls, actionFn, guardedOptions);

  // Surface status into real-run results (pending is ok:true, NOT failed).
  if (!batchResult.dryRun && batchResult.results.length > 0) {
    batchResult.results = batchResult.results.map((r) => {
      const cap = captured.get(r.target);
      if (cap && r.ok && cap.status !== undefined) {
        return { ...r, status: cap.status };
      }
      return r;
    });
  }

  return batchResult;
}

export default {
  runGuardedBatch,
  randomDelay,
  assertFacebookUrl,
  ACCOUNT_RISK_WARNING,
  loginWithCookie,
  createBrowser,
  createPage,
  likeFacebookPosts,
  commentOnFacebookPosts,
  createFacebookPost,
  scheduleFacebookPost,
  shareFacebookPosts,
  warmupScrollFeed,
  MAX_DURATION_SECONDS,
  joinFacebookGroups,
  GROUP_ACTION_DELAY_FLOOR_MS,
};
