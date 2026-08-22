// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../lib/prisma.js';
/**
 * @typedef {import('@prisma/client').User} User
 */
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
// Payment routes archived - XActions is now 100% free and open-source
// All credit and subscription endpoints have been removed

// All routes require authentication
router.use(authMiddleware);

// Lightweight current-user endpoint for sidebar/header display
router.get('/me', (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  const u = reqUser;
  res.json({
    id: u.id,
    username: u.username,
    twitterUsername: u.twitterUsername || null,
    twitterConnected: !!u.twitterAccessToken,
    hasSession: !!u.sessionCookie
  });
});

// Get user profile
router.get('/profile', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const user = await prisma.user.findUnique({
      where: { id: reqUser.id },
      include: {
        operations: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      // XActions is now free - unlimited access for all users
      plan: 'free_unlimited',
      twitterConnected: !!user.twitterAccessToken,
      recentOperations: user.operations
    });
  } catch (error) {
    console.error('❌ Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.patch('/profile', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { username } = /** @type {{ username?: string }} */ (req.body);

    if (username) {
      // Check if username is taken
      const existing = await prisma.user.findFirst({
        where: {
          username,
          NOT: { id: reqUser.id }
        }
      });

      if (existing) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }

    const user = await prisma.user.update({
      where: { id: reqUser.id },
      data: { username }
    });

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      plan: 'free_unlimited'
    });
  } catch (error) {
    console.error('❌ Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get user statistics
router.get('/stats', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const operations = await prisma.operation.findMany({
      where: { userId: reqUser.id }
    });

    const stats = {
      totalOperations: operations.length,
      totalUnfollows: operations.reduce((sum, op) => sum + (op.unfollowedCount || 0), 0),
      totalFollowers: operations.reduce((sum, op) => sum + (op.followedCount || 0), 0),
      operationsByType: /** @type {Record<string, number>} */ ({}),
      operationsByStatus: /** @type {Record<string, number>} */ ({})
    };

    operations.forEach(op => {
      stats.operationsByType[op.type] = (stats.operationsByType[op.type] || 0) + 1;
      stats.operationsByStatus[op.status] = (stats.operationsByStatus[op.status] || 0) + 1;
    });

    res.json(stats);
  } catch (error) {
    console.error('❌ Stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get operation history
router.get('/operations', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const { page = '1', limit = '20', type, status } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const where = /** @type {import('@prisma/client').Prisma.OperationWhereInput} */ ({ userId: reqUser.id });
    if (type) where.type = type;
    if (status) where.status = status;

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
    console.error('❌ Operations fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch operations' });
  }
});

// Delete account
router.delete('/account', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    await prisma.user.delete({
      where: { id: reqUser.id }
    });

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('❌ Account deletion error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
