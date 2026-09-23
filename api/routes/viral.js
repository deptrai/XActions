// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Viral DNA Mining API Endpoints
 *
 * Provides REST API for Epic 45: jev-corpus-miner
 * - POST /mine — trigger viral mining job
 * - GET /mine/:jobId — get job status/progress
 * - DELETE /mine/:jobId — cancel job
 * - GET /stats/:platform/:niche — get latest viral stats
 * - GET /stats — list all stats
 * - POST /backtest — run backtest
 * - GET /backtest/:reportId — get report
 * - GET /corpus/:platform/:niche — download corpus
 * - GET /platforms — list supported platforms
 *
 * Story 46.2: sessionCookie shim → requireSession → Zod validate → handler;
 * success via res.sendData, failures via next(ApiError).
 *
 * @module api/routes/viral
 */

import express from 'express';
import crypto from 'crypto';
import { listPlatforms, getPlatformCategory } from '../../src/analytics/platformQuestions.js';
import { sessionCookieShim } from '../middleware/session-cookie-shim.js';
import { validate } from '../middleware/validate.js';
import { ApiError, asyncHandler } from '../middleware/envelope.js';
import {
  ViralMineBody,
  ViralBacktestBody,
  ViralJobIdParams,
  ViralReportIdParams,
  ViralStatsParams,
  ViralSessionHeaders,
} from '../schemas/viral.js';

const router = express.Router();

// In-memory job store (production: use Redis or DB)
const miningJobs = new Map();
const backtestReports = new Map();

/**
 * Generate unique job ID
 */
