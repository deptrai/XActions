// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt
/**
 * Facebook velocity & rate-limiting configuration (Story 6.13 — ADR-015).
 *
 * Pure module — does NOT import puppeteer or any browser library.
 * Provides centralized, human-scaled action limits and delay floors.
 *
 * Exports:
 *   - LIMITS : { action: { perHour|perDay: number } } — hard action limits
 *   - ACCOUNT_AGE_TIERS : { maxDays, factor, label }[] — age-based scaling
 *   - getActionLimit(action, accountAgeDays) : scaled limit object
 *   - enforceDelay(action, accountAgeDays, { delayFn, rng }) : 5-15s delay
 *   - getAccountAgeDays(c_user, { db, nowFn }) : calculate account age in days
 *
 * Scope:
 *   - Story 6.13: velocity limits and delay floor
 *   - Story 6.14: account age tier integration
 *
 * NFR2: centralized config.
 * NFR3: delayFn and rng seams for testing.
 * NFR4: no account/cookie/token logged in errors.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 */

// ============================================================================
// Default seams — overridable in tests (NFR3)
// ============================================================================

const defaultDelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultRng = Math.random;
const defaultNowFn = () => Date.now();

// ============================================================================
// Timestamp normalization (Story 6.14)
// ============================================================================

/**
 * Normalize a timestamp-like value to milliseconds since epoch.
 * Accepts Date, number (ms), or ISO/parseable string.
 * Returns NaN for null, undefined, or unparseable values.
 *
 * @param {Date|number|string|null|undefined} value
 * @returns {number}
 */
function normalizeTimestamp(value) {
  if (value == null) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string') {
    const n = new Date(value).getTime();
    return n;
  }
  return NaN;
}

// ============================================================================
// Velocity limits (hard floors, not overrideable)
// ============================================================================

/**
 * Human-scaled action limits for Facebook automation.
 * These are hard floors — callers may not safely exceed them.
 */
const LIMITS_RAW = {
  like: { perHour: 30 },
  comment: { perHour: 10 },
  friendRequest: { perDay: 20 },
  message: { perHour: 20 },
};

// Deep-freeze to enforce ADR-015 "hard floors không override được".
for (const action of Object.keys(LIMITS_RAW)) {
  Object.freeze(LIMITS_RAW[action]);
}
export const LIMITS = Object.freeze(LIMITS_RAW);

// ============================================================================
// Account age tiers (Story 6.14 — used by getActionLimit)
// ============================================================================

/**
 * Account-age scaling factors. Tiers are ordered from most-restrictive to least.
 * `maxDays: Infinity` is the catch-all mature tier.
 */
const ACCOUNT_AGE_TIERS_RAW = [
  { maxDays: 7, factor: 0.50, label: 'new' },
  { maxDays: 28, factor: 0.80, label: 'young' },
  { maxDays: Infinity, factor: 1.00, label: 'mature' },
];

// Deep-freeze so age-tier factors cannot be tampered with at runtime.
for (const tier of ACCOUNT_AGE_TIERS_RAW) {
  Object.freeze(tier);
}
export const ACCOUNT_AGE_TIERS = Object.freeze(ACCOUNT_AGE_TIERS_RAW);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize account age in days.
 * - null/undefined/NaN → Infinity (mature, fail-safe default)
 * - negative values → 0 (most restrictive, safe for invalid ages)
 * - strings are coerced to numbers (e.g. "5" → 5)
 *
 * @param {number} [accountAgeDays=Infinity]
 * @returns {number}
 */
function normalizeAgeDays(accountAgeDays = Infinity) {
  if (accountAgeDays == null || Number.isNaN(accountAgeDays)) {
    return Infinity;
  }
  const n = Number(accountAgeDays);
  return n < 0 ? 0 : n;
}

/**
 * Return the age-tier factor for a given account age in days.
 * Falls through tiers until `accountAgeDays <= maxDays` is satisfied.
 *
 * @param {number} [accountAgeDays=Infinity]
 * @returns {number}
 */
