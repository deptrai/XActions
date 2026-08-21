// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalQrLogin } from '../../../src/core/login/terminal-qr.js';
import { AbstractLogin } from '../../../src/core/base-login.js';
import { PlatformError } from '../../../src/core/error-envelope.js';

describe('Story 12.1 — TerminalQrLogin (src/core/login/terminal-qr.js)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Class Hierarchy & Contract', () => {
    it.skip('[P0] should extend AbstractLogin and have name "terminal-qr"', () => {
      const login = new TerminalQrLogin();
      expect(login).toBeInstanceOf(AbstractLogin);
      expect(login.name).toBe('terminal-qr');
    });

    it.skip('[P0] generateShortCode() should produce a clean 6-character code excluding ambiguous chars', () => {
      const login = new TerminalQrLogin();
      const code = login.generateShortCode();
      expect(code).toBeDefined();
      expect(code.length).toBe(6);
      // Excludes 0, O, I, 1, l
      expect(code).not.toMatch(/[0OI1l]/);
    });
  });

  describe('Login Polling, Countdown & Lifecycle', () => {
    it.skip('[P0] should resolve LoginResult when checkLoginState succeeds within timeout', async () => {
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
        timeoutSec: 60
      });

      const loginPromise = login.login();

      // Advance timers by 3 seconds
      await vi.advanceTimersByTimeAsync(3000);

      const result = await loginPromise;
      expect(result).toBeDefined();
      expect(result.accountId).toBe('act_twitter_123');
      expect(result.cookies.auth_token).toBe('secret_auth');
      expect(result.cookies.ct0).toBe('secret_ct0');
    });

    it.skip('[P0] should abort and throw PlatformError [QR EXPIRED] when timeout (120s) expires', async () => {
      const mockCheckLoginState = vi.fn().mockResolvedValue(false);

      const login = new TerminalQrLogin({
        platform: 'twitter',
        getQrCode: async () => 'https://x.com/i/flow/qr?token=test_session',
        checkLoginState: mockCheckLoginState,
        intervalMs: 1000,
        timeoutSec: 120
      });

      const loginPromise = login.login();

      // Advance timers beyond 120s
      const timerPromise = vi.advanceTimersByTimeAsync(121000);

      await expect(Promise.all([loginPromise, timerPromise])).rejects.toSatisfy((err) => {
        expect(err).toBeInstanceOf(PlatformError);
        expect(err.message).toContain('[QR EXPIRED]');
        expect(err.type).toBe('TIMEOUT');
        expect(err.code).toBe('XACT_4080');
        expect(err.suggestedAction).toBe('RETRY');
        return true;
      });
    });

    it.skip('[P1] should throw PlatformError [ACCOUNT CHECKPOINTED] when platform returns checkpoint', async () => {
      const mockCheckLoginState = vi.fn().mockResolvedValue({
        checkpoint: true,
        message: 'Identity verification required'
      });

      const login = new TerminalQrLogin({
        platform: 'twitter',
        getQrCode: async () => 'https://x.com/i/flow/qr?token=test_session',
        checkLoginState: mockCheckLoginState,
        intervalMs: 1000
      });

      const loginPromise = login.login();
      await vi.advanceTimersByTimeAsync(1000);

      await expect(loginPromise).rejects.toSatisfy((err) => {
        expect(err).toBeInstanceOf(PlatformError);
        expect(err.message).toContain('[ACCOUNT CHECKPOINTED]');
        expect(err.type).toBe('CHECKPOINT');
        return true;
      });
    });

    it.skip('[P0] should cleanly clear all background timers on completion (no dangling intervals)', async () => {
      const mockCheckLoginState = vi.fn().mockResolvedValue({
        authenticated: true,
        accountId: 'act_clean_timer',
        cookies: { auth_token: 'tok' }
      });

      const login = new TerminalQrLogin({
        platform: 'twitter',
        getQrCode: async () => 'https://x.com/i/flow/qr?token=test',
        checkLoginState: mockCheckLoginState,
        intervalMs: 1000
      });

      const loginPromise = login.login();
      await vi.advanceTimersByTimeAsync(1000);
      await loginPromise;

      // Verify that no timers remain active
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
