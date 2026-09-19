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
 * @license Apache-2.0
 */

import { scrape, DESCRIPTORS } from '../scrapers/index.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import { normalizeVnPhone } from '../utils/vn-phone.js';
import { globalAdaptiveRateGovernor } from '../core/adaptive-governor.js';
import { resolveIdentities } from './entity-resolver.js';

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
  // Epic 41 — zero-auth identity registries (direct fetch, no proxy).
  github:       { username: 'profile' },
  gravatar:     { email: 'profile' },
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
const CIRCUIT_MAX_ENTRIES = 200;

/**
 * In-memory failure counters, keyed by `platform` or `platform:accountId` so a
 * transient failure on one account does not trip the circuit for every account
 * on that platform.
 *
 * State per key:
 *  - `failures` — consecutive failures.
 *  - `openedAt` — epoch ms the circuit last tripped (>= threshold).
 *  - `probing`  — true while a single half-open probe is in flight; concurrent
 *                 callers see the circuit as still open until the probe settles.
 *
 * @type {Map<string, { failures: number, openedAt: number, probing: boolean }>}
 */
const _failureCounts = new Map();

/**
 * Circuit key scoped to the account when one is supplied, else platform-wide.
 * @param {string} platform
 * @param {string} [accountId]
 * @returns {string}
 */
function circuitKey(platform, accountId) {
  return accountId ? `${platform}:${accountId}` : platform;
}

/**
 * Evict stale entries once the map grows past `CIRCUIT_MAX_ENTRIES`, keeping the
 * most-recently-opened circuits. Prevents unbounded growth across many distinct
 * platform/account keys over a long-running process.
 * @param {number} now
 */
function evictCircuits(now) {
  if (_failureCounts.size <= CIRCUIT_MAX_ENTRIES) return;
  // Drop fully-recovered / long-idle entries first (oldest openedAt).
  const entries = [..._failureCounts.entries()].sort((a, b) => a[1].openedAt - b[1].openedAt);
  const excess = _failureCounts.size - CIRCUIT_MAX_ENTRIES;
  for (let i = 0; i < excess; i++) _failureCounts.delete(entries[i][0]);
}

/**
 * True when the platform's circuit is currently open (skip dispatch).
 *
 * Half-open with single-probe semantics: after `CIRCUIT_COOLDOWN_MS` exactly one
 * caller is allowed through to probe; it sets `probing` so concurrent callers
 * still observe the circuit as open until the probe's success/failure is
 * recorded.
 *
 * @param {string} platform
 * @param {number} now
 * @param {string} [accountId]
 * @returns {boolean} true → skip dispatch
 */
function isCircuitOpen(platform, now, accountId) {
  const s = _failureCounts.get(circuitKey(platform, accountId));
  if (!s || s.failures < CIRCUIT_FAILURE_THRESHOLD) return false;
  if (now - s.openedAt < CIRCUIT_COOLDOWN_MS) return true;
  // Cooldown elapsed — allow ONE probe through; others stay open until it settles.
  if (s.probing) return true;
  s.probing = true;
  return false;
}

/**
 * @param {string} platform
 * @param {number} now
 * @param {string} [accountId]
 */
function recordPlatformFailure(platform, now, accountId) {
  const key = circuitKey(platform, accountId);
  const s = _failureCounts.get(key) || { failures: 0, openedAt: 0, probing: false };
  s.failures += 1;
  s.probing = false;
  if (s.failures >= CIRCUIT_FAILURE_THRESHOLD) s.openedAt = now;
  _failureCounts.set(key, s);
  evictCircuits(now);
}

/**
 * @param {string} platform
 * @param {string} [accountId]
 */