function getAgeFactor(accountAgeDays = Infinity) {
  const age = normalizeAgeDays(accountAgeDays);
  for (const tier of ACCOUNT_AGE_TIERS) {
    if (age <= tier.maxDays) {
      return tier.factor;
    }
  }
  return 1.0;
}

/**
 * Scale a limit value by an age factor, flooring to an integer and clamping to >= 1.
 *
 * @param {number} value
 * @param {number} factor
 * @returns {number}
 */
function scaleLimit(value, factor) {
  return Math.max(1, Math.floor(value * factor));
}

// ============================================================================
// getActionLimit — Story 6.13
// ============================================================================

/**
 * Get the rate limit for a Facebook action, optionally scaled by account age.
 *
 * @param {string} action - one of 'like', 'comment', 'friendRequest', 'message'
 * @param {number} [accountAgeDays=Infinity] - account age in days
 * @returns {Object|null} - scaled limit object (e.g. { perHour: 30 }) or null if action unknown
 */
export function getActionLimit(action, accountAgeDays = Infinity) {
  const limit = LIMITS[action];
  if (!limit) return null;

  const factor = getAgeFactor(accountAgeDays);
  const scaled = {};
  for (const [key, value] of Object.entries(limit)) {
    scaled[key] = scaleLimit(value, factor);
  }
  return scaled;
}

// ============================================================================
// enforceDelay — Story 6.13
// ============================================================================

/**
 * Enforce the 5-15s delay floor between Facebook actions.
 *
 * The `action` and `accountAgeDays` parameters are reserved for future per-action
 * or per-age delay floors (Story 6.14+). For Story 6.13 the floor is always 5-15s.
 *
 * @param {string} action - action type (reserved)
 * @param {number} [accountAgeDays=Infinity] - account age in days (reserved)
 * @param {Object} [options]
 * @param {Function} [options.delayFn] - delay function (default: setTimeout-based)
 * @param {Function} [options.rng] - random number generator (default: Math.random)
 * @returns {Promise<void>}
 */
export async function enforceDelay(action, accountAgeDays = Infinity, options = {}) {
  const { delayFn = defaultDelayFn, rng = defaultRng } = options;
  // Clamp rng to [0, 1] so the 5-15s hard floor cannot be bypassed (AC6).
  const r = Math.max(0, Math.min(1, rng()));
  const ms = 5000 + r * 10000; // 5-15s
  return delayFn(ms);
}

// ============================================================================
// getAccountAgeDays — Story 6.14
// ============================================================================

/**
 * Calculate the age of a Facebook account in days given its account ID (`c_user`).
 *
 * Pure function — uses injectable seams for data access (`db`) and time (`nowFn`).
 * Falls back to `0` (most restrictive / "new" tier) when `db` is missing,
 * `c_user` is null/empty, no creation record exists, or any value is unparseable.
 * This is fail-safe for anti-detection: unknown age = assume new account.
 *
 * @param {string} c_user - Facebook user ID string
 * @param {Object} [options]
 * @param {Object} [options.db] - database adapter with `getAccountCreatedAt(c_user)` method
 * @param {Function} [options.nowFn] - returns current timestamp in ms (default: Date.now)
 * @returns {Promise<number>} account age in days (integer >= 0)
 */
export async function getAccountAgeDays(c_user, options = {}) {
  const { db, nowFn = defaultNowFn } = options;
  if (!c_user || typeof c_user !== 'string' || !db || typeof db.getAccountCreatedAt !== 'function') {
    return 0;
  }

  try {
    const createdAt = await db.getAccountCreatedAt(c_user);
    const createdTime = normalizeTimestamp(createdAt);
    if (!Number.isFinite(createdTime)) return 0;

    const now = normalizeTimestamp(nowFn());
    if (!Number.isFinite(now)) return 0;
    const diffMs = now - createdTime;
    return Math.max(0, Math.floor(diffMs / 86400000));
  } catch (_err) {
    return 0;
  }
}
