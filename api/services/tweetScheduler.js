// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt
//
// EPS-2 Tweet Scheduling — scheduler worker.
// Mirrors api/services/facebookScheduler.js: 1-minute node-cron tick, per-user throughput
// cap (≤5 completed/hour, NFR-9/NFR10) with jitter deferral, atomic pending→running claim,
// stale-running sweep on startup, PII-free error strings, Operation linkage, Socket.IO emit.
//
// Differences from the Facebook worker:
//  - filters Schedule by platform: 'twitter'
//  - authenticates with the user's Twitter `sessionCookie` (auth_token) via the twitter
//    scraper login flow (src/scrapers/twitter/index.js), NOT a FacebookAccount cookie
//  - executes via postTweet / postThread from src/postComposer.js (reuse-first — do NOT
//    rewrite tweet DOM logic)
//  - re-arms recurring schedules (recurrenceCron) after a successful execution

import prisma from '../lib/prisma.js';
import cron from 'node-cron';
import { postTweet, postThread } from '../../src/postComposer.js';
import { createBrowser, createPage, loginWithCookie } from '../../src/scrapers/twitter/index.js';
const THROUGHPUT_WINDOW_MS = 3_600_000; // 1 hour
const THROUGHPUT_CAP = 5;               // NFR-9 / NFR10: ≤5 executed/hour/user
const JITTER_MIN_MS = 5 * 60 * 1000;    // 5 min
const JITTER_MAX_MS = 15 * 60 * 1000;   // 15 min

/**
 * @typedef {object} TweetResult
 * @property {boolean} [success]
 * @property {string} [error]
 */

/**
 * @typedef {object} ScheduleSession
 * @property {import('puppeteer').Page} page
 * @property {import('puppeteer').Browser} [browser]
 */

/**
 * @typedef {object} SchedulerDeps
 * @property {(page: import('puppeteer').Page, schedule: import('@prisma/client').Schedule) => Promise<TweetResult>} [postExecutor]
 * @property {(schedule: import('@prisma/client').Schedule) => Promise<ScheduleSession>} [sessionFactory]
 * @property {import('@prisma/client').PrismaClient} [prismaClient]
 */

/**
 * Did the tweet executor actually publish?
 * postTweet / postThread resolve with `{ success: boolean, ... }` and do NOT throw on a
 * failed post (e.g. composer not found). Treat success:true as the only success signal.
 * A bare truthy result without `success` is treated as failure (defensive — never silently
 * mark a row completed when we cannot confirm the post landed).
 * @param {TweetResult} result
 */
function isTweetSuccess(result) {
  return !!result && result.success === true;
}

/** Extract a PII-free failure reason from a tweet result (no cookie/URL data).
 * @param {TweetResult} result
 */
function tweetFailureReason(result) {
  const reason = result?.error;
  return `tweet failed (success=${result?.success ?? false})${
    typeof reason === 'string' && reason.length <= 80 ? `: ${reason}` : ''
  }`;
}

/**
 * Build a PII-free error string for persistence/logging.
 * Allowlist err.code / err.name ONLY — never persist raw (err instanceof Error ? err.message : String(err)), which for
 * Puppeteer/login errors on x.com can embed the auth_token cookie value (NFR3).
 * @param {unknown} err
 */
function safeErrorString(err) {
  const e = /** @type {{ code?: unknown; name?: unknown }} */ (err);
  if (typeof e.code === 'string' && e.code) return e.code;
  if (typeof e.name === 'string' && e.name && e.name !== 'Error') return e.name;
  return 'execution error';
}

/**
 * Compute the next fire time for a recurring schedule.
 * Uses node-cron's internal parser via a transient schedule + a manual next-at computation.
 * Falls back to now + 1 hour if the expression cannot be advanced.
 * @param {string} recurrenceCron
 * @param {number} fromMs
 */
function nextRecurrenceAt(recurrenceCron, fromMs) {
  if (!recurrenceCron || !cron.validate(recurrenceCron)) return null;
  // node-cron does not expose a public "next run" API. Compute by scanning forward minute
  // by minute up to 24h — cheap and deterministic for valid cron expressions.
  const start = Math.ceil(fromMs / 60000) * 60000; // next minute boundary
  for (let t = start + 60000; t <= start + 24 * 3_600_000; t += 60000) {
    const d = new Date(t);
    const minute = d.getMinutes();
    const hour = d.getHours();
    const dom = d.getDate();
    const month = d.getMonth() + 1;
    const dow = d.getDay();
    if (cronPartMatches(recurrenceCron, 0, minute) &&
        cronPartMatches(recurrenceCron, 1, hour) &&
        cronPartMatches(recurrenceCron, 2, dom) &&
        cronPartMatches(recurrenceCron, 3, month) &&
        cronPartMatches(recurrenceCron, 4, dow)) {
      return new Date(t);
    }
  }
  return new Date(fromMs + 3_600_000); // fallback: +1h
}

