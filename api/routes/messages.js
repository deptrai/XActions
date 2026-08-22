// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../lib/prisma.js';
/**
 * @typedef {import('@prisma/client').User} User
 */
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { queueJob } from '../services/jobQueue.js';

const router = express.Router();
router.use(authMiddleware);

// Send a DM
router.post('/send', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    const { username, message } = req.body;
    if (!username || !message) {
      return res.status(400).json({ error: 'Username and message are required' });
    }

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'sendDM',
        status: 'pending',
        config: JSON.stringify({ username, message }),
      },
    });

    await queueJob({
      type: 'sendDM',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { username, message, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'DM queued' });
  } catch (error) {
    console.error('❌ Send DM error:', error);
    res.status(500).json({ error: 'Failed to send DM' });
  }
});

// Get conversations
router.get('/conversations', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { limit = '20' } = req.query;

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'getConversations',
        status: 'pending',
        config: JSON.stringify({ limit: parseInt(limit) }),
      },
    });

    await queueJob({
      type: 'getConversations',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { limit: parseInt(limit), sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Conversations fetch queued' });
  } catch (error) {
    console.error('❌ Conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Export DMs
router.get('/export', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { format = 'json', limit = '100' } = req.query;

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'exportDMs',
        status: 'pending',
        config: JSON.stringify({ format, limit: parseInt(limit) }),
      },
    });

    await queueJob({
      type: 'exportDMs',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { format, limit: parseInt(limit), sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'DM export queued' });
  } catch (error) {
    console.error('❌ Export DMs error:', error);
    res.status(500).json({ error: 'Failed to export DMs' });
  }
});

export default router;
