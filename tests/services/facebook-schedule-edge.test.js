// by nichxbt
// Coverage expansion (TEA automate) — Story 4.1 scheduleFacebookPost + scheduler.
// Validation/persistence + runDueSchedules/sweepStaleRunning branches not covered by
// facebook-schedule.test.js. DB-backed (real Prisma, seed/clean) + injected seams. No vi.mock.
// Uses an ISOLATED test-user id so it never collides with the base schedule suite.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scheduleFacebookPost } from '../../api/services/facebookAutomation.js';
import { runDueSchedules, sweepStaleRunning } from '../../api/services/facebookScheduler.js';

const prisma = new PrismaClient();

const TEST_USER = {
  id: 'test-user-sched-4-1-edge',
  username: 'sched_edge_user',
  email: 'sched_edge@example.com',
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

const fakePage = { _fake: true };
const fakeSessionFactory = async () => ({ page: fakePage, browser: null });

function makePostExecutor(mode = 'success') {
  const calls = [];
  const executor = async (page, content) => {
    calls.push({ page, content });
    if (mode === 'throw') throw new Error('Simulated failure');
    return { dryRun: false, platform: 'facebook', attempted: 1, succeeded: 1, failed: 0, results: [{ target: content, ok: true }] };
  };
  executor.calls = calls;
  return executor;
}

const futureDate = (offsetMs = 120_000) => new Date(Date.now() + offsetMs).toISOString();

// ── scheduleFacebookPost: validation + persistence edges ─────────────────────

describe('scheduleFacebookPost — validation edges', () => {
  beforeEach(async () => { await seedUser(); await cleanSchedules(); });
  afterEach(async () => { await cleanSchedules(); });

  it('content non-string (number) → throws before any DB write', async () => {
    await expect(
      scheduleFacebookPost(null, { content: 42, scheduledAt: futureDate() }, { dryRun: false, userId: TEST_USER.id }),
    ).rejects.toThrow('content must be a non-empty string');
    expect(await prisma.schedule.count({ where: { userId: TEST_USER.id } })).toBe(0);
  });

  it('scheduledAt missing/undefined → throws (invalid ISO-8601)', async () => {
    await expect(
      scheduleFacebookPost(null, { content: 'hi' }, { dryRun: false, userId: TEST_USER.id }),
    ).rejects.toThrow('valid ISO-8601 datetime');
  });

  it('scheduledAt unparseable string → throws', async () => {
    await expect(
      scheduleFacebookPost(null, { content: 'hi', scheduledAt: 'not-a-date' }, { dryRun: false, userId: TEST_USER.id }),
    ).rejects.toThrow('valid ISO-8601 datetime');
  });

  it('dryRun:null stays dry-run (no DB row)', async () => {
    const result = await scheduleFacebookPost(
      null, { content: 'null gate', scheduledAt: futureDate() }, { dryRun: null, userId: TEST_USER.id },
    );
    expect(result.dryRun).toBe(true);
    expect(await prisma.schedule.count({ where: { userId: TEST_USER.id } })).toBe(0);
  });

  it('dry-run echoes mediaUrls in the preview', async () => {
    const media = ['https://example.com/a.jpg', 'https://example.com/b.jpg'];
    const result = await scheduleFacebookPost(null, { content: 'with media', scheduledAt: futureDate(), mediaUrls: media });
    expect(result.preview.mediaUrls).toEqual(media);
  });

  it('real run persists mediaUrls (JSON) and facebookAccountId on the row', async () => {
    const media = ['https://example.com/x.jpg'];
    const result = await scheduleFacebookPost(
      null,
      { content: 'persist test', scheduledAt: futureDate(), mediaUrls: media, facebookAccountId: 'acct-123' },
      { dryRun: false, userId: TEST_USER.id },
    );
    const row = await prisma.schedule.findUnique({ where: { id: result.scheduleId } });
    expect(JSON.parse(row.mediaUrls)).toEqual(media);
    expect(row.facebookAccountId).toBe('acct-123');
  });
});

// ── sweepStaleRunning ────────────────────────────────────────────────────────

describe('sweepStaleRunning', () => {
  beforeEach(async () => { await seedUser(); await cleanSchedules(); });
  afterEach(async () => { await cleanSchedules(); });

  it('marks a leftover running row as failed (error:interrupted) and returns the swept count', async () => {
    const row = await prisma.schedule.create({
      data: { userId: TEST_USER.id, content: 'stuck', scheduledAt: new Date(Date.now() - 5000), status: 'running' },
    });
    const count = await sweepStaleRunning(prisma);
    expect(count).toBeGreaterThanOrEqual(1);
    const updated = await prisma.schedule.findUnique({ where: { id: row.id } });
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('interrupted');
  });
});

// ── runDueSchedules: boundaries ──────────────────────────────────────────────

describe('runDueSchedules — boundaries', () => {
  beforeEach(async () => { await seedUser(); await cleanSchedules(); });
  afterEach(async () => { await cleanSchedules(); });

  async function createDue(overrides = {}) {
    return prisma.schedule.create({
      data: { userId: TEST_USER.id, content: 'due post', scheduledAt: new Date(Date.now() - 5000), status: 'pending', ...overrides },
    });
  }

  it('empty queue: no due schedules → executor never called, no error', async () => {
    const executor = makePostExecutor();
    await runDueSchedules(new Date(), { prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: executor });
    expect(executor.calls).toHaveLength(0);
  });

  it('throughput boundary: with 4 completed in-window (one below cap of 5), the 5th IS executed', async () => {
    const inWindow = new Date(Date.now() - 3_600_000 + 60_000);
    for (let i = 0; i < 4; i++) {
      await prisma.schedule.create({
        data: { userId: TEST_USER.id, content: `done ${i}`, scheduledAt: inWindow, status: 'completed', executedAt: inWindow },
      });
    }
    const fifth = await createDue({ content: 'fifth — under cap' });
    const executor = makePostExecutor();
    await runDueSchedules(new Date(), { prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: executor });
    const updated = await prisma.schedule.findUnique({ where: { id: fifth.id } });
    expect(updated.status).toBe('completed');
    expect(executor.calls).toHaveLength(1);
  });

  it('deferred (over-cap) schedule is pushed 5–15 min into the future (jitter window)', async () => {
    const inWindow = new Date(Date.now() - 3_600_000 + 60_000);
    for (let i = 0; i < 5; i++) {
      await prisma.schedule.create({
        data: { userId: TEST_USER.id, content: `done ${i}`, scheduledAt: inWindow, status: 'completed', executedAt: inWindow },
      });
    }
    const sixth = await createDue({ content: 'sixth — defer' });
    const now = new Date();
    await runDueSchedules(now, { prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: makePostExecutor() });
    const updated = await prisma.schedule.findUnique({ where: { id: sixth.id } });
    const deltaMs = updated.scheduledAt.getTime() - now.getTime();
    expect(updated.status).toBe('pending');
    expect(deltaMs).toBeGreaterThanOrEqual(5 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('two due schedules in one tick → both executed', async () => {
    await createDue({ content: 'first' });
    await createDue({ content: 'second' });
    const executor = makePostExecutor();
    await runDueSchedules(new Date(), { prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: executor });
    expect(executor.calls).toHaveLength(2);
    const rows = await prisma.schedule.findMany({ where: { userId: TEST_USER.id } });
    expect(rows.every((r) => r.status === 'completed')).toBe(true);
  });

  it('NFR3: a custom-named error (TimeoutError) persists only the name, never the raw message', async () => {
    const schedule = await createDue({ content: 'named-error post' });
    const leaky = async () => {
      const e = new Error('cookie xs=SECRET_TOKEN_123 leaked in message');
      e.name = 'TimeoutError';
      throw e;
    };
    await runDueSchedules(new Date(), { prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: leaky });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('TimeoutError'); // name only — message scrubbed
    expect(updated.error).not.toContain('SECRET_TOKEN_123');
  });

  it('an error with err.code persists the code (allowlisted) not the message', async () => {
    const schedule = await createDue({ content: 'coded-error post' });
    const leaky = async () => {
      const e = new Error('ECONNRESET while reading xs=SECRET');
      e.code = 'ECONNRESET';
      throw e;
    };
    await runDueSchedules(new Date(), { prismaClient: prisma, sessionFactory: fakeSessionFactory, postExecutor: leaky });
    const updated = await prisma.schedule.findUnique({ where: { id: schedule.id } });
    expect(updated.error).toBe('ECONNRESET');
    expect(updated.error).not.toContain('SECRET');
  });
});
