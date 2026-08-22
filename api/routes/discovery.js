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

// Search tweets
router.get('/search', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { query, limit = '50', filter } = req.query;
    if (!query) return res.status(400).json({ error: 'Search query is required' });

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'searchTweets',
        status: 'pending',
        config: JSON.stringify({ query, limit: parseInt(limit), filter }),
      },
    });

    await queueJob({
      type: 'searchTweets',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { query, limit: parseInt(limit), filter, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Search queued' });
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ error: 'Failed to search' });
  }
});

// Get trends
router.get('/trends', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { category } = req.query;

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'getTrends',
        status: 'pending',
        config: JSON.stringify({ category }),
      },
    });

    await queueJob({
      type: 'getTrends',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { category, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Trends fetch queued' });
  } catch (error) {
    console.error('❌ Trends error:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

// Get explore feed
router.get('/explore', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { category = 'trending', limit = '30' } = req.query;

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'getExploreFeed',
        status: 'pending',
        config: JSON.stringify({ category, limit: parseInt(limit) }),
      },
    });

    await queueJob({
      type: 'getExploreFeed',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { category, limit: parseInt(limit), sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Explore feed fetch queued' });
  } catch (error) {
    console.error('❌ Explore error:', error);
    res.status(500).json({ error: 'Failed to fetch explore feed' });
  }
});

export default router;
