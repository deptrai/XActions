// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// P0-3: Cookie/token leak detection — NFR4 compliance
// Verifies that c_user, xs, auth_token values never appear in console output,
// error messages, or API response bodies.
// by nichxbt

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loginWithCookie } from '../../src/scrapers/facebook/index.js';
import { runGuardedBatch, ACCOUNT_RISK_WARNING } from '../../api/services/facebookAutomation.js';

const FAKE_C_USER = '67890123456';
const FAKE_XS = 'xs_secret_value_abc123def456';
const FAKE_AUTH_TOKEN = 'auth_token_secret_xyz789';

function makeFakePage({ bodyText = '', cookies = [] } = {}) {
  const consoleMessages = [];
  const setCookieCalls = [];
  return {
    _consoleMessages: consoleMessages,
    _setCookieCalls: setCookieCalls,
    url: () => 'https://www.facebook.com/',
    goto: vi.fn().mockResolvedValue({ ok: true }),
    content: vi.fn().mockResolvedValue('<html><body></body></html>'),
    setCookie: vi.fn(async (cookie) => {
      setCookieCalls.push({ name: cookie.name, value: cookie.value });
    }),
    evaluate: vi.fn(async (fn) => {
      if (typeof fn === 'function') {
        const fnStr = fn.toString();
        if (fnStr.includes('hasLoginForm') || fnStr.includes('hasSecurityCheck')) {
          const norm = bodyText.normalize('NFC').toLowerCase();
          return {
            hasLoginForm: bodyText.includes('login') && bodyText.includes('password') && !bodyText.includes('Welcome'),
            hasLoginButton: bodyText.includes('Log in') && bodyText.includes('password'),
            hasSecurityCheck: norm.includes('confirm that you are a real person') ||
              (norm.includes('confirm that you') && norm.includes('human')) ||
              norm.includes('security check') ||
              norm.includes('confirmez que vous') ||
              norm.includes('vérification de sécurité') ||
              norm.includes('verification de securite') ||
              norm.includes('enter the text from the image') ||
              norm.includes('hear this code'),
          };
        }
        return fn;
      }
      return fn;
    }),
    waitForSelector: vi.fn().mockResolvedValue(null),
    $: vi.fn().mockResolvedValue(null),
    $$: vi.fn().mockResolvedValue([]),
    on: vi.fn((event, cb) => {
      if (event === 'console') {
        consoleMessages.push(cb);
      }
    }),
  };
}

