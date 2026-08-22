// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Portability Endpoints
 *
 * Export account data, migrate to other platforms, diff exports,
 * import data, convert formats, list supported platforms.
 *
 * @module api/routes/ai/portability
 */

import express from 'express';
import crypto from 'crypto';

const router = express.Router();

/**
 * @typedef {Object} JobStatus
 * @property {string} [id]
 * @property {string} [status]
 * @property {string} [type]
 * @property {number} [progress]
 * @property {Record<string, unknown>} [result]
 * @property {Record<string, unknown>} [error]
 * @property {string} [createdAt]
 * @property {string} [startedAt]
 * @property {string} [completedAt]
 */

/* ScrapedUser, ScrapedTweet, ScrapedMedia, and ScrapedBookmark types are provided globally by src/types/ai-routes.d.ts */

/**
 * @typedef {Object} VideoVariant
 * @property {string} url
 * @property {string} [quality]
 * @property {string} [contentType]
 * @property {number} [bitrate]
 */


const generateOperationId = () =>
  `ai-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

/**
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} error
 * @param {string} message
 * @param {Record<string, unknown> & { retryable?: boolean; retryAfterMs?: number }} [extras]
 */
const errorResponse = (res, statusCode, error, message, extras = {}) =>
  res.status(statusCode).json({
    success: false, error, message,
    retryable: extras.retryable ?? true,
    retryAfterMs: extras.retryAfterMs ?? 5000,
    timestamp: new Date().toISOString(),
    ...extras,
  });

/**
 * @param {import('express').Response} res
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} [meta]
 */
const successResponse = (res, data, meta = {}) =>
  res.json({ success: true, data, meta: { processedAt: new Date().toISOString(), ...meta } });

// Session middleware
router.use((req, res, next) => {
  const sessionCookie = /** @type {string | undefined} */ (req.body.sessionCookie) || /** @type {string | undefined} */ (req.headers['x-session-cookie']);
  if (!sessionCookie) {
    return res.status(400).json({ error: 'SESSION_REQUIRED', message: 'Session cookie is required' });
  }
  req.sessionCookie = sessionCookie;
  next();
});

/**
 * POST /api/ai/portability/platforms
 * List supported import/export platforms
 */
router.post('/platforms', async (req, res) => {
  return successResponse(res, {
    platforms: [
      { id: 'twitter', name: 'X / Twitter', formats: ['json', 'csv'], import: true, export: true },
      { id: 'bluesky', name: 'Bluesky (AT Protocol)', formats: ['json'], import: true, export: true },
      { id: 'mastodon', name: 'Mastodon', formats: ['json', 'csv'], import: true, export: true },
      { id: 'threads', name: 'Threads (Meta)', formats: ['json'], import: false, export: true },
      { id: 'nostr', name: 'Nostr', formats: ['json'], import: true, export: true },
    ],
    supportedFormats: ['json', 'csv', 'txt', 'ndjson'],
  });
});

/**
 * POST /api/ai/portability/export-account
 * Export full account data
 */
router.post('/export-account', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const formats = /** @type {string[] | undefined} */ (req.body.formats) ?? ['json'];
  const only = /** @type {string[] | undefined} */ (req.body.only) ?? ['profile', 'tweets', 'followers', 'following'];
  const limit = /** @type {string | number | undefined} */ (req.body.limit) ?? 1000;

  const validFormats = ['json', 'csv', 'txt'];
  const validSections = ['profile', 'tweets', 'followers', 'following', 'bookmarks', 'dms', 'likes'];
  const effectiveFormats = formats.filter(f => validFormats.includes(f));
  const effectiveSections = Array.isArray(only) ? only.filter(s => validSections.includes(s)) : validSections;
  const effectiveLimit = Math.min(Math.max(parseInt(String(limit), 10) || 1000, 100), 10000);

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'exportAccount',
      config: {
        username: username ? username.replace(/^@/, '').toLowerCase() : null,
        formats: effectiveFormats,
        sections: effectiveSections,
        limit: effectiveLimit,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    const estimatedMinutes = Math.ceil(effectiveSections.length * 2);
    return successResponse(res, {
      operationId, status: 'queued', type: 'export-account',
      config: { formats: effectiveFormats, sections: effectiveSections, limit: effectiveLimit },
      estimatedDuration: `~${estimatedMinutes} minutes`,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 15000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/portability/migrate
 * Migrate account data to another platform
 */
router.post('/migrate', async (req, res) => {
  const username = /** @type {string | undefined} */ (req.body.username);
  const platform = /** @type {string | undefined} */ (req.body.platform);
  const dryRun = /** @type {boolean | undefined} */ (req.body.dryRun) ?? true;
  const exportDir = /** @type {string | undefined} */ (req.body.exportDir);

  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });
  if (!platform) return res.status(400).json({ error: 'INVALID_INPUT', message: 'platform is required (bluesky|mastodon|nostr)' });

  const validPlatforms = ['bluesky', 'mastodon', 'nostr'];
  if (!validPlatforms.includes(platform)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: `platform must be one of: ${validPlatforms.join(', ')}` });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'migrateAccount',
      config: {
        username: username.replace(/^@/, '').toLowerCase(),
        platform, dryRun: !!dryRun,
        exportDir: exportDir || null,
        sessionCookie: (/** @type {string} */ (req.sessionCookie)),
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'migrate-account',
      config: { platform, dryRun: !!dryRun },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 15000 },
    }, { note: dryRun ? 'Dry run — no data will be written to target platform' : `Live migration to ${platform}` });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/portability/diff
 * Diff two exports to find changes
 */
router.post('/diff', async (req, res) => {
  const exportA = /** @type {ExportPortability | string | undefined} */ (req.body.exportA);
  const exportB = /** @type {ExportPortability | string | undefined} */ (req.body.exportB);
  const dirA = /** @type {string | undefined} */ (req.body.dirA);
  const dirB = /** @type {string | undefined} */ (req.body.dirB);

  if (!exportA && !exportB && !dirA && !dirB) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Provide exportA+exportB (data objects) or dirA+dirB (file paths)',
    });
  }

  // If data objects provided, diff inline
  if (exportA && exportB && typeof exportA === 'object' && typeof exportB === 'object') {
    const followersA = new Set((exportA.followers || []).map(u => u.username));
    const followersB = new Set((exportB.followers || []).map(u => u.username));
    const gained = [...followersB].filter(u => !followersA.has(u));
    const lost = [...followersA].filter(u => !followersB.has(u));

    return successResponse(res, {
      mode: 'inline',
      followers: { gained: gained.length, lost: lost.length, gainedUsers: gained, lostUsers: lost },
      tweets: {
        countA: (exportA.tweets || []).length,
        countB: (exportB.tweets || []).length,
        delta: (exportB.tweets || []).length - (exportA.tweets || []).length,
      },
    });
  }

  // File-path based diff
  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'diffExports',
      config: { dirA: dirA || null, dirB: dirB || null, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'diff-exports',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/portability/import
 * Import data from another platform
 */
router.post('/import', async (req, res) => {
  const data = /** @type {string | undefined} */ (req.body.data);
  const from = /** @type {string | undefined} */ (req.body.from);
  const dryRun = /** @type {boolean | undefined} */ (req.body.dryRun) ?? true;

  if (!data) return res.status(400).json({ error: 'INVALID_INPUT', message: 'data is required' });
  if (!from) return res.status(400).json({ error: 'INVALID_INPUT', message: 'from platform is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (/** @type {unknown} */ (await import('../../services/jobQueue.js')));
    await queueJob({
      id: operationId,
      type: 'importData',
      config: { data, from, dryRun: !!dryRun, sessionCookie: (/** @type {string} */ (req.sessionCookie)) },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'import-data',
      config: { from, dryRun: !!dryRun },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'ACTION_FAILED', _errMessage);
  
  
  }
});

/**
 * POST /api/ai/portability/convert
 * Convert data between formats (synchronous)
 */
router.post('/convert', async (req, res) => {
  const data = /** @type {string | undefined} */ (req.body.data);
  const from = /** @type {string | undefined} */ (req.body.from) ?? 'json';
  const to = /** @type {string | undefined} */ (req.body.to) ?? 'csv';

  if (!data) return res.status(400).json({ error: 'INVALID_INPUT', message: 'data is required' });

  const validFormats = ['json', 'csv', 'txt', 'ndjson'];
  if (!validFormats.includes(to)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: `to format must be one of: ${validFormats.join(', ')}` });
  }

  try {
    let converted;
    const items = Array.isArray(data) ? data : [data];

    if (to === 'csv') {
      if (items.length === 0) { converted = ''; }
      else {
        const headers = Object.keys(items[0]).join(',');
        const rows = items.map(item => Object.values(item).map(v => JSON.stringify(v)).join(','));
        converted = [headers, ...rows].join('\n');
      }
    } else if (to === 'ndjson') {
      converted = items.map(i => JSON.stringify(i)).join('\n');
    } else if (to === 'txt') {
      converted = items.map(i => typeof i === 'string' ? i : JSON.stringify(i, null, 2)).join('\n\n');
    } else {
      converted = JSON.stringify(items, null, 2);
    }

    return successResponse(res, {
      from, to,
      converted,
      itemCount: items.length,
      byteSize: Buffer.byteLength(String(converted)),
    });
  } catch (error) {
    const _errMessage = error instanceof Error ? error.message : String(error);return errorResponse(res, 500, 'CONVERSION_FAILED', _errMessage);
  
  
  }
});

export default router;
