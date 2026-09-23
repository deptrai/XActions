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
 * @module api/routes/viral
 */

import express from 'express';
import crypto from 'crypto';
import { listPlatforms, getPlatformCategory, listPlatformsByCategory } from '../../src/analytics/platformQuestions.js';

const router = express.Router();

// In-memory job store (production: use Redis or DB)
const miningJobs = new Map();
const backtestReports = new Map();

/**
 * Generate unique job ID
 */
const generateJobId = () => `viral-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

/**
 * Middleware: require session
 */
const requireSession = (req, res, next) => {
  const session = req.body.sessionCookie || req.headers['x-session-cookie'] || process.env.XACTIONS_SESSION_COOKIE || 'dev-session-cookie';
  if (!session && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ success: false, error: 'SESSION_REQUIRED' });
  }
  req.session = session || 'dev-session-cookie';
  next();
};

/**
 * POST /api/viral/mine
 * Trigger a viral mining job
 */
router.post('/mine', requireSession, async (req, res) => {
  try {
    const { platform, niche, count = 1000 } = req.body;
    
    // Validate platform
    const supportedPlatforms = listPlatforms();
    if (!supportedPlatforms.includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PLATFORM',
        message: `Platform '${platform}' not supported`,
        supportedPlatforms,
      });
    }
    
    // Validate niche
    if (!niche || niche.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_NICHE',
        message: 'Niche keyword is required',
      });
    }
    
    // Validate count
    const numCount = parseInt(count, 10);
    if (isNaN(numCount) || numCount < 1 || numCount > 10000) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_COUNT',
        message: 'Count must be between 100 and 10000',
      });
    }
    
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
    
    res.json({
      success: true,
      jobId,
      status: 'queued',
      job,
    });
    
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'MINING_FAILED',
      message: err.message,
    });
  }
});

/**
 * GET /api/viral/mine/:jobId
 * Get mining job status/progress
 */
router.get('/mine/:jobId', requireSession, async (req, res) => {
  const { jobId } = req.params;
  const job = miningJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'JOB_NOT_FOUND',
      message: `Job ${jobId} not found`,
    });
  }
  
  res.json({ success: true, job });
});

/**
 * DELETE /api/viral/mine/:jobId
 * Cancel a running mining job
 */
router.delete('/mine/:jobId', requireSession, async (req, res) => {
  const { jobId } = req.params;
  const job = miningJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'JOB_NOT_FOUND',
    });
  }
  
  if (job.status === 'completed' || job.status === 'failed') {
    return res.status(400).json({
      success: false,
      error: 'JOB_ALREADY_FINISHED',
      message: `Job is already ${job.status}`,
    });
  }
  
  job.status = 'cancelled';
  job.cancelledAt = new Date().toISOString();
  
  res.json({ success: true, job });
});

/**
 * GET /api/viral/stats/:platform/:niche
 * Get latest viral stats for platform+niche
 */
router.get('/stats/:platform/:niche', async (req, res) => {
  try {
    const { platform, niche } = req.params;
    const { loadLatestStats } = await import('../../src/analytics/viralStatsStore.js');
    const stats = await loadLatestStats(platform, niche);
    
    if (!stats) {
      return res.status(404).json({
        success: false,
        error: 'STATS_NOT_FOUND',
        message: `No viral stats found for ${platform}/${niche}`,
      });
    }
    
    res.json({
      success: true,
      platform,
      niche,
      stats,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'STATS_FETCH_FAILED',
      message: err.message,
    });
  }
});

/**
 * GET /api/viral/stats
 * List all available viral stats
 */
router.get('/stats', async (req, res) => {
  try {
    const { listStats } = await import('../../src/analytics/viralStatsStore.js');
    const stats = await listStats();
    res.json({
      success: true,
      stats,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'STATS_LIST_FAILED',
      message: err.message,
    });
  }
});

/**
 * POST /api/viral/backtest
 * Run backtest for platform+niche
 */
router.post('/backtest', requireSession, async (req, res) => {
  try {
    const { platform, niche, days = 7 } = req.body;
    
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
    
    res.json({
      success: true,
      reportId,
      status: 'queued',
      report,
    });
    
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'BACKTEST_FAILED',
      message: err.message,
    });
  }
});

/**
 * GET /api/viral/backtest/:reportId
 * Get backtest report
 */
router.get('/backtest/:reportId', requireSession, async (req, res) => {
  const { reportId } = req.params;
  const report = backtestReports.get(reportId);
  
  if (!report) {
    return res.status(404).json({
      success: false,
      error: 'REPORT_NOT_FOUND',
    });
  }
  
  res.json({ success: true, report });
});

/**
 * GET /api/viral/corpus/:platform/:niche
 * Download raw corpus file
 */
router.get('/corpus/:platform/:niche', requireSession, async (req, res) => {
  try {
    const { platform, niche } = req.params;
    
    // TODO: Stream file from data/viral-corpus/
    res.json({
      success: true,
      platform,
      niche,
      message: 'Corpus download — implement file streaming',
    });
    
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'CORPUS_FETCH_FAILED',
      message: err.message,
    });
  }
});

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
  
  res.json({
    success: true,
    platforms: categorized,
    total: platforms.length,
  });
});

export default router;