function recordPlatformSuccess(platform, accountId) {
  _failureCounts.delete(circuitKey(platform, accountId));
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
 *
 * NOTE on cleanup: the losing `scrape()` promise is NOT abandoned to leak —
 * `scrape()` itself wraps `crawler.start()` in try/finally with `crawler.cleanup()`,
 * so once the underlying crawl settles the browser/session is released. The
 * timeout only abandons the *caller-side* wait; the crawler finishes and cleans
 * up in the background. We additionally pass a `signal`/`timeout` into the
 * scrape options so well-behaved crawlers can abort early instead of running
 * the full crawl.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, signal) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`⏱ platform timeout after ${ms}ms`);
      err.code = 'OSINT_TIMEOUT';
      reject(err);
    }, ms);
  });
  if (signal) {
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  }
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Simple promise pool — run `fn(item)` over `items` with at most `limit` in flight.
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item:T)=>Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function runPool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
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
      if (platform === 'linkedin') {
        // lead_profile expects a LinkedIn URL or /in/<slug> handle. A bare
        // username maps to the /in/ profile URL so the lookup actually resolves.
        args.profileUrl = uname.includes('linkedin.com')
          ? uname
          : `https://www.linkedin.com/in/${uname.replace(/\/+$/, '')}`;
      }
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
 * Produce a JSON-safe, size-bounded copy of a raw crawler record for embedding
 * in `ProfileItem.metadata.raw`. Strips non-serializable values (functions,
 * class instances, circular refs) and truncates deep nesting so the MCP
 * envelope can always be `JSON.stringify`'d and PII-bearing blobs stay bounded.
 * @param {unknown} v
 * @param {number} [depth]
 * @returns {unknown}
 */
function sanitizeRaw(v, depth = 0) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v.length > 2000 ? v.slice(0, 2000) + '…' : v;
  if (typeof v !== 'object') return undefined; // functions, symbols, bigint
  if (depth > 4) return '[truncated]';
  if (Array.isArray(v)) return v.slice(0, 50).map((e) => sanitizeRaw(e, depth + 1));
  const out = {};
  let n = 0;
  for (const [k, val] of Object.entries(v)) {
    if (n++ > 60) { out._truncated = true; break; }
    const sv = sanitizeRaw(val, depth + 1);
    if (sv !== undefined) out[k] = sv;
  }
  return out;
}

/**
 * Normalize one platform's raw scrape result into `ProfileItem[]`.
 * Handles the common shapes: single profile object, `{ company }`,
 * `{ profile }`, `{ profiles: [] }`, `{ items: [] }`, `{ data: [] }`,
 * `{ users/channels/leads/accounts: [] }`, `{ result }`,
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
      metadata: { ...(r.metadata && typeof r.metadata === 'object' ? r.metadata : {}), raw: sanitizeRaw(r) },
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
  if (Array.isArray(r.users)) pushFrom(r.users);
  if (Array.isArray(r.channels)) pushFrom(r.channels);
  if (Array.isArray(r.leads)) pushFrom(r.leads);
  if (Array.isArray(r.accounts)) pushFrom(r.accounts);
  if (r.profile) pushFrom(r.profile);
  if (r.company) pushFrom(r.company);
  if (r.user) pushFrom(r.user);
  if (r.lead) pushFrom(r.lead);
  if (r.channel) pushFrom(r.channel);
  if (r.result && typeof r.result === 'object' && !Array.isArray(r.result)) pushFrom(r.result);

  // If nothing matched a wrapper key, treat the object itself as a profile.
  if (out.length === 0) pushFrom(r);
  return out;
}

// ---------------------------------------------------------------------------
// Fan-out executor
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Per-platform default timeout budgets (Story 36.2: Tier-Aware Deadlines).
 * Tier 0 (static/lightweight REST) = 4s - 5s to avoid holding up the fan-out.
 * Tier 1 (browser / GraphQL / complex anti-bot) = 15s.
 * @type {Record<string, number>}
 */
