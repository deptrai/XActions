// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TypeScript declarations for the Medirus stealth browser (Story 27.1, 27.4).
 * @author nich (@nichxbt)
 * @license MIT
 */

import type { Browser, Page } from 'puppeteer';
import type { Fingerprint, FingerprintManager } from '../core/fingerprint-manager.js';

/** Structural minimum for a caller-supplied pool (`pooled` option). */
export interface BrowserPoolLike {
  acquire(): Promise<PooledLease>;
  release(page: any): Promise<void>;
  drain?(): Promise<void>;
}

export interface PooledLease {
  page: Page;
  context: any;
  backend: string;
  waitMs: number;
  pageMs: number;
}

/** Browser-shaped handle wrapping a pool lease (Story 53.2). */
export interface PooledBrowserHandle {
  _native: any;
  _pooled: true;
  _pool: BrowserPoolLike;
  _lease: PooledLease;
  _adapter?: string;
  __backend: string;
  __fingerprint?: Fingerprint;
}

export interface StealthBrowserOptions {
  pooled?: boolean | BrowserPoolLike;
  proxy?: string | { url?: string; server?: string; username?: string; password?: string };
  headless?: boolean;
  userDataDir?: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
  fingerprint?: Fingerprint;
  fingerprintManager?: FingerprintManager;
  accountId?: string;
  platform?: string;
  backend?: string;
  fallbackBackend?: string;
  wsEndpoint?: string;
  requiresAuth?: boolean;
  telemetryContext?: any;
}

export interface StealthPageOptions {
  proxy?: string | { url?: string; server?: string; username?: string; password?: string };
  userAgent?: string;
  fingerprint?: Fingerprint;
  fingerprintManager?: FingerprintManager;
  accountId?: string;
  platform?: string;
}

export function launchStealthBrowser(options?: StealthBrowserOptions): Promise<Browser | PooledBrowserHandle>;
export function closeStealthBrowser(browser: any): Promise<void>;
export function createStealthPage(browser: Browser | PooledBrowserHandle | any, options?: StealthPageOptions): Promise<Page>;
export function getDefaultPool(backend: string, poolOptions?: Record<string, unknown>): Promise<BrowserPoolLike>;
export function resetDefaultPools(): Promise<void>;
export function stealthClick(page: Page, selector: string, options?: { steps?: number }): Promise<void>;
export function stealthType(page: Page, selector: string, text: string): Promise<void>;

declare const _default: {
  launchStealthBrowser: typeof launchStealthBrowser;
  closeStealthBrowser: typeof closeStealthBrowser;
  createStealthPage: typeof createStealthPage;
  getDefaultPool: typeof getDefaultPool;
  resetDefaultPools: typeof resetDefaultPools;
  stealthClick: typeof stealthClick;
  stealthType: typeof stealthType;
};
export default _default;
