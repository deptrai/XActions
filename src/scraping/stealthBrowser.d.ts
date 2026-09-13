// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TypeScript declarations for the XActions stealth browser (Story 27.1).
 * @author nich (@nichxbt)
 * @license MIT
 */

import type { Browser, Page } from 'puppeteer';
import type { Fingerprint, FingerprintManager } from '../core/fingerprint-manager.js';

export interface StealthBrowserOptions {
  proxy?: string | { url?: string; server?: string; username?: string; password?: string };
  headless?: boolean;
  userDataDir?: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
  fingerprint?: Fingerprint;
  fingerprintManager?: FingerprintManager;
  accountId?: string;
  platform?: string;
}

export interface StealthPageOptions {
  proxy?: string | { url?: string; server?: string; username?: string; password?: string };
  userAgent?: string;
  fingerprint?: Fingerprint;
  fingerprintManager?: FingerprintManager;
  accountId?: string;
  platform?: string;
}

export function launchStealthBrowser(options?: StealthBrowserOptions): Promise<Browser>;
export function createStealthPage(browser: Browser, options?: StealthPageOptions): Promise<Page>;
export function stealthClick(page: Page, selector: string, options?: { steps?: number }): Promise<void>;
export function stealthType(page: Page, selector: string, text: string): Promise<void>;

declare const _default: {
  launchStealthBrowser: typeof launchStealthBrowser;
  createStealthPage: typeof createStealthPage;
  stealthClick: typeof stealthClick;
  stealthType: typeof stealthType;
};
export default _default;