const generateJobId = () => `viral-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

/**
 * Middleware: require session.
 * Dual-read precedence is unchanged: body.sessionCookie wins over the header
 * (the shim only fills the header when it is absent). Dev fallback preserved.
 */
const requireSession = (req, _res, next) => {
  const session = req.body?.sessionCookie || req.headers['x-session-cookie'] || process.env.XACTIONS_SESSION_COOKIE || 'dev-session-cookie';
  if (!session && process.env.NODE_ENV === 'production') {
    return next(new ApiError('SESSION_REQUIRED', 401, 'Session required'));
  }
  req.session = session || 'dev-session-cookie';
  next();
};

// The stored job carries the caller's session credential for the worker — never emit it.
const publicJob = (job) => {
  if (!job || typeof job !== 'object') return job;
  const { session: _session, ...rest } = job;
  return rest;
};

// Sessioned chain: shim (transport normalization) → authenticate → validate.
const sessioned = (schemas) => [sessionCookieShim, requireSession, validate(schemas)];

/**
 * POST /api/viral/mine
 * Trigger a viral mining job
 */
router.post('/mine', ...sessioned({ body: ViralMineBody, headers: ViralSessionHeaders }), asyncHandler(async (req, res) => {
  const { platform, niche, count } = req.body;

  // Validate platform
  const supportedPlatforms = listPlatforms();
  if (!supportedPlatforms.includes(platform)) {
    throw new ApiError('INVALID_PLATFORM', 400, `Platform '${platform}' not supported`, { supportedPlatforms });
  }

  // Validate niche (schema requires min(1); this still catches whitespace-only)
  if (!niche.trim()) {
    throw new ApiError('INVALID_NICHE', 400, 'Niche keyword is required');
  }

  const numCount = count;

  // Create job
  const jobId = generateJobId();
  const job = {
    id: jobId,
    platform,
    category: getPlatformCategory(platform),
    niche: niche.trim(),
    count: numCount,
    status: 'queued',
    progress: {
      scraped: 0,
      classified: 0,
      total: numCount,
    },
    cost: {
      estimated: numCount * 14 * 0.00000048, // $0.00000048 per question
      currency: 'USD',
    },
    createdAt: new Date().toISOString(),
    session: req.session,
  };

  miningJobs.set(jobId, job);

  // Queue for processing (integrate with jobQueue.js)
  try {
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: jobId,
      type: 'viral-mining',
      config: { platform, niche, count: numCount },
      status: 'queued',
    });
  } catch (queueErr) {
    // Job queue not available — process asynchronously in background (dev mode)
    console.warn('[viral] Job queue unavailable, processing in-process background');
    (async () => {
      try {
        const { viralMine } = await import('../../src/analytics/jevViralMiner.js');
        job.status = 'running';
        const result = await viralMine(
          { platform, niche, count: numCount },
          {
            onProgress: (p) => {
              if (p.percentage != null) job.progress.percentage = p.percentage;
              if (p.completed != null) job.progress[p.phase === 'classify' ? 'classified' : 'scraped'] = p.completed;
            },
          }
        );
        job.status = 'completed';
        job.result = result;
        job.progress.scraped = result.scraped;
        job.progress.classified = result.classified;
        job.outputPath = result.outputPath;
      } catch (e) {
        job.status = 'failed';
        job.error = e.message;
      }
    })();
  }

  res.sendData({
    jobId,
    status: 'queued',
    job: publicJob(job),
  });
}));

/**
 * GET /api/viral/mine/:jobId
 * Get mining job status/progress
 */
router.get('/mine/:jobId', ...sessioned({ params: ViralJobIdParams, headers: ViralSessionHeaders }), asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = miningJobs.get(jobId);

  if (!job) {
    throw new ApiError('JOB_NOT_FOUND', 404, `Job ${jobId} not found`);
  }

  res.sendData({ job: publicJob(job) });
}));

/**
 * DELETE /api/viral/mine/:jobId
 * Cancel a running mining job
 */
router.delete('/mine/:jobId', ...sessioned({ params: ViralJobIdParams, headers: ViralSessionHeaders }), asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = miningJobs.get(jobId);

  if (!job) {
    throw new ApiError('JOB_NOT_FOUND', 404, `Job ${jobId} not found`);
  }

  if (job.status === 'completed' || job.status === 'failed') {
    throw new ApiError('JOB_ALREADY_FINISHED', 400, `Job is already ${job.status}`);
  }

  job.status = 'cancelled';
  job.cancelledAt = new Date().toISOString();

  res.sendData({ job: publicJob(job) });
}));

/**
 * GET /api/viral/stats/:platform/:niche
 * Get latest viral stats for platform+niche
 */
router.get('/stats/:platform/:niche', validate({ params: ViralStatsParams }), asyncHandler(async (req, res) => {
  try {
    const { platform, niche } = req.params;
    const { loadLatestStats } = await import('../../src/analytics/viralStatsStore.js');
    const stats = await loadLatestStats(platform, niche);

    if (!stats) {
      throw new ApiError('STATS_NOT_FOUND', 404, `No viral stats found for ${platform}/${niche}`);
    }

    res.sendData({
      platform,
      niche,
      stats,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('STATS_FETCH_FAILED', 500, err.message);
  }
}));

/**
 * GET /api/viral/stats
 * List all available viral stats
 */
router.get('/stats', asyncHandler(async (req, res) => {
  try {
    const { listStats } = await import('../../src/analytics/viralStatsStore.js');
    const stats = await listStats();
    res.sendData({ stats });
  } catch (err) {
    throw new ApiError('STATS_LIST_FAILED', 500, err.message);
  }
}));

/**
 * POST /api/viral/backtest
 * Run backtest for platform+niche
 */
router.post('/backtest', ...sessioned({ body: ViralBacktestBody, headers: ViralSessionHeaders }), asyncHandler(async (req, res) => {
  const { platform, niche, days } = req.body;

  const reportId = generateJobId();
  const report = {
    id: reportId,
    platform,
    niche,
    days,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };

  backtestReports.set(reportId, report);

  // Run backtest in background
  (async () => {
    try {
      const { runBacktest } = await import('../../src/analytics/jevBacktest.js');
      report.status = 'running';
      const result = await runBacktest({ platform, niche, days }, { session: req.session });
      report.status = 'completed';
      report.result = result;
    } catch (e) {
      report.status = 'failed';
      report.error = e.message;
    }
  })();

  res.sendData({
    reportId,
    status: 'queued',
    report,
  });
}));

/**
 * GET /api/viral/backtest/:reportId
 * Get backtest report
 */
router.get('/backtest/:reportId', ...sessioned({ params: ViralReportIdParams, headers: ViralSessionHeaders }), asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const report = backtestReports.get(reportId);

  if (!report) {
    throw new ApiError('REPORT_NOT_FOUND', 404, `Report ${reportId} not found`);
  }

  res.sendData({ report });
}));

/**
 * GET /api/viral/corpus/:platform/:niche
 * Download raw corpus file
 */
router.get('/corpus/:platform/:niche', ...sessioned({ params: ViralStatsParams, headers: ViralSessionHeaders }), asyncHandler(async (req, res) => {
  const { platform, niche } = req.params;

  // TODO: Stream file from data/viral-corpus/
  res.sendData({
    platform,
    niche,
    message: 'Corpus download — implement file streaming',
  });
}));

/**
 * GET /api/viral/platforms
 * List all supported platforms with categories
 */
router.get('/platforms', (req, res) => {
  const platforms = listPlatforms();
  const categorized = {};

  for (const platform of platforms) {
    const category = getPlatformCategory(platform);
    if (!categorized[category]) {
      categorized[category] = [];
    }
    categorized[category].push(platform);
  }

  res.sendData({
    platforms: categorized,
    total: platforms.length,
  });
});

export default router;
export { miningJobs };
