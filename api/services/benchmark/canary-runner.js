// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CanaryRunner — Synthetic canary probe executor and scheduler for low-volume and critical scrapers.
 * Runs hourly probes per platform against fixed test URLs (AD-23), uses dedicated probe accounts (AD-35),
 * validates responses for False-200 / Checkpoints, records telemetry (AD-33), and persists to ScraperCanaryRun.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import crypto from 'node:crypto';
import cron from 'node-cron';
import prismaClient from '../../lib/prisma.js';
import { defaultTelemetryEmitter } from '../../../src/core/telemetry-emitter.js';
import { globalAccountPool } from '../../../src/core/account-pool.js';
import {
  CANARY_CONFIGS,
  DEFAULT_CANARY_CRON,
  DEFAULT_CANARY_TIMEOUT_MS,
} from '../../../src/benchmark/canary-config.js';

// Platform response validators
import { TwitterPlatformResponseValidator } from '../../../src/scrapers/social/twitter/validator.js';
import { FacebookPlatformResponseValidator } from '../../../src/scrapers/social/facebook/validator.js';
import { ThreadsPlatformResponseValidator } from '../../../src/scrapers/social/threads/validator.js';
import { TikTokPlatformResponseValidator } from '../../../src/scrapers/social/tiktok/validator.js';
import { ShopeePlatformResponseValidator } from '../../../src/scrapers/ecom/shopee/validator.js';
import { FnbPlatformResponseValidator } from '../../../src/scrapers/fnb/merchant/validator.js';
import { MaSoThuePlatformResponseValidator } from '../../../src/scrapers/procurement/masothue/validator.js';
import { YouTubePlatformResponseValidator } from '../../../src/scrapers/social/youtube/validator.js';
import { ZaloPlatformResponseValidator } from '../../../src/scrapers/social/zalo/validator.js';

export class CanaryRunner {
  /** @type {import('@prisma/client').PrismaClient} */
  #prisma;

  /** @type {import('../../../src/core/telemetry-emitter.js').TelemetryEmitter} */
  #telemetryEmitter;

  /** @type {import('../../../src/core/account-pool.js').AccountPool} */
  #accountPool;

  /** @type {Record<string, any>} */
  #canaryConfigs;

  /** @type {Function | null} */
  #fetchSeam;

  /** @type {number} */
  #timeoutMs;

  /** @type {import('node-cron').ScheduledTask | null} */
  #cronTask = null;

