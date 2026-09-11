// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scheduler API Routes
 * Cron job management for recurring crawls / CLI commands.
 * Admin-only: every route requires a JWT for a user with isAdmin = true.
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Scheduler jobs spawn `node bin/unfollowx <command> <args>` — admin-only surface.
router.use(authenticateToken, requireAdmin);

async function scheduler() {
  const { getScheduler } = await import('../../src/scheduler/scheduler.js');
  return getScheduler();
}

// GET /api/schedule — list all jobs
router.get('/', async (req, res) => {
  try {
    const sched = await scheduler();
    res.json({ jobs: sched.listJobs() });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// GET /api/schedule/templates — preset job templates
router.get('/templates', async (req, res) => {
  try {
    const { JOB_TEMPLATES } = await import('../../src/scheduler/scheduler.js');
    res.json({ templates: JOB_TEMPLATES });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// POST /api/schedule — add a job { name, cron, command|action, args? }
router.post('/', async (req, res) => {
  try {
    const sched = await scheduler();
    const body = /** @type {Record<string, unknown>} */ (req.body);
    const name = /** @type {string | undefined} */ (body.name);
    const cron = /** @type {string | undefined} */ (body.cron);
    const command = /** @type {string | undefined} */ (body.command || body.action);
    const args = Array.isArray(body.args) ? body.args.map(String) : [];
    if (!name || !cron) return res.status(400).json({ error: 'name and cron required' });
    sched.addJob({ name, cron, command: command || name, args });
    res.json({ status: 'scheduled', name, cron });
  } catch (error) {
    const status = /already exists|Invalid cron|requires:/i.test(error instanceof Error ? error.message : String(error)) ? 400 : 500;
    res.status(status).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// DELETE /api/schedule/:name — remove a job
router.delete('/:name', async (req, res) => {
  try {
    const sched = await scheduler();
    const result = sched.removeJob(req.params.name);
    if (result?.error) return res.status(404).json({ error: result.error });
    res.json({ status: 'removed', name: req.params.name });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// POST /api/schedule/:name/enable — enable a job
router.post('/:name/enable', async (req, res) => {
  try {
    const sched = await scheduler();
    const result = sched.enableJob(req.params.name);
    if (result?.error) return res.status(404).json({ error: result.error });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// POST /api/schedule/:name/disable — disable a job
router.post('/:name/disable', async (req, res) => {
  try {
    const sched = await scheduler();
    const result = sched.disableJob(req.params.name);
    if (result?.error) return res.status(404).json({ error: result.error });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// POST /api/schedule/:name/run — run a job now
router.post('/:name/run', async (req, res) => {
  try {
    const sched = await scheduler();
    const result = await sched.runJobNow(req.params.name);
    if (result?.error && result?.status === undefined) return res.status(404).json({ error: result.error });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// GET /api/schedule/:name/history — last N runs
router.get('/:name/history', async (req, res) => {
  try {
    const sched = await scheduler();
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    res.json({ history: await sched.getJobHistory(req.params.name, limit) });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

export default router;

// by nichxbt
