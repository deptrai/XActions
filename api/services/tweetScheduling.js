// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt
//
// EPS-2 Tweet Scheduling — create entry point.
// Mirrors scheduleFacebookPost (api/services/facebookAutomation.js) validation + dry-run gate,
// but persists to the same Schedule table with platform: 'twitter' and tweet-specific fields
// (thread, timezone, recurrenceCron). Execution is handled by api/services/tweetScheduler.js,
// which reuses postTweet / postThread from src/postComposer.js — do NOT rewrite tweet DOM logic.

import prisma from '../lib/prisma.js';
import cron from 'node-cron';
const MIN_THREAD_LEN = 2;
const MAX_THREAD_LEN = 25;
const MIN_LEAD_MS = 60_000; // scheduledAt must be ≥60s in the future (next cron tick + slack)

/**
 * Validate an IANA timezone name. Returns the canonical name or throws.
 * Intl.supportedValuesOf('timeZone') is available in Node 17+ (XActions requires Node ≥18).
 */
function validateTimezone(timezone) {
  if (timezone === undefined || timezone === null) return null;
  if (typeof timezone !== 'string' || !timezone.trim()) {
    throw new Error('❌ scheduleTweet: timezone must be a non-empty IANA name');
  }
  const supported = Intl.supportedValuesOf?.('timeZone');
  if (Array.isArray(supported)) {
    if (!supported.includes(timezone)) {
      throw new Error(`❌ scheduleTweet: timezone "${timezone}" is not a recognized IANA timezone`);
    }
  } else {
    // Fallback: probe by formatting — throws on an invalid tz.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new Error(`❌ scheduleTweet: timezone "${timezone}" is not a recognized IANA timezone`);
    }
  }
  return timezone;
}

/**
 * Parse a scheduledAt that may be wall-clock in a named timezone into a UTC Date.
 *
 * The caller passes a local datetime string (e.g. "2026-07-01T09:00") plus an IANA tz.
 * We interpret that wall-clock instant in the tz, then return the equivalent UTC Date.
 * If `scheduledAt` already carries an offset/Z (ISO-8601 absolute), the timezone is ignored
 * for parsing (the instant is already absolute) but still stored for display.
 *
 * @param {string|Date} scheduledAt
 * @param {string|null} timezone
 * @returns {Date}
 */
function parseScheduledAt(scheduledAt, timezone) {
  if (scheduledAt instanceof Date) {
    if (isNaN(scheduledAt.getTime())) {
      throw new Error('❌ scheduleTweet: scheduledAt must be a valid ISO-8601 datetime');
    }
    return scheduledAt;
  }

  if (typeof scheduledAt !== 'string' || !scheduledAt.trim()) {
    throw new Error('❌ scheduleTweet: scheduledAt must be a valid ISO-8601 datetime');
  }

  // Absolute ISO-8601 (has Z or offset) → Date parses it directly; tz is display-only.
  const hasOffset = /([zZ]|[+\-]\d{2}:?\d{2})$/.test(scheduledAt);
  if (hasOffset) {
    const d = new Date(scheduledAt);
    if (isNaN(d.getTime())) {
      throw new Error('❌ scheduleTweet: scheduledAt must be a valid ISO-8601 datetime');
    }
    return d;
  }

  // Wall-clock string without offset → interpret in the named tz (default UTC).
  // Build an absolute ISO by computing the tz offset at that wall-clock instant.
  const tz = timezone || 'UTC';
  // Naive wall-clock parts: accept "YYYY-MM-DDTHH:mm[:ss]" or "YYYY-MM-DD HH:mm[:ss]".
  const m = scheduledAt.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) {
    // Fall back to Date parse (some engines accept naive local). If invalid, throw.
    const d = new Date(scheduledAt);
    if (isNaN(d.getTime())) {
      throw new Error('❌ scheduleTweet: scheduledAt must be a valid ISO-8601 datetime');
    }
    return d;
  }
  const [, y, mo, d, h, mi, s] = m;
  const wallClock = `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}`;
  // Compute the offset (minutes) of `tz` at this wall-clock instant by formatting the
  // same instant in the tz and diffing against UTC. Use a probe UTC instant then adjust.
  // Simpler: format a UTC Date constructed from wall-clock parts in the tz and read the offset.
  const probe = new Date(`${wallClock}Z`); // assume UTC first
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(probe);
  const get = (type) => tzParts.find((p) => p.type === type)?.value;
  const tzWall = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  // The difference between the probe (UTC wall-clock) and the tz wall-clock is the offset.
  const probeMs = new Date(`${wallClock}Z`).getTime();
  const tzWallMs = new Date(`${tzWall}Z`).getTime();
  // Standard tz offset (east positive): how far ahead the tz is from UTC at this instant.
  // London in July (BST, +01:00) → tzWall is 1h ahead of probe → offsetMs = +3_600_000.
  const offsetMs = tzWallMs - probeMs; // positive when tz is east of / ahead of UTC
  // Wall-clock "09:00 London" = 09:00 UTC − (+1h offset) = 08:00 UTC.
  return new Date(probeMs - offsetMs);
}

