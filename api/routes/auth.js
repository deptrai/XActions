// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import prisma from '../lib/prisma.js';
import express from 'express';
import { resolveUserId } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { validate } from '../middleware/validate.js';
import { ApiError, asyncHandler } from '../middleware/envelope.js';
import { RegisterBody, LoginBody, RefreshBody } from '../schemas/auth.js';

const router = express.Router();

/** Dev-only details bag for 500s — mirrors the previous register/login hint. */
function devErrorDetails(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    detail: message,
    hint: message.includes('connect') || message.includes('ECONNREFUSED')
      ? 'PostgreSQL is not running. Start it with: docker compose up -d postgres'
      : undefined,
  };
}

// Register new user (email optional)
router.post('/register',
  validate({ body: RegisterBody }),
  asyncHandler(async (req, res) => {
    try {
      const { password, username, email } = req.body;

      // Check if username exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { username },
            ...(email ? [{ email }] : [])
          ]
        }
      });

      if (existingUser) {
        if (existingUser.username === username) {
          throw new ApiError('USERNAME_TAKEN', 400, 'Username already taken');
        }
        if (email && existingUser.email === email) {
          throw new ApiError('EMAIL_TAKEN', 400, 'Email already registered');
        }
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user with 0 credits (must follow or buy to get credits)
      const user = await prisma.user.create({
        data: {
          email: email || null,  // Email is optional
          username,
          password: hashedPassword,
          credits: 0,
          subscription: {
            create: {
              tier: 'free',
              status: 'active',
              startDate: new Date()
            }
          }
        },
        include: {
          subscription: true
        }
      });

      // Generate JWT (use username if no email)
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_SECRET || '',
        { expiresIn: '7d' }
      );

      res.sendData({
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          credits: user.credits,
          subscription: user.subscription
        }
      }, 201);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('❌ Registration error:', (error instanceof Error ? error.message : String(error)));
      throw new ApiError(
        'INTERNAL',
        500,
        'Registration failed',
        process.env.NODE_ENV !== 'production' ? devErrorDetails(error) : undefined
      );
    }
  })
);

// Login (accepts username OR email)
router.post('/login',
  validate({ body: LoginBody }),
  asyncHandler(async (req, res) => {
    try {
      const { identifier, password } = req.body;

      // Find user by email OR username
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: identifier.toLowerCase() },
            { username: identifier }
          ]
        },
        include: { subscription: true }
      });

      if (!user) {
        throw new ApiError('UNAUTHORIZED', 401, 'Invalid credentials');
      }

      // Check if user has a password (guest users don't)
      if (!user.password) {
        throw new ApiError('UNAUTHORIZED', 401, 'This account was created as a guest. Please set a password first.', { needsPassword: true });
      }

      // Verify password
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        throw new ApiError('UNAUTHORIZED', 401, 'Invalid credentials');
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_SECRET || '',
        { expiresIn: '7d' }
      );

      res.sendData({
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          credits: user.credits,
          subscription: user.subscription,
          twitterConnected: !!user.twitterAccessToken
        }
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('❌ Login error:', (error instanceof Error ? error.message : String(error)));
      throw new ApiError(
        'INTERNAL',
        500,
        'Login failed',
        process.env.NODE_ENV !== 'production' ? devErrorDetails(error) : undefined
      );
    }
  })
);

// Refresh token — only allow refresh within 24 hours of expiration
router.post('/refresh',
  validate({ body: RefreshBody }),
  asyncHandler(async (req, res) => {
    try {
      const { token } = req.body;

      // Verify signature first, then validate the refresh window and payload.
      // ignoreExpiration allows recently-expired tokens to be refreshed.
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || '', { ignoreExpiration: true });
      } catch (verifyError) {
        throw new ApiError('UNAUTHORIZED', 401, 'Invalid token');
      }

      if (!decoded || typeof decoded.exp !== 'number') {
        throw new ApiError('UNAUTHORIZED', 401, 'Invalid token');
      }

      const userId = resolveUserId(decoded);
      if (!userId) {
        throw new ApiError('UNAUTHORIZED', 401, 'Invalid token');
      }

      // Only allow refresh if token expired within the last 24 hours
      const now = Math.floor(Date.now() / 1000);
      const maxRefreshWindow = 24 * 60 * 60; // 24 hours
      if (decoded.exp < now - maxRefreshWindow) {
        throw new ApiError('UNAUTHORIZED', 401, 'Token too old to refresh — please log in again');
      }

      // Verify user still exists
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new ApiError('UNAUTHORIZED', 401, 'User not found');
      }

      // Generate new token
      const newToken = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_SECRET || '',
        { expiresIn: '7d' }
      );

      res.sendData({ token: newToken });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('❌ Refresh token error:', error);
      throw new ApiError('INTERNAL', 500, 'Authentication error');
    }
  })
);

export default router;
