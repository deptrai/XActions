// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt
//
// EPS-2 Tweet Scheduling — REST API.
// All routes require auth (req.user.id). Body userId is NEVER trusted — the caller's
// authenticated user id scopes every read/write (AC6 #22).
//
// Endpoints:
//   POST   /api/tweet-schedule          — create (dry-run default; dryRun:false + auth persists)
//   GET    /api/tweet-schedule          — list caller's schedules (optional ?status= filter)
//   DELETE /api/tweet-schedule/:id      — cancel: pending → cancelled (running/completed → 409)
//   PATCH  /api/tweet-schedule/reorder  — persist [{ id, queueOrder }] (drag & drop queue view)

import prisma from '../lib/prisma.js';
/**
 * @typedef {import('@prisma/client').User} User
 */
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { scheduleTweet } from '../services/tweetScheduling.js';
const router = express.Router();
router.use(authMiddleware);

/**
 * Parse a comma-separated thread string ("t2,t3") into a string[].
 * Returns undefined when the input is empty/absent (single tweet).
 * @param {unknown} raw
 */
function parseThread(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

// POST /api/tweet-schedule — create a scheduled tweet (dry-run by default)
router.post('/', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const body = /** @type {Record<string, unknown>} */ (req.body ?? {});
    const input = {
      content: typeof body.content === 'string' ? body.content : undefined,
      mediaUrls: Array.isArray(body.mediaUrls) ? body.mediaUrls.map(String) : undefined,
      scheduledAt: body.scheduledAt ? new Date(String(body.scheduledAt)) : undefined,
      thread: parseThread(body.thread),
      timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
      recurrenceCron: typeof body.recurrenceCron === 'string' ? body.recurrenceCron : undefined,
      queueOrder: typeof body.queueOrder === 'number' ? body.queueOrder : undefined,
    };
    const options = {
      dryRun: body.dryRun === false ? false : true,
      userId: reqUser.id,
    };

    // Caller's authenticated user id scopes the row — never trust a body userId.
    const result = await scheduleTweet(input, options);
    res.json(result);
  } catch (error) {
    // Validation errors are caller faults; surface the message so the dashboard can show it.
    const status = /^❌ scheduleTweet:/.test((error instanceof Error ? error.message : String(error))) ? 400 : 500;
    res.status(status).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// GET /api/tweet-schedule — list the caller's schedules (optional ?status= filter)
router.get('/', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { status } = req.query;
    const where = /** @type {Record<string, string>} */ ({ userId: reqUser.id, platform: 'twitter' });
    if (status) where.status = status;

    const schedules = await prisma.schedule.findMany({
      where,
      orderBy: [{ queueOrder: 'asc' }, { scheduledAt: 'asc' }],
    });

    res.json({
      schedules: schedules.map((s) => ({
        id: s.id,
        content: s.content,
        mediaUrls: s.mediaUrls,
        scheduledAt: s.scheduledAt.toISOString(),
        status: s.status,
        thread: s.thread,
        timezone: s.timezone,
        recurrenceCron: s.recurrenceCron,
        queueOrder: s.queueOrder,
        executedAt: s.executedAt ? s.executedAt.toISOString() : null,
        error: s.error ?? null,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// PATCH /api/tweet-schedule/reorder — persist drag & drop queue order
// Body: { items: [{ id, queueOrder }] } — only the caller's rows are touched.
router.patch('/reorder', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const body = /** @type {Record<string, unknown>} */ (req.body ?? {});
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array of { id, queueOrder }' });
    }

    // Update each row, scoped to the caller's userId so a forged id cannot reorder
    // another user's row (defensive — prisma.updateMany count tells us if it landed).
    let updated = 0;
    for (const raw of items) {
      const item = /** @type {Record<string, unknown>} */ (raw);
      if (!item.id || typeof item.queueOrder !== 'number') continue;
      const r = await prisma.schedule.updateMany({
        where: { id: String(item.id), userId: reqUser.id, platform: 'twitter' },
        data: { queueOrder: item.queueOrder },
      });
      updated += r.count;
    }

    res.json({ reordered: updated });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// DELETE /api/tweet-schedule/:id — cancel: pending → cancelled (running/completed → 409)
router.delete('/:id', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    // Atomic claim: only a pending row owned by the caller can transition to cancelled.
    const claim = await prisma.schedule.updateMany({
      where: { id: req.params.id, userId: reqUser.id, platform: 'twitter', status: 'pending' },
      data: { status: 'cancelled' },
    });

    if (claim.count === 0) {
      // Either not found, not owned, or not pending. Distinguish 404 vs 409 for clear UX.
      const existing = await prisma.schedule.findFirst({
        where: { id: req.params.id, userId: reqUser.id, platform: 'twitter' },
        select: { status: true },
      });
      if (!existing) return res.status(404).json({ error: 'Schedule not found' });
      return res.status(409).json({
        error: `Cannot cancel a schedule in status "${existing.status}" (only pending can be cancelled)`,
      });
    }

    res.json({ cancelled: claim.count, id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

export default router;

// by nichxbt
