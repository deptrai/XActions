// by nichxbt
// Tests for EPS-2: scheduleTweet + runDueTweets
// Browser-free: inject a fake page + post executor seam. No vi.mock per project mandate.
// Mirrors tests/services/facebook-schedule.test.js, adapted to the tweet worker's
// postTweet/postThread result shape ({ success: boolean, ... }) and tweet-specific
// fields (thread, timezone, recurrenceCron, queueOrder, platform discriminator).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scheduleTweet } from '../../api/services/tweetScheduling.js';
import { runDueTweets, sweepStaleRunningTweets } from '../../api/services/tweetScheduler.js';

const prisma = new PrismaClient();

// ── Test user seeded once per suite ──────────────────────────────────────────

const TEST_USER = {
  id: 'test-user-tweet-sched-eps2',
  username: 'tweet_sched_test_user',
  email: 'tweet_sched@example.com',
};

async function seedUser() {
  await prisma.user.upsert({
    where: { id: TEST_USER.id },
    update: {},
    create: { ...TEST_USER, credits: 0 },
  });
}

async function cleanSchedules() {
  await prisma.schedule.deleteMany({ where: { userId: TEST_USER.id } });
  await prisma.operation.deleteMany({ where: { userId: TEST_USER.id } });
}

// Fake page — signals to the scheduler's sessionFactory that no browser is needed
const fakePage = { _fake: true };

// Injectable sessionFactory: returns a fake page, no real browser
const fakeSessionFactory = async () => ({ page: fakePage, browser: null });

// Injectable postExecutor mirroring postTweet / postThread's REAL return shape:
//   mode 'success' → { success: true, text, timestamp }
//   mode 'fail'    → { success: false, error }  (NO throw — like a real composer-not-found)
//   mode 'throw'   → throws (session/login style error)
// Records calls so tests can assert execution count and the schedule payload.
function makePostExecutor(mode = 'success', { error } = {}) {
  const calls = [];
  const executor = async (page, schedule) => {
    calls.push({ page, schedule });
    if (mode === 'throw') throw new Error('Simulated tweet failure');
    if (mode === 'fail') {
      return { success: false, error: error ?? 'composer not found' };
    }
    return { success: true, text: schedule.content.slice(0, 100), timestamp: new Date().toISOString() };
  };
  executor.calls = calls;
  return executor;
}

// Fixed reference time for deterministic create-side tests (injectable clock)
const FIXED_NOW = new Date('2026-06-01T12:00:00.000Z').getTime();
const fixedNow = () => FIXED_NOW;

// Future datetime helper — at least 120s ahead of FIXED_NOW so create-side tests don't flap
const futureDate = (offsetMs = 120_000) => new Date(FIXED_NOW + offsetMs).toISOString();

// ── scheduleTweet ────────────────────────────────────────────────────────────