/**
 * Validate the optional thread array. Returns a normalized string[] or null.
 * `content` is the first tweet; `thread` holds the follow-up replies.
 */
function validateThread(thread) {
  if (thread === undefined || thread === null) return null;
  if (!Array.isArray(thread)) {
    throw new Error('❌ scheduleTweet: thread must be an array of non-empty strings');
  }
  if (thread.length < MIN_THREAD_LEN - 1 || thread.length > MAX_THREAD_LEN - 1) {
    // thread[] are the follow-ups; content is tweet #1 → total length = thread.length + 1.
    throw new Error(
      `❌ scheduleTweet: thread must contain between ${MIN_THREAD_LEN - 1} and ${MAX_THREAD_LEN - 1} follow-up tweets (got ${thread.length})`,
    );
  }
  const normalized = thread.map((t, i) => {
    if (typeof t !== 'string' || !t.trim()) {
      throw new Error(`❌ scheduleTweet: thread[${i}] must be a non-empty string`);
    }
    return t;
  });
  return normalized;
}

function validateRecurrence(recurrenceCron) {
  if (recurrenceCron === undefined || recurrenceCron === null) return null;
  if (typeof recurrenceCron !== 'string' || !recurrenceCron.trim()) {
    throw new Error('❌ scheduleTweet: recurrenceCron must be a non-empty cron expression string');
  }
  if (!cron.validate(recurrenceCron)) {
    throw new Error(`❌ scheduleTweet: recurrenceCron "${recurrenceCron}" is not a valid cron expression`);
  }
  return recurrenceCron;
}

/**
 * Schedule a tweet (or thread) for future publishing.
 *
 * DB-only at create time — no browser is launched. The worker
 * (api/services/tweetScheduler.js) acquires a Puppeteer session at execution time
 * and reuses postTweet / postThread from src/postComposer.js.
 *
 * @param {Object} input
 * @param {string} input.content - Tweet text (non-empty). First tweet of a thread.
 * @param {string[]?} input.mediaUrls - Optional media URL list (JSON-stringified on store).
 * @param {string|Date} input.scheduledAt - ISO-8601 datetime, ≥60s in the future.
 * @param {string[]?} input.thread - Follow-up tweet texts (length 1–24; content is tweet #1).
 * @param {string?} input.timezone - IANA tz name to interpret a wall-clock scheduledAt.
 * @param {string?} input.recurrenceCron - node-cron expression; re-arms after execution.
 * @param {number?} input.queueOrder - Queue priority (0 = highest); defaults to 0.
 * @param {Object} options
 * @param {boolean} [options.dryRun=true] - Preview without persisting.
 * @param {string} [options.userId] - Required when dryRun:false — scopes the row.
 * @param {Function} [options.now=Date.now] - Injectable clock for tests.
 * @returns {Promise<Object>}
 */
export async function scheduleTweet(input = {}, options = {}) {
  const {
    content,
    mediaUrls,
    scheduledAt,
    thread,
    timezone,
    recurrenceCron,
    queueOrder,
  } = input;
  const { dryRun = true, userId, now = () => Date.now() } = options;

  // Non-empty content guard — empty content = blank tweet.
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('❌ scheduleTweet: content must be a non-empty string');
  }

  const tz = validateTimezone(timezone);
  const threadNormalized = validateThread(thread);
  const recurrence = validateRecurrence(recurrenceCron);

  const scheduledDate = parseScheduledAt(scheduledAt, tz);
  if (scheduledDate.getTime() < now() + MIN_LEAD_MS) {
    throw new Error('❌ scheduleTweet: scheduledAt must be at least 60 seconds in the future');
  }

  // Strict dry-run gate: anything except explicit `false` stays in dry-run (mirrors runGuardedBatch).
  const isRealRun = dryRun === false;

  if (isRealRun && !userId) {
    throw new Error('❌ scheduleTweet: options.userId is required for dryRun:false');
  }

  // --- dry-run branch: preview only, NO DB write ---
  if (!isRealRun) {
    return {
      dryRun: true,
      platform: 'twitter',
      preview: {
        content,
        thread: threadNormalized,
        mediaUrls: mediaUrls ?? null,
        scheduledAt: scheduledDate.toISOString(),
        timezone: tz,
        recurrenceCron: recurrence,
        willFireAt: scheduledDate.toLocaleString(tz ? 'en-US' : undefined, { timeZone: tz || undefined }),
      },
    };
  }

  // --- real run: persist one Schedule row scoped by userId ---
  const schedule = await prisma.schedule.create({
    data: {
      userId,
      content,
      mediaUrls: mediaUrls ? JSON.stringify(mediaUrls) : null,
      scheduledAt: scheduledDate,
      status: 'pending',
      platform: 'twitter',
      thread: threadNormalized ? JSON.stringify(threadNormalized) : null,
      timezone: tz,
      recurrenceCron: recurrence,
      queueOrder: typeof queueOrder === 'number' ? queueOrder : 0,
    },
  });

  return {
    dryRun: false,
    platform: 'twitter',
    scheduleId: schedule.id,
    scheduledAt: schedule.scheduledAt.toISOString(),
    status: schedule.status,
  };
}
