// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TypeScript declarations for the XActions Browser Page Pool (Story 53.1, AD-24).
 * @author nich (@nichxbt)
 * @license MIT
 */

import type { Browser, BrowserContext, Page } from 'puppeteer';
import type { Fingerprint, FingerprintManager } from '../core/fingerprint-manager.js';
import type { StealthBrowserOptions } from './stealthBrowser.js';

export interface BrowserPoolOptions {
  /** Max concurrent slots (default env `XACTIONS_BROWSER_POOL_SIZE`, then 4). */
  size?: number;
  /** Isolated-context ceiling per browser before spawning another (default 5 chrome / 3 obscura). */
  contextsPerBrowser?: number;
  /** Max wait for a slot; 0 = forever. */
  acquireTimeoutMs?: number;
  /** 'chrome' | 'obscura' */
  backend?: string;
  /** Default 'none' inside a pool — no silent backend swap mid-run. */
  fallbackBackend?: string;
  /** Obscura CDP endpoint. */
  wsEndpoint?: string;
  proxy?: StealthBrowserOptions['proxy'];
  headless?: boolean;
  /** Post-auth guard (AD-23): obscura rejected upstream. */
  requiresAuth?: boolean;
  /** @internal subclasses set false — use SharedContextPool instead. */
  isolated?: boolean;
  telemetryContext?: any;
  userDataDir?: string;
  userAgent?: string;
  fingerprint?: Fingerprint;
  fingerprintManager?: FingerprintManager;
  accountId?: string;
  platform?: string;
}

export interface PoolAcquire {
  page: Page;
  /** Isolated BrowserContext — null for SharedContextPool. */
  context: BrowserContext | null;
  /** 'chrome' | 'obscura' — actual backend serving this page. */
  backend: string;
  /** Time spent queued for a slot. */
  waitMs: number;
  /** Context+page creation time. */
  pageMs: number;
}

export interface PoolStats {
  size: number;
  active: number;
  queued: number;
  browsers: number;
  draining: boolean;
}

export class PoolDrainingError extends Error {}
export class PoolAcquireTimeoutError extends Error {
  timeoutMs: number;
  constructor(timeoutMs: number);
}

export class BrowserPool {
  constructor(options?: BrowserPoolOptions);
  acquire(): Promise<PoolAcquire>;
  release(page: Page): Promise<void>;
  drain(): Promise<void>;
  stats(): PoolStats;
}

/**
 * Shared default-context pool — anonymous public scraping only (AD-24 Rule 2).
 * Cookies/storage ARE shared between jobs.
 */
export class SharedContextPool extends BrowserPool {}
