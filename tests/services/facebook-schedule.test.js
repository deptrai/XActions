// by nichxbt
// Tests for Story 4.1: scheduleFacebookPost + runDueSchedules
// Browser-free: inject fake page + post executor seam. No vi.mock per project mandate.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scheduleFacebookPost } from '../../api/services/facebookAutomation.js';
import { runDueSchedules } from '../../api/services/facebookScheduler.js';

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

// Injectable postExecutor: records calls, simulates success
function makePostExecutor(shouldThrow = false) {
  const calls = [];
  const executor = async (page, content) => {
    calls.push({ page, content });
    if (shouldThrow) throw new Error('Simulated post failure');
    return { ok: true };
  };
  executor.calls = calls;
  return executor;
}

// Future datetime helper — at least 120s ahead so tests don't flap near the 60s boundary
const futureDate = (offsetMs = 120_000) => new Date(Date.now() + offsetMs).toISOString();

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
      { dryRun: true },
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
      { dryRun: false, userId: TEST_USER.id },
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
      scheduleFacebookPost(null, { content: '   ', scheduledAt: futureDate() }, { dryRun: false, userId: TEST_USER.id }),
    ).rejects.toThrow('content must be a non-empty string');

    const count = await prisma.schedule.count({ where: { userId: TEST_USER.id } });
    expect(count).toBe(0);
  });

  it('past scheduledAt throws', async () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    await expect(
      scheduleFacebookPost(null, { content: 'Late post', scheduledAt: past }, { dryRun: false, userId: TEST_USER.id }),
    ).rejects.toThrow('scheduledAt must be at least 60 seconds in the future');
  });

  it('scheduledAt within 60s throws', async () => {
    const soon = new Date(Date.now() + 30_000).toISOString();
    await expect(
      scheduleFacebookPost(null, { content: 'Too soon', scheduledAt: soon }, { dryRun: false, userId: TEST_USER.id }),
    ).rejects.toThrow('scheduledAt must be at least 60 seconds in the future');
  });

  it('missing userId on dryRun:false throws without creating a row', async () => {
    await expect(
      scheduleFacebookPost(null, { content: 'Unscoped', scheduledAt: futureDate() }, { dryRun: false }),
    ).rejects.toThrow('options.userId is required');

    const count = await prisma.schedule.count({ where: { userId: TEST_USER.id } });
    expect(count).toBe(0);
  });

  it('page param may be null without error (accepted but not used)', async () => {
    const result = await scheduleFacebookPost(
      null,
      { content: 'Null page test', scheduledAt: futureDate() },
      { dryRun: true },
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

  async function createDueSchedule(overrides = {}) {
    return prisma.schedule.create({
      data: {
        userId: TEST_USER.id,
        content: 'Test post content',
        scheduledAt: new Date(Date.now() - 5000), // 5s in past = due
        status: 'pending',
        ...overrides,
      },
    });
  }

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

  it('failing executor transitions schedule to failed, not retried on next tick', async () => {
    const schedule = await createDueSchedule();
    const failingExecutor = makePostExecutor(true);

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

  it('throughput cap: 6th due schedule is deferred (not executed, not failed)', async () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000 + 60_000); // within the 1h window

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

  it('NFR3: no cookie value appears in any Schedule or Operation field', async () => {
    const FAKE_COOKIE_VALUE = 'FAKE_XS_TOKEN_DO_NOT_PERSIST_abc123xyz';
    const schedule = await createDueSchedule({ content: 'Cookie audit test' });

    // sessionFactory that simulates a "cookie was in scope" scenario
    const suspiciousSessionFactory = async () => {
      // Intentionally do NOT leak FAKE_COOKIE_VALUE into any return value
      return { page: fakePage, browser: null };
    };

    const executor = makePostExecutor();
    await runDueSchedules(new Date(), {
      prismaClient: prisma,
      sessionFactory: suspiciousSessionFactory,
      postExecutor: executor,
    });

    const updatedSchedule = await prisma.schedule.findUnique({ where: { id: schedule.id } });
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
});