// Check a single cron field against a value, handling *, */n, lists, and ranges.
/**
 * @param {string} expr
 * @param {number} fieldIndex
 * @param {number} value
 */
function cronPartMatches(expr, fieldIndex, value) {
  const part = expr.trim().split(/\s+/)[fieldIndex];
  if (!part) return fieldIndex >= 5; // 5-field cron: dow is last
  if (part === '*') return true;
  for (const token of part.split(',')) {
    if (token === '*') return true;
    if (token.startsWith('*/')) {
      const step = Number(token.slice(2));
      if (step > 0 && value % step === 0) return true;
      continue;
    }
    if (token.includes('-')) {
      const [lo, hi] = token.split('-').map(Number);
      if (value >= lo && value <= hi) return true;
      continue;
    }
    if (token.includes('/')) {
      const [base, step] = token.split('/').map(Number);
      if (step > 0 && value >= base && (value - base) % step === 0) return true;
      continue;
    }
    if (Number(token) === value) return true;
  }
  return false;
}

/**
 * Execute all due scheduled tweets for the current tick.
 *
 * Pure-ish — injectable `deps` for browser-free tests (no vi.mock needed).
 *
 * @param {Date} now - Current time (injected for testability)
 * @param {Partial<SchedulerDeps>} [deps]
 */
export async function runDueTweets(now, deps = {}) {
  const {
    postExecutor = null,
    sessionFactory = null,
    prismaClient = prisma,
  } = /** @type {SchedulerDeps} */ (deps);

  const dueSchedules = await prismaClient.schedule.findMany({
    where: {
      platform: 'twitter',
      status: 'pending',
      scheduledAt: { lte: now },
    },
    orderBy: [{ queueOrder: 'asc' }, { scheduledAt: 'asc' }],
  });

  for (const schedule of dueSchedules) {
    // Per-row isolation — one bad row must never abort the whole tick.
    try {
      // --- Throughput cap (NFR-9): ≤5 completed/hour/user ---
      const recentCount = await prismaClient.schedule.count({
        where: {
          userId: schedule.userId,
          platform: 'twitter',
          status: 'completed',
          executedAt: { gte: new Date(now.getTime() - THROUGHPUT_WINDOW_MS) },
        },
      });

      if (recentCount >= THROUGHPUT_CAP) {
        // Defer with jitter — never hard-reject. Base the new time on `now`, not the original
        // scheduledAt, otherwise an overdue capped post stays in the past and re-defers every
        // tick (busy-loop).
        const jitter = JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS);
        await prismaClient.schedule.update({
          where: { id: schedule.id },
          data: { scheduledAt: new Date(now.getTime() + jitter) },
        });
        console.warn(`⚠️ Tweet throughput cap hit for user ${schedule.userId} — deferred schedule ${schedule.id}`);
        continue;
      }

      // --- Atomic claim (pending → running) to prevent double execution ---
      const claim = await prismaClient.schedule.updateMany({
        where: { id: schedule.id, status: 'pending' },
        data: { status: 'running' },
      });
      if (claim.count === 0) {
        continue; // lost the race to another tick/process
      }

      // --- Operation record: scoped by userId, PII-free config ---
      /** @type {(payload: Record<string, unknown>) => void} */
      const emit = (payload) => {
        global.io?.to(`user:${schedule.userId}`).emit('tweet:operation', payload);
      };

      const operation = await prismaClient.operation.create({
        data: {
          userId: schedule.userId,
          type: 'tweet_schedule',
          status: 'running',
          startedAt: now,
          config: JSON.stringify({
            scheduleId: schedule.id,
            contentLength: schedule.content.length,
            isThread: !!schedule.thread,
            threadLength: schedule.thread ? JSON.parse(schedule.thread).length + 1 : 1,
            recurring: !!schedule.recurrenceCron,
          }),
        },
      });

      emit({
        event: 'start',
        operationId: operation.id,
        userId: schedule.userId,
        type: 'tweet_schedule',
        status: 'running',
      });

      /** @type {import('puppeteer').Browser | null} */
      let browser = null;
      try {
        // --- Acquire session (injectable for tests) ---
        /** @type {import('puppeteer').Page} */
        let page;
        if (sessionFactory) {
          const session = await sessionFactory(schedule);
          page = session.page;
          browser = session.browser ?? null;
        } else {
          const user = await prismaClient.user.findUnique({
            where: { id: schedule.userId },
            select: { sessionCookie: true, twitterAccessToken: true },
          });
          if (!user || (!user.sessionCookie && !user.twitterAccessToken)) {
            throw new Error('No Twitter session found for user');
          }
          if (!user.sessionCookie) {
            // OAuth access-token posting is out of scope for the browser-automation worker;
            // surface a clear, PII-free error so the row is marked failed (not silently skipped).
            throw new Error('OAuth-only account — sessionCookie required for scheduled tweets');
          }
          // Cookie values never logged (NFR3)
          browser = await createBrowser({ headless: true });
          page = await createPage(browser);
          await loginWithCookie(page, user.sessionCookie);
        }

        // --- Execute: reuse postTweet / postThread — do NOT reinvent ---
        /** @type {(p: import('puppeteer').Page, sched: import('@prisma/client').Schedule) => Promise<TweetResult>} */
        const executor = postExecutor ?? ((p, sched) => {
          const threadArr = sched.thread ? JSON.parse(/** @type {string} */ (sched.thread)) : null;
          if (threadArr && Array.isArray(threadArr) && threadArr.length > 0) {
            return /** @type {Promise<TweetResult>} */ (postThread(p, [sched.content, ...threadArr]));
          }
          return /** @type {Promise<TweetResult>} */ (postTweet(p, sched.content));
        });

        const result = await executor(page, schedule);
        if (!isTweetSuccess(result)) {
          throw new Error(tweetFailureReason(result));
        }

        const executedAt = new Date();
        await prismaClient.schedule.update({
          where: { id: schedule.id },
          data: { status: 'completed', executedAt, operationId: operation.id },
        });
        await prismaClient.operation.update({
          where: { id: operation.id },
          data: {
            status: 'completed',
            completedAt: executedAt,
            result: JSON.stringify({ scheduleId: schedule.id }),
          },
        });

        // --- Re-arm recurring schedule ---
        if (schedule.recurrenceCron) {
          const nextAt = nextRecurrenceAt(schedule.recurrenceCron, executedAt.getTime());
          if (nextAt) {
            await prismaClient.schedule.create({
              data: {
                userId: schedule.userId,
                content: schedule.content,
                mediaUrls: schedule.mediaUrls,
                scheduledAt: nextAt,
                status: 'pending',
                platform: 'twitter',
                thread: schedule.thread,
                timezone: schedule.timezone,
                recurrenceCron: schedule.recurrenceCron,
                queueOrder: schedule.queueOrder,
              },
            });
          }
        }

        emit({ event: 'complete', operationId: operation.id, userId: schedule.userId, status: 'completed' });
        console.log(`✅ Tweet schedule ${schedule.id} executed for user ${schedule.userId}`);
      } catch (err) {
        const safeError = safeErrorString(err);
        const executedAt = new Date();

        // status:failed + no retry — next tick's pending filter excludes this schedule (AC7)
        await prismaClient.schedule.update({
          where: { id: schedule.id },
          data: { status: 'failed', executedAt, error: safeError, operationId: operation.id },
        });
        await prismaClient.operation.update({
          where: { id: operation.id },
          data: { status: 'failed', completedAt: executedAt, error: safeError },
        });

        emit({
          event: 'error',
          operationId: operation.id,
          userId: schedule.userId,
          status: 'failed',
          error: safeError,
        });
        console.error(`❌ Tweet schedule ${schedule.id} failed for user ${schedule.userId}: ${safeError}`);
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    } catch (rowErr) {
      console.error(`❌ Tweet scheduler row ${schedule.id} aborted:`, safeErrorString(rowErr));
    }
  }
}

