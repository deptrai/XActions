// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Notifications API Routes
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { Router } from 'express';

/**
 * @typedef {Object} Notifier
 * @property {(opts: Record<string, unknown>) => Promise<Record<string, unknown>>} send
 * @property {(channel: string) => Promise<Record<string, unknown>>} test
 * @property {(opts: Record<string, unknown>) => Record<string, unknown>} configure
 */

const router = Router();

// POST /api/notifications/send
router.post('/send', async (req, res) => {
  try {
    const { getNotifier } = await import('../../src/notifications/notifier.js');
    const notifier = /** @type {Notifier} */ (await getNotifier());
    const body = /** @type {Record<string, string>} */ (req.body);
    const { title, message, severity } = body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const result = await notifier.send({ title, message, severity });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// POST /api/notifications/test/:channel
router.post('/test/:channel', async (req, res) => {
  try {
    const { getNotifier } = await import('../../src/notifications/notifier.js');
    const notifier = /** @type {Notifier} */ (await getNotifier());
    const result = await notifier.test(req.params.channel);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// POST /api/notifications/configure
router.post('/configure', async (req, res) => {
  try {
    const { getNotifier } = await import('../../src/notifications/notifier.js');
    const notifier = /** @type {Notifier} */ (await getNotifier());
    const body = /** @type {Record<string, unknown>} */ (req.body);
    const result = notifier.configure(body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

export default router;

// by nichxbt
