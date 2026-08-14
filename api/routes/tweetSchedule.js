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
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { scheduleTweet } from '../services/tweetScheduling.js';
const router = express.Router();
router.use(authMiddleware);

/**
 * Parse a comma-separated thread string ("t2,t3") into a string[].
 * Returns undefined when the input is empty/absent (single tweet).
 */
function parseThread(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

// POST /api/tweet-schedule — create a scheduled tweet (dry-run by default)
router.post('/', async (req, res) => {
  try {
    const { content, mediaUrls, scheduledAt, thread, timezone, recurrenceCron, queueOrder, dryRun } = req.body ?? {};

    // Caller's authenticated user id scopes the row — never trust a body userId.
    const result = await scheduleTweet(
      { content, mediaUrls, scheduledAt, thread: parseThread(thread), timezone, recurrenceCron, queueOrder },
      { dryRun: dryRun === false ? false : true, userId: req.user.id },
    );
    res.json(result);
  } catch (error) {
    // Validation errors are caller faults; surface the message so the dashboard can show it.
    const status = /^❌ scheduleTweet:/.test(error.message) ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
});

// GET /api/tweet-schedule — list the caller's schedules (optional ?status= filter)
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const where = { userId: req.user.id, platform: 'twitter' };
    if (status) where.status = String(status);

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
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/tweet-schedule/reorder — persist drag & drop queue order
// Body: { items: [{ id, queueOrder }] } — only the caller's rows are touched.
router.patch('/reorder', async (req, res) => {
  try {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array of { id, queueOrder }' });
    }

    // Update each row, scoped to the caller's userId so a forged id cannot reorder
    // another user's row (defensive — prisma.updateMany count tells us if it landed).
    let updated = 0;
    for (const item of items) {
      if (!item?.id || typeof item.queueOrder !== 'number') continue;
      const r = await prisma.schedule.updateMany({
        where: { id: String(item.id), userId: req.user.id, platform: 'twitter' },
        data: { queueOrder: item.queueOrder },
      });
      updated += r.count;
    }

    res.json({ reordered: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tweet-schedule/:id — cancel: pending → cancelled (running/completed → 409)
router.delete('/:id', async (req, res) => {
  try {
    // Atomic claim: only a pending row owned by the caller can transition to cancelled.
    const claim = await prisma.schedule.updateMany({
      where: { id: req.params.id, userId: req.user.id, platform: 'twitter', status: 'pending' },
      data: { status: 'cancelled' },
    });

    if (claim.count === 0) {
      // Either not found, not owned, or not pending. Distinguish 404 vs 409 for clear UX.
      const existing = await prisma.schedule.findFirst({
        where: { id: req.params.id, userId: req.user.id, platform: 'twitter' },
        select: { status: true },
      });
      if (!existing) return res.status(404).json({ error: 'Schedule not found' });
      return res.status(409).json({
        error: `Cannot cancel a schedule in status "${existing.status}" (only pending can be cancelled)`,
      });
    }

    res.json({ cancelled: claim.count, id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

// by nichxbt
