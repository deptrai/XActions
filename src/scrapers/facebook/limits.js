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

// ============================================================================
// Velocity limits (hard floors, not overrideable)
// ============================================================================

/**
 * Human-scaled action limits for Facebook automation.
 * These are hard floors — callers may not safely exceed them.
 */
export const LIMITS = {
  like: { perHour: 30 },
  comment: { perHour: 10 },
  friendRequest: { perDay: 20 },
  message: { perHour: 20 },
};

// ============================================================================
// Account age tiers (Story 6.14 — used by getActionLimit)
// ============================================================================

/**
 * Account-age scaling factors. Tiers are ordered from most-restrictive to least.
 * `maxDays: Infinity` is the catch-all mature tier.
 */
export const ACCOUNT_AGE_TIERS = [
  { maxDays: 7, factor: 0.50, label: 'new' },
  { maxDays: 28, factor: 0.80, label: 'young' },
  { maxDays: Infinity, factor: 1.00, label: 'mature' },
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Return the age-tier factor for a given account age in days.
 * Falls through tiers until `accountAgeDays <= maxDays` is satisfied.
 *
 * @param {number} [accountAgeDays=Infinity]
 * @returns {number}
 */
function getAgeFactor(accountAgeDays = Infinity) {
  for (const tier of ACCOUNT_AGE_TIERS) {
    if (accountAgeDays <= tier.maxDays) {
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
  const ms = 5000 + rng() * 10000; // 5-15s
  return delayFn(ms);
}
