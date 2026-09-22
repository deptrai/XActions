// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * EntityResolver — pure-JS identity resolution for OSINT fan-out results.
 *
 * Groups the flat `profiles[]` returned by `x_social_find_profiles` into
 * `identityClusters[]`: sets of profiles across platforms that likely belong to
 * the same real person, each with a confidence score in [0,1].
 *
 * Algorithm (Story 41.2, Epic 41): Jaro-Winkler string similarity + a weighted
 * additive confidence model, merged via union-find. Only the algorithm is
 * ported (Jaro-Winkler) — no Python code, no network, no I/O, no PII
 * persistence (Option D: in-memory per-request only).
 *
 * Scoring signals (additive, capped at 100 → confidence = score/100):
 *   username_exact   +40  identical username across platforms
 *   name_similar     +30  Jaro-Winkler(displayName) > 0.85
 *   avatar_match     +30  identical avatar URL (or pHash match via avatarHashMap)
 *   crosslink_bio    +20  a bio/links references the other profile
 *   bio_semantic     +35  Jev semantic second opinion: the two bios describe
 *                         the same person (Story 42.5 — only via a prefetched
 *                         bioScoreMap; never computed inside this module)
 *
 * Two profiles merge when their pairwise score >= MERGE_THRESHOLD (40).
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { fetchAvatarHash, getAvatarPHashThreshold, isAvatarPHashEnabled, hammingDistance } from '../osint/phash.js';

// ---------------------------------------------------------------------------
// Jaro-Winkler similarity
// ---------------------------------------------------------------------------

/**
 * Jaro similarity between two strings.
 * @param {string} s1
 * @param {string} s2
 * @returns {number} similarity in [0,1]
 */
function jaro(s1, s2) {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // Count transpositions.
  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  t = Math.floor(t / 2);

  return (matches / len1 + matches / len2 + (matches - t) / matches) / 3;
}


const WINKLER_PREFIX_SCALING = 0.1;
const WINKLER_MAX_PREFIX = 4;

/**
 * Jaro-Winkler similarity — Jaro plus a boost for a common prefix.
 * @param {string} a
 * @param {string} b
 * @returns {number} similarity in [0,1]
 */
export function jaroWinkler(a, b) {
  const s1 = String(a || '');
  const s2 = String(b || '');
  const j = jaro(s1, s2);
  if (j < 0.7) return j; // Winkler boost only applies above the 0.7 threshold (standard).
  let prefix = 0;
  const max = Math.min(WINKLER_MAX_PREFIX, Math.min(s1.length, s2.length));
  while (prefix < max && s1[prefix] === s2[prefix]) prefix++;
  return j + prefix * WINKLER_PREFIX_SCALING * (1 - j);
}

// ---------------------------------------------------------------------------
// Pairwise scoring
// ---------------------------------------------------------------------------

/** Merge threshold: two profiles join a cluster when pairwise score >= 40. */
export const MERGE_THRESHOLD = 40;
const NAME_SIM_THRESHOLD = 0.85;
const MAX_SCORE = 100;

/** @param {unknown} v @returns {string} */
const norm = (v) => String(v || '').trim().toLowerCase();

/**
 * Host of a URL string (lowercase, no www.), or '' when unparseable.
 * @param {string} url
 * @returns {string}
 */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Detect a cross-link: does profile `a` reference profile `b`?
 * Checks a.bio / a.metadata.verifiedAccounts against b's username + profileUrl.
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 * @returns {boolean}
 */
function crossLinks(a, b) {
  const bUser = norm(b.username);
  const bHost = hostOf(b.profileUrl || '');
  const haystacks = [norm(a.bio)];

  const acc = a?.metadata?.verifiedAccounts;
  if (Array.isArray(acc)) {
    for (const v of acc) {
      if (v && typeof v === 'object') {
        haystacks.push(norm(v.username), norm(v.url), norm(v.service));
      }
    }
  }
  // Also scan any platform profileUrls embedded in metadata.raw-ish fields.
  const raw = a?.metadata?.raw;
  if (raw && typeof raw === 'object') {
    haystacks.push(norm(raw.blog), norm(raw.profileUrl), norm(raw.url));
  }

  return haystacks.some((h) => {
    if (!h) return false;
    if (bUser && h.includes(bUser)) return true;
    if (bHost && h.includes(bHost)) return true;
    return false;
  });
}

/**
 * Stable identity key for one profile in bio-score map lookups.
 * Prefers the normalized `id` (`${platform}:${externalId}`) emitted by
 * normalizeToProfileItems; falls back to `platform:username|name|profileUrl`
 * when callers hand in ad-hoc objects without an id.
 * @param {Record<string, any>} p
 * @returns {string}
 */
