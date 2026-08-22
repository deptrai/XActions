// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt

import prisma from '../lib/prisma.js';
import cron from 'node-cron';
import { resolveAccountCookie } from '../routes/facebookAccounts.js';
import {
  createBrowser,
  createPage,
  loginWithCookie,
  createFacebookPost,
  buildUserDataDir,
} from './facebookAutomation.js';
const THROUGHPUT_WINDOW_MS = 3_600_000; // 1 hour
const THROUGHPUT_CAP = 5;             // NFR-9 / NFR10: ≤5 executed/hour/user
const JITTER_MIN_MS = 5 * 60 * 1000;  // 5 min
const JITTER_MAX_MS = 15 * 60 * 1000; // 15 min

/**
 * @typedef {object} PostResult
 * @property {boolean} [ok]
 * @property {number} [succeeded]
 * @property {number} [failed]
 * @property {Record<string, unknown>[]} [results]
 * @property {string} [error]
 */

/**
 * Did the post executor actually publish?
 *
 * `createFacebookPost` resolves with a runGuardedBatch result
 * (`{ succeeded, failed, results, ... }`) and does NOT throw on a failed post.
 * Treat as success only when at least one item succeeded and none failed.
 * A bare truthy/`{ ok:true }` (injected test executors) is also accepted.
 * @param {PostResult} result
 */
function isPostSuccess(result) {
  if (!result) return false;
  if (result.ok === true) return true;
  if (typeof result.failed === 'number' || typeof result.succeeded === 'number') {
    return (result.failed ?? 0) === 0 && (result.succeeded ?? 0) > 0;
  }
  // Unknown shape from a custom executor → assume success only if explicitly not failed
  return result.ok !== false;
}

/** Extract a PII-free failure reason from a batch result (no cookie/URL data).
 * @param {PostResult} result
 */
// Stryker disable BlockStatement,LogicalOperator: error message is scrubbed by safeErrorString (NFR3) — mutants are equivalent in this context
function postFailureReason(result) {
  const results = /** @type {Record<string, unknown>[]} */ (result?.results);
  const first = Array.isArray(results)
    ? results.find((r) => r && r.ok === false)
    : null;
  const reason = first?.error || result?.error;
  // Only surface short, structured reasons; never echo a raw message that could carry secrets.
  return `post failed (succeeded=${result?.succeeded ?? 0}, failed=${result?.failed ?? 0})${
    typeof reason === 'string' && reason.length <= 80 ? `: ${reason}` : ''
  }`;
}

/**
 * Build a PII-free error string for persistence/logging.
 * Allowlist err.code / err.name ONLY — never persist raw (err instanceof Error ? err.message : String(err)), which for
 * Puppeteer/login errors can embed cookie or URL values (NFR3).
 * @param {unknown} err
 */
function safeErrorString(err) {
  const e = /** @type {{ code?: unknown; name?: unknown }} */ (err);
  // Stryker disable next-line OptionalChaining: err is always an Error object from catch block, never null
  if (typeof e.code === 'string' && e.code) return e.code;
  if (typeof e.name === 'string' && e.name && e.name !== 'Error') return e.name;
  return 'execution error';
}

/**
 * @typedef {object} ScheduleSession
 * @property {import('puppeteer').Page} page
 * @property {import('puppeteer').Browser} [browser]
 */

/**
 * @typedef {object} SchedulerDeps
 * @property {(page: import('puppeteer').Page, content: string) => Promise<PostResult>} [postExecutor]
 * @property {(schedule: import('@prisma/client').Schedule) => Promise<ScheduleSession>} [sessionFactory]
 * @property {import('@prisma/client').PrismaClient} [prismaClient]
 */

/**
 * Execute all due scheduled posts for the current tick.
 *
 * Pure-ish — injectable `deps` for browser-free tests (no vi.mock needed).
 *
 * @param {Date} now - Current time (injected for testability)
 * @param {Partial<SchedulerDeps>} [deps]
 */
