// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TerminalQrLogin — Terminal ASCII QR Code authentication handler.
 * Implements frictionless login with 1:1 ASCII QR, real-time countdown,
 * cryptographically secure shortcodes, non-TTY fallback, and secure cookie persistence.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractLogin } from '../base-login.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../error-envelope.js';
import { globalSessionManager } from '../session-manager.js';
import { displayTerminalQrCode, isTty } from '../../utils/qrcode.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/** @typedef {import('../types.js').LoginResult} LoginResult */

const SHORT_CODE_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export class TerminalQrLogin extends AbstractLogin {
  /** @type {string} */
  name = 'terminal-qr';

  /**
   * @param {Object} [options]
   * @param {string} [options.platform='twitter']
   * @param {string[]} [options.requiredCookies]
   * @param {Function} [options.getQrCode]
   * @param {Function} [options.checkLoginState]
   * @param {string} [options.cookiePath]
   * @param {number} [options.intervalMs=1000]
   * @param {number} [options.timeoutSec=120]
   * @param {number} [options.countdownSec=60]
   * @param {boolean} [options.quiet=false]
   * @param {AbortSignal} [options.signal]
   */
  constructor(options = {}) {
    super();
    this.options = options;
    this.platform = options.platform || 'twitter';
    this.intervalMs = options.intervalMs || 1000;
    this.timeoutSec = options.timeoutSec || 120;
    this.countdownSec = options.countdownSec || 60;
    
    // Multi-platform cookie filename isolation
    const defaultCookieFilename = this.platform.toLowerCase() === 'twitter' 
      ? 'cookies.json' 
      : `cookies-${this.platform.toLowerCase()}.json`;
    this.cookiePath = options.cookiePath || path.join(os.homedir(), '.xactions', defaultCookieFilename);
  }

  /**
   * Generate a cryptographically secure 6-character short code without ambiguous characters.
   * @returns {string}
   */
  generateShortCode() {
    let result = '';
    for (let i = 0; i < 6; i++) {
      const idx = crypto.randomInt(0, SHORT_CODE_CHARSET.length);
      result += SHORT_CODE_CHARSET[idx];
    }
    return result;
  }

  /**
   * Resolve required cookies based on platform if not explicitly specified.
   * @returns {string[]}
   */
  getRequiredCookies() {
    if (this.options.requiredCookies && Array.isArray(this.options.requiredCookies)) {
      return this.options.requiredCookies;
    }
    switch (this.platform.toLowerCase()) {
      case 'facebook':
        return ['c_user', 'xs'];
      case 'twitter':
      default:
        return ['auth_token', 'ct0'];
    }
  }

  /**
   * Validate that cookie object contains all required keys for the target platform.
   * @param {Object} cookies
   * @returns {boolean}
   */
  validateCookies(cookies) {
    if (!cookies || typeof cookies !== 'object') return false;
    const required = this.getRequiredCookies();
    return required.every(key => Boolean(cookies[key]));
  }

  /**
   * Execute the QR login lifecycle.
   * @param {Object} [runtimeOptions]
   * @returns {Promise<LoginResult>}
   */
  async login(runtimeOptions = {}) {
    const opts = { ...this.options, ...runtimeOptions };
    const platform = opts.platform || this.platform;
    const intervalMs = opts.intervalMs || this.intervalMs;
    const timeoutSec = opts.timeoutSec || this.timeoutSec;
    const targetCookiePath = opts.cookiePath || this.cookiePath;
    const shortCode = this.generateShortCode();

    // Check pre-aborted signal immediately
    if (opts.signal?.aborted) {
      throw new PlatformError({
        type: 'CANCELLED',
        code: 'XACT_4099',
        message: '[LOGIN CANCELLED] Login aborted by user signal',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform
      });
    }

    // 1. Get QR code data/URL
    let qrData = '';
    if (typeof opts.getQrCode === 'function') {
      qrData = await opts.getQrCode();
    } else if (opts.qrUrl) {
      qrData = opts.qrUrl;
    } else {
      qrData = `https://x.com/i/flow/qr?code=${shortCode}&platform=${platform}`;
    }

    // 2. Render QR code or Non-TTY fallback
    if (!opts.quiet) {
      try {
        const rendered = await displayTerminalQrCode(qrData, {
          shortCode,
          showUrl: true
        });
        if (isTty()) {
          console.log(rendered);
        } else {
          process.stdout.write(rendered);
        }
      } catch (err) {
        console.warn(`[QR WARNING] Could not display QR: ${err.message}`);
      }
    }

    // 3. Polling loop with timeout, locking, and cleanup
    return new Promise((resolve, reject) => {
      let isDone = false;
      let inFlight = false;
      let remainingSeconds = timeoutSec;
      let intervalId = null;

      const cleanup = () => {
        isDone = true;
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        if (!opts.quiet && isTty()) {
          process.stdout.write('\r\x1b[K');
        }
      };

      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          cleanup();
          reject(new PlatformError({
            type: 'CANCELLED',
            code: 'XACT_4099',
            message: '[LOGIN CANCELLED] Login aborted by user signal',
            suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
            platform
          }));
        }, { once: true });
      }

      const poll = async () => {
        if (isDone || inFlight) return;
        inFlight = true;

        try {
          let checkResult = null;

          // Polling source: custom checkLoginState function OR file polling from disk
          if (typeof opts.checkLoginState === 'function') {
            checkResult = await opts.checkLoginState();
          } else if (targetCookiePath) {
            try {
              const fileContent = await fs.readFile(targetCookiePath, 'utf-8');
              const parsed = JSON.parse(fileContent);
              if (this.validateCookies(parsed)) {
                checkResult = { authenticated: true, cookies: parsed };
              }
            } catch {
              // File does not exist yet or is being written; continue polling
            }
          }

          if (isDone) return;

          if (checkResult) {
            // Checkpoint required
            if (checkResult.checkpoint) {
              cleanup();
              return reject(new PlatformError({
                type: 'CHECKPOINT',
                code: 'XACT_4031',
                message: `[ACCOUNT CHECKPOINTED] ${checkResult.message || 'Identity verification required on platform'}`,
                suggestedAction: SuggestedActions.RELOGIN,
                platform
              }));
            }

            // Successfully authenticated
            if (checkResult.authenticated || checkResult.cookies) {
              const cookies = checkResult.cookies || {};
              if (this.validateCookies(cookies) || checkResult.authenticated) {
                cleanup();

                const accountId = checkResult.accountId || `act_${platform}_${Date.now()}`;
                const loginResult = {
                  accountId,
                  cookies,
                  tokens: checkResult.tokens || {},
                  expiresAt: checkResult.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                };

                // Save cookies to session manager
                globalSessionManager.set(accountId, loginResult);

                // Save to local file if path is specified and cookies object is valid
                try {
                  if (targetCookiePath && cookies && typeof cookies === 'object' && Object.keys(cookies).length > 0) {
                    const dir = path.dirname(targetCookiePath);
                    await fs.mkdir(dir, { recursive: true });
                    await fs.writeFile(
                      targetCookiePath,
                      JSON.stringify(cookies, null, 2),
                      { mode: 0o600 }
                    );
                  }
                } catch (err) {
                  console.warn(`[WARNING] Failed to write cookie file: ${err.message}`);
                }

                if (!opts.quiet && isTty()) {
                  process.stdout.write(`\r\x1b[K✅ Account active (${accountId})\n`);
                }

                return resolve(loginResult);
              }
            }
          }

          remainingSeconds -= intervalMs >= 1000 ? Math.round(intervalMs / 1000) : (intervalMs / 1000);

          if (!opts.quiet && isTty()) {
            if (remainingSeconds <= this.countdownSec && remainingSeconds > 0) {
              process.stdout.write(`\r\x1b[K⚠️  QR expiring soon... (${Math.round(remainingSeconds)}s remaining)`);
            } else if (remainingSeconds > 0) {
              process.stdout.write(`\r\x1b[K⏳ Scan the QR code. Expires in ${Math.round(remainingSeconds)}s...`);
            }
          }

          if (remainingSeconds <= 0) {
            cleanup();
            return reject(new PlatformError({
              type: 'TIMEOUT',
              code: 'XACT_4080',
              message: `[QR EXPIRED] Login timeout (${timeoutSec}s). Run again to generate a new QR code.`,
              suggestedAction: 'RETRY',
              isRetryable: true,
              platform
            }));
          }
        } catch (pollErr) {
          // Allow transient network errors to retry during polling loop
          if (pollErr instanceof PlatformError && (pollErr.type === 'CHECKPOINT' || pollErr.type === 'CANCELLED')) {
            cleanup();
            return reject(pollErr);
          }
          // Log transient warning and continue polling until timeout
          if (!opts.quiet) {
            console.warn(`[POLL WARNING] Transient error during poll: ${pollErr.message}`);
          }
        } finally {
          inFlight = false;
        }
      };

      intervalId = setInterval(poll, intervalMs);
      if (typeof intervalId.unref === 'function') {
        intervalId.unref();
      }
    });
  }
}