function profilePairId(p) {
  const id = String(p?.id || '').trim();
  if (id) return id;
  const platform = String(p?.platform || '').trim();
  const key = String(p?.username || p?.name || p?.profileUrl || '').trim();
  // No usable identity → '' — callers skip degenerate keys so unrelated
  // empty-identity profiles never share one map entry.
  return key ? `${platform}:${key}` : '';
}

/**
 * Deterministic key for an unordered profile pair — identical regardless of
 * argument order, so the async bio prefetch (`prefetchBioScores`) and the sync
 * `scorePair` lookup agree on map keys without sharing index state.
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 * @returns {string} `${idA}||${idB}` with the two ids sorted lexicographically
 */
export function bioPairKey(a, b) {
  const idA = profilePairId(a);
  const idB = profilePairId(b);
  if (!idA || !idB) return ''; // degenerate identity — no stable pair key
  return idA <= idB ? `${idA}||${idB}` : `${idB}||${idA}`;
}

/**
 * Score a pair of profiles; returns total score + which signals fired.
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 * @param {Map<string, bigint>} [avatarHashMap] — pre-fetched avatar pHash map (url → hash)
 * @param {boolean} [phashEnabled] — resolved pHash kill-switch (default: env)
 * @param {number} [phashThreshold] — resolved Hamming threshold (default: env)
 * @param {Map<string, {score: number, confidence: number}>} [bioScoreMap] — pre-fetched
 *        Jev bio scores keyed by bioPairKey (Story 42.5); only qualifying pairs present
 * @returns {{ score: number, signals: string[] }}
 */
export function scorePair(a, b, avatarHashMap, phashEnabled = isAvatarPHashEnabled(), phashThreshold = getAvatarPHashThreshold(), bioScoreMap) {
  let score = 0;
  const signals = [];

  const aUser = norm(a.username);
  const bUser = norm(b.username);
  if (aUser && bUser && aUser === bUser) {
    score += 40;
    signals.push('username_exact');
  }

  const aName = norm(a.name || a.authorName);
  const bName = norm(b.name || b.authorName);
  if (aName && bName && jaroWinkler(aName, bName) > NAME_SIM_THRESHOLD) {
    score += 30;
    signals.push('name_similar');
  }

  const aAv = norm(a.avatar);
  const bAv = norm(b.avatar);
  let avatarMatched = false;
  if (aAv && bAv && aAv === bAv) {
    // Fast-path: identical URL
    avatarMatched = true;
  } else if (aAv && bAv && avatarHashMap && phashEnabled) {
    // pHash path: compare perceptual hashes (enabled/threshold resolved by caller)
    const aHash = avatarHashMap.get(aAv);
    const bHash = avatarHashMap.get(bAv);
    if (aHash !== undefined && bHash !== undefined) {
      const dist = hammingDistance(aHash, bHash);
      if (dist <= phashThreshold) {
        avatarMatched = true;
      }
    }
  }
  if (avatarMatched) {
    score += 30;
    signals.push('avatar_match');
  }

  if (crossLinks(a, b) || crossLinks(b, a)) {
    score += 20;
    signals.push('crosslink_bio');
  }

  // Story 42.5 — Jev semantic bio second opinion. bioScoreMap is produced by
  // the async `prefetchBioScores` pre-pass and only contains pairs Jev judged
  // samePerson (score >= 2, confidence >= threshold). +35 alone stays below
  // MERGE_THRESHOLD — it can only tip a pair already carrying a free signal.
  const bioKey = bioScoreMap ? bioPairKey(a, b) : '';
  if (bioKey && bioScoreMap && typeof bioScoreMap.has === 'function' && bioScoreMap.has(bioKey)) {
    score += 35;
    signals.push('bio_semantic');
  }

  return { score: Math.min(score, MAX_SCORE), signals };
}

// ---------------------------------------------------------------------------
// Union-find clustering
// ---------------------------------------------------------------------------

/**
 * Pick the most representative member of a cluster: highest followersCount,
 * tie-broken by number of populated identifying fields.
 * @param {Array<Record<string, any>>} members
 * @returns {Record<string, any>}
 */
function pickPrimary(members) {
  const richness = (p) =>
    ['username', 'name', 'bio', 'avatar', 'profileUrl', 'externalId'].reduce(
      (n, k) => n + (p[k] ? 1 : 0),
      0
    );
  return members.reduce((best, p) => {
    const f = typeof p.followersCount === 'number' ? p.followersCount : -1;
    const bf = typeof best.followersCount === 'number' ? best.followersCount : -1;
    if (f !== bf) return f > bf ? p : best;
    return richness(p) > richness(best) ? p : best;
  }, members[0]);
}

