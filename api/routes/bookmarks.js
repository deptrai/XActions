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

// Get bookmarks
router.get('/', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { limit = '100', format = 'json' } = req.query;

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'getBookmarks',
        status: 'pending',
        config: JSON.stringify({ limit: parseInt(limit), format }),
      },
    });

    await queueJob({
      type: 'getBookmarks',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { limit: parseInt(limit), format, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Bookmark export queued' });
  } catch (error) {
    console.error('❌ Get bookmarks error:', error);
    res.status(500).json({ error: 'Failed to get bookmarks' });
  }
});

// Create bookmark folder (Premium+)
router.post('/folders', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'createBookmarkFolder',
        status: 'pending',
        config: JSON.stringify({ name }),
      },
    });

    await queueJob({
      type: 'createBookmarkFolder',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { name, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Folder creation queued' });
  } catch (error) {
    console.error('❌ Create folder error:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Clear all bookmarks
router.delete('/clear', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'clearBookmarks',
        status: 'pending',
        config: JSON.stringify({}),
      },
    });

    await queueJob({
      type: 'clearBookmarks',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Bookmark clear queued' });
  } catch (error) {
    console.error('❌ Clear bookmarks error:', error);
    res.status(500).json({ error: 'Failed to clear bookmarks' });
  }
});

export default router;