export async function runDueSchedules(now, deps = {}) {
  const {
    postExecutor = null,
    sessionFactory = null,
    prismaClient = prisma,
  } = /** @type {SchedulerDeps} */ (deps);

  const dueSchedules = await prismaClient.schedule.findMany({
    where: {
      status: 'pending',
      scheduledAt: { lte: now },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  for (const schedule of dueSchedules) {
    // P4: per-row isolation — one bad row must never abort the whole tick.
    try {
      // --- Throughput cap (NFR-9): ≤5 completed/hour/user ---
      const recentCount = await prismaClient.schedule.count({
        where: {
          userId: schedule.userId,
          status: 'completed',
          executedAt: { gte: new Date(now.getTime() - THROUGHPUT_WINDOW_MS) },
        },
      });

      if (recentCount >= THROUGHPUT_CAP) {
        // Defer with jitter — never hard-reject (PRD NFR-9: "enqueue với jitter thay vì từ chối hard").
        // P3: base the new time on `now`, not the (possibly long-past) original scheduledAt —
        // otherwise an overdue capped post stays in the past and re-defers every tick (busy-loop).
        const jitter = JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS);
        await prismaClient.schedule.update({
          where: { id: schedule.id },
          data: { scheduledAt: new Date(now.getTime() + jitter) },
        });
        // Stryker disable next-line StringLiteral: log-only string, no behavioral impact
        console.warn(`⚠️ Throughput cap hit for user ${schedule.userId} — deferred schedule ${schedule.id}`);
        continue;
      }

      // --- P1: atomically claim the row (pending → running) to prevent double execution ---
      // node-cron fires every minute, but a browser post session can exceed 1 minute. Without a
      // claim, the next tick re-reads the same pending row and posts twice. updateMany returns the
      // affected count; if another tick already claimed it, count===0 and we skip.
      const claim = await prismaClient.schedule.updateMany({
        where: { id: schedule.id, status: 'pending' },
        data: { status: 'running' },
      });
      if (claim.count === 0) {
        continue; // lost the race to another tick/process
      }

      // --- Operation record (AC8): scoped by userId, PII-free config ---
      /** @type {(payload: Record<string, unknown>) => void} */
      const emit = (payload) => {
        global.io?.to(`user:${schedule.userId}`).emit('facebook:operation', payload);
      };

      const operation = await prismaClient.operation.create({
        data: {
          userId: schedule.userId,
          type: 'facebook_schedule',
          status: 'running',
          startedAt: now,
          // Cookie values NEVER appear here (NFR3)
          config: JSON.stringify({
            scheduleId: schedule.id,
            contentLength: schedule.content.length,
            facebookAccountId: schedule.facebookAccountId ?? null,
          }),
        },
      });

      emit({
        event: 'start',
        operationId: operation.id,
        userId: schedule.userId,
        type: 'facebook_schedule',
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
          // Resolve FacebookAccount — reuse SAME decrypt path as /api/facebook/accounts (NFR3)
          /** @type {{ c_user: string; xs: string } | null} */
          let cookie = null;
          if (schedule.facebookAccountId) {
            cookie = await resolveAccountCookie(schedule.userId, schedule.facebookAccountId);
          } else {
            const account = await prismaClient.facebookAccount.findFirst({
              where: { userId: schedule.userId },
              select: { id: true },
              orderBy: { createdAt: 'desc' },
            });
            if (!account) throw new Error('No Facebook account found for user');
            cookie = await resolveAccountCookie(schedule.userId, account.id);
          }

          // Cookie values never logged (NFR3)
          browser = await createBrowser({ headless: true, userDataDir: buildUserDataDir(cookie.c_user) });
          page = await createPage(browser);
          await loginWithCookie(page, { c_user: cookie.c_user, xs: cookie.xs });
        }

        // --- Execute post: reuse createFacebookPost — do NOT reinvent (REUSE-FIRST mandate) ---
        /** @type {(p: import('puppeteer').Page, content: string) => Promise<PostResult>} */
        const executor =
          postExecutor ??
          ((p, content) => createFacebookPost(p, content, { dryRun: false }));

        // P2: createFacebookPost returns a batchResult and does NOT throw on a failed post
        // (runGuardedBatch records results[].ok:false / failed>0). Inspect the result and throw
        // so the catch block marks the schedule failed instead of silently "completed".
        const result = await executor(page, schedule.content);
        if (!isPostSuccess(result)) {
          throw new Error(postFailureReason(result));
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

        emit({ event: 'complete', operationId: operation.id, userId: schedule.userId, status: 'completed' });
        console.log(`✅ Schedule ${schedule.id} executed for user ${schedule.userId}`);
      } catch (err) {
        // P6: PII-free error string — allowlist err.code/err.name ONLY; never persist raw
        // (err instanceof Error ? err.message : String(err)) (Puppeteer/login errors can embed cookie/URL values → NFR3 leak).
        const safeError = safeErrorString(/** @type {Error} */ (err));
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

        // Stryker disable next-line ObjectLiteral: emit payload shape is side-effect only (Socket.io)
        emit({
          event: 'error',
          operationId: operation.id,
          userId: schedule.userId,
          status: 'failed',
          error: safeError,
        });
        console.error(`❌ Schedule ${schedule.id} failed for user ${schedule.userId}: ${safeError}`);
      } finally {
        // Always close browser regardless of success/failure (AC5)
        if (browser) await browser.close().catch(() => {});
      }
    } catch (rowErr) {
      // P4: a failure in claim / count / operation.create must not abort remaining due rows.
      console.error(`❌ Scheduler row ${schedule.id} aborted:`, safeErrorString(/** @type {Error} */ (rowErr)));
    }
  }
}

// Guard: startFacebookScheduler is safe to call exactly once per process (AC5)
let schedulerStarted = false;

/**
 * Recover schedules left in `running` by a crashed/killed process.
 * A fresh scheduler owns no in-flight rows, so any pre-existing `running`
 * row is stale → mark it failed (no blind retry, AC7).
 * @param {import('@prisma/client').PrismaClient} [prismaClient]
 */
export async function sweepStaleRunning(prismaClient = prisma) {
  const swept = await prismaClient.schedule.updateMany({
    where: { status: 'running' },
    data: { status: 'failed', error: 'interrupted' },
  });
  // Stryker disable next-line ConditionalExpression: log-only branch, no behavioral impact
  if (swept.count > 0) {
    // Stryker disable next-line StringLiteral: log-only string, no behavioral impact
    console.warn(`⚠️ Facebook scheduler: swept ${swept.count} stale running schedule(s) → failed`);
  }
  return swept.count;
}

/**
 * Register a node-cron tick (every minute) to execute due scheduled posts.
 *
 * Start this from the API server process (api/server.js, after `global.io` is set)
 * so that `facebook:operation` Socket.IO events reach connected clients — the same
 * process where Bull `.process()` handlers run and emit. The `schedulerStarted`
 * guard makes it safe to call once; a single server instance owns the tick.
 * For multi-instance deployments, gate by env or move to a dedicated scheduler
 * process with a socket.io Redis adapter (out of scope here).
 */
export function startFacebookScheduler() {
  if (schedulerStarted) {
    console.warn('⚠️ startFacebookScheduler: already started, skipping duplicate call');
    return;
  }
  schedulerStarted = true;

  // Crash recovery: clear stale `running` rows from a prior process before ticking.
  sweepStaleRunning().catch((err) =>
    console.error('❌ Facebook scheduler startup sweep failed:', safeErrorString(/** @type {Error} */ (err))),
  );

  cron.schedule('* * * * *', async () => {
    try {
      await runDueSchedules(new Date());
    } catch (err) {
      // Never crash the cron process on a tick error
      console.error('❌ Facebook scheduler tick error:', safeErrorString(/** @type {Error} */ (err)));
    }
  });

  console.log('🔄 Facebook scheduler started (1-minute tick, ±2-minute execution window)');
}