describe('P0-3: Cookie/token leak detection (NFR4)', () => {
  let consoleWarnSpy;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('loginWithCookie — cookie values not leaked', () => {
    it('does not log c_user or xs values on successful login', async () => {
      const page = makeFakePage({ bodyText: 'Welcome to Facebook' });
      await loginWithCookie(page, { c_user: FAKE_C_USER, xs: FAKE_XS });

      const allConsoleOutput = [
        ...consoleWarnSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
        ...consoleLogSpy.mock.calls.flat(),
      ].join(' ');

      expect(allConsoleOutput).not.toContain(FAKE_C_USER);
      expect(allConsoleOutput).not.toContain(FAKE_XS);
    });

    it('does not log cookie values when invalid cookie is skipped', async () => {
      const page = makeFakePage({ bodyText: 'Welcome to Facebook' });
      page.setCookie = vi.fn(async (cookie) => {
        if (cookie.name === 'sb') throw new Error('Invalid cookie format');
      });

      await loginWithCookie(page, {
        c_user: FAKE_C_USER,
        xs: FAKE_XS,
        sb: 'sb_secret_value',
      });

      const allConsoleOutput = [...consoleWarnSpy.mock.calls.flat()].join(' ');
      expect(allConsoleOutput).not.toContain(FAKE_C_USER);
      expect(allConsoleOutput).not.toContain(FAKE_XS);
      expect(allConsoleOutput).not.toContain('sb_secret_value');
    });

    it('error message on missing cookies does not contain values', async () => {
      const page = makeFakePage();

      await expect(
        loginWithCookie(page, { c_user: '', xs: FAKE_XS })
      ).rejects.toThrow();

      const allConsoleOutput = [
        ...consoleWarnSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ].join(' ');

      expect(allConsoleOutput).not.toContain(FAKE_XS);
    });

    it('error message on security check does not leak cookie values', async () => {
      const page = makeFakePage({
        bodyText: 'confirm that you are a real person — security check',
      });

      await expect(
        loginWithCookie(page, { c_user: FAKE_C_USER, xs: FAKE_XS })
      ).rejects.toThrow(/security check/);

      const allConsoleOutput = [
        ...consoleWarnSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ].join(' ');

      expect(allConsoleOutput).not.toContain(FAKE_C_USER);
      expect(allConsoleOutput).not.toContain(FAKE_XS);
    });
  });

  describe('runGuardedBatch — no cookie values in warnings', () => {
    it('account risk warning does not contain cookie values', async () => {
      const noDelay = () => {};
      const result = await runGuardedBatch(
        ['https://www.facebook.com/post/1'],
        vi.fn().mockResolvedValue({ ok: true }),
        { dryRun: false, delay: noDelay, maxBatch: 1 }
      );

      const allConsoleOutput = [...consoleWarnSpy.mock.calls.flat()].join(' ');
      expect(allConsoleOutput).toContain(ACCOUNT_RISK_WARNING.substring(0, 20));
      expect(allConsoleOutput).not.toContain(FAKE_C_USER);
      expect(allConsoleOutput).not.toContain(FAKE_XS);
    });

    it('delay error warning does not leak sensitive data', async () => {
      const badDelay = () => { throw new Error(`delay failed with token=${FAKE_AUTH_TOKEN}`); };

      await runGuardedBatch(
        ['https://www.facebook.com/post/1'],
        vi.fn().mockResolvedValue({ ok: true }),
        { dryRun: false, delay: badDelay, maxBatch: 1, maxRetry: 0 }
      );

      const allConsoleOutput = [...consoleWarnSpy.mock.calls.flat()].join(' ');
      expect(allConsoleOutput).not.toContain(FAKE_AUTH_TOKEN);
    });
  });

  describe('API response shape — no cookie echo', () => {
    it('runGuardedBatch result does not contain raw cookie fields', async () => {
      const noDelay = () => {};
      const result = await runGuardedBatch(
        ['https://www.facebook.com/post/1'],
        vi.fn().mockResolvedValue({ ok: true }),
        { dryRun: true, delay: noDelay }
      );

      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain('c_user');
      expect(resultStr).not.toContain('xs');
      expect(resultStr).not.toContain('auth_token');
    });

    it('dry-run preview does not contain cookie values', async () => {
      const noDelay = () => {};
      const result = await runGuardedBatch(
        ['https://www.facebook.com/post/1', 'https://www.facebook.com/post/2'],
        vi.fn(),
        { dryRun: true, delay: noDelay, maxBatch: 20 }
      );

      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain(FAKE_C_USER);
      expect(resultStr).not.toContain(FAKE_XS);
    });
  });

  describe('Static scan — no hardcoded secrets in source', () => {
    it('facebook scraper source has no hardcoded c_user values', async () => {
      const fs = await import('fs/promises');
      const source = await fs.readFile('src/scrapers/facebook/index.js', 'utf-8');
      expect(source).not.toMatch(/c_user.*=.*['"]\d{10,}['"]/);
    });

    it('facebook automation source has no hardcoded xs values', async () => {
      const fs = await import('fs/promises');
      const source = await fs.readFile('api/services/facebookAutomation.js', 'utf-8');
      expect(source).not.toMatch(/xs.*=.*['"][A-Za-z0-9_-]{20,}['"]/);
    });

    it('graphql source does not echo cookie values in errors', async () => {
      const fs = await import('fs/promises');
      const source = await fs.readFile('src/scrapers/facebook/graphql.js', 'utf-8');
      expect(source).not.toMatch(/console\.\w+.*c_user.*value/);
      expect(source).not.toMatch(/console\.\w+.*\bxs\b.*value/);
    });
  });
});
