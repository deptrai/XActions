// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt

import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { resolveAccountCookie } from '../routes/facebookAccounts.js';
import {
  createBrowser,
  createPage,
  loginWithCookie,
  createFacebookPost,
} from './facebookAutomation.js';

const prisma = new PrismaClient();

const THROUGHPUT_WINDOW_MS = 3_600_000; // 1 hour
const THROUGHPUT_CAP = 5;             // NFR-9 / NFR10: ≤5 executed/hour/user
const JITTER_MIN_MS = 5 * 60 * 1000;  // 5 min
const JITTER_MAX_MS = 15 * 60 * 1000; // 15 min

/**
 * Execute all due scheduled posts for the current tick.
 *
 * Pure-ish — injectable `deps` for browser-free tests (no vi.mock needed).
 *
 * @param {Date} now - Current time (injected for testability)
 * @param {Object} [deps]
 * @param {Function} [deps.postExecutor] - (page, content) => result; defaults to createFacebookPost
 * @param {Function} [deps.sessionFactory] - (schedule) => Promise<{page, browser}>; defaults to real browser flow
 * @param {Object} [deps.prismaClient] - Prisma instance; defaults to module-level singleton
 */
export async function runDueSchedules(now, deps = {}) {
  const {
    postExecutor = null,
    sessionFactory = null,
    prismaClient = prisma,
  } = deps;

  const dueSchedules = await prismaClient.schedule.findMany({
    where: {
      status: 'pending',
      scheduledAt: { lte: now },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  for (const schedule of dueSchedules) {
    // --- Throughput cap (NFR-9): ≤5 completed/hour/user ---
    const recentCount = await prismaClient.schedule.count({
      where: {
        userId: schedule.userId,
        status: 'completed',
        executedAt: { gte: new Date(now.getTime() - THROUGHPUT_WINDOW_MS) },
      },
    });

    if (recentCount >= THROUGHPUT_CAP) {
      // Defer with jitter — never hard-reject (PRD NFR-9: "enqueue với jitter thay vì từ chối hard")
      const jitter = JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS);
      await prismaClient.schedule.update({
        where: { id: schedule.id },
        data: { scheduledAt: new Date(schedule.scheduledAt.getTime() + jitter) },
      });
      console.warn(`⚠️ Throughput cap hit for user ${schedule.userId} — deferred schedule ${schedule.id}`);
      continue;
    }

    // --- Operation record (AC8): scoped by userId, PII-free config ---
    const emit = (payload) =>
      global.io?.to(`user:${schedule.userId}`).emit('facebook:operation', payload);

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

    let browser = null;
    try {
      // --- Acquire session (injectable for tests) ---
      let page;
      if (sessionFactory) {
        const session = await sessionFactory(schedule);
        page = session.page;
        browser = session.browser ?? null;
      } else {
        // Resolve FacebookAccount — reuse SAME decrypt path as /api/facebook/accounts (NFR3)
        let cookie;
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
        browser = await createBrowser({ headless: true });
        page = await createPage(browser);
        await loginWithCookie(page, { c_user: cookie.c_user, xs: cookie.xs });
      }

      // --- Execute post: reuse createFacebookPost — do NOT reinvent (REUSE-FIRST mandate) ---
      const executor =
        postExecutor ??
        ((p, content) => createFacebookPost(p, content, { dryRun: false }));

      await executor(page, schedule.content);

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
      // PII-free error string — cookie values must never appear here (NFR3 / AC7)
      const safeError =
        err?.code || err?.name || (err?.message ?? 'unknown error').slice(0, 200);
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
      console.error(`❌ Schedule ${schedule.id} failed for user ${schedule.userId}: ${safeError}`);
    } finally {
      // Always close browser regardless of success/failure (AC5)
      if (browser) await browser.close().catch(() => {});
    }
  }
}

// Guard: startFacebookScheduler is safe to call exactly once per process (AC5)
let schedulerStarted = false;

/**
 * Register a node-cron tick (every minute) to execute due scheduled posts.
 *
 * IMPORTANT: Call this from the worker entry (`npm run worker` / jobQueue.js) ONLY —
 * NOT from api/server.js — to avoid double-firing. Guard with ENABLE_FB_SCHEDULER
 * env flag if there is any risk of both processes starting this.
 */
export function startFacebookScheduler() {
  if (schedulerStarted) {
    console.warn('⚠️ startFacebookScheduler: already started, skipping duplicate call');
    return;
  }
  schedulerStarted = true;

  cron.schedule('* * * * *', async () => {
    try {
      await runDueSchedules(new Date());
    } catch (err) {
      // Never crash the cron process on a tick error
      console.error('❌ Facebook scheduler tick error:', err?.code || err?.name || 'unknown');
    }
  });

  console.log('🔄 Facebook scheduler started (1-minute tick, ±2-minute execution window)');
}
