// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * OSINT / Person Reconnaissance — `x_social_find_profiles` fan-out engine.
 *
 * Pure Data Harvesting (Option D / AD-40): fans a person-lookup query out across
 * many platforms via the Universal Scrape Dispatcher (`scrape(platform, action,
 * args)`), normalizes every result into `ProfileItem[]`, and returns them to the
 * caller. No PII persistence, no entity resolution, no Golden Record.
 *
 * Story 36.1: tool contract + fan-out + per-platform timeout + minimal
 *             in-memory per-platform circuit counter.
 * Story 36.2: adaptive circuit breaker / richer fault isolation (out of scope).
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { scrape, DESCRIPTORS } from '../scrapers/index.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import { normalizeVnPhone } from '../utils/vn-phone.js';

// ---------------------------------------------------------------------------
// Platform → action map for person lookup
// ---------------------------------------------------------------------------
//
// Each platform exposes differently-named actions for the same intent. The map
// below resolves `{ platform, queryType }` to the canonical action string the
// platform's descriptor expects. A platform with no entry for a queryType is
// reported as `skipped` rather than being called with a wrong action.

/**
 * @typedef {'username'|'name'|'phone'|'email'} QueryType
 */

/**
 * Map: platform → queryType → canonical action.
 * Platforms absent for a queryType are skipped for that query.
 * @type {Record<string, Partial<Record<QueryType, string>>>}
 */
export const PROFILE_ACTION_MAP = {
  twitter:      { username: 'profile',        name: 'search',          email: 'search' },
  threads:      { username: 'profile',        name: 'search',          email: 'search' },
  bluesky:      { username: 'profile',        name: 'search' },
  mastodon:     { username: 'profile',        name: 'search' },
  facebook:     { username: 'profile',        name: 'search' },
  reddit:       { username: 'user',           name: 'search' },
  instagram:    { username: 'user' },
  tiktok:       { username: 'search',         name: 'search' },
  medium:       { username: 'user' },
  youtube:      { username: 'channel_detail', name: 'search' },
  zalo:         { username: 'oa_detail',      phone: 'oa_detail' },
  linkedin:     { username: 'lead_profile',   name: 'lead_profile',    email: 'lead_profile' },
  topcv:        { name: 'company_detail' },
  vietnamworks: { name: 'company_detail' },
  chotot:       { phone: 'search_listings',   name: 'search_listings' },
  masothue:     { phone: 'search',            name: 'search' },
};

/**
 * Platforms that accept a VN phone query — receive the normalized `0xxxxxxxxx`.
 * @type {ReadonlySet<string>}
 */
const VN_PHONE_PLATFORMS = new Set(['chotot', 'zalo', 'masothue']);

// ---------------------------------------------------------------------------
// Minimal per-platform circuit counter (Story 36.1)
// ---------------------------------------------------------------------------

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;

/**
 * In-memory per-platform failure counters.
 * `Map<platform, { failures:number, openedAt:number }>`
 * @type {Map<string, { failures: number, openedAt: number }>}
 */
const _failureCounts = new Map();

/**
 * True when the platform's circuit is currently open (skip dispatch).
 * Half-open: after `CIRCUIT_COOLDOWN_MS` a single attempt is allowed through.
 * @param {string} platform
 * @param {number} now
 * @returns {boolean}
 */
function isCircuitOpen(platform, now) {
  const s = _failureCounts.get(platform);
  if (!s || s.failures < CIRCUIT_FAILURE_THRESHOLD) return false;
  return now - s.openedAt < CIRCUIT_COOLDOWN_MS;
}

/** @param {string} platform @param {number} now */
function recordPlatformFailure(platform, now) {
  const s = _failureCounts.get(platform) || { failures: 0, openedAt: 0 };
  s.failures += 1;
  if (s.failures >= CIRCUIT_FAILURE_THRESHOLD) s.openedAt = now;
  _failureCounts.set(platform, s);
}

/** @param {string} platform */
function recordPlatformSuccess(platform) {
  _failureCounts.delete(platform);
}

/** Test-only: reset the in-memory circuit counters. */
export function __resetOsintCircuits() {
  _failureCounts.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Race a promise against a millisecond deadline.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`⏱ platform timeout after ${ms}ms`);
      err.code = 'OSINT_TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Auto-detect the query type from its shape.
 * @param {string} query
 * @returns {QueryType}
 */