  /** @type {boolean} */
  #isProbing = false;

  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   * @param {import('../../../src/core/telemetry-emitter.js').TelemetryEmitter} [deps.telemetryEmitter]
   * @param {import('../../../src/core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {Record<string, any>} [deps.canaryConfigs]
   * @param {Function} [deps.fetchSeam]
   * @param {number} [deps.timeoutMs]
   */
  constructor(deps = {}) {
    this.#prisma = deps.prisma || prismaClient;
    this.#telemetryEmitter = deps.telemetryEmitter || defaultTelemetryEmitter;
    this.#accountPool = deps.accountPool || globalAccountPool;
    this.#canaryConfigs = deps.canaryConfigs || CANARY_CONFIGS;
    this.#fetchSeam = deps.fetchSeam || null;
    this.#timeoutMs = deps.timeoutMs || DEFAULT_CANARY_TIMEOUT_MS;
  }

  /**
   * Resolve appropriate platform validator by platform key.
   * @param {string} platform
   * @returns {import('../../../src/core/platform-validator.js').AbstractPlatformResponseValidator | null}
   */
  getValidator(platform) {
    switch (platform) {
      case 'twitter':
        return new TwitterPlatformResponseValidator();
      case 'facebook':
        return new FacebookPlatformResponseValidator();
      case 'threads':
        return new ThreadsPlatformResponseValidator();
      case 'tiktok':
        return new TikTokPlatformResponseValidator();
      case 'shopee':
        return new ShopeePlatformResponseValidator();
      case 'fnb':
      case 'fnb_merchant':
        return new FnbPlatformResponseValidator();
      case 'masothue':
        return new MaSoThuePlatformResponseValidator();
      case 'youtube':
        return new YouTubePlatformResponseValidator();
      case 'zalo':
        return new ZaloPlatformResponseValidator();
      default:
        return null;
    }
  }

  /**
   * Check if a dedicated probe account is available in AccountPool (AD-35).
   * @param {string} platform
   * @param {string} [probeAccountKey]
   * @returns {Object | null}
   */
  #findProbeAccount(platform, probeAccountKey) {
    if (!this.#accountPool) return null;

    if (probeAccountKey) {
      const specific = this.#accountPool.getAccount(probeAccountKey, platform);
      if (specific) return specific;
    }

    if (typeof this.#accountPool.listAccountDetails === 'function') {
      const accounts = this.#accountPool.listAccountDetails(platform);
      const probeAccount = accounts.find(
        (acc) => {
          const accRecord = /** @type {Record<string, unknown>} */ (acc);
          return accRecord.isProbe === true ||
            (/** @type {Record<string, unknown>} */ (accRecord.credentials))?.probe === true ||
            String(accRecord.accountId || '').startsWith('probe-');
        }
      );
      if (probeAccount) {
        const probeAccountRecord = /** @type {Record<string, unknown>} */ (probeAccount);
        return this.#accountPool.getAccount(String(probeAccountRecord.accountId), platform);
      }
    }

    return null;
  }

  /**
   * Execute a single synthetic canary probe for a scraper.
   * @param {string} scraperId
   * @param {{ timeoutMs?: number }} [options]
   * @returns {Promise<Record<string, any>>}
   */
  async probe(scraperId, options = {}) {
    const config = this.#canaryConfigs[scraperId];
    if (!config) {
      return {
        scraperId,
        isSuccess: false,
        errorReason: `Scraper "${scraperId}" not found in canary configuration`,
      };
    }

    const runId = crypto.randomUUID();
    const timeoutMs = options.timeoutMs || this.#timeoutMs;

    // AD-35: Enforce dedicated probe account isolation on auth-required platforms
    if (config.authRequired) {
      const probeAccount = this.#findProbeAccount(config.platform, config.probeAccountKey);
      if (!probeAccount) {
        const failureRecord = {
          scraperId,
          platform: config.platform,
          targetUrl: config.targetUrl,
          isSuccess: false,
          latencyMs: 0,
          httpStatus: 401,
          false200Detected: false,
          checkpointDetected: false,
          errorReason: 'Dedicated probe account unavailable (AD-35)',
          executedAt: new Date(),
        };

        // Emit failure telemetry
        this.#telemetryEmitter.emitRun({
          runId,
          source: 'canary',
          isCanary: true,
          scraperId,
          platform: config.platform,
          category: config.category,
          success: false,
          errorReason: failureRecord.errorReason,
          latencyMs: 0,
          timestamp: failureRecord.executedAt.toISOString(),
        });

        // Persist failure to PostgreSQL
        try {
          if (this.#prisma?.scraperCanaryRun?.create) {
            await this.#prisma.scraperCanaryRun.create({ data: failureRecord });
          }
        } catch (dbErr) {
          const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
          console.warn(`[CanaryRunner] Failed to persist probe account failure for ${scraperId}:`, msg);
        }

        return failureRecord;
      }
    }

    const startTime = Date.now();
    let httpStatus = 500;
    let latencyMs = 0;
    let false200Detected = false;
    let checkpointDetected = false;
    let errorReason = null;
    let isSuccess = false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchFn = this.#fetchSeam || globalThis.fetch;
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'X-Canary-Probe': 'true',
      };

      const response = await fetchFn(config.targetUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);
      latencyMs = Math.max(1, Date.now() - startTime);
      httpStatus = response.status;

      let text = '';
      let json = null;
      try {
        text = await response.text();
        try {
          json = JSON.parse(text);
        } catch {}
      } catch {}

      const validator = this.getValidator(config.platform);
      let isLogin = false;
      if (validator) {
        const resObj = {
          status: httpStatus,
          statusCode: httpStatus,
          data: json,
          body: text,
          text: () => Promise.resolve(text),
        };

        const validation = validator.validateResponse(resObj);
        false200Detected = Boolean(validation.isFalse200);
        checkpointDetected = Boolean(validation.isCheckpoint);
        isLogin = Boolean(validator.isLoginWall && validator.isLoginWall(resObj));
      }