export const PLATFORM_TIMEOUTS_MS = {
  // Tier 0: Lightweight REST / static HTML
  masothue: 4_000,
  chotot: 4_000,
  topcv: 4_000,
  vietnamworks: 4_000,
  reddit: 5_000,
  medium: 5_000,
  bluesky: 6_000,
  mastodon: 6_000,
  zalo: 10_000,
  // Epic 41 — Tier-0 identity registries (direct REST, no browser).
  github: 4_000,
  gravatar: 4_000,

  // Tier 1: Browser / heavy anti-bot
  twitter: 15_000,
  facebook: 15_000,
  threads: 15_000,
  instagram: 15_000,
  tiktok: 15_000,
  youtube: 15_000,
  linkedin: 15_000,
};

/**
 * Classify a scrape error into a high-level error taxonomy (Story 36.2).
 * Enables downstream callers (Nowing AI Lead Hub / ChainLens) to make automated
 * recovery decisions (backoff, retry with proxy, auth refresh).
 *
 * @param {any} err
 * @returns {{ code: string, message: string }}
 */
export function classifyPlatformError(err) {
  if (!err) return { code: 'SCRAPE_ERROR', category: 'SCRAPE_ERROR', message: 'Unknown error' };
  if (err.code === 'OSINT_TIMEOUT') {
    return { code: 'OSINT_TIMEOUT', category: 'PLATFORM_TIMEOUT', message: err.message || 'platform timeout' };
  }
  const rawCode = err.code || '';
  const msg = err.message || String(err);
  const status = err.status || err.statusCode;

  let category = 'SCRAPE_ERROR';
  if (rawCode === 'XACT_4291' || status === 429 || /rate limit/i.test(msg)) {
    category = 'RATE_LIMITED';
  } else if (rawCode === 'XACT_5030' || status === 403 || /captcha|challenge|blocked|forbidden|anti-bot/i.test(msg)) {
    category = 'BOT_BLOCKED';
  } else if (rawCode === 'XACT_4010' || status === 401 || /auth|login|unauthorized|session expired/i.test(msg)) {
    category = 'AUTH_REQUIRED';
  }

  return {
    code: rawCode || category,
    category,
    message: msg,
  };
}