/**
 * Resolve a flat ProfileItem[] into identityClusters[].
 *
 * @param {Array<Record<string, any>>} profiles
 * @param {string} [query] — original lookup query (reserved; boosts nothing yet
 *                          but kept for future query-anchored scoring).
 * @param {Map<string, bigint>} [avatarHashMap] — pre-fetched avatar pHash map (url → hash)
 * @param {Map<string, {score: number, confidence: number}>} [bioScoreMap] — pre-fetched
 *        Jev bio scores keyed by bioPairKey (Story 42.5); only qualifying pairs present
 * @returns {Array<{ clusterId: string, confidence: number, profiles: Array, matchedSignals: string[], primaryProfile: any }>}
 */
export function resolveIdentities(profiles, query, avatarHashMap, bioScoreMap) {
  // Story 41.3 — evaluate pHash config once per call, not per pair (env reads in the O(n^2) loop).
  const phashEnabled = isAvatarPHashEnabled();
  const phashThreshold = phashEnabled ? getAvatarPHashThreshold() : 0;
  const list = Array.isArray(profiles) ? profiles.filter((p) => p && typeof p === 'object') : [];
  if (list.length === 0) return [];

  const n = list.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  /** @param {number} x @returns {number} */
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  /** @param {number} a @param {number} b */
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Pairwise scoring — record which signal set merged each pair.
  /** @type {Map<number, { max: number, signals: Set<string> }>} */
  const rootStats = new Map();
  const pairSignals = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Same-platform duplicates still allowed to merge, but carry less meaning.
      const { score, signals } = scorePair(list[i], list[j], avatarHashMap, phashEnabled, phashThreshold, bioScoreMap);
      pairSignals.push([i, j, score, signals]);
      if (score >= MERGE_THRESHOLD) {
        union(i, j);
        const r = find(i);
        const st = rootStats.get(r) || { max: 0, signals: new Set() };
        st.max = Math.max(st.max, score);
        signals.forEach((s) => st.signals.add(s));
        rootStats.set(r, st);
      }
    }
  }

  // Group members by root.
  /** @type {Map<number, number[]>} */
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }

  const clusters = [];
  let idx = 0;
  for (const memberIdx of groups.values()) {
    const members = memberIdx.map((i) => list[i]);
    const root = find(memberIdx[0]);
    const st = rootStats.get(root);

    let confidence;
    let matchedSignals;
    if (members.length === 1) {
      // Singleton: self-evidence only. Confidence reflects identifying richness.
      const p = members[0];
      const hasIdentity = Boolean(p.username || p.name || p.externalId || p.profileUrl);
      confidence = hasIdentity ? 0.5 : 0.1;
      matchedSignals = ['singleton'];
    } else {
      confidence = Math.min(1, (st?.max || 0) / MAX_SCORE);
      matchedSignals = [...(st?.signals || [])];
    }

    clusters.push({
      clusterId: `cluster-${idx++}`,
      confidence: Math.max(0, Math.min(1, confidence)),
      profiles: members,
      matchedSignals,
      primaryProfile: pickPrimary(members),
    });
  }

  // Highest-confidence clusters first for caller ergonomics.
  clusters.sort((a, b) => b.confidence - a.confidence);
  return clusters;
}

/**
 * Pre-fetch avatar perceptual hashes for all unique avatar URLs in profiles.
 *
 * Fetches images in parallel via Promise.allSettled with a ≤3s timeout each,
 * dedupes by URL, and returns a Map<avatarUrl, hash>. Failures return null and
 * are excluded from the map — never throws.
 *
 * @param {Array<Record<string, any>>} profiles
 * @param {object} [options]
 * @param {object} [options.httpClient] — HTTP client with .request(url, {signal})
 * @param {number} [options.timeoutMs=3000] — fetch timeout per avatar
 * @returns {Promise<Map<string, bigint>>}
 */
export async function prefetchAvatarHashes(profiles, options = {}) {
  const map = new Map();
  if (!isAvatarPHashEnabled()) return map;

  const list = Array.isArray(profiles) ? profiles : [];
  // norm() lowercases — but signed CDN URLs are case-sensitive. Fetch the raw
  // URL, key the map by the normalized form that scorePair looks up.
  const urlByNorm = new Map();
  for (const p of list) {
    const raw = String(p?.avatar || '').trim();
    const av = norm(raw);
    if (av && !urlByNorm.has(av)) urlByNorm.set(av, raw);
  }

  // Cap concurrency + per-fetch timeout so a slow CDN can't stall the tool.
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(Number.isFinite(options.concurrency) ? options.concurrency : 8);
  const perFetchTimeout = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? Math.min(options.timeoutMs, 3000)
    : 3000;

  await Promise.allSettled(
    [...urlByNorm.entries()].map(([normKey, rawUrl]) =>
      limit(async () => {
        const res = await fetchAvatarHash(rawUrl, { ...options, timeoutMs: perFetchTimeout });
        if (res) map.set(normKey, res.hash);
      })
    )
  );
  return map;
}

export default { jaroWinkler, scorePair, resolveIdentities, prefetchAvatarHashes, bioPairKey, MERGE_THRESHOLD };