export function detectQueryType(query) {
  const q = String(query || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return 'email';
  if (normalizeVnPhone(q)) return 'phone';
  if (/^[\d+()\-\s]{7,}$/.test(q) && /\d{5,}/.test(q.replace(/\D/g, ''))) return 'phone';
  if (/^@?[A-Za-z0-9_.-]{2,}$/.test(q) && !q.includes(' ')) return 'username';
  return 'name';
}

/**
 * Build the args object the platform's descriptor `mapArgs` expects for a
 * profile-lookup call.
 * @param {string} platform
 * @param {QueryType} queryType
 * @param {string} query
 * @param {string} [locale]
 * @returns {Record<string, unknown>}
 */
export function buildScrapeArgs(platform, queryType, query, locale) {
  /** @type {Record<string, unknown>} */
  const args = {};
  const q = String(query).trim();

  switch (queryType) {
    case 'username': {
      const uname = q.replace(/^@/, '');
      // Most descriptors read `username`; bluesky/mastodon also accept it via mapArgs.
      args.username = uname;
      args.handle = uname;      // bluesky/mastodon
      args.target = uname;      // fallback alias used by several descriptors
      if (platform === 'youtube') args.channel = uname;
      if (platform === 'zalo') args.oaId = uname;
      if (platform === 'linkedin') args.profileUrl = uname.includes('linkedin.com') ? uname : undefined;
      break;
    }
    case 'name': {
      args.query = q;
      args.searchQuery = q;
      args.name = q;
      args.companyName = q;     // topcv/vietnamworks company_detail
      args.keywords = q;
      break;
    }
    case 'phone': {
      const vn = normalizeVnPhone(q);
      const normalized = vn || q;
      args.query = normalized;
      args.phone = normalized;
      args.keywords = normalized;
      args.searchQuery = normalized;
      break;
    }
    case 'email': {
      args.query = q;
      args.email = q;
      args.keywords = q;
      break;
    }
    default:
      args.query = q;
  }

  if (locale) args.locale = locale;
  return args;
}

// ---------------------------------------------------------------------------
// Result normalization → ProfileItem[]
// ---------------------------------------------------------------------------

/**
 * Normalize one platform's raw scrape result into `ProfileItem[]`.
 * Handles the common shapes: single profile object, `{ company }`,
 * `{ profile }`, `{ profiles: [] }`, `{ items: [] }`, `{ data: [] }`,
 * PostItem-ish records carrying author fields, and bare arrays.
 *
 * @param {string} platform
 * @param {unknown} raw
 * @returns {import('../core/types.js').ProfileItem[]}
 */
export function normalizeToProfileItems(platform, raw) {
  const now = new Date();
  /** @type {import('../core/types.js').ProfileItem[]} */
  const out = [];

  /** @param {Record<string, any>} r */
  const toItem = (r) => {
    if (!r || typeof r !== 'object') return null;
    const username = r.username || r.handle || r.actor || r.user || undefined;
    const name = r.name || r.displayName || r.authorName || r.companyName || r.fullName || undefined;
    const profileUrl = r.profileUrl || r.url || r.link || r.companyUrl || undefined;
    const avatar = r.avatar || r.authorAvatar || r.avatarUrl || r.profileImage || undefined;
    const externalId = r.externalId || r.id || r.userId || r.companyId || username || profileUrl || name;
    if (!username && !name && !profileUrl && !externalId) return null;
    return {
      id: `${platform}:${externalId ?? username ?? name ?? 'unknown'}`,
      platform,
      externalId: externalId != null ? String(externalId) : undefined,
      username,
      name,
      authorName: r.authorName || name,
      bio: r.bio || r.description || r.headline || undefined,
      avatar,
      profileUrl,
      followersCount: typeof r.followersCount === 'number' ? r.followersCount
        : typeof r.followers === 'number' ? r.followers : undefined,
      followingCount: typeof r.followingCount === 'number' ? r.followingCount
        : typeof r.following === 'number' ? r.following : undefined,
      metadata: { ...(r.metadata && typeof r.metadata === 'object' ? r.metadata : {}), raw: r },
      crawledAt: r.crawledAt instanceof Date ? r.crawledAt : now,
    };
  };

  const pushFrom = (v) => {
    if (Array.isArray(v)) {
      for (const e of v) { const it = toItem(e); if (it) out.push(it); }
    } else {
      const it = toItem(v);
      if (it) out.push(it);
    }
  };

  if (raw == null) return out;

  if (Array.isArray(raw)) { pushFrom(raw); return out; }
  if (typeof raw !== 'object') return out;

  const r = /** @type {Record<string, any>} */ (raw);
  if (Array.isArray(r.profiles)) pushFrom(r.profiles);
  if (Array.isArray(r.items)) pushFrom(r.items);
  if (Array.isArray(r.data)) pushFrom(r.data);
  if (Array.isArray(r.results)) pushFrom(r.results);
  if (r.profile) pushFrom(r.profile);
  if (r.company) pushFrom(r.company);
  if (r.user) pushFrom(r.user);
  if (r.lead) pushFrom(r.lead);
  if (r.channel) pushFrom(r.channel);

  // If nothing matched a wrapper key, treat the object itself as a profile.
  if (out.length === 0) pushFrom(r);
  return out;
}

// ---------------------------------------------------------------------------
// Fan-out executor
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PLATFORMS = Object.keys(PROFILE_ACTION_MAP);

/**
 * Execute the `x_social_find_profiles` tool.
 *
 * @param {Record<string, unknown>} args
 * @returns {Promise<Record<string, unknown>>}
 */
export async function executeSocialFindProfiles(args) {
  const {
    query,
    platforms,
    locale,
    timeoutMs,
    accountId,
    proxyUrl,
    context,
  } = args || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'x_social_find_profiles requires a non-empty query string',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const requestedType = typeof args.queryType === 'string' ? args.queryType.toLowerCase() : 'auto';
  const queryType = /** @type {QueryType} */ (
    requestedType === 'auto' ? detectQueryType(query) : requestedType
  );
  if (!['username', 'name', 'phone', 'email'].includes(queryType)) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: `Invalid queryType "${args.queryType}". Use auto|name|username|phone|email`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  // Resolve target platform list (dedup + lowercase).
  const requested = Array.isArray(platforms) && platforms.length > 0
    ? platforms.map((p) => String(p).toLowerCase())
    : DEFAULT_PLATFORMS;
  const targets = [...new Set(requested)];

  // Normalize VN phone once for VN-platform dispatch.
  const vnNormalized = queryType === 'phone' ? normalizeVnPhone(query) : null;
  const effectiveQuery = queryType === 'phone' && vnNormalized ? vnNormalized : query;

  const startedAt = Date.now();

  const jobs = targets.map((platform) => (async () => {
    const pStarted = Date.now();
    const base = { platform, durationMs: 0, count: 0 };

    if (!DESCRIPTORS[platform] || !PROFILE_ACTION_MAP[platform]) {
      return { ...base, status: 'unsupported', profiles: [] };
    }
    const action = PROFILE_ACTION_MAP[platform][queryType];
    if (!action) {
      return { ...base, status: 'skipped', reason: `no ${queryType} lookup supported`, profiles: [] };
    }
    if (queryType === 'phone' && VN_PHONE_PLATFORMS.has(platform) && !vnNormalized) {
      return { ...base, status: 'skipped', reason: 'invalid VN phone', profiles: [] };
    }
    if (isCircuitOpen(platform, pStarted)) {
      return { ...base, status: 'circuit_open', profiles: [] };
    }

    const scrapeArgs = buildScrapeArgs(platform, queryType, effectiveQuery, locale);
    const options = {
      ...scrapeArgs,
      ...(accountId ? { accountId } : {}),
      ...(proxyUrl ? { proxyUrl } : {}),
      ...(context && typeof context === 'object' ? { context } : {}),
    };

    try {
      const raw = await withTimeout(scrape(platform, action, options), deadlineMs);
      const profiles = normalizeToProfileItems(platform, raw);
      recordPlatformSuccess(platform);
      return {
        ...base,
        status: 'ok',
        count: profiles.length,
        profiles,
        durationMs: Date.now() - pStarted,
      };
    } catch (err) {
      recordPlatformFailure(platform, Date.now());
      const isTimeout = err && err.code === 'OSINT_TIMEOUT';
      return {
        ...base,
        status: isTimeout ? 'timeout' : 'error',
        error: {
          code: isTimeout ? 'OSINT_TIMEOUT' : (err?.code || 'SCRAPE_ERROR'),
          message: err?.message || String(err),
        },
        profiles: [],
        durationMs: Date.now() - pStarted,
      };
    }
  })());

  const settled = await Promise.allSettled(jobs);

  /** @type {import('../core/types.js').ProfileItem[]} */
  const profiles = [];
  /** @type {Array<Record<string, unknown>>} */
  const platformStatus = [];

  settled.forEach((res, i) => {
    const platform = targets[i];
    if (res.status === 'fulfilled') {
      const { profiles: ps, ...status } = res.value;
      profiles.push(...ps);
      platformStatus.push(status);
    } else {
      // Defensive: jobs never reject, but keep the batch partial-failure tolerant.
      platformStatus.push({
        platform,
        status: 'error',
        count: 0,
        durationMs: 0,
        error: { code: 'INTERNAL', message: res.reason?.message || String(res.reason) },
      });
    }
  });

  return {
    success: true,
    query,
    queryType,
    platformsQueried: targets.length,
    totalProfiles: profiles.length,
    profiles,
    platformStatus,
    durationMs: Date.now() - startedAt,
  };
}
