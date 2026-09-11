// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Scheduler HTTP API Routes — /api/schedule.
 * Uses supertest against the real Express app, real admin JWT, and the real
 * Scheduler singleton (jobs are persisted to ~/.xactions and cleaned up).
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../../api/server.js';
import { prisma, cleanupTestDatabase } from '../store/test-prisma-client.js';
import { getScheduler } from '../../src/scheduler/scheduler.js';

const TEST_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-12345';

function makeUserToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, isAdmin: user.isAdmin },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

async function seedUser(overrides = {}) {
  const id = `test_sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: {
      id,
      username: `sched_user_${id}`,
      email: `${id}@example.com`,
      password: await bcrypt.hash('TestPassword123!', 10),
      isAdmin: false,
      credits: 100,
      ...overrides,
    },
  });
}

const JOB_PREFIX = 'vitest_sched_';
const createdJobs = [];

async function cleanupJobs() {
  const scheduler = getScheduler();
  for (const name of createdJobs.splice(0)) {
    try {
      scheduler.removeJob(name);
    } catch {}
  }
}

describe('/api/schedule — authentication & authorization', () => {
  let adminUser;
  let regularUser;

  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = TEST_SECRET;
    adminUser = await seedUser({ isAdmin: true });
    regularUser = await seedUser({ isAdmin: false });
  });

  afterAll(async () => {
    await cleanupJobs();
    const ids = [adminUser?.id, regularUser?.id].filter(Boolean);
    if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/schedule');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin JWT with 403', async () => {
    const res = await request(app)
      .get('/api/schedule')
      .set('Authorization', `Bearer ${makeUserToken(regularUser)}`);
    expect(res.status).toBe(403);
  });

  it('rejects POST without auth', async () => {
    const res = await request(app)
      .post('/api/schedule')
      .send({ name: `${JOB_PREFIX}unauth`, cron: '0 9 * * *' });
    expect(res.status).toBe(401);
  });

  it('lists jobs for admin', async () => {
    const res = await request(app)
      .get('/api/schedule')
      .set('Authorization', `Bearer ${makeUserToken(adminUser)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.jobs)).toBe(true);
  });
});

describe('/api/schedule — job lifecycle', () => {
  let adminUser;
  let adminToken;
  // Unique per run — vitest shuffles test order and the scheduler singleton
  // persists jobs across the file, so names must never collide.
  const jobName = `${JOB_PREFIX}lifecycle_${Date.now()}`;

  beforeAll(async () => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = TEST_SECRET;
    adminUser = await seedUser({ isAdmin: true });
    adminToken = makeUserToken(adminUser);
  });

  afterAll(async () => {
    await cleanupJobs();
    if (adminUser) await prisma.user.deleteMany({ where: { id: adminUser.id } });
    await prisma.$disconnect();
  });

  // NOTE: tests are order-shuffled (sequence.shuffle) — the lifecycle is one
  // sequential `it` so every step sees a consistent job state.
  it('full lifecycle: create → list → disable → enable → run → history → delete', async () => {
    createdJobs.push(jobName);
    const auth = () => ({ Authorization: `Bearer ${adminToken}` });

    // create
    const create = await request(app)
      .post('/api/schedule')
      .set(auth())
      .send({ name: jobName, cron: '0 9 * * *', command: '--help' });
    expect(create.status).toBe(200);
    expect(create.body.status).toBe('scheduled');

    // list shows it enabled with the given command
    const list = await request(app).get('/api/schedule').set(auth());
    const job = list.body.jobs.find((j) => j.name === jobName);
    expect(job).toBeDefined();
    expect(job.cron).toBe('0 9 * * *');
    expect(job.command).toBe('--help');
    expect(job.enabled).toBe(true);

    // disable → enable
    const disable = await request(app).post(`/api/schedule/${jobName}/disable`).set(auth());
    expect(disable.status).toBe(200);
    expect(disable.body.status).toBe('disabled');
    const afterDisable = await request(app).get('/api/schedule').set(auth());
    expect(afterDisable.body.jobs.find((j) => j.name === jobName).enabled).toBe(false);
    const enable = await request(app).post(`/api/schedule/${jobName}/enable`).set(auth());
    expect(enable.status).toBe(200);
    expect(enable.body.status).toBe('enabled');

    // run now (real CLI spawn: `node bin/unfollowx --help`) + history
    const run = await request(app).post(`/api/schedule/${jobName}/run`).set(auth());
    expect(run.status).toBe(200);
    expect(run.body.status).toBe('success');
    expect(run.body.exitCode).toBe(0);
    const history = await request(app).get(`/api/schedule/${jobName}/history`).set(auth());
    expect(history.status).toBe(200);
    expect(Array.isArray(history.body.history)).toBe(true);
    expect(history.body.history.length).toBeGreaterThan(0);
    expect(history.body.history[0].status).toBe('success');

    // delete
    const del = await request(app).delete(`/api/schedule/${jobName}`).set(auth());
    expect(del.status).toBe(200);
    expect(del.body.status).toBe('removed');
    const afterDelete = await request(app).get('/api/schedule').set(auth());
    expect(afterDelete.body.jobs.find((j) => j.name === jobName)).toBeUndefined();
  }, 60000);

  it('rejects invalid cron with 400', async () => {
    const res = await request(app)
      .post('/api/schedule')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${JOB_PREFIX}badcron`, cron: 'not-a-cron' });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields with 400', async () => {
    const res = await request(app)
      .post('/api/schedule')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${JOB_PREFIX}missing` });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate job name with 400', async () => {
    const name = `${JOB_PREFIX}dup_${Date.now()}`;
    createdJobs.push(name);
    const first = await request(app)
      .post('/api/schedule')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, cron: '0 10 * * *' });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post('/api/schedule')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, cron: '0 11 * * *' });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/already exists/i);
  });

  it('returns 404 for unknown job actions', async () => {
    const missing = `${JOB_PREFIX}missing_404_${Date.now()}`;
    for (const action of ['enable', 'disable', 'run']) {
      const res = await request(app)
        .post(`/api/schedule/${missing}/${action}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    }
    const del = await request(app)
      .delete(`/api/schedule/${missing}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(404);
  });

  it('returns job templates', async () => {
    const res = await request(app)
      .get('/api/schedule/templates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.templates.length).toBeGreaterThan(0);
    expect(res.body.templates[0]).toHaveProperty('name');
    expect(res.body.templates[0]).toHaveProperty('cron');
    expect(res.body.templates[0]).toHaveProperty('command');
  });
});
