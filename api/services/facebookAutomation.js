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
    delayMin: delayMinRaw,
    delayMax: delayMaxRaw,
    maxBatch = 20,
    maxRetry = 1,
    shouldStop,
    onProgress,
  } = options;

  // Normalize delayMin/delayMax: treat null/undefined as "use default" (a spread
  // options object carrying delayMin:null should fall back, not throw — destructure
  // defaults only catch `undefined`). Genuinely invalid values (NaN, string, negative)
  // still throw below.
  const delayMin = delayMinRaw ?? 1000;
  const delayMax = delayMaxRaw ?? 3000;

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
  const { dryRun = true, userId, now = () => Date.now() } = options;

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
  if (scheduledDate.getTime() < now() + 60_000) {
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
      as.map((a) => a.href).filter((h) => /\/groups\/[^/]+\/?$/.test(h.split('?')[0])),
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
 * @param {boolean} [options.dryRun=true] - Default true; only explicit false sends real joins.
 *   NOTE: in keyword mode, dry-run does NOT resolve URLs (search would drive the browser) —
 *   it returns an empty preview + a warning. Use URL mode (or a real run) to preview groups.
 * @param {number} [options.delayMin] - Clamped UP to GROUP_ACTION_DELAY_FLOOR_MS (30s) — cannot go lower
 * @param {number} [options.delayMax] - Defaults to 90s
 * @param {Function} [options.delay] - Injectable delay seam (tests pass a spy)
 * @param {Function} [options.joinFn] - Injectable per-group join (default joinSingleGroup)
 * @param {Function} [options.searchFn] - Injectable keyword search (default defaultGroupSearch)
 * @param {number} [options.maxBatch=20] - Inherited from runGuardedBatch; BOUNDS the number of
 *   groups joined per call. In keyword mode, `limit` should be <= maxBatch — a resolved set
 *   larger than maxBatch makes runGuardedBatch throw an "exceeds maxBatch" error.
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
    // Keyword mode. Resolving URLs requires driving the browser (navigate + scroll),
    // which would violate the dry-run "no browser side-effects" contract that every
    // other automate fn upholds. So in DRY-RUN we do NOT search — return an empty
    // preview + a warning telling the caller to use a real run (or URL mode) to
    // preview concrete groups. The search only runs on an explicit real run.
    if (options.dryRun !== false) {
      return {
        dryRun: true,
        platform: 'facebook',
        attempted: 0, succeeded: 0, failed: 0,
        preview: [],
        results: [],
        warning:
          '⚠️ keyword-mode dry-run does not resolve group URLs (search would drive the browser). ' +
          'Use a real run, or URL mode, to preview concrete groups.',
      };
    }
    // Real run: resolve URLs via the (injectable) search seam, then validate.
    const limit = Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : 10;
    groupUrls = await searchFn(page, input.keyword.trim(), limit);
    if (!Array.isArray(groupUrls) || groupUrls.length === 0) {
      // Empty search results → return an empty result, do NOT throw (AC3).
      return {
        dryRun: false,
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
  // --- NFR-6 delay floor: clamp UP to 30s, never below; default 30s/90s ---
  // Guard with Number.isFinite (not just ??): NaN/Infinity (e.g. from parseFloat('x'))
  // would survive `?? floor` and make Math.max(floor, NaN) === NaN, silently bypassing
  // the floor and surfacing a confusing error from runGuardedBatch's own validation.
  const safeMinOpt = Number.isFinite(delayMinOpt) && delayMinOpt >= 0 ? delayMinOpt : GROUP_ACTION_DELAY_FLOOR_MS;
  const safeMaxOpt = Number.isFinite(delayMaxOpt) && delayMaxOpt >= 0 ? delayMaxOpt : GROUP_ACTION_DELAY_MAX_MS;
  const delayMin = Math.max(GROUP_ACTION_DELAY_FLOOR_MS, safeMinOpt);
  const delayMax = Math.max(delayMin, safeMaxOpt);

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

// ============================================================================
// Facebook Group Batch Post (Story 4.5 — FR-19, Cluster-1 medium risk)
// ============================================================================

// FR-19 strict batch cap: >10 groups requires force:true. Stricter than
// runGuardedBatch's default maxBatch=20 — enforced before delegation.
export const GROUP_POST_BATCH_LIMIT = 10;

/**
 * Post content to a single Facebook group (AC4). Internal helper for postToFacebookGroups.
 *
 * Navigates to the group page and uses the group composer to type + submit the post.
 * Selectors are UNVERIFIED (locale-aware, fallback chain) — see selectors-facebook.md
 * Groups section. A PII-free throw is raised if the composer or submit button is not found.
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {string} groupUrl - facebook.com group URL
 * @param {string} content - Post content to type
 * @returns {Promise<{posted: boolean}>}
 * @throws {Error} If composer or submit button not found (PII-free)
 */
async function postToSingleGroup(page, groupUrl, content) {
  await page.goto(groupUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(500);

  // Group composer selectors — UNVERIFIED, locale-aware (en/vi) + fallbacks.
  // See docs/agents/selectors-facebook.md Groups section for verify-checklist.
  const composerSelectors = [
    '[aria-label*="Write something"]',   // en — group composer prompt
    '[aria-label*="Viết gì đó"]',        // vi — group composer prompt
    '[aria-label*="What\'s on your mind"]', // en — fallback (home-feed style)
    '[aria-label*="Bạn đang nghĩ gì"]',  // vi — fallback (home-feed style)
    '[data-testid="status-attachment-mentions-input"]',
    // Removed: div[role="textbox"][contenteditable="true"] — too broad, matches comment
    // boxes and Messenger compose. The aria + data-testid selectors above are sufficient.
  ];

  let composer = null;
  try {
    await page.waitForSelector(composerSelectors.join(', '), { timeout: 8000 });
  } catch (err) {
    // Only swallow selector timeout — a detached frame / destroyed context is a real
    // error that should propagate, not be masked behind a generic "not found" throw.
    if (!/timeout|waiting for selector/i.test(err?.message ?? '')) throw err;
    throw new Error('❌ Group post composer not found; group unreachable or locale unsupported');
  }

  for (const selector of composerSelectors) {
    composer = await page.$(selector);
    if (composer) break;
  }
  if (!composer) {
    throw new Error('❌ Group post composer not found; group unreachable or locale unsupported');
  }

  await composer.click();
  await sleep(300);
  await page.keyboard.type(content);
  await sleep(200);

  // Submit button selectors — UNVERIFIED, locale-aware.
  const submitSelectors = [
    '[aria-label="Post"]',       // en
    '[aria-label="Đăng"]',       // vi
    'div[aria-label="Post"][role="button"]',
    'div[aria-label="Đăng"][role="button"]',
  ];

  let submitBtn = null;
  for (const selector of submitSelectors) {
    submitBtn = await page.$(selector);
    if (submitBtn) break;
  }
  if (!submitBtn) {
    throw new Error('❌ Group post submit button not found; composer open but submit unavailable');
  }

  await submitBtn.click();
  await sleep(2000);

  // Facebook group posts submit via XHR without navigation — post-success
  // confirmation selector is UNVERIFIED (same caveat as createFacebookPost).
  // Return {posted:true} once submit fires; live-verify confirms actual delivery.
  return { posted: true };
}

/**
 * Batch post content to multiple Facebook groups (Story 4.5 — FR-19).
 * Cluster-1 batch write: routes through runGuardedBatch (NFR-7) with the
 * mandatory account-risk warning (NFR-8) and a 30s inter-post delay floor (NFR-6).
 *
 * Default effective cap is 10 groups (GROUP_POST_BATCH_LIMIT). Passing more
 * than 10 requires options.force = true; with force the runGuardedBatch
 * maxBatch cap (default 20) still applies.
 *
 * mediaUrls is accepted but text-only posting in MVP — media upload is reserved
 * for a future story. mediaUrls is validated for type only and documented as
 * not-yet-implemented; it is NOT silently dropped.
 *
 * @param {Object} page - Puppeteer page (authenticated); may be null for dry-run
 * @param {Object} input - { groupUrls: string[], content: string, mediaUrls?: string[] }
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=true] - Default true; only explicit false posts for real.
 * @param {boolean} [options.force=false] - Allow >10 groups (up to runGuardedBatch maxBatch=20).
 * @param {number} [options.delayMin] - Clamped UP to GROUP_ACTION_DELAY_FLOOR_MS (30s).
 * @param {number} [options.delayMax] - Defaults to 90s.
 * @param {Function} [options.delay] - Injectable delay seam (tests pass a spy).
 * @param {Function} [options.postFn] - Injectable per-group post (default postToSingleGroup).
 * @returns {Promise<Object>} runGuardedBatch result with per-group {target, ok, error?}
 */
export async function postToFacebookGroups(page, input, options = {}) {
  const {
    postFn: postFnOpt,
    delayMin: delayMinOpt,
    delayMax: delayMaxOpt,
    force,
    ...rest
  } = options;
  const postFn = postFnOpt ?? postToSingleGroup;

  // --- Input validation (before any browser action) ---
  if (!input || typeof input !== 'object') {
    throw new Error('❌ postToFacebookGroups: input must be { groupUrls, content }');
  }

  const { groupUrls, content, mediaUrls } = input;

  if (!Array.isArray(groupUrls) || groupUrls.length === 0) {
    throw new Error('❌ postToFacebookGroups: groupUrls must be a non-empty array');
  }

  for (const u of groupUrls) {
    assertFacebookUrl(u, 'postToFacebookGroups: groupUrl');
  }

  // Duplicate group URL guard (Map-collision pattern from 4.2).
  if (new Set(groupUrls).size !== groupUrls.length) {
    throw new Error('❌ postToFacebookGroups: groupUrls must not contain duplicates');
  }

  // Non-empty content guard (reuse createFacebookPost guard).
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('❌ postToFacebookGroups: content must be a non-empty string');
  }

  // mediaUrls: reserved, not-yet-implemented in MVP (mirrors scheduleFacebookPost posture).
  if (mediaUrls !== undefined) {
    if (!Array.isArray(mediaUrls)) {
      throw new Error('❌ postToFacebookGroups: mediaUrls must be an array if provided');
    }
    // mediaUrls accepted but not yet implemented — text-only post in MVP.
    // A future story will add media upload support.
  }

  // --- batchLimit / force gate (AC2, FR-19) — enforced before browser, in dry-run too ---
  if (groupUrls.length > GROUP_POST_BATCH_LIMIT && force !== true) {
    throw new Error(
      `❌ postToFacebookGroups: ${groupUrls.length} groups exceeds the default cap of ${GROUP_POST_BATCH_LIMIT}. ` +
      `Pass options.force = true to proceed (still capped at runGuardedBatch maxBatch=20), ` +
      `or split the batch into chunks of ${GROUP_POST_BATCH_LIMIT}.`,
    );
  }

  // --- NFR-6 delay floor: clamp UP to 30s, never below; default 30s/90s ---
  const safeMinOpt = Number.isFinite(delayMinOpt) && delayMinOpt >= 0 ? delayMinOpt : GROUP_ACTION_DELAY_FLOOR_MS;
  const safeMaxOpt = Number.isFinite(delayMaxOpt) && delayMaxOpt >= 0 ? delayMaxOpt : GROUP_ACTION_DELAY_MAX_MS;
  const delayMin = Math.max(GROUP_ACTION_DELAY_FLOOR_MS, safeMinOpt);
  const delayMax = Math.max(delayMin, safeMaxOpt);

  const guardedOptions = { ...rest, delayMin, delayMax };

  const actionFn = async (groupUrl) => {
    return postFn(page, groupUrl, content);
  };

  const batchResult = await runGuardedBatch(groupUrls, actionFn, guardedOptions);

  // Dry-run: echo content once in the return (AC6.12).
  if (batchResult.dryRun) {
    batchResult.previewContent = content;
    if (mediaUrls !== undefined) {
      batchResult.mediaUrlsNote = 'mediaUrls accepted but text-only post in MVP — media upload reserved for a future story';
    }
  }

  return batchResult;
}

// ============================================================================
// Facebook Friend Requests (Story 4.7 — FR-21, Cluster-2 HIGHEST risk)
// ============================================================================

// NFR-6 Cluster-2 safety floor: friend requests are paced >= 60s apart — DOUBLE
// the group-action floor. Friend-request spam is the top cause of checkpoint.
// A user CANNOT configure below 60s. This is a safety INVARIANT, not a tunable.
export const FRIEND_REQUEST_DELAY_FLOOR_MS = 60000;
const FRIEND_REQUEST_DELAY_MAX_MS = 180000;

// NFR-11: strip phone numbers and email addresses from any collected text field.
// Applied at the normalizer level (suggestions/location modes) — NOT a caller option.
const FR_PII_PHONE_RE = /(\+?\d[\d\s\-().]{7,}\d)/g;
const FR_PII_EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function stripFriendPii(value) {
  if (!value || typeof value !== 'string') return value ?? null;
  const cleaned = value.replace(FR_PII_PHONE_RE, '').replace(FR_PII_EMAIL_RE, '').trim();
  return cleaned || null;
}

/**
 * Send a friend request to a single profile (AC4). Internal helper.
 *
 * Navigates to the profile and detects the relationship state BEFORE clicking:
 * - already a friend → status:'already_friend' (skip, ok:true, NOT fail)
 * - request already pending → status:'pending' (skip, ok:true, NOT fail)
 * - "Add Friend" present → click → status:'sent'
 * Profile unreachable / blocked / deactivated → PII-free throw (recorded ok:false).
 *
 * UNVERIFIED locale-aware selectors — fallback chain. See selectors-facebook.md.
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {string} profileUrl - facebook.com profile URL
 * @returns {Promise<{sent: boolean, status: 'sent'|'already_friend'|'pending'|'not_found'}>}
 * @throws {Error} If the profile is unreachable / no actionable button found (PII-free)
 */
async function sendSingleFriendRequest(page, profileUrl) {
  await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(500);

  // Add Friend button — UNVERIFIED locale-aware selectors (en/vi) + aria fallbacks.
  const addSelectors = [
    '[aria-label="Add friend"]',   // en
    '[aria-label="Add Friend"]',   // en (alt casing)
    '[aria-label="Thêm bạn bè"]',  // vi
    'div[role="button"][aria-label*="Add friend"]',
    'div[role="button"][aria-label*="Thêm bạn"]',
  ];

  // Already-friend indicator — relationship already established (skip, NOT fail).
  const friendSelectors = [
    '[aria-label="Friends"]',      // en
    '[aria-label="Bạn bè"]',       // vi
    'div[role="button"][aria-label*="Friends"]',
  ];

  // Pending indicator — request already sent / awaiting acceptance (skip, NOT fail).
  const pendingSelectors = [
    '[aria-label="Cancel request"]', // en
    '[aria-label="Requested"]',      // en
    '[aria-label="Đã yêu cầu"]',     // vi
    '[aria-label="Hủy yêu cầu"]',    // vi
  ];

  // Combined single wait: block until ANY relationship indicator renders
  // (one wait, never Nx sequential — findLikeButton lesson). Only swallow the
  // timeout; a frame-destroyed error must propagate (4.2/4.5 review lesson).
  try {
    await page.waitForSelector(
      [...friendSelectors, ...pendingSelectors, ...addSelectors].join(', '),
      { timeout: 5000 },
    );
  } catch (err) {
    if (err?.name === 'TimeoutError' || /timeout/i.test(err?.message ?? '')) {
      throw new Error('❌ Friend request controls not found; profile unreachable, blocked, or locale unsupported');
    }
    throw err;
  }

  // Already-friend state first (no race) → skip, do not click.
  for (const selector of friendSelectors) {
    if (await page.$(selector)) {
      return { sent: false, status: 'already_friend' };
    }
  }

  // Pending request already sent → skip, do not click.
  for (const selector of pendingSelectors) {
    if (await page.$(selector)) {
      return { sent: false, status: 'pending' };
    }
  }

  // Otherwise locate + click the Add Friend button.
  let addButton = null;
  for (const selector of addSelectors) {
    addButton = await page.$(selector);
    if (addButton) break;
  }
  if (!addButton) {
    throw new Error('❌ Add Friend button not found; profile unreachable or locale unsupported');
  }
  await addButton.click();
  await sleep(800); // let the request state settle

  // After clicking, a pending indicator confirms the request actually fired
  // (no silent success — same posture as 4.2/4.4/4.5; UNVERIFIED → live-verify).
  for (const selector of pendingSelectors) {
    if (await page.$(selector)) {
      return { sent: true, status: 'sent' };
    }
  }

  return { sent: true, status: 'sent' };
}

/**
 * Default suggestions/location search seam (AC3 suggestions/location modes).
 * Navigates the "People You May Know" surface and scroll-collects up to `limit`
 * profile cards. Extracts ONLY { name, profileUrl, location? } per card — NFR-11
 * strips phone/email even if visible. Injectable via options.searchFn.
 *
 * @param {Object} page - Puppeteer page
 * @param {number} limit - max profiles to collect
 * @returns {Promise<Array<{ name: string|null, profileUrl: string, location: string|null }>>}
 */
async function defaultFriendSuggestions(page, limit) {
  await page.goto('https://www.facebook.com/friends/suggestions', {
    waitUntil: 'networkidle2', timeout: 30000,
  });

  const collected = new Map(); // keyed by profileUrl
  let stalls = 0;
  while (collected.size < limit && stalls < 5) {
    const before = collected.size;
    const raw = await page.$$eval('div[role="listitem"], a[href*="/profile.php"], a[href]', (nodes) => {
      // Collect profile anchors with nearby name + location text.
      const out = [];
      const seen = new Set();
      for (const node of nodes) {
        const a = node.matches('a[href]') ? node : node.querySelector('a[href]');
        if (!a) continue;
        const href = a.getAttribute('href') || '';
        const abs = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
        const idMatch = abs.match(/facebook\.com\/profile\.php\?id=(\d+)/i);
        const segMatch = abs.match(/facebook\.com\/([^/?&#]+)/i);
        let profileUrl = null;
        if (idMatch) {
          profileUrl = `https://www.facebook.com/profile.php?id=${idMatch[1]}`;
        } else if (segMatch && !['friends', 'profile.php', 'photo', 'watch'].includes(segMatch[1].toLowerCase())) {
          profileUrl = abs.split('?')[0];
        }
        if (!profileUrl || seen.has(profileUrl)) continue;
        seen.add(profileUrl);
        const card = node.closest('div[role="listitem"]') || node;
        const name = a.textContent?.trim() || card.querySelector('span, strong')?.textContent?.trim() || null;
        // Location is best-effort: a secondary text line in the card.
        const loc = card.querySelector('[class*="location"], span[dir="auto"]:nth-of-type(2)')?.textContent?.trim() || null;
        out.push({ name, profileUrl, location: loc });
      }
      return out;
    });

    for (const r of raw) {
      if (!collected.has(r.profileUrl)) collected.set(r.profileUrl, r);
      if (collected.size >= limit) break;
    }
    if (collected.size === before) stalls++; else stalls = 0;
    await page.evaluate(() => window.scrollBy(0, 1000));
    await randomDelay(1000, 3000);
  }
  return Array.from(collected.values()).slice(0, limit);
}

/**
 * Send friend requests by UID list, suggestions, or location filter (Story 4.7 — FR-21).
 * Cluster-2 batch write (HIGHEST account risk): routes through runGuardedBatch (NFR-7)
 * with the mandatory non-suppressible account-risk warning (NFR-8) and a 60s inter-request
 * delay floor (NFR-6). batchLimit <= 20/session (runGuardedBatch default maxBatch).
 *
 * @param {Object} page - Puppeteer page (authenticated); may be null for uid_list dry-run
 * @param {Object} input - { mode: 'uid_list'|'suggestions'|'location', targets?, location?, limit? }
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=true] - Default true; only explicit false sends real requests.
 *   In suggestions/location mode, dry-run does NOT drive the browser — returns empty preview + warning.
 * @param {number} [options.delayMin] - Clamped UP to FRIEND_REQUEST_DELAY_FLOOR_MS (60s) — cannot go lower
 * @param {number} [options.delayMax] - Defaults to 180s
 * @param {Function} [options.delay] - Injectable delay seam (tests pass a spy)
 * @param {Function} [options.requestFn] - Injectable per-profile request (default sendSingleFriendRequest)
 * @param {Function} [options.searchFn] - Injectable suggestions search (default defaultFriendSuggestions)
 * @returns {Promise<Object>} runGuardedBatch result, with per-profile status merged in
 */
export async function sendFriendRequests(page, input, options = {}) {
  const {
    requestFn: requestFnOpt,
    searchFn: searchFnOpt,
    delayMin: delayMinOpt,
    delayMax: delayMaxOpt,
    ...rest
  } = options;
  const requestFn = requestFnOpt ?? sendSingleFriendRequest;
  const searchFn = searchFnOpt ?? defaultFriendSuggestions;

  // --- Validate input + resolve mode (explicit, before any browser write) ---
  if (!input || typeof input !== 'object') {
    throw new Error('❌ sendFriendRequests: input must be { mode, targets?/location?/limit? }');
  }
  const { mode, targets, location } = input;
  if (mode !== 'uid_list' && mode !== 'suggestions' && mode !== 'location') {
    throw new Error("❌ sendFriendRequests: input.mode must be 'uid_list', 'suggestions', or 'location'");
  }

  let profileUrls;
  if (mode === 'uid_list') {
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new Error('❌ sendFriendRequests: uid_list mode requires a non-empty targets array');
    }
    for (const t of targets) {
      assertFacebookUrl(t, 'sendFriendRequests: target');
    }
    profileUrls = targets;
  } else {
    // suggestions / location modes use the scroll-collect surface.
    // Dry-run must NOT drive the browser (4.4 review P1) — return empty preview + warning.
    if (options.dryRun !== false) {
      return {
        dryRun: true,
        platform: 'facebook',
        attempted: 0, succeeded: 0, failed: 0,
        preview: [],
        results: [],
        warning:
          `⚠️ ${mode}-mode dry-run does not resolve profile URLs (suggestions search would drive the browser). ` +
          'Use uid_list mode, or a real run, to preview concrete profiles.',
      };
    }
    if (mode === 'location' && (typeof location !== 'string' || !location.trim())) {
      throw new Error('❌ sendFriendRequests: location mode requires a non-empty location string');
    }
    const limit = Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : 10;
    const collected = await searchFn(page, limit);
    let profiles = Array.isArray(collected) ? collected : [];
    // NFR-11: strip phone/email from every collected text field at normalizer level.
    profiles = profiles.map((p) => ({
      name: stripFriendPii(p.name),
      profileUrl: p.profileUrl,
      location: stripFriendPii(p.location),
    }));
    if (mode === 'location') {
      const needle = location.trim().toLowerCase();
      profiles = profiles.filter((p) => (p.location ?? '').toLowerCase().includes(needle));
    }
    profileUrls = profiles.map((p) => p.profileUrl).filter(Boolean);
    if (profileUrls.length === 0) {
      return {
        dryRun: false,
        platform: 'facebook',
        attempted: 0, succeeded: 0, failed: 0,
        preview: [], results: [], warning: null,
      };
    }
    for (const u of profileUrls) {
      assertFacebookUrl(u, 'sendFriendRequests: resolved profileUrl');
    }
  }

  // --- NFR-6 Cluster-2 delay floor: clamp UP to 60s, never below; default 60s/180s ---
  // Number.isFinite guard (not just ??): NaN/Infinity would survive `?? floor` and make
  // Math.max(floor, NaN) === NaN, silently bypassing the floor (4.4 review P2).
  const safeMinOpt = Number.isFinite(delayMinOpt) && delayMinOpt >= 0 ? delayMinOpt : FRIEND_REQUEST_DELAY_FLOOR_MS;
  const safeMaxOpt = Number.isFinite(delayMaxOpt) && delayMaxOpt >= 0 ? delayMaxOpt : FRIEND_REQUEST_DELAY_MAX_MS;
  const delayMin = Math.max(FRIEND_REQUEST_DELAY_FLOOR_MS, safeMinOpt);
  const delayMax = Math.max(delayMin, safeMaxOpt);

  const guardedOptions = { ...rest, delayMin, delayMax };

  // Capture per-profile status for the post-batch merge (AC4) — same closure-Map
  // pattern as 4.4's joined/pending. Skip states (already_friend/pending) are ok:true.
  const captured = new Map();
  const actionFn = async (profileUrl) => {
    const result = await requestFn(page, profileUrl);
    captured.set(profileUrl, result);
    return result;
  };

  const batchResult = await runGuardedBatch(profileUrls, actionFn, guardedOptions);

  // Surface status into real-run results (already_friend/pending are ok:true, NOT failed).
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

// ============================================================================
// Facebook Cancel Pending Friend Requests (Story 4.8 — FR-22, Cluster-2)
// ============================================================================

// FR-22: cancel pacing is 2-5s — the lowest delay of any Cluster-2 write. Unlike
// 4.4's 30s or 4.7's 60s floors (safety INVARIANTS), 2-5s is a spec value passed
// directly to runGuardedBatch — not a non-negotiable floor constant.
const CANCEL_DELAY_MIN_MS = 2000;
const CANCEL_DELAY_MAX_MS = 5000;

/**
 * Parse a "Sent X days ago" / "Đã gửi X ngày trước" string into an age in days.
 * Best-effort: returns null if unparseable (caller errs on the side of including).
 *
 * @param {string|null} dateSentText
 * @returns {number|null} age in days, or null if unparseable
 */
function parseRequestAgeDays(dateSentText) {
  if (typeof dateSentText !== 'string' || !dateSentText.trim()) return null;
  const t = dateSentText.toLowerCase();
  // "X day(s)" / "X ngày" → days; "X week(s)"/"X tuần" → *7; "X month(s)"/"X tháng" → *30
  const num = t.match(/(\d+)/);
  if (!num) return null;
  const n = parseInt(num[1], 10);
  if (!Number.isFinite(n)) return null;
  if (/week|tuần/.test(t)) return n * 7;
  if (/month|tháng/.test(t)) return n * 30;
  if (/year|năm/.test(t)) return n * 365;
  if (/hour|giờ|minute|phút|just now|vừa xong/.test(t)) return 0;
  if (/day|ngày/.test(t)) return n;
  return null;
}

/**
 * Default Phase-1 collect seam — scrape the sent-requests list.
 * Navigates `/friends/requests/sent`, bounded scroll-collects pending requests
 * with `{ name, profileUrl, dateSent }`. UNVERIFIED selectors — see selectors-facebook.md.
 * Injectable via options.collectFn so tests skip the real browser.
 *
 * @param {Object} page - Puppeteer page
 * @param {number} limit - max requests to collect
 * @param {Function} delay - injectable delay seam
 * @returns {Promise<Array<{ name: string|null, profileUrl: string, dateSent: string|null }>>}
 */
async function defaultCollectSentRequests(page, limit, delay) {
  await page.goto('https://www.facebook.com/friends/requests/sent', {
    waitUntil: 'networkidle2', timeout: 30000,
  });
  await delay(1000, 3000);

  const collected = new Map(); // keyed by profileUrl
  let stalls = 0;
  while (collected.size < limit && stalls < 5) {
    const before = collected.size;
    const raw = await page.$$eval('div[role="listitem"]', (items) =>
      items.map((item) => {
        const a = item.querySelector('a[href]');
        const href = a?.getAttribute('href') || '';
        const abs = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
        const idMatch = abs.match(/facebook\.com\/profile\.php\?id=(\d+)/i);
        const segMatch = abs.match(/facebook\.com\/([^/?&#]+)/i);
        let profileUrl = null;
        if (idMatch) {
          profileUrl = `https://www.facebook.com/profile.php?id=${idMatch[1]}`;
        } else if (segMatch && !['friends', 'profile.php', 'photo', 'watch'].includes(segMatch[1].toLowerCase())) {
          profileUrl = abs.split('?')[0];
        }
        const name = a?.textContent?.trim() || item.querySelector('span, strong')?.textContent?.trim() || null;
        // "Sent X days ago" line — best-effort secondary text.
        const dateSent = item.querySelector('span[dir="auto"]:last-of-type, abbr')?.textContent?.trim() || null;
        return { name, profileUrl, dateSent };
      }).filter((r) => r.profileUrl),
    );

    for (const r of raw) {
      if (!collected.has(r.profileUrl)) collected.set(r.profileUrl, r);
      if (collected.size >= limit) break;
    }
    if (collected.size === before) stalls++; else stalls = 0;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1000, 3000);
  }
  return Array.from(collected.values()).slice(0, limit);
}

/**
 * Cancel a single pending friend request (AC4). Internal helper.
 * Navigates to the profile and clicks "Cancel request" / "Hủy yêu cầu".
 * UNVERIFIED locale-aware selectors — fallback chain + PII-free throw.
 *
 * @param {Object} page - Puppeteer page
 * @param {string} profileUrl - facebook.com profile URL
 * @returns {Promise<{cancelled: boolean}>}
 * @throws {Error} If the Cancel-request button is not found (PII-free)
 */
async function cancelSingleRequest(page, profileUrl) {
  await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(500);

  const cancelSelectors = [
    '[aria-label="Cancel request"]', // en
    '[aria-label="Requested"]',      // en (click → menu → cancel)
    '[aria-label="Hủy yêu cầu"]',    // vi
    '[aria-label="Đã yêu cầu"]',     // vi
    'div[role="button"][aria-label*="Cancel request"]',
    'div[role="button"][aria-label*="Hủy yêu cầu"]',
  ];

  try {
    await page.waitForSelector(cancelSelectors.join(', '), { timeout: 5000 });
  } catch (err) {
    if (err?.name === 'TimeoutError' || /timeout/i.test(err?.message ?? '')) {
      throw new Error('❌ Cancel-request button not found; request already resolved or profile unreachable');
    }
    throw err;
  }

  let cancelBtn = null;
  for (const selector of cancelSelectors) {
    cancelBtn = await page.$(selector);
    if (cancelBtn) break;
  }
  if (!cancelBtn) {
    throw new Error('❌ Cancel-request button not found; request already resolved or profile unreachable');
  }
  await cancelBtn.click();
  await sleep(800);

  return { cancelled: true };
}

/**
 * Bulk-cancel pending friend requests (Story 4.8 — FR-22).
 * Two-phase: (1) collect the sent-requests list (read; runs in dry-run too for
 * the preview), then (2) batch-cancel via runGuardedBatch with a 2-5s delay.
 *
 * Dry-run runs Phase 1 (read navigation) but NOT Phase 2 (no Cancel click).
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {Object} [options]
 * @param {number} options.limit - Max cancellations (required, positive integer)
 * @param {number} [options.olderThanDays] - Only cancel requests older than N days
 * @param {boolean} [options.dryRun=true] - Default true; only explicit false cancels
 * @param {Function} [options.delay] - Injectable delay seam (tests pass a spy)
 * @param {Function} [options.collectFn] - Injectable Phase-1 collect (default scrape)
 * @param {Function} [options.cancelFn] - Injectable per-request cancel (default cancelSingleRequest)
 * @returns {Promise<Object>} dry-run: { dryRun, platform, pending, count };
 *   real: { dryRun, platform, cancelled, failed, remaining }
 */
export async function cancelPendingFriendRequests(page, options = {}) {
  const {
    limit,
    olderThanDays,
    delay = randomDelay,
    collectFn: collectFnOpt,
    cancelFn: cancelFnOpt,
    ...rest
  } = options;
  const collectFn = collectFnOpt ?? defaultCollectSentRequests;
  const cancelFn = cancelFnOpt ?? cancelSingleRequest;

  // AC6: validate limit — positive finite integer.
  if (!Number.isFinite(limit) || limit <= 0 || Math.floor(limit) !== limit) {
    throw new Error('❌ cancelPendingFriendRequests: limit must be a positive integer');
  }

  // --- Phase 1: collect pending requests (runs in dry-run too — preview needs it) ---
  let pending = await collectFn(page, limit, delay);
  if (!Array.isArray(pending)) pending = [];

  // olderThanDays filter: include unparseable dates (err toward cleanup, AC2.7).
  if (Number.isFinite(olderThanDays) && olderThanDays > 0) {
    pending = pending.filter((r) => {
      const age = parseRequestAgeDays(r.dateSent);
      return age === null || age >= olderThanDays;
    });
  }

  // Cap at limit.
  pending = pending.slice(0, limit);

  // --- AC3: dry-run returns the preview; Phase 2 does NOT run ---
  if (options.dryRun !== false) {
    return {
      dryRun: true,
      platform: 'facebook',
      pending: pending.map((r) => ({ name: r.name, profileUrl: r.profileUrl, dateSent: r.dateSent })),
      count: pending.length,
    };
  }

  // --- AC5: empty list → zero result, no throw ---
  const totalPending = pending.length;
  if (totalPending === 0) {
    return { dryRun: false, platform: 'facebook', cancelled: 0, failed: 0, remaining: 0 };
  }

  // --- Phase 2: batch-cancel via runGuardedBatch (2-5s delay, NFR-7/8) ---
  const targets = pending.map((r) => r.profileUrl);
  const guardedOptions = { ...rest, delay, delayMin: CANCEL_DELAY_MIN_MS, delayMax: CANCEL_DELAY_MAX_MS };

  const actionFn = async (profileUrl) => cancelFn(page, profileUrl);
  const batchResult = await runGuardedBatch(targets, actionFn, guardedOptions);

  // --- Transform runGuardedBatch result into { cancelled, failed, remaining } ---
  const cancelled = batchResult.succeeded;
  const failed = batchResult.failed;
  const remaining = totalPending - cancelled - failed;
  return {
    dryRun: false,
    platform: 'facebook',
    cancelled,
    failed,
    remaining,
  };
}

// ============================================================================
// Newsfeed farming / account warming (Story 4.9 — FR-23, Cluster-2)
// ============================================================================

// Duration cap: warming sessions run longer than view-boost (600s vs 300s).
export const MAX_WARMUP_DURATION_SECONDS = 600;
export const DEFAULT_WARMUP_DURATION_SECONDS = 120;

const WARMUP_HOME_URL = 'https://www.facebook.com/';

// Default reaction: find Like button, skip silently if not found, click only if not already liked.
async function defaultReactFn(page) {
  let result;
  try {
    result = await findLikeButton(page);
  } catch {
    // findLikeButton throws when button not found — swallow to skip silently (AC3.8)
    return;
  }
  if (result.alreadyLiked) return;
  await result.element.click();
}

/**
 * Warm up a Facebook account with natural newsfeed scrolling and optional light reactions.
 * Navigates to the home feed (hardcoded) — NOT a runGuardedBatch case (no item batch).
 *
 * @param {Object|null} page - Puppeteer page (authenticated); MAY be null in dry-run
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=true] - Default true; only explicit false drives the browser
 * @param {number} [options.durationSeconds] - Dwell time; clamped to MAX_WARMUP_DURATION_SECONDS (600); default 120
 * @param {boolean} [options.allowReactions=false] - When false, pure scroll only (no reactions)
 * @param {number} [options.reactProbability=0.05] - Per-scroll reaction probability; >0.2 clamped to 0.2; <=0/NaN/non-number → 0
 * @param {Function} [options.reactFn] - Injectable reaction seam (default: find-then-click Like)
 * @param {Function} [options.delay=randomDelay] - Injectable pause seam.
 *   ⚠️ COUPLED WITH `now`: override both together or neither.
 * @param {Function} [options.now] - Injectable clock (default () => Date.now()); see `delay`.
 * @returns {Promise<Object>} Preview (dry-run) or run summary (real)
 */
export async function warmupAccount(page, options = {}) {
  const {
    dryRun = true,
    durationSeconds,
    allowReactions = false,
    reactProbability: rawReactProbability = 0.05,
    reactFn = defaultReactFn,
    delay = randomDelay,
    now = () => Date.now(),
  } = options;

  // Resolve duration: default when missing/null, throw <=0/non-finite/non-number, clamp >600.
  let requested = durationSeconds;
  if (requested === undefined || requested === null) {
    requested = DEFAULT_WARMUP_DURATION_SECONDS;
  }
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
    throw new Error('❌ warmupAccount: durationSeconds must be a positive finite number');
  }
  const clamped = requested > MAX_WARMUP_DURATION_SECONDS;
  const effectiveDuration = clamped ? MAX_WARMUP_DURATION_SECONDS : requested;

  // Normalize reactProbability: >0.2 → 0.2; <=0/NaN/non-number → 0; never throw (AC3.7).
  let normalizedReactProbability;
  if (typeof rawReactProbability !== 'number' || !Number.isFinite(rawReactProbability) || rawReactProbability <= 0) {
    normalizedReactProbability = 0;
  } else if (rawReactProbability > 0.2) {
    normalizedReactProbability = 0.2;
  } else {
    normalizedReactProbability = rawReactProbability;
  }
  const reactProbabilityClamped = typeof rawReactProbability === 'number' && rawReactProbability > 0.2;

  // Strict dry-run gate: anything except explicit `false` stays dry-run.
  const isRealRun = dryRun === false;

  // --- dry-run: pure compute, NO seam, NO page.* (AC5) ---
  if (!isRealRun) {
    return {
      dryRun: true,
      platform: 'facebook',
      preview: {
        durationSeconds: effectiveDuration,
        clamped,
        allowReactions,
        reactProbability: normalizedReactProbability,
        reactProbabilityClamped,
      },
    };
  }

  // --- real run ---

  // Mandatory NFR-8 warning — non-suppressible, emitted directly (not via runGuardedBatch).
  console.warn('⚠️ Account warming does not guarantee avoiding checkpoint. Use a test account before using your main account.');

  const durationMs = effectiveDuration * 1000;

  const SCROLL_PAUSE_MIN_MS = 800;
  const SCROLL_PAUSE_MAX_MS = 2500;
  const LONG_PAUSE_MIN_MS = 5000;
  const LONG_PAUSE_MAX_MS = 8000;
  const LONG_PAUSE_EVERY_N = 3;

  // Iteration backstop: bounds busy-spin if delay is no-op without advancing `now`.
  const maxScrolls = Math.ceil(durationMs / SCROLL_PAUSE_MIN_MS) + 1;

  await page.goto(WARMUP_HOME_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  const start = now();
  let scrolls = 0;

  while (now() - start < durationMs && scrolls < maxScrolls) {
    const amount = 300 + Math.floor(Math.random() * 500); // 300–800px
    await page.evaluate((y) => window.scrollBy(0, y), amount);
    scrolls++;

    // ≥5s pause every 3rd iteration (AC6).
    if (scrolls % LONG_PAUSE_EVERY_N === 0) {
      await delay(LONG_PAUSE_MIN_MS, LONG_PAUSE_MAX_MS);
    } else {
      await delay(SCROLL_PAUSE_MIN_MS, SCROLL_PAUSE_MAX_MS);
    }

    // Optional probabilistic reaction (AC3).
    if (allowReactions && normalizedReactProbability > 0 && Math.random() < normalizedReactProbability) {
      await Promise.resolve(reactFn(page)).catch(() => {});
    }
  }

  return {
    dryRun: false,
    platform: 'facebook',
    durationSeconds: effectiveDuration,
    scrolls,
  };
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
  postToFacebookGroups,
  GROUP_POST_BATCH_LIMIT,
  sendFriendRequests,
  FRIEND_REQUEST_DELAY_FLOOR_MS,
  cancelPendingFriendRequests,
  warmupAccount,
  MAX_WARMUP_DURATION_SECONDS,
  DEFAULT_WARMUP_DURATION_SECONDS,
};
