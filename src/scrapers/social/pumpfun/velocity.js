// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Comment velocity — time-delta interpolation over the most recent reply
 * sample. A single ≤50-reply page is consumed; no pagination (rate-limit safe).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

const MINUTE_MS = 60 * 1000;

/**
 * Extract a millisecond timestamp from a reply object. Tries common field
 * names then falls back to parsing created/timestamp-like values.
 * @param {Record<string, unknown>} reply
 * @returns {number | null}
 */
function replyTimestamp(reply) {
  if (!reply || typeof reply !== 'object') return null;
  const candidates = [
    reply.timestamp,
    reply.created_at,
    reply.createdAt,
    reply.created_timestamp,
    reply.ts,
    reply.time,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const n = typeof c === 'number' ? c : Date.parse(String(c));
    if (Number.isFinite(n)) {
      // Seconds → ms heuristic.
      return n < 1e12 ? n * 1000 : n;
    }
  }
  return null;
}

/**
 * Compute comment velocity from a reply sample.
 *
 * @param {Array<Record<string, unknown>>} replies - newest-first reply sample (≤50).
 * @param {number} [nowMs] - reference "now" (injectable for tests).
 * @returns {{ last1m: number, last5m: number, sampleSize: number }}
 */
export function computeCommentVelocity(replies, nowMs = Date.now()) {
  const list = Array.isArray(replies) ? replies : [];
  const timestamps = list
    .map(replyTimestamp)
    .filter((t) => typeof t === 'number' && Number.isFinite(t))
    .sort((a, b) => b - a); // newest first

  const sampleSize = timestamps.length;
  if (sampleSize === 0) {
    return { last1m: 0, last5m: 0, sampleSize: 0 };
  }

  const countWithin = (windowMs) => timestamps.filter((t) => nowMs - t <= windowMs).length;

  const in1m = countWithin(MINUTE_MS);
  const in5m = countWithin(5 * MINUTE_MS);

  // last1m = comments per minute over the last minute. last5m = comments per
  // minute averaged over the last 5 minutes.
  const last1m = in1m;
  const last5m = in5m / 5;

  return {
    last1m: Math.round(last1m * 100) / 100,
    last5m: Math.round(last5m * 100) / 100,
    sampleSize,
  };
}

export default computeCommentVelocity;
