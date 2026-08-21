// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalQrLogin } from '../../../src/core/login/terminal-qr.js';
import { AbstractLogin } from '../../../src/core/base-login.js';
import { PlatformError } from '../../../src/core/error-envelope.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Story 12.1 — TerminalQrLogin (src/core/login/terminal-qr.js)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Class Hierarchy & Contract', () => {
    it('[P0] should extend AbstractLogin and have name "terminal-qr"', () => {
      const login = new TerminalQrLogin();
      expect(login).toBeInstanceOf(AbstractLogin);
      expect(login.name).toBe('terminal-qr');
    });

    it('[P0] generateShortCode() should produce a clean 6-character code excluding ambiguous chars', () => {
      const login = new TerminalQrLogin();
      const code = login.generateShortCode();
      expect(code).toBeDefined();
      expect(code.length).toBe(6);
      expect(code).not.toMatch(/[0OI1l]/);
    });

    it('[P1] should isolate cookiePath by platform (cookies.json vs cookies-facebook.json)', () => {
      const twitterLogin = new TerminalQrLogin({ platform: 'twitter' });
      expect(twitterLogin.cookiePath).toContain('cookies.json');

      const facebookLogin = new TerminalQrLogin({ platform: 'facebook' });
      expect(facebookLogin.cookiePath).toContain('cookies-facebook.json');
    });
  });

  describe('Login Polling, Countdown & Lifecycle', () => {
    it('[P0] should resolve LoginResult when checkLoginState succeeds within timeout', async () => {
      let callCount = 0;
      const mockCheckLoginState = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount >= 3) {
          return {
            authenticated: true,
            accountId: 'act_twitter_123',
            cookies: { auth_token: 'secret_auth', ct0: 'secret_ct0' },
            tokens: { bearer: 'bearer_token' }
          };
        }
        return false;
      });

      const login = new TerminalQrLogin({
        platform: 'twitter',
        getQrCode: async () => 'https://x.com/i/flow/qr?token=test_session',
        checkLoginState: mockCheckLoginState,
        intervalMs: 1000,
        timeoutSec: 60,
        quiet: true
      });

      const loginPromise = login.login();
      await vi.advanceTimersByTimeAsync(3000);

      const result = await loginPromise;
      expect(result).toBeDefined();
      expect(result.accountId).toBe('act_twitter_123');
      expect(result.cookies.auth_token).toBe('secret_auth');
      expect(result.cookies.ct0).toBe('secret_ct0');
    });

    it('[P0] should abort and throw PlatformError [QR EXPIRED] when timeout (120s) expires', async () => {
      const mockCheckLoginState = vi.fn().mockResolvedValue(false);

      const login = new TerminalQrLogin({
        platform: 'twitter',
        getQrCode: async () => 'https://x.com/i/flow/qr?token=test_session',
        checkLoginState: mockCheckLoginState,
        intervalMs: 1000,
        timeoutSec: 120,
        quiet: true
      });

      const assertion = expect(login.login()).rejects.toSatisfy((err) => {
        expect(err).toBeInstanceOf(PlatformError);
        expect(err.message).toContain('[QR EXPIRED]');
        expect(err.type).toBe('TIMEOUT');
        expect(err.code).toBe('XACT_4080');
        expect(err.suggestedAction).toBe('RETRY');
        return true;
      });

      await vi.advanceTimersByTimeAsync(121000);
      await assertion;
    });

    it('[P0] should reject immediately when AbortSignal is pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const login = new TerminalQrLogin({
        platform: 'twitter',
        signal: controller.signal,
        quiet: true
      });

      await expect(login.login()).rejects.toSatisfy((err) => {
        expect(err).toBeInstanceOf(PlatformError);
        expect(err.type).toBe('CANCELLED');
        expect(err.message).toContain('[LOGIN CANCELLED]');
        return true;
      });
    });

    it('[P1] should throw PlatformError [ACCOUNT CHECKPOINTED] when platform returns checkpoint', async () => {
      const mockCheckLoginState = vi.fn().mockResolvedValue({
        checkpoint: true,
        message: 'Identity verification required'
      });

      const login = new TerminalQrLogin({
        platform: 'twitter',
        getQrCode: async () => 'https://x.com/i/flow/qr?token=test_session',
        checkLoginState: mockCheckLoginState,
        intervalMs: 1000,
        quiet: true
      });

      const assertion = expect(login.login()).rejects.toSatisfy((err) => {
        expect(err).toBeInstanceOf(PlatformError);
        expect(err.message).toContain('[ACCOUNT CHECKPOINTED]');
        expect(err.type).toBe('CHECKPOINT');
        return true;
      });

      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    });

    it('[P0] should cleanly clear all background timers on completion (no dangling intervals)', async () => {
      const mockCheckLoginState = vi.fn().mockResolvedValue({
        authenticated: true,
        accountId: 'act_clean_timer',
        cookies: { auth_token: 'tok', ct0: 'csrf' }
      });

      const login = new TerminalQrLogin({
        platform: 'twitter',
        getQrCode: async () => 'https://x.com/i/flow/qr?token=test',
        checkLoginState: mockCheckLoginState,
        intervalMs: 1000,
        quiet: true
      });

      const loginPromise = login.login();
      await vi.advanceTimersByTimeAsync(1000);
      await loginPromise;

      expect(vi.getTimerCount()).toBe(0);
    });

    it('[P0] should save cookie file with secure 0o600 file permissions upon success', async () => {
      const tempCookiePath = path.join(os.tmpdir(), `test-cookies-${Date.now()}.json`);
      const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue();

      const mockCheckLoginState = vi.fn().mockResolvedValue({
        authenticated: true,
        accountId: 'act_perm_test',
        cookies: { auth_token: 'valid_auth', ct0: 'valid_ct0' }
      });

      const login = new TerminalQrLogin({
        platform: 'twitter',
        cookiePath: tempCookiePath,
        checkLoginState: mockCheckLoginState,
        intervalMs: 1000,
        quiet: true
      });

      const loginPromise = login.login();
      await vi.advanceTimersByTimeAsync(1000);
      await loginPromise;

      expect(writeFileSpy).toHaveBeenCalledWith(
        tempCookiePath,
        expect.stringContaining('valid_auth'),
        expect.objectContaining({ mode: 0o600 })
      );
    });
  });
});