// Guard: startTweetScheduler is safe to call exactly once per process
let schedulerStarted = false;

/**
 * Recover schedules left in `running` by a crashed/killed process.
 * A fresh scheduler owns no in-flight rows, so any pre-existing `running`
 * row is stale → mark it failed (no blind retry).
 * @param {import('@prisma/client').PrismaClient} [prismaClient]
 */
export async function sweepStaleRunningTweets(prismaClient = prisma) {
  const swept = await prismaClient.schedule.updateMany({
    where: { platform: 'twitter', status: 'running' },
    data: { status: 'failed', error: 'interrupted' },
  });
  if (swept.count > 0) {
    console.warn(`⚠️ Tweet scheduler: swept ${swept.count} stale running schedule(s) → failed`);
  }
  return swept.count;
}

/**
 * Register a node-cron tick (every minute) to execute due scheduled tweets.
 * Start from the API server process (api/server.js, after `global.io` is set) so that
 * `tweet:operation` Socket.IO events reach connected clients. The `schedulerStarted` guard
 * makes it safe to call once; a single server instance owns the tick.
 */
export function startTweetScheduler() {
  if (schedulerStarted) {
    console.warn('⚠️ startTweetScheduler: already started, skipping duplicate call');
    return;
  }
  schedulerStarted = true;

  sweepStaleRunningTweets().catch((err) =>
    console.error('❌ Tweet scheduler startup sweep failed:', safeErrorString(err)),
  );

  cron.schedule('* * * * *', async () => {
    try {
      await runDueTweets(new Date());
    } catch (err) {
      console.error('❌ Tweet scheduler tick error:', safeErrorString(err));
    }
  });

  console.log('🔄 Tweet scheduler started (1-minute tick, ±2-minute execution window)');
}

export { safeErrorString, isTweetSuccess, nextRecurrenceAt };
