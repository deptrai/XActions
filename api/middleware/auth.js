// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../lib/prisma.js';
import jwt from 'jsonwebtoken';
import { tierMeetsRequirement, getTier, isWithinLimit } from '../config/subscription-tiers.js';

/**
 * Resolve a user identifier from a decoded JWT payload.
 * Prefers `userId` over `id` over `sub`. Only accepts non-empty strings.
 * @param {Record<string, unknown>} decoded
 * @returns {string|undefined}
 */
export function resolveUserId(decoded) {
  if (!decoded || typeof decoded !== 'object') return undefined;

  const candidates = [decoded.userId, decoded.id, decoded.sub];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }
    const decoded = jwt.verify(token, secret);
    if (typeof decoded !== 'object' || decoded === null) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = resolveUserId(/** @type {Record<string, unknown>} */ (decoded));
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Attach user to request - all users have full access
    req.user = /** @type {Record<string, unknown>} */ (user);
    next();
  } catch (error) {
    if (error instanceof Error && (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError')) {
      return res.status(401).json({ error: error.name === 'JsonWebTokenError' ? 'Invalid token' : 'Token expired' });
    }
    console.error('❌ Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

// Optional auth - doesn't fail if no token, just attaches user if valid
/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return next();
    }
    const decoded = jwt.verify(token, secret);
    if (typeof decoded !== 'object' || decoded === null) {
      req.user = null;
      return next();
    }

    const userId = resolveUserId(/** @type {Record<string, unknown>} */ (decoded));
    const user = userId
      ? await prisma.user.findUnique({
          where: { id: userId }
        })
      : null;

    req.user = user ? /** @type {Record<string, unknown>} */ (user) : null;
    next();
  } catch (error) {
    if (error instanceof Error && (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError')) {
      req.user = null;
      return next();
    }
    console.error('❌ Optional auth error:', error);
    next(error);
  }
};

/**
 * Require a minimum subscription tier.
 * Loads the user's subscription from DB and checks tier level.
 * Must be used after authMiddleware.
 * @param {string} [requiredTier]
 */
const requireSubscription = (requiredTier = 'free') => {
  /**
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return async (req, res, next) => {
    if (requiredTier === 'free') return next();

    try {
      const reqUser = /** @type {Record<string, unknown>} */ (req.user);
      const reqUserId = /** @type {string} */ (reqUser.id);
      const subscription = await prisma.subscription.findUnique({
        where: { userId: reqUserId },
      });

      const userTier = (subscription?.status === 'active' || subscription?.status === 'cancelled')
        ? /** @type {string} */ (subscription.tier)
        : 'free';

      // Cancelled subs still have access until cancelAt date
      if (subscription?.status === 'cancelled' && subscription.cancelAt && subscription.cancelAt < new Date()) {
        req.userTier = 'free';
      } else {
        req.userTier = userTier;
      }

      if (!tierMeetsRequirement(/** @type {string} */ (req.userTier), requiredTier)) {
        return res.status(403).json({
          error: 'Upgrade required',
          requiredTier,
          currentTier: req.userTier,
          upgradeUrl: '/api/billing/plans',
        });
      }

      next();
    } catch (error) {
      console.error('❌ Subscription check error:', error instanceof Error ? error.message : error);
      // Fail open — don't block users if DB is down
      next();
    }
  };
};

/**
 * Check daily usage against tier limits.
 * limitKey: 'apiCallsPerDay' | 'scrapesPerDay' | 'automationsPerDay'
 * Must be used after authMiddleware.
 * @param {string} limitKey
 */
const checkUsageLimit = (limitKey) => {
  /**
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return async (req, res, next) => {
    try {
      const reqUser = /** @type {Record<string, unknown>} */ (req.user);
      const reqUserId = /** @type {string} */ (reqUser.id);
      const subscription = await prisma.subscription.findUnique({
        where: { userId: reqUserId },
      });

      const userTier = subscription?.status === 'active' ? /** @type {string} */ (subscription.tier) : 'free';
      const tierConfig = getTier(userTier);
      const tierLimits = /** @type {Record<string, number>} */ (tierConfig.limits);
      const limit = tierLimits[limitKey];

      if (limit === -1) return next(); // unlimited

      // Count today's operations
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayCount = await prisma.operation.count({
        where: {
          userId: reqUserId,
          createdAt: { gte: todayStart },
        },
      });

      if (!isWithinLimit(limit, todayCount)) {
        return res.status(429).json({
          error: 'Daily limit reached',
          limit,
          used: todayCount,
          currentTier: userTier,
          upgradeUrl: '/api/billing/plans',
        });
      }

      next();
    } catch (error) {
      console.error('❌ Usage limit check error:', error instanceof Error ? error.message : error);
      next();
    }
  };
};

/**
 * Require admin privileges
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!Boolean(req.user.isAdmin)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};

export {
  authMiddleware,
  optionalAuthMiddleware,
  requireSubscription,
  checkUsageLimit,
  requireAdmin,
};

// Also export authenticate as alias for authMiddleware for backward compatibility
export const authenticate = authMiddleware;
export const authenticateToken = authMiddleware;
