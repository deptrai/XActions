// by nichxbt
// Tests for Story 4.1: scheduleFacebookPost + runDueSchedules
// Browser-free: inject fake page + post executor seam. No vi.mock per project mandate.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scheduleFacebookPost } from '../../api/services/facebookAutomation.js';
import { runDueSchedules, sweepStaleRunning } from '../../api/services/facebookScheduler.js';

const prisma = new PrismaClient();

// ── Test user seeded once per suite ──────────────────────────────────────────

const TEST_USER = {
  id: 'test-user-sched-4-1',
  username: 'sched_test_user',
  email: 'sched_test@example.com',
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

// Helper: create a due pending schedule (used across multiple describe blocks)
async function createDueSchedule(overrides = {}) {
  return prisma.schedule.create({
    data: {
      userId: TEST_USER.id,
      content: 'Test post content',
      scheduledAt: new Date(Date.now() - 5000),
      status: 'pending',
      ...overrides,
    },
  });
}

// Injectable postExecutor: records calls, simulates success
// Injectable postExecutor that mirrors createFacebookPost's REAL return shape
// (runGuardedBatch batchResult), not a bare { ok:true }. This lets us exercise
// the worker's success-detection logic (P2: a failed post must not be "completed").
//   mode 'success' → { succeeded:1, failed:0, results:[{ ok:true }] }
//   mode 'fail'    → { succeeded:0, failed:1, results:[{ ok:false, error }] }  (NO throw — like real createFacebookPost)
//   mode 'throw'   → throws (session/login style error)
function makePostExecutor(mode = 'success', { error } = {}) {
  const calls = [];
  const executor = async (page, content) => {
    calls.push({ page, content });
    if (mode === 'throw') throw new Error('Simulated post failure');
    if (mode === 'fail') {
      return {
        dryRun: false,
        platform: 'facebook',
        attempted: 1,
        succeeded: 0,
        failed: 1,
        results: [{ target: content, ok: false, error: error ?? 'composer not found' }],
      };
    }
    return {
      dryRun: false,
      platform: 'facebook',
      attempted: 1,
      succeeded: 1,
      failed: 0,
      results: [{ target: content, ok: true }],
    };
  };
  executor.calls = calls;
  return executor;
}

// Fixed reference time for deterministic tests (injectable clock)
const FIXED_NOW = new Date('2026-06-01T12:00:00.000Z').getTime();
const fixedNow = () => FIXED_NOW;

// Future datetime helper — at least 120s ahead of FIXED_NOW so tests don't flap
const futureDate = (offsetMs = 120_000) => new Date(FIXED_NOW + offsetMs).toISOString();

// ── scheduleFacebookPost ─────────────────────────────────────────────────────

describe('scheduleFacebookPost', () => {
  beforeEach(async () => {
    await seedUser();
    await cleanSchedules();
  });

  afterEach(async () => {
    await cleanSchedules();
  });

  it('dry-run: returns preview with willFireAt, creates ZERO Schedule rows', async () => {
    const scheduledAt = futureDate();
    const result = await scheduleFacebookPost(
      null,
      { content: 'Hello world', scheduledAt },
      { dryRun: true, now: fixedNow },
    );

    expect(result.dryRun).toBe(true);
    expect(result.platform).toBe('facebook');
    expect(result.preview.content).toBe('Hello world');
    expect(result.preview.scheduledAt).toBe(new Date(scheduledAt).toISOString());
    expect(result.preview.willFireAt).toBeTruthy();
    expect(result.preview.mediaUrls).toBeNull();

    const count = await prisma.schedule.count({ where: { userId: TEST_USER.id } });
    expect(count).toBe(0);
  });

  it('dry-run: default when dryRun is not set', async () => {
    const result = await scheduleFacebookPost(
      null,
      { content: 'No explicit dryRun', scheduledAt: futureDate() },
      { now: fixedNow },
    );
    expect(result.dryRun).toBe(true);
    const count = await prisma.schedule.count({ where: { userId: TEST_USER.id } });
    expect(count).toBe(0);
  });

  it('dryRun:false creates exactly one pending Schedule row scoped to userId', async () => {
    const scheduledAt = futureDate();
    const result = await scheduleFacebookPost(
      null,
      { content: 'Real schedule', scheduledAt },
      { dryRun: false, userId: TEST_USER.id, now: fixedNow },
    );

    expect(result.dryRun).toBe(false);
    expect(result.platform).toBe('facebook');
    expect(result.scheduleId).toBeTruthy();
    expect(result.status).toBe('pending');

    const rows = await prisma.schedule.findMany({ where: { userId: TEST_USER.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(result.scheduleId);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].userId).toBe(TEST_USER.id);
  });

  it('empty content throws before any DB write', async () => {
    await expect(
      scheduleFacebookPost(null, { content: '   ', scheduledAt: futureDate() }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('content must be a non-empty string');

    const count = await prisma.schedule.count({ where: { userId: TEST_USER.id } });
    expect(count).toBe(0);
  });

  it('past scheduledAt throws', async () => {
    const past = new Date(FIXED_NOW - 10_000).toISOString();
    await expect(
      scheduleFacebookPost(null, { content: 'Late post', scheduledAt: past }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('scheduledAt must be at least 60 seconds in the future');
  });

  it('scheduledAt within 60s throws', async () => {
    const soon = new Date(FIXED_NOW + 30_000).toISOString();
    await expect(
      scheduleFacebookPost(null, { content: 'Too soon', scheduledAt: soon }, { dryRun: false, userId: TEST_USER.id, now: fixedNow }),
    ).rejects.toThrow('scheduledAt must be at least 60 seconds in the future');
  });

  it('missing userId on dryRun:false throws without creating a row', async () => {
    await expect(
      scheduleFacebookPost(null, { content: 'Unscoped', scheduledAt: futureDate() }, { dryRun: false, now: fixedNow }),
    ).rejects.toThrow('options.userId is required');

    const count = await prisma.schedule.count({ where: { userId: TEST_USER.id } });
    expect(count).toBe(0);
  });

  it('page param may be null without error (accepted but not used)', async () => {
    const result = await scheduleFacebookPost(
      null,
      { content: 'Null page test', scheduledAt: futureDate() },
      { dryRun: true, now: fixedNow },
    );
    expect(result.dryRun).toBe(true);
  });
});

// ── runDueSchedules ──────────────────────────────────────────────────────────

describe('runDueSchedules', () => {
  beforeEach(async () => {
    await seedUser();
    await cleanSchedules();
  });

  afterEach(async () => {
    await cleanSchedules();
  });

  it('due pending schedule transitions to completed', async () => {
    const schedule = await createDueSchedule();
    const executor = makePostExecutor();

    await runDueSchedules(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('completed');
    expect(updated.executedAt).toBeTruthy();
    expect(updated.operationId).toBeTruthy();
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].content).toBe('Test post content');
  });

  it('throwing executor transitions schedule to failed, not retried on next tick', async () => {
    const schedule = await createDueSchedule();
    const failingExecutor = makePostExecutor('throw');

    await runDueSchedules(new Date(), {
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
    await runDueSchedules(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor2,
    });
    expect(executor2.calls).toHaveLength(0);
  });

  it('post that returns a failure result (no throw) is marked failed, not completed', async () => {
    // createFacebookPost resolves with { failed:1 } instead of throwing; the worker
    // must inspect the result and NOT record the schedule as completed (P2).
    const schedule = await createDueSchedule();
    const failResultExecutor = makePostExecutor('fail');

    await runDueSchedules(new Date(), {
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
    const oneHourAgo = new Date(Date.now() - 3_600_000 + 60_000); // within the 1h window (real clock for DB query)

    // Seed 5 completed schedules in the last hour
    for (let i = 0; i < 5; i++) {
      await prisma.schedule.create({
        data: {
          userId: TEST_USER.id,
          content: `Completed post ${i}`,
          scheduledAt: oneHourAgo,
          status: 'completed',
          executedAt: oneHourAgo,
        },
      });
    }

    const sixth = await createDueSchedule({ content: 'Sixth post — should defer' });
    const executor = makePostExecutor();

    await runDueSchedules(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    const updated = await prisma.schedule.findUnique({ where: { id: sixth.id } });
    // Must be deferred (scheduledAt pushed forward), not executed, not failed
    expect(updated.status).toBe('pending');
    expect(updated.scheduledAt.getTime()).toBeGreaterThan(sixth.scheduledAt.getTime());
    expect(executor.calls).toHaveLength(0);
  });

  it('creates an Operation record linked to the Schedule on success', async () => {
    const schedule = await createDueSchedule();
    const executor = makePostExecutor();

    await runDueSchedules(new Date(), {
      prismaClient: prisma,
      sessionFactory: fakeSessionFactory,
      postExecutor: executor,
    });

    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    const op = await prisma.operation.findUnique({ where: { id: updated.operationId } });
    expect(op).toBeTruthy();
    expect(op.type).toBe('facebook_schedule');
    expect(op.status).toBe('completed');
    expect(op.userId).toBe(TEST_USER.id);
  });

  it('NFR3: a cookie value carried in an error message never reaches a persisted field', async () => {
    // Real risk: Puppeteer/login errors embed cookie/URL data in err.message. Put the
    // secret into the execution scope via a throwing executor, then assert safeErrorString
    // scrubbed it from every persisted field (Schedule.error / Operation.error/config/result).
    const FAKE_COOKIE_VALUE = 'FAKE_XS_TOKEN_DO_NOT_PERSIST_abc123xyz';
    const schedule = await createDueSchedule({ content: 'Cookie audit test' });

    const leakyExecutor = async () => {
      // A plain Error whose message embeds the secret — code/name are the only safe fields.
      throw new Error(`Protocol error Network.setCookie failed for xs=${FAKE_COOKIE_VALUE}`);
    };

    await runDueSchedules(new Date(), {
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
      op?.config ?? '',
      op?.result ?? '',
      op?.error ?? '',
    ].join('\n');

    expect(allPersistedStrings).not.toContain(FAKE_COOKIE_VALUE);
  });

  it('claims the row atomically — a concurrent tick does not double-execute', async () => {
    // P1: two overlapping ticks reading the same due row must result in exactly one execution.
    const schedule = await createDueSchedule({ content: 'Double-exec guard' });
    const executor = makePostExecutor();

    await Promise.all([
      runDueSchedules(new Date(), { prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: executor }),
      runDueSchedules(new Date(), { prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: executor }),
    ]);

    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('completed');
    // The pending→running claim must let only ONE tick execute the post.
    expect(executor.calls).toHaveLength(1);
  });
});

// ── P1 Kill: isPostSuccess — all result shapes (L30-36) ──────────────

describe('runDueSchedules — isPostSuccess result shapes (P1 kill)', () => {
  beforeEach(async () => {
    await seedUser();
    await cleanSchedules();
  });
  afterEach(async () => {
    await cleanSchedules();
  });

  it('null result → schedule marked failed (L30: !result → false)', async () => {
    const schedule = await createDueSchedule();
    const nullExecutor = async () => null;
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: nullExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
  });

  it('result.ok===true → schedule marked completed (L31: ok===true → true)', async () => {
    const schedule = await createDueSchedule();
    const okExecutor = async () => ({ ok: true });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: okExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('completed');
  });

  it('result.ok===false (bare) → schedule marked failed (L36: ok!==false)', async () => {
    const schedule = await createDueSchedule();
    const failExecutor = async () => ({ ok: false });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: failExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
  });

  it('result with failed>0 → schedule marked failed (L33: failed===0 && succeeded>0)', async () => {
    const schedule = await createDueSchedule();
    const failExecutor = async () => ({ failed: 1, succeeded: 0, results: [] });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: failExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
  });

  it('result with failed=0, succeeded>0 → completed (L33 boundary)', async () => {
    const schedule = await createDueSchedule();
    const successExecutor = async () => ({ failed: 0, succeeded: 1, results: [] });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: successExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('completed');
  });

  it('result with failed=0, succeeded=0 → failed (L33: succeeded>0 is required)', async () => {
    const schedule = await createDueSchedule();
    const zeroExecutor = async () => ({ failed: 0, succeeded: 0, results: [] });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: zeroExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
  });

  it('result with only succeeded (no failed field) → completed (L32: typeof check)', async () => {
    const schedule = await createDueSchedule();
    const succeededOnlyExecutor = async () => ({ succeeded: 1 });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: succeededOnlyExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('completed');
  });

  it('result with only failed (no succeeded field) → failed (L32: typeof check)', async () => {
    const schedule = await createDueSchedule();
    const failedOnlyExecutor = async () => ({ failed: 1 });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: failedOnlyExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
  });

  it('unknown shape with ok not false → completed (L36: ok!==false)', async () => {
    const schedule = await createDueSchedule();
    const unknownExecutor = async () => ({ foo: 'bar' });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: unknownExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('completed');
  });
});

// ── P1 Kill: postFailureReason — exact error message (L40-48) ─────────
// NOTE: postFailureReason creates an Error whose .message contains the reason,
// but safeErrorString scrubs .message (NFR3) and only returns .code or .name.
// So the persisted error is "execution error" for plain Error, not the reason.
// To kill postFailureReason mutants, we need to export it or test via a
// custom Error subclass that carries the reason in .code.

describe('runDueSchedules — postFailureReason via error.code (P1 kill)', () => {
  beforeEach(async () => {
    await seedUser();
    await cleanSchedules();
  });
  afterEach(async () => {
    await cleanSchedules();
  });

  it('failed post with results → schedule marked failed (postFailureReason called)', async () => {
    const schedule = await createDueSchedule();
    const failExecutor = async () => ({
      failed: 2, succeeded: 1, results: [{ ok: false, error: 'timeout' }],
    });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: failExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    // postFailureReason throws Error → safeErrorString returns "execution error"
    // StringLiteral mutant L59: 'execution error' → '' → empty error
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('execution error');
  });

  it('failed post with short error in results → schedule marked failed', async () => {
    const schedule = await createDueSchedule();
    const failExecutor = async () => ({
      failed: 1, succeeded: 0, results: [{ ok: false, error: 'composer not found' }],
    });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: failExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('execution error');
  });

  it('failed post with long error >80 chars → schedule marked failed', async () => {
    const schedule = await createDueSchedule();
    const longError = 'x'.repeat(81);
    const failExecutor = async () => ({
      failed: 1, succeeded: 0, results: [{ ok: false, error: longError }],
    });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: failExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
    // NFR3: long error never persisted (safeErrorString scrubs .message)
    expect(updated.error).not.toContain(longError);
  });

  it('failed post with result.error (no results array) → schedule marked failed', async () => {
    const schedule = await createDueSchedule();
    const failExecutor = async () => ({
      failed: 1, succeeded: 0, error: 'network error',
    });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: failExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
    // NFR3: "network error" is in .message, scrubbed by safeErrorString
    expect(updated.error).not.toContain('network error');
  });
});

// ── P1 Kill: safeErrorString — err.code/err.name (L57-59) ────────────

describe('runDueSchedules — safeErrorString (P1 kill)', () => {
  beforeEach(async () => {
    await seedUser();
    await cleanSchedules();
  });
  afterEach(async () => {
    await cleanSchedules();
  });

  it('error with code property → schedule error is the code (L57)', async () => {
    const schedule = await createDueSchedule();
    const codeExecutor = async () => {
      const err = new Error('raw message with cookie=secret');
      err.code = 'ECONNRESET';
      throw err;
    };
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: codeExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    // ConditionalExpression mutant L57: false → code not returned
    expect(updated.error).toBe('ECONNRESET');
    expect(updated.error).not.toContain('cookie');
  });

  it('error with name (not "Error") → schedule error is the name (L58)', async () => {
    const schedule = await createDueSchedule();
    const nameExecutor = async () => {
      const err = new TypeError('type error message');
      err.name = 'TypeError';
      throw err;
    };
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: nameExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    // ConditionalExpression mutant L58: false → name not returned
    // LogicalOperator mutant L58: && → || → name returned even if "Error"
    expect(updated.error).toBe('TypeError');
  });

  it('plain Error (name="Error") → schedule error is "execution error" (L59)', async () => {
    const schedule = await createDueSchedule();
    const plainExecutor = async () => {
      throw new Error('plain error');
    };
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: plainExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    // StringLiteral mutant L58: 'Error' → '' → name check bypassed
    // StringLiteral mutant L59: 'execution error' → '' → empty error
    expect(updated.error).toBe('execution error');
  });

  it('error with empty code string → falls through to name (L57: err.code truthiness)', async () => {
    const schedule = await createDueSchedule();
    const emptyCodeExecutor = async () => {
      const err = new Error('msg');
      err.code = '';
      err.name = 'TimeoutError';
      throw err;
    };
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: emptyCodeExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    // ConditionalExpression mutant L57: true → empty code returned (should fall through)
    expect(updated.error).toBe('TimeoutError');
  });

  it('error with code="Error" name → falls through to "execution error" (L58: name !== Error)', async () => {
    const schedule = await createDueSchedule();
    const errorNameExecutor = async () => {
      const err = new Error('msg');
      err.name = 'Error';
      throw err;
    };
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: errorNameExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    // name === 'Error' → falls through to 'execution error'
    expect(updated.error).toBe('execution error');
  });

  it('null thrown from executor → schedule marked failed, not crashed (L57: err?.code)', async () => {
    const schedule = await createDueSchedule();
    const nullThrowExecutor = async () => { throw null; };
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: nullThrowExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    // OptionalChaining mutant L57: err?.code → err.code → throws on null
    // Original: err?.code = undefined → falls through → 'execution error'
    // Mutant: err.code throws → outer catch → row aborted, schedule stays 'running'
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('execution error');
  });

  it('undefined thrown from executor → schedule marked failed (L57: err?.code)', async () => {
    const schedule = await createDueSchedule();
    const undefThrowExecutor = async () => { throw undefined; };
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: undefThrowExecutor,
    });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('execution error');
  });
});

// ── P1 Kill: finally block — browser close (L234) ────────────────────

describe('runDueSchedules — finally block browser close (P1 kill, L234)', () => {
  beforeEach(async () => {
    await seedUser();
    await cleanSchedules();
  });
  afterEach(async () => {
    await cleanSchedules();
  });

  it('browser.close() is called on success (finally block executes)', async () => {
    const schedule = await createDueSchedule();
    let browserClosed = false;
    const fakeBrowser = {
      close: async () => { browserClosed = true; },
    };
    const sessionWithBrowser = async () => ({ page: fakePage, browser: fakeBrowser });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: sessionWithBrowser, postExecutor: makePostExecutor(),
    });
    // BlockStatement mutant L234: finally {} → {} → browser.close() not called
    expect(browserClosed).toBe(true);
  });

  it('browser.close() is called even when executor throws (finally block)', async () => {
    const schedule = await createDueSchedule();
    let browserClosed = false;
    const fakeBrowser = {
      close: async () => { browserClosed = true; },
    };
    const sessionWithBrowser = async () => ({ page: fakePage, browser: fakeBrowser });
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: sessionWithBrowser, postExecutor: makePostExecutor('throw'),
    });
    // BlockStatement mutant L234: finally {} → {} → browser.close() not called
    expect(browserClosed).toBe(true);
  });

  it('browser.close() error is swallowed (catch(() => {}))', async () => {
    const schedule = await createDueSchedule();
    const fakeBrowser = {
      close: async () => { throw new Error('close failed'); },
    };
    const sessionWithBrowser = async () => ({ page: fakePage, browser: fakeBrowser });
    // Should not throw even if browser.close() throws
    await expect(
      runDueSchedules(new Date(), {
        prismaClient: prisma, sessionFactory: sessionWithBrowser, postExecutor: makePostExecutor(),
      }),
    ).resolves.toBeUndefined();
  });
});

// ── P1 Kill: sweepStaleRunning — exact count + log (L253-261) ─────────

describe('sweepStaleRunning — exact behavior (P1 kill)', () => {
  beforeEach(async () => {
    await seedUser();
    await cleanSchedules();
  });
  afterEach(async () => {
    await cleanSchedules();
  });

  it('returns exact count of swept stale running schedules', async () => {
    // Create stale running schedules
    await prisma.schedule.create({
      data: {
        userId: TEST_USER.id,
        content: 'Stale 1',
        scheduledAt: new Date(Date.now() - 60000),
        status: 'running',
      },
    });
    await prisma.schedule.create({
      data: {
        userId: TEST_USER.id,
        content: 'Stale 2',
        scheduledAt: new Date(Date.now() - 60000),
        status: 'running',
      },
    });

    const count = await sweepStaleRunning(prisma);
    // EqualityOperator mutant L258: > → >= or <= → wrong count check
    expect(count).toBe(2);
  });

  it('returns 0 when no stale running schedules exist', async () => {
    const count = await sweepStaleRunning(prisma);
    // ConditionalExpression mutant L258: true → log always fires (but count is 0)
    expect(count).toBe(0);
  });

  it('marks stale running schedules as failed with error "interrupted"', async () => {
    const schedule = await prisma.schedule.create({
      data: {
        userId: TEST_USER.id,
        content: 'Stale recovery',
        scheduledAt: new Date(Date.now() - 60000),
        status: 'running',
      },
    });

    await sweepStaleRunning(prisma);
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    // StringLiteral mutant L256: 'interrupted' → '' → empty error
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('interrupted');
  });

  it('does NOT sweep pending or completed schedules (L255: where status=running)', async () => {
    // ObjectLiteral mutant L255: where: {} → sweeps ALL schedules regardless of status
    const pending = await prisma.schedule.create({
      data: {
        userId: TEST_USER.id,
        content: 'Pending',
        scheduledAt: new Date(Date.now() - 60000),
        status: 'pending',
      },
    });
    const completed = await prisma.schedule.create({
      data: {
        userId: TEST_USER.id,
        content: 'Completed',
        scheduledAt: new Date(Date.now() - 60000),
        status: 'completed',
      },
    });

    await sweepStaleRunning(prisma);
    const pendingAfter = await prisma.schedule.findUnique({ where: { id: pending.id } });
    const completedAfter = await prisma.schedule.findUnique({ where: { id: completed.id } });
    // Mutant L255: where:{} → pending/completed also swept → status='failed'
    expect(pendingAfter.status).toBe('pending');
    expect(completedAfter.status).toBe('completed');
  });
});

// ── P1 Kill: throughput cap jitter (L104) ────────────────────────────

describe('runDueSchedules — throughput cap jitter (P1 kill, L104)', () => {
  beforeEach(async () => {
    await seedUser();
    await cleanSchedules();
  });
  afterEach(async () => {
    await cleanSchedules();
  });

  it('deferred schedule gets jitter within JITTER_MIN_MS..JITTER_MAX_MS range', async () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000 + 60_000);
    for (let i = 0; i < 5; i++) {
      await prisma.schedule.create({
        data: {
          userId: TEST_USER.id,
          content: `Completed ${i}`,
          scheduledAt: oneHourAgo,
          status: 'completed',
          executedAt: oneHourAgo,
        },
      });
    }
    const sixth = await createDueSchedule({ content: 'Deferred' });
    const beforeRun = Date.now();
    await runDueSchedules(new Date(), {
      prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: makePostExecutor(),
    });
    const updated = await prisma.schedule.findUnique({ where: { id: sixth.id } });
    // ArithmeticOperator mutant L104: * → / → jitter ≈ 0 → deferredTime ≈ now + JITTER_MIN_MS (300000)
    // But JITTER_MIN_MS is the MINIMUM, so jitter should be > JITTER_MIN_MS (not exactly JITTER_MIN_MS)
    // JITTER_MIN_MS = 300000 (5min), JITTER_MAX_MS = 900000 (15min)
    // Original: jitter = 300000 + random * 600000 → range [300000, 900000]
    // Mutant /: jitter = 300000 + random / 600000 → range [300000, 300000.0000017] → ~300000
    // To kill mutant: assert deferredTime > now + JITTER_MIN_MS + some buffer (e.g. 310000)
    const deferredTime = updated.scheduledAt.getTime();
    // Use beforeRun as lower bound (jitter is added to now passed to runDueSchedules)
    // Must be > now + 310000 to kill the / mutant (which gives ~300000)
    expect(deferredTime).toBeGreaterThan(beforeRun + 310000); // must be > JITTER_MIN_MS + buffer
    expect(deferredTime).toBeLessThan(beforeRun + 1000000); // at most ~15min ahead + buffer
  });
});
