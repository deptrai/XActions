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

// Post a tweet
router.post('/tweet', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    const body = /** @type {Record<string, unknown>} */ (req.body);
    const text = String(body.text || '');
    if (!text) return res.status(400).json({ error: 'Tweet text is required' });
    if (text.length > 25000) return res.status(400).json({ error: 'Tweet exceeds max length' });
    const replyTo = body.replyTo;
    const quoteTweetId = body.quoteTweetId;

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'postTweet',
        status: 'pending',
        config: JSON.stringify({ text, replyTo, quoteTweetId }),
      },
    });

    await queueJob({
      type: 'postTweet',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { text, replyTo, quoteTweetId, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Tweet queued' });
  } catch (error) {
    console.error('❌ Post tweet error:', error);
    res.status(500).json({ error: 'Failed to post tweet' });
  }
});

// Post a thread
router.post('/thread', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    const body = /** @type {Record<string, unknown>} */ (req.body);
    const tweets = Array.isArray(body.tweets) ? body.tweets : [];
    if (tweets.length < 2) {
      return res.status(400).json({ error: 'Thread requires at least 2 tweets' });
    }

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'postThread',
        status: 'pending',
        config: JSON.stringify({ tweets }),
      },
    });

    await queueJob({
      type: 'postThread',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { tweets, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Thread queued' });
  } catch (error) {
    console.error('❌ Post thread error:', error);
    res.status(500).json({ error: 'Failed to post thread' });
  }
});

// Create a poll
router.post('/poll', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    const body = /** @type {Record<string, unknown>} */ (req.body);
    const question = String(body.question || '');
    const options = Array.isArray(body.options) ? body.options.map(String) : [];
    const durationMinutes = Number(body.durationMinutes) || 1440;
    if (!question) return res.status(400).json({ error: 'Poll question is required' });
    if (options.length < 2 || options.length > 4) {
      return res.status(400).json({ error: 'Poll requires 2-4 options' });
    }

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'createPoll',
        status: 'pending',
        config: JSON.stringify({ question, options, durationMinutes }),
      },
    });

    await queueJob({
      type: 'createPoll',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { question, options, durationMinutes, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Poll queued' });
  } catch (error) {
    console.error('❌ Create poll error:', error);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// Schedule a post
router.post('/schedule', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    const body = /** @type {Record<string, unknown>} */ (req.body);
    const text = String(body.text || '');
    const scheduledAt = String(body.scheduledAt || '');
    if (!text) return res.status(400).json({ error: 'Tweet text is required' });
    if (!scheduledAt) return res.status(400).json({ error: 'Schedule time is required' });

    const scheduleDate = new Date(scheduledAt);
    if (scheduleDate <= new Date()) {
      return res.status(400).json({ error: 'Schedule time must be in the future' });
    }

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'schedulePost',
        status: 'pending',
        config: JSON.stringify({ text, scheduledAt }),
      },
    });

    await queueJob({
      type: 'schedulePost',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { text, scheduledAt, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Scheduled post queued' });
  } catch (error) {
    console.error('❌ Schedule post error:', error);
    res.status(500).json({ error: 'Failed to schedule post' });
  }
});

// Delete a tweet
router.delete('/tweet/:tweetId', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    if (!reqUser.twitterAccessToken && !reqUser.sessionCookie) {
      return res.status(400).json({ error: 'Twitter account not connected' });
    }

    const { tweetId } = req.params;

    const operation = await prisma.operation.create({
      data: {
        userId: reqUser.id,
        type: 'deleteTweet',
        status: 'pending',
        config: JSON.stringify({ tweetId }),
      },
    });

    await queueJob({
      type: 'deleteTweet',
      operationId: operation.id,
      userId: reqUser.id,
      authMethod: reqUser.authMethod || 'oauth',
      config: { tweetId, sessionCookie: reqUser.sessionCookie },
    });

    res.json({ operationId: operation.id, status: 'queued', message: 'Delete queued' });
  } catch (error) {
    console.error('❌ Delete tweet error:', error);
    res.status(500).json({ error: 'Failed to delete tweet' });
  }
});

export default router;
