// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * SelectorCanary — Periodic DOM Probe & Drift Alert (Story 28.2).
 * Periodically probes public test targets per platform with a stealth browser,
 * detects DOM selector drift across fallback chains, updates GovernorStatus,
 * and dispatches alerts when success rate remains below 0.8 for two consecutive runs.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { globalAdaptiveRateGovernor } from '../core/adaptive-governor.js';
import { defaultAlertDispatcher } from '../../api/services/benchmark/alerting.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class SelectorCanary {
  /** @type {Record<string, Array<import('../core/types.js').CanaryTargetConfig>> | null} */
  #config = null;

  /** @type {string | null} */
  #configPath = null;

  /** @type {Function | null} */
  #browserFactory = null;

  /** @type {Function | null} */
  #createPage = null;

  /** @type {Function | null} */
  #closeBrowserFn = null;

  /** @type {any} */
  #alertDispatcher = null;

  /** @type {import('../core/adaptive-governor.js').AdaptiveRateGovernor | null} */
  #governor = null;

  /** @type {() => number} */
  #now = () => Date.now();

  /** @type {number} */
  #delayMs = 1000;

  /** @type {string | null} */
  #cronSchedule = null;

  /** @type {import('node-cron').ScheduledTask | null} */
  #cronTask = null;

  /** @type {boolean} */
  #isRunning = false;

  /** @type {Map<string, Array<{ successRate: number, usedFallback: boolean, driftDetected: boolean, lastWorkingSelector: string | null, timestamp: number }>>} */
  #runHistory = new Map();

  /** @type {Map<string, number>} */
  #consecutiveFailures = new Map();

  /** @type {Map<string, string>} */
  #lastWorkingSelectors = new Map();

  /** @type {Map<string, import('../core/types.js').PlatformDriftStatus & { usedFallback?: boolean, driftDetected?: boolean }>} */
  #driftStatuses = new Map();

  /**
   * @param {Object} [options]
   * @param {Record<string, Array<import('../core/types.js').CanaryTargetConfig>>} [options.config]
   * @param {string} [options.configPath]
   * @param {Function} [options.browserFactory]
   * @param {Function} [options.createPage]
   * @param {Function} [options.closeBrowser]
   * @param {any} [options.alertDispatcher]
   * @param {import('../core/adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {() => number} [options.now]
   * @param {number} [options.delayMs=1000] Delay between DOM actions in ms (pass 0 in unit tests)
   * @param {string} [options.cronSchedule]
   */
  constructor(options = {}) {
    this.#config = options.config || null;
    this.#configPath = options.configPath || null;
    this.#browserFactory = options.browserFactory || null;
    this.#createPage = options.createPage || null;
    this.#closeBrowserFn = options.closeBrowser || null;
    this.#alertDispatcher = options.alertDispatcher || defaultAlertDispatcher;
    this.#governor = options.governor || globalAdaptiveRateGovernor;
    this.#now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.#delayMs = options.delayMs !== undefined ? options.delayMs : 1000;
    this.#cronSchedule = options.cronSchedule || null;
  }

  /**
   * Load targets configuration from memory or disk.
   * @returns {Record<string, Array<import('../core/types.js').CanaryTargetConfig>> | null}
   */
  #loadConfig() {
    if (this.#config) {
      return this.#config;
    }
    const resolvedPath = this.#configPath || path.resolve(__dirname, '../../config/canary-targets.json');
    try {
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`⚠️ [SelectorCanary] Canary targets config not found at: ${resolvedPath}`);
        return null;
      }
      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
        console.warn('⚠️ [SelectorCanary] Canary targets config is empty or invalid.');
        return null;
      }
      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ [SelectorCanary] Failed to load canary targets config: ${msg}`);
      return null;
    }
  }

  /**
   * Launch stealth browser or invoke injected factory.
   */
  async #launchBrowser() {
    if (this.#browserFactory) {
      return await this.#browserFactory();
    }
    const { launchStealthBrowser } = await import('../scraping/stealthBrowser.js');
    return await launchStealthBrowser({
      backend: 'obscura',
      fallbackBackend: 'chrome',
      requiresAuth: false,
      headless: true,
    });
  }

  /**
   * Create stealth page or invoke injected page factory.
   * @param {any} browser
   */
  async #getPage(browser) {
    if (this.#createPage) {
      return await this.#createPage(browser);
    }
    if (typeof browser.createPage === 'function') {
      return await browser.createPage();
    }
    if (this.#browserFactory && typeof browser.newPage === 'function') {
      return await browser.newPage();
    }
    try {
      const { createStealthPage } = await import('../scraping/stealthBrowser.js');
      return await createStealthPage(browser);
    } catch (err) {
      if (typeof browser.newPage === 'function') {
        return await browser.newPage();
      }
      throw err;
    }
  }

  /**
   * Safely teardown stealth browser instance.
   * @param {any} browser
   */
  async #closeBrowser(browser) {
    if (!browser) return;
    if (this.#closeBrowserFn) {
      return await this.#closeBrowserFn(browser);
    }
    try {
      const { closeStealthBrowser } = await import('../scraping/stealthBrowser.js');
      await closeStealthBrowser(browser);
    } catch {
      if (typeof browser.close === 'function') {
        await browser.close();
      }
    }
  }

  /**
   * Run one complete canary probe cycle across all configured platforms and targets.
   * @returns {Promise<Record<string, import('../core/types.js').SelectorCanaryResult>>}
   */
  async runOnce() {
    if (this.#isRunning) {
      console.warn('⚠️ [SelectorCanary] Probe run already in progress, skipping concurrent run.');
      return {};
    }
    this.#isRunning = true;

    try {
      const config = this.#loadConfig();
      if (!config) {
        return {};
      }

      /** @type {Record<string, import('../core/types.js').SelectorCanaryResult>} */
      const results = {};
      const platforms = Object.keys(config);

      for (const platform of platforms) {
        const rawTargets = config[platform];
        if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
          console.warn(`⚠️ [SelectorCanary] Platform "${platform}" has no target entries, skipping.`);
          continue;
        }

        // Filter valid targets with non-empty selector chains
        const validTargets = rawTargets.filter((t) => {
          if (!t || !t.url || !Array.isArray(t.selectorChain) || t.selectorChain.length === 0) {
            console.warn(`⚠️ [SelectorCanary] Target "${t?.name || 'unknown'}" has invalid or empty selectorChain, skipping.`);
            return false;
          }
          return true;
        });

        if (validTargets.length === 0) {
          console.warn(`⚠️ [SelectorCanary] No valid targets to probe for platform "${platform}".`);
          continue;
        }

        let succeededCount = 0;
        let platformUsedFallback = false;
        let platformDriftDetected = false;
        let platformLastWorkingSelector = null;
        let browserLaunchFailed = false;

        let browser = null;
        try {
          browser = await this.#launchBrowser();
        } catch (err) {
          browserLaunchFailed = true;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`⚠️ [SelectorCanary] Browser launch failed for platform "${platform}": ${msg}`);
        }

        if (browserLaunchFailed) {
          succeededCount = 0;
          platformDriftDetected = true;
          platformUsedFallback = false;
        } else {
          try {
            for (const target of validTargets) {
              let page = null;
              let targetMatchedSelector = null;
              let targetUsedFallback = false;

              try {
                page = await this.#getPage(browser);
                await page.goto(target.url, {
                  waitUntil: 'domcontentloaded',
                  timeout: 30000,
                });

                if (this.#delayMs > 0) {
                  await new Promise((res) => setTimeout(res, this.#delayMs));
                }

                for (let i = 0; i < target.selectorChain.length; i++) {
                  const selector = target.selectorChain[i];
                  let element = null;
                  try {
                    element = await page.$(selector);
                  } catch {
                    element = null;
                  }

                  if (element) {
                    targetMatchedSelector = selector;
                    if (i > 0) {
                      targetUsedFallback = true;
                    }
                    break;
                  }
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`⚠️ [SelectorCanary] Navigation / probe error on "${target.name || target.url}": ${msg}`);
              } finally {
                if (page && typeof page.close === 'function') {
                  await page.close().catch(() => {});
                }
              }

              if (targetMatchedSelector) {
                succeededCount++;
                platformLastWorkingSelector = targetMatchedSelector;
                if (targetUsedFallback) {
                  platformUsedFallback = true;
                  platformDriftDetected = true;
                }
              } else {
                platformDriftDetected = true;
              }
            }
          } finally {
            if (browser) {
              await this.#closeBrowser(browser).catch(() => {});
            }
          }
        }

        const successRate = validTargets.length > 0 ? Number((succeededCount / validTargets.length).toFixed(4)) : 0;
        const nowTs = this.#now();
        const lastProbe = new Date(nowTs).toISOString();

        if (platformLastWorkingSelector) {
          this.#lastWorkingSelectors.set(platform, platformLastWorkingSelector);
        }
        const effectiveLastWorking = platformLastWorkingSelector || this.#lastWorkingSelectors.get(platform) || null;

        // In-memory rolling history (last 10 runs per platform)
        const history = this.#runHistory.get(platform) || [];
        history.push({
          successRate,
          usedFallback: platformUsedFallback,
          driftDetected: platformDriftDetected,
          lastWorkingSelector: effectiveLastWorking,
          timestamp: nowTs,
        });
        if (history.length > 10) {
          history.shift();
        }
        this.#runHistory.set(platform, history);

        // Consecutive failure evaluation (threshold < 0.8)
        let consecutiveFailures = 0;
        if (successRate < 0.8) {
          consecutiveFailures = (this.#consecutiveFailures.get(platform) || 0) + 1;
        } else {
          consecutiveFailures = 0;
        }
        this.#consecutiveFailures.set(platform, consecutiveFailures);

        const alert = consecutiveFailures >= 2;

        if (alert && this.#alertDispatcher && typeof this.#alertDispatcher.dispatchAlert === 'function') {
          try {
            await this.#alertDispatcher.dispatchAlert({
              scraperId: `selector-canary:${platform}`,
              platform,
              previousTier: 'B',
              currentTier: 'C',
              healthScore: Math.round(successRate * 100),
              reason: `Selector drift: successRate ${successRate.toFixed(2)} < 0.8 for ${consecutiveFailures} consecutive runs`,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ [SelectorCanary] Alert dispatch failed for platform "${platform}": ${msg}`);
          }
        }

        /** @type {import('../core/types.js').PlatformDriftStatus} */
        const driftStatus = {
          alert,
          successRate,
          lastProbe,
          ...(effectiveLastWorking ? { lastWorkingSelector: effectiveLastWorking } : {}),
          consecutiveFailures,
        };

        if (this.#governor && typeof this.#governor.setPlatformDrift === 'function') {
          this.#governor.setPlatformDrift(platform, driftStatus);
        }

        this.#driftStatuses.set(platform, {
          ...driftStatus,
          usedFallback: platformUsedFallback,
          driftDetected: platformDriftDetected,
        });

        results[platform] = {
          platform,
          successRate,
          usedFallback: platformUsedFallback,
          driftDetected: platformDriftDetected,
          lastWorkingSelector: effectiveLastWorking,
          lastProbe,
          consecutiveFailures,
          alert,
        };
      }

      return results;
    } finally {
      this.#isRunning = false;
    }
  }

  /**
   * Get current platform drift status map.
   * @returns {Record<string, import('../core/types.js').PlatformDriftStatus>}
   */
  getStatus() {
    return Object.fromEntries(this.#driftStatuses.entries());
  }

  /**
   * Start scheduled periodic selector canary probes.
   * @param {string} [cronSchedule]
   * @returns {boolean}
   */
  startScheduler(cronSchedule) {
    if (this.#cronTask) {
      return false;
    }
    const schedule = cronSchedule || process.env.SELECTOR_CANARY_CRON || this.#cronSchedule || '0 * * * *';
    if (!cron.validate(schedule)) {
      console.error(`❌ [SelectorCanary] Invalid cron schedule expression: "${schedule}". Scheduler not started.`);
      return false;
    }
    console.log(`⏱️ [SelectorCanary] Starting selector canary scheduler (${schedule})...`);
    this.#cronTask = cron.schedule(schedule, async () => {
      try {
        console.log('🔄 [SelectorCanary] Running scheduled DOM selector probe...');
        await this.runOnce();
        console.log('✅ [SelectorCanary] Scheduled DOM selector probe completed.');
      } catch (err) {
        console.error('❌ [SelectorCanary] Error during scheduled selector probe:', err);
      }
    });
    return true;
  }

  /**
   * Stop scheduled selector canary probes.
   */
  stopScheduler() {
    if (this.#cronTask) {
      this.#cronTask.stop();
      this.#cronTask = null;
      console.log('🛑 [SelectorCanary] Selector canary scheduler stopped.');
    }
  }
}

export const globalSelectorCanary = new SelectorCanary();
