// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../lib/prisma.js';
/**
 * @typedef {import('@prisma/client').User} User
 */
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getTwitterClient } from './twitter.js';
import { queueJob } from '../services/jobQueue.js';

// Payment routes archived - XActions is now 100% free and open-source
// All credit checks have been removed - unlimited operations for all users

const router = express.Router();
// All routes require authentication
router.use(authMiddleware);

// Unfollow non-followers
router.post('/unfollow-non-followers', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected - use OAuth or Session Cookie' });
    }

    const { maxUnfollows = 100, dryRun = false } = req.body;

    // Create operation record
    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'unfollowNonFollowers',
        status: 'pending',
        config: JSON.stringify({ maxUnfollows, dryRun })
      }
    });

    // Queue the job
    await queueJob({
      type: 'unfollowNonFollowers',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { 
        maxUnfollows, 
        dryRun,
        username: reqUser.twitterUsername,
        sessionCookie: reqUser.sessionCookie
      }
    });

    res.json({
      operationId: operation.id,
      status: 'queued',
      message: 'Unfollow operation queued successfully'
    });
  } catch (error) {
    console.error('❌ Unfollow non-followers error:', error);
    res.status(500).json({ error: 'Failed to start unfollow operation' });
  }
});

// Unfollow everyone
router.post('/unfollow-everyone', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected - use OAuth or Session Cookie' });
    }

    const { maxUnfollows = 100, dryRun = false } = req.body;

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'unfollowEveryone',
        status: 'pending',
        config: JSON.stringify({ maxUnfollows, dryRun })
      }
    });

    await queueJob({
      type: 'unfollowEveryone',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { 
        maxUnfollows, 
        dryRun,
        username: reqUser.twitterUsername,
        sessionCookie: reqUser.sessionCookie
      }
    });

    res.json({
      operationId: operation.id,
      status: 'queued',
      message: 'Unfollow everyone operation queued successfully'
    });
  } catch (error) {
    console.error('❌ Unfollow everyone error:', error);
    res.status(500).json({ error: 'Failed to start unfollow operation' });
  }
});

// Detect unfollowers
router.post('/detect-unfollowers', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected - use OAuth or Session Cookie' });
    }

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'detectUnfollowers',
        status: 'pending',
        config: JSON.stringify({})
      }
    });

    await queueJob({
      type: 'detectUnfollowers',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: {
        username: reqUser.twitterUsername,
        sessionCookie: reqUser.sessionCookie
      }
    });

    res.json({
      operationId: operation.id,
      status: 'queued',
      message: 'Detect unfollowers operation queued successfully'
    });
  } catch (error) {
    console.error('❌ Detect unfollowers error:', error);
    res.status(500).json({ error: 'Failed to start detect operation' });
  }
});

// Get operation status
router.get('/status/:operationId', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { operationId } = req.params;

    const operation = await prisma.operation.findFirst({
      where: {
        id: operationId,
        userId: reqUser.id
      }
    });

    if (!operation) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    res.json(operation);
  } catch (error) {
    console.error('❌ Operation status error:', error);
    res.status(500).json({ error: 'Failed to fetch operation status' });
  }
});

// Cancel operation
router.post('/cancel/:operationId', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { operationId } = req.params;

    const operation = await prisma.operation.findFirst({
      where: {
        id: operationId,
        userId: reqUser.id,
        status: { in: ['pending', 'processing'] }
      }
    });

    if (!operation) {
      return res.status(404).json({ error: 'Operation not found or already completed' });
    }

    await prisma.operation.update({
      where: { id: operationId },
      data: { status: 'cancelled' }
    });

    res.json({ message: 'Operation cancelled successfully' });
  } catch (error) {
    console.error('❌ Operation cancellation error:', error);
    res.status(500).json({ error: 'Failed to cancel operation' });
  }
});

// List all operations
router.get('/', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { page = '1', limit = '20', status, type } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = /** @type {Record<string, string>} */ ({ userId: reqUser.id });
    if (status) where.status = status;
    if (type) where.type = type;

    const [operations, total] = await Promise.all([
      prisma.operation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.operation.count({ where })
    ]);

    res.json({
      operations,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('❌ Operations list error:', error);
    res.status(500).json({ error: 'Failed to fetch operations' });
  }
});

export default router;
