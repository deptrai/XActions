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

// Get profile info
router.get('/:username', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { username } = req.params;

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'getProfile',
        status: 'pending',
        config: JSON.stringify({ username }),
      },
    });

    await queueJob({
      type: 'getProfile',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { username, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Profile fetch queued' });
  } catch (error) {
    console.error('❌ Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update profile
router.put('/update', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    const { name, bio, location, website } = req.body;
    if (!name && !bio && !location && !website) {
      return res.status(400).json({ error: 'At least one field required' });
    }

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'updateProfile',
        status: 'pending',
        config: JSON.stringify({ name, bio, location, website }),
      },
    });

    await queueJob({
      type: 'updateProfile',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { name, bio, location, website, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Profile update queued' });
  } catch (error) {
    console.error('❌ Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