describe('scheduleTweet', () => {
  beforeEach(async () => {
    await seedUser();
    await cleanSchedules();
  });

  afterEach(async () => {
    await cleanSchedules();
  });

  it('dry-run: returns preview with willFireAt, creates ZERO Schedule rows', async () => {
    const scheduledAt = futureDate();
    const result = await scheduleTweet(
      { content: 'Hello world', scheduledAt },
      { dryRun: true, now: fixedNow },
    );

    expect(result.dryRun).toBe(true);
    expect(result.platform).toBe('twitter');
    expect(result.preview.content).toBe('Hello world');
    expect(result.preview.scheduledAt).toBe(new Date(scheduledAt).toISOString());
    expect(result.preview.willFireAt).toBeTruthy();
    expect(result.preview.mediaUrls).toBeNull();
    expect(result.preview.thread).toBeNull();
    expect(result.preview.timezone).toBeNull();
    expect(result.preview.recurrenceCron).toBeNull();

    const count = await prisma.schedule.count({ where: { userId: TEST_USER.id } });
    expect(count).toBe(0);
  });

  it('dry-run: default when dryRun is not set', async () => {
    const result = await scheduleTweet(
      { content: 'No explicit dryRun', scheduledAt: futureDate() },
      { now: fixedNow },
    );
    expect(result.dryRun).toBe(true);
    const count = await prisma.schedule.count({ where: { userId: TEST_USER.id } });
    expect(count).toBe(0);
  });

  it('dryRun:false creates exactly one pending Schedule row scoped to userId with platform twitter', async () => {
    const scheduledAt = futureDate();
    const result = await scheduleTweet(
      { content: 'Real schedule', scheduledAt },
      { dryRun: false, userId: TEST_USER.id, now: fixedNow },
    );

    expect(result.dryRun).toBe(false);
    expect(result.platform).toBe('twitter');
    expect(result.scheduleId).toBeTruthy();
    expect(result.status).toBe('pending');

    const rows = await prisma.schedule.findMany({ where: { userId: TEST_USER.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(result.scheduleId);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].userId).toBe(TEST_USER.id);
    expect(rows[0].platform).toBe('twitter');
  });

  it('empty content throws before any DB write', async () => {
    await expect(
      scheduleTweet({ content: '   ', scheduledAt: futureDate() }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('content must be a non-empty string');

    const count = await prisma.schedule.count({ where: { userId: TEST_USER.id } });
    expect(count).toBe(0);
  });

  it('past scheduledAt throws', async () => {
    const past = new Date(FIXED_NOW - 10_000).toISOString();
    await expect(
      scheduleTweet({ content: 'Late tweet', scheduledAt: past }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('scheduledAt must be at least 60 seconds in the future');
  });

  it('scheduledAt within 60s throws', async () => {
    const soon = new Date(FIXED_NOW + 30_000).toISOString();
    await expect(
      scheduleTweet({ content: 'Too soon', scheduledAt: soon }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('scheduledAt must be at least 60 seconds in the future');
  });

  it('missing userId on dryRun:false throws without creating a row', async () => {
    await expect(
      scheduleTweet({ content: 'Unscoped', scheduledAt: futureDate() }, { dryRun: false, now: fixedNow }),
    ).rejects.toThrow('options.userId is required');

    const count = await prisma.schedule.count({ where: { userId: TEST_USER.id } });
    expect(count).toBe(0);
  });

  it('thread: validates length and persists JSON-stringified follow-ups', async () => {
    const result = await scheduleTweet(
      { content: 'Thread opener', scheduledAt: futureDate(), thread: ['Reply 1', 'Reply 2'] },
      { dryRun: false, userId: TEST_USER.id, now: fixedNow },
    );
    expect(result.dryRun).toBe(false);

    const row = await prisma.schedule.findUnique({ where: { id: result.scheduleId } });
    expect(row.thread).toBe(JSON.stringify(['Reply 1', 'Reply 2']));
  });

  it('thread: too few follow-ups throws (need ≥1 for a 2-tweet thread)', async () => {
    await expect(
      scheduleTweet({ content: 'Solo', scheduledAt: futureDate(), thread: [] }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('thread must contain between 1 and 24 follow-up tweets');
  });

  it('thread: too many follow-ups throws (max 24 → 25 total)', async () => {
    const tooMany = Array.from({ length: 25 }, (_, i) => `r${i}`);
    await expect(
      scheduleTweet({ content: 'Opener', scheduledAt: futureDate(), thread: tooMany }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('thread must contain between 1 and 24 follow-up tweets');
  });

  it('thread: empty entry throws', async () => {
    await expect(
      scheduleTweet({ content: 'Opener', scheduledAt: futureDate(), thread: ['  '] }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('thread[0] must be a non-empty string');
  });

  it('timezone: invalid IANA name throws', async () => {
    await expect(
      scheduleTweet({ content: 'TZ test', scheduledAt: futureDate(), timezone: 'Not/A/Timezone' }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('is not a recognized IANA timezone');
  });

  it('timezone: valid IANA name is stored and wall-clock scheduledAt is interpreted in that tz', async () => {
    // 09:00 London (BST, +01:00) = 08:00 UTC on 2026-07-01.
    const result = await scheduleTweet(
      { content: 'TZ test', scheduledAt: '2026-07-01T09:00', timezone: 'Europe/London' },
      { dryRun: false, userId: TEST_USER.id, now: fixedNow },
    );
    const row = await prisma.schedule.findUnique({ where: { id: result.scheduleId } });
    expect(row.timezone).toBe('Europe/London');
    // 08:00 UTC == 09:00 BST
    expect(row.scheduledAt.toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });

  it('recurrenceCron: invalid expression throws', async () => {
    await expect(
      scheduleTweet({ content: 'Recur test', scheduledAt: futureDate(), recurrenceCron: 'not a cron' }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('is not a valid cron expression');
  });

  it('recurrenceCron: valid expression is stored', async () => {
    const result = await scheduleTweet(
      { content: 'Recur test', scheduledAt: futureDate(), recurrenceCron: '0 9 * * *' },
      { dryRun: false, userId: TEST_USER.id, now: fixedNow },
    );
    const row = await prisma.schedule.findUnique({ where: { id: result.scheduleId } });
    expect(row.recurrenceCron).toBe('0 9 * * *');
  });

  it('queueOrder: persisted when provided, defaults to 0', async () => {
    const r1 = await scheduleTweet(
      { content: 'High priority', scheduledAt: futureDate(), queueOrder: 5 },
      { dryRun: false, userId: TEST_USER.id, now: fixedNow },
    );
    const r2 = await scheduleTweet(
      { content: 'Default priority', scheduledAt: futureDate() },
      { dryRun: false, userId: TEST_USER.id, now: fixedNow },
    );
    const row1 = await prisma.schedule.findUnique({ where: { id: r1.scheduleId } });
    const row2 = await prisma.schedule.findUnique({ where: { id: r2.scheduleId } });
    expect(row1.queueOrder).toBe(5);
    expect(row2.queueOrder).toBe(0);
  });
});

// ── runDueTweets ─────────────────────────────────────────────────────────────

describe('runDueTweets', () => {
  beforeEach(async () => {
    await seedUser();
    await cleanSchedules();
  });

  afterEach(async () => {
    await cleanSchedules();
  });

  async function createDueSchedule(overrides = {}) {
    return prisma.schedule.create({
      data: {
        userId: TEST_USER.id,
        content: 'Test tweet content',
        scheduledAt: new Date(Date.now() - 5000), // 5s in past = due (real clock for DB query)
        status: 'pending',
        platform: 'twitter',
        ...overrides,
      },
    });
  }

  it('due pending schedule transitions to completed', async () => {
    const schedule = await createDueSchedule();
    const executor = makePostExecutor();

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('completed');
    expect(updated.executedAt).toBeTruthy();
    expect(updated.operationId).toBeTruthy();
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].schedule.content).toBe('Test tweet content');
    expect(executor.calls[0].page).toBe(fakePage);
  });

  it('throwing executor transitions schedule to failed, not retried on next tick', async () => {
    const schedule = await createDueSchedule();
    const failingExecutor = makePostExecutor('throw');

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: failingExecutor,
    });

    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
    expect(updated.error).toBeTruthy();
    expect(updated.executedAt).toBeTruthy();

    // Second tick: failed schedule must NOT be retried (filtered by status:pending query)
    const executor2 = makePostExecutor();
    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor2,
    });
    expect(executor2.calls).toHaveLength(0);
  });

  it('post that returns a failure result (success:false, no throw) is marked failed, not completed', async () => {
    // postTweet resolves with { success:false } instead of throwing; the worker must inspect
    // the result and NOT record the schedule as completed (defensive success detection).
    const schedule = await createDueSchedule();
    const failResultExecutor = makePostExecutor('fail');

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: failResultExecutor,
    });

    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(failResultExecutor.calls).toHaveLength(1);
    expect(updated.status).toBe('failed');
    expect(updated.executedAt).toBeTruthy();

    const op = await prisma.operation.findUnique({ where: { id: updated.operationId } });
    expect(op.status).toBe('failed');
  });

  it('throughput cap: 6th due schedule is deferred (not executed, not failed)', async () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000 + 60_000); // within the 1h window

    // Seed 5 completed twitter schedules in the last hour
    for (let i = 0; i < 5; i++) {
      await prisma.schedule.create({
        data: {
          userId: TEST_USER.id,
          content: `Completed tweet ${i}`,
          scheduledAt: oneHourAgo,
          status: 'completed',
          executedAt: oneHourAgo,
          platform: 'twitter',
        },
      });
    }

    const sixth = await createDueSchedule({ content: 'Sixth tweet — should defer' });
    const executor = makePostExecutor();

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    const updated = await prisma.schedule.findUnique({ where: { id: sixth.id } });
    // Must be deferred (scheduledAt pushed forward 5–15min), not executed, not failed
    expect(updated.status).toBe('pending');
    expect(updated.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(executor.calls).toHaveLength(0);
  });

  it('throughput cap counts only twitter completed rows (facebook completions do not count)', async () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000 + 60_000);

    // 5 completed FACEBOOK schedules — must NOT count against the tweet cap
    for (let i = 0; i < 5; i++) {
      await prisma.schedule.create({
        data: {
          userId: TEST_USER.id,
          content: `Completed FB post ${i}`,
          scheduledAt: oneHourAgo,
          status: 'completed',
          executedAt: oneHourAgo,
          platform: 'facebook',
        },
      });
    }

    const tweet = await createDueSchedule({ content: 'Tweet — should still execute' });
    const executor = makePostExecutor();

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    const updated = await prisma.schedule.findUnique({ where: { id: tweet.id } });
    expect(updated.status).toBe('completed');
    expect(executor.calls).toHaveLength(1);
  });

  it('creates an Operation record linked to the Schedule on success', async () => {
    const schedule = await createDueSchedule();
    const executor = makePostExecutor();

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    const op = await prisma.operation.findUnique({ where: { id: updated.operationId } });
    expect(op).toBeTruthy();
    expect(op.type).toBe('tweet_schedule');
    expect(op.status).toBe('completed');
    expect(op.userId).toBe(TEST_USER.id);
  });

  it('NFR3: a cookie value carried in an error message never reaches a persisted field', async () => {
    // Real risk: Puppeteer/login errors embed cookie/URL data in err.message. Put the
    // secret into the execution scope via a throwing executor, then assert safeErrorString
    // scrubbed it from every persisted field (Schedule.error / Operation.error/config/result).
    const FAKE_COOKIE_VALUE = 'FAKE_AUTH_TOKEN_DO_NOT_PERSIST_abc123xyz';
    const schedule = await createDueSchedule({ content: 'Cookie audit test' });

    const leakyExecutor = async () => {
      // A plain Error whose message embeds the secret — code/name are the only safe fields.
      throw new Error(`Protocol error Network.setCookie failed for auth_token=${FAKE_COOKIE_VALUE}`);
    };

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: leakyExecutor,
    });

    const updatedSchedule = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updatedSchedule.status).toBe('failed'); // confirms the error path actually ran
    const op = updatedSchedule.operationId
      ? await prisma.operation.findUnique({ where: { id: updatedSchedule.operationId } })
      : null;

    const allPersistedStrings = [
      updatedSchedule.content,
      updatedSchedule.error ?? '',
      updatedSchedule.mediaUrls ?? '',
      updatedSchedule.thread ?? '',
      op?.config ?? '',
      op?.result ?? '',
      op?.error ?? '',
    ].join('\n');

    expect(allPersistedStrings).not.toContain(FAKE_COOKIE_VALUE);
  });

  it('claims the row atomically — a concurrent tick does not double-execute', async () => {
    // Two overlapping ticks reading the same due row must result in exactly one execution.
    const schedule = await createDueSchedule({ content: 'Double-exec guard' });
    const executor = makePostExecutor();

    await Promise.all([
      runDueTweets(new Date(), { prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: executor }),
      runDueTweets(new Date(), { prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: executor }),
    ]);

    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('completed');
    // The pending→running claim must let only ONE tick execute the post.
    expect(executor.calls).toHaveLength(1);
  });

  it('thread schedule: executor receives the full thread and completes', async () => {
    const schedule = await createDueSchedule({
      content: 'Thread opener',
      thread: JSON.stringify(['Reply 1', 'Reply 2']),
    });
    const executor = makePostExecutor();

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].schedule.thread).toBe(JSON.stringify(['Reply 1', 'Reply 2']));
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('completed');
  });

  it('recurrenceCron: a successful recurring schedule re-arms a new pending row', async () => {
    // Schedule due now with a daily 09:00 recurrence. After execution, a new pending
    // row should exist for the next 09:00 (within 24h).
    const schedule = await createDueSchedule({
      content: 'Recurring tweet',
      recurrenceCron: '0 9 * * *',
    });
    const executor = makePostExecutor();

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    const original = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(original.status).toBe('completed');

    // A new pending row should exist for the same user, content, and recurrence.
    const reArmed = await prisma.schedule.findFirst({
      where: {
        userId: TEST_USER.id,
        status: 'pending',
        recurrenceCron: '0 9 * * *',
        content: 'Recurring tweet',
      },
    });
    expect(reArmed).toBeTruthy();
    expect(reArmed.id).not.toBe(schedule.id);
    // Next fire should be within 24h of now.
    expect(reArmed.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect(reArmed.scheduledAt.getTime()).toBeLessThan(Date.now() + 25 * 3_600_000);
  });

  it('queueOrder: lower queueOrder executes first when both are due', async () => {
    // Two due schedules; the one with queueOrder 0 should be claimed first. Because the
    // worker processes rows sequentially and the executor is synchronous-ish, we verify
    // both complete and the call order matches queueOrder ordering.
    const a = await createDueSchedule({ content: 'A-queueOrder5', queueOrder: 5 });
    const b = await createDueSchedule({ content: 'B-queueOrder0', queueOrder: 0 });
    const executor = makePostExecutor();

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    expect(executor.calls).toHaveLength(2);
    // queueOrder 0 (B) should be processed before queueOrder 5 (A)
    expect(executor.calls[0].schedule.id).toBe(b.id);
    expect(executor.calls[1].schedule.id).toBe(a.id);

    const updatedA = await prisma.schedule.findUnique({ where: { id: a.id } });
    const updatedB = await prisma.schedule.findUnique({ where: { id: b.id } });
    expect(updatedA.status).toBe('completed');
    expect(updatedB.status).toBe('completed');
  });

  it('sweepStaleRunningTweets: pre-existing running rows are marked failed (interrupted)', async () => {
    const stale = await prisma.schedule.create({
      data: {
        userId: TEST_USER.id,
        content: 'Stale running tweet',
        scheduledAt: new Date(Date.now() - 60_000),
        status: 'running',
        platform: 'twitter',
      },
    });

    const sweptCount = await sweepStaleRunningTweets(prisma);

    expect(sweptCount).toBeGreaterThanOrEqual(1);
    const updated = await prisma.schedule.findUnique({ where: { id: stale.id } });
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('interrupted');
  });

  it('platform isolation: facebook schedules are never picked up by the tweet worker', async () => {
    const fbSchedule = await prisma.schedule.create({
      data: {
        userId: TEST_USER.id,
        content: 'Facebook schedule — must not run',
        scheduledAt: new Date(Date.now() - 5000),
        status: 'pending',
        platform: 'facebook',
      },
    });
    const executor = makePostExecutor();

    await runDueTweets(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    expect(executor.calls).toHaveLength(0);
    const updated = await prisma.schedule.findUnique({ where: { id: fbSchedule.id } });
    expect(updated.status).toBe('pending'); // untouched
  });
});