      isSuccess = httpStatus >= 200 && httpStatus < 400 && !false200Detected && !checkpointDetected;
      if (!isSuccess) {
        if (isLogin) {
          errorReason = 'Checkpoint or login wall detected';
        } else if (false200Detected) {
          errorReason = 'False 200 challenge page detected';
        } else if (checkpointDetected) {
          errorReason = 'Checkpoint or login wall detected';
        } else {
          errorReason = `HTTP ${httpStatus} error`;
        }
      }
    } catch (err) {
      clearTimeout(timer);
      const e = /** @type {Error} */ (err);
      latencyMs = Math.max(1, Date.now() - startTime);
      if (e.name === 'AbortError' || latencyMs >= timeoutMs) {
        httpStatus = 504;
        latencyMs = timeoutMs;
        errorReason = `Probe timed out after ${timeoutMs}ms`;
      } else {
        httpStatus = 502;
        errorReason = e.message || 'Probe transport failed';
      }
      isSuccess = false;
    }

    const canaryRecord = {
      scraperId,
      platform: config.platform,
      targetUrl: config.targetUrl,
      isSuccess,
      latencyMs: Math.round(latencyMs),
      httpStatus,
      false200Detected,
      checkpointDetected,
      errorReason: isSuccess ? null : errorReason,
      executedAt: new Date(),
    };

    // Emit canary telemetry (AD-33)
    this.#telemetryEmitter.emitRun({
      runId,
      source: 'canary',
      isCanary: true,
      scraperId,
      platform: config.platform,
      category: config.category,
      success: isSuccess,
      errorReason: canaryRecord.errorReason,
      latencyMs: canaryRecord.latencyMs,
      timestamp: canaryRecord.executedAt.toISOString(),
    });

    // Write to ScraperCanaryRun table
    try {
      if (this.#prisma?.scraperCanaryRun?.create) {
        await this.#prisma.scraperCanaryRun.create({ data: canaryRecord });
      }
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.warn(`[CanaryRunner] Failed to persist canary run for ${scraperId}:`, msg);
    }

    return canaryRecord;
  }

  /**
   * Run synthetic canary probes across all configured scrapers.
   * @param {Object} [options]
   * @returns {Promise<{ total: number, succeeded: number, failed: number, results: Array<Record<string, any>>, skipped?: boolean }>}
   */
  async probeAll(options = {}) {
    if (this.#isProbing) {
      console.warn('⚠️ [CanaryRunner] Previous probeAll cycle is still executing. Skipping overlapping run.');
      return { total: 0, succeeded: 0, failed: 0, results: [], skipped: true };
    }

    this.#isProbing = true;
    const scraperIds = Object.keys(this.#canaryConfigs);
    const results = [];
    let succeeded = 0;
    let failed = 0;

    try {
      for (const id of scraperIds) {
        try {
          const res = await this.probe(id, options);
          results.push(res);
          if (res.isSuccess) {
            succeeded++;
          } else {
            failed++;
          }
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ scraperId: id, isSuccess: false, errorReason: msg });
        }
      }
    } finally {
      this.#isProbing = false;
    }

    return {
      total: scraperIds.length,
      succeeded,
      failed,
      results,
    };
  }

  /**
   * Start hourly scheduled canary probes (NFR-20).
   * @param {string} [cronSchedule=DEFAULT_CANARY_CRON]
   */
  startScheduler(cronSchedule = DEFAULT_CANARY_CRON) {
    if (this.#cronTask) {
      return;
    }

    console.log(`⏱️ [CanaryRunner] Starting synthetic canary scheduler (${cronSchedule})...`);
    this.#cronTask = cron.schedule(cronSchedule, async () => {
      try {
        const outcome = await this.probeAll();
        console.log(
          `✅ [CanaryRunner] Canary cycle completed: ${outcome.succeeded}/${outcome.total} succeeded, ${outcome.failed} failed.`
        );
      } catch (err) {
        console.error('[CanaryRunner] Unhandled error during scheduled canary cycle:', err);
      }
    });
  }

  /**
   * Stop scheduled canary probes.
   */
  stopScheduler() {
    if (this.#cronTask) {
      this.#cronTask.stop();
      this.#cronTask = null;
      console.log('🛑 [CanaryRunner] Canary scheduler stopped.');
    }
  }
}

export const defaultCanaryRunner = new CanaryRunner();