const MAX_CONCURRENT_PLATFORMS = 4;
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

  // Reject non-string queryType outright (numbers, booleans, arrays) instead of
  // silently coercing to 'auto' — malformed input must surface as XACT_4001.
  if (args.queryType !== undefined && args.queryType !== null && typeof args.queryType !== 'string') {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: `Invalid queryType "${JSON.stringify(args.queryType)}". Use auto|name|username|phone|email`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const requestedType = typeof args.queryType === 'string' ? args.queryType.toLowerCase() : 'auto';
  let queryType = /** @type {QueryType} */ (
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

  // If auto/explicit 'phone' was detected but the number is not a VN phone,
  // every platform's phone path would skip (only VN platforms support phone and
  // they require a valid VN number) — degrade to 'name' so the query still runs.
  if (queryType === 'phone' && !normalizeVnPhone(query)) {
    queryType = 'name';
  }

  const callerTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null;

  // Resolve target platform list (dedup + lowercase).
  const requested = Array.isArray(platforms) && platforms.length > 0
    ? platforms.map((p) => String(p).toLowerCase())
    : DEFAULT_PLATFORMS;
  const targets = [...new Set(requested)];

  // Normalize VN phone once for VN-platform dispatch.
  const vnNormalized = queryType === 'phone' ? normalizeVnPhone(query) : null;
  const effectiveQuery = queryType === 'phone' && vnNormalized ? vnNormalized : query;

  const startedAt = Date.now();

  const runOne = async (platform) => {
    const pStarted = Date.now();
    const base = { platform, count: 0 };
    const elapsed = () => Date.now() - pStarted;

    if (!DESCRIPTORS[platform] || !PROFILE_ACTION_MAP[platform]) {
      return { ...base, status: 'unsupported', durationMs: elapsed(), profiles: [] };
    }
    const action = PROFILE_ACTION_MAP[platform][queryType];
    if (!action) {
      return { ...base, status: 'skipped', reason: `no ${queryType} lookup supported`, durationMs: elapsed(), profiles: [] };
    }
    if (queryType === 'phone' && VN_PHONE_PLATFORMS.has(platform) && !vnNormalized) {
      return { ...base, status: 'skipped', reason: 'invalid VN phone', durationMs: elapsed(), profiles: [] };
    }
    if (accountId && globalAdaptiveRateGovernor?.isHibernating(accountId, platform)) {
      return { ...base, status: 'account_sick', reason: 'account is hibernating', durationMs: elapsed(), profiles: [] };
    }
    if (isCircuitOpen(platform, pStarted, accountId)) {
      return { ...base, status: 'circuit_open', durationMs: elapsed(), profiles: [] };
    }

    const platformDeadline = callerTimeout || PLATFORM_TIMEOUTS_MS[platform] || DEFAULT_TIMEOUT_MS;
    const scrapeArgs = buildScrapeArgs(platform, queryType, effectiveQuery, locale);
    // Per-platform abort signal + HTTP timeout so a hanging crawl can be cut
    // short by well-behaved crawlers; the outer withTimeout still bounds the wait.
    const controller = new AbortController();
    const options = {
      ...scrapeArgs,
      timeout: platformDeadline,
      signal: controller.signal,
      ...(accountId ? { accountId } : {}),
      ...(proxyUrl ? { proxyUrl } : {}),
      ...(context && typeof context === 'object' ? { context } : {}),
    };

    try {
      const raw = await withTimeout(scrape(platform, action, options), platformDeadline, controller.signal);
      const profiles = normalizeToProfileItems(platform, raw);
      recordPlatformSuccess(platform, accountId);
      return {
        ...base,
        status: 'ok',
        count: profiles.length,
        profiles,
        durationMs: elapsed(),
      };
    } catch (err) {
      controller.abort(); // signal any cooperative crawler to stop early
      recordPlatformFailure(platform, Date.now(), accountId);
      const isTimeout = err && err.code === 'OSINT_TIMEOUT';
      const classified = classifyPlatformError(err);
      return {
        ...base,
        status: isTimeout ? 'timeout' : 'error',
        error: classified,
        profiles: [],
        durationMs: elapsed(),
      };
    }
  };

  // Fan-out with a bounded concurrency pool: default queries hit up to 16
  // platforms, many Puppeteer-backed — cap in-flight dispatches to avoid
  // exhausting memory / file descriptors / platform rate limits.
  const settledResults = await runPool(targets, MAX_CONCURRENT_PLATFORMS, (p) =>
    runOne(p).then((v) => ({ status: 'fulfilled', value: v })).catch((reason) => ({ status: 'rejected', reason }))
  );

  /** @type {import('../core/types.js').ProfileItem[]} */
  const profiles = [];
  /** @type {Array<Record<string, unknown>>} */
  const platformStatus = [];

  settledResults.forEach((res, i) => {
    const platform = targets[i];
    if (res.status === 'fulfilled') {
      const { profiles: ps, ...status } = res.value;
      profiles.push(...ps);
      platformStatus.push(status);
    } else {
      // Defensive: runOne never rejects, but keep the batch partial-failure tolerant.
      platformStatus.push({
        platform,
        status: 'error',
        count: 0,
        durationMs: 0,
        error: { code: 'INTERNAL', message: res.reason?.message || String(res.reason) },
      });
    }
  });

  const dispatched = platformStatus.filter((s) => s.status === 'ok' || s.status === 'error' || s.status === 'timeout').length;

  // Story 41.2 — group the flat fan-out results into identity clusters so the
  // caller can tell which cross-platform profiles belong to the same person.
  // In-memory per-request only (Option D): no PII persistence. `profiles[]`
  // and `platformStatus[]` are unchanged — `identityClusters` is additive.
  const identityClusters = resolveIdentities(profiles, query);

  return {
    success: true,
    query,
    queryType,
    platformsQueried: targets.length,
    platformsAttempted: dispatched,
    totalProfiles: profiles.length,
    profiles,
    identityClusters,
    platformStatus,
    durationMs: Date.now() - startedAt,
  };
}
