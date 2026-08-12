// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// P0-10: Checkpoint detection (AR7) — Facebook anti-bot/security check
// Verifies that loginWithCookie detects checkpoint/CAPTCHA and throws
// a clear error without leaking cookie values.
// by nichxbt

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loginWithCookie } from '../../src/scrapers/facebook/index.js';

function makePageWithBody(bodyText) {
  return {
    url: () => 'https://www.facebook.com/',
    goto: vi.fn().mockResolvedValue({ ok: true }),
    content: vi.fn().mockResolvedValue(`<html><body>${bodyText}</body></html>`),
    setCookie: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async (fn) => {
      if (typeof fn === 'function') {
        const fnStr = fn.toString();
        if (fnStr.includes('hasLoginForm') || fnStr.includes('hasSecurityCheck')) {
          const norm = bodyText.normalize('NFC').toLowerCase();
          return {
            hasLoginForm: false,
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
  };
}

describe('P0-10: Checkpoint detection (AR7)', () => {
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('detects English checkpoint phrases', () => {
    it('detects "confirm that you are a real person"', async () => {
      const page = makePageWithBody('Please confirm that you are a real person to continue.');
      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).rejects.toThrow(/security check/i);
    });

    it('detects "confirm that you" + "human"', async () => {
      const page = makePageWithBody('Please confirm that you are human.');
      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).rejects.toThrow(/security check/i);
    });

    it('detects "security check"', async () => {
      const page = makePageWithBody('Security check — please enter the code.');
      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).rejects.toThrow(/security check/i);
    });

    it('detects "Enter the text from the image"', async () => {
      const page = makePageWithBody('Enter the text from the image below.');
      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).rejects.toThrow(/security check/i);
    });

    it('detects "hear this code" (audio CAPTCHA)', async () => {
      const page = makePageWithBody('Press play to hear this code.');
      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).rejects.toThrow(/security check/i);
    });
  });

  describe('detects French checkpoint phrases', () => {
    it('detects "confirmez que vous êtes une personne"', async () => {
      const page = makePageWithBody('Veuillez confirmez que vous êtes une personne.');
      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).rejects.toThrow(/security check/i);
    });

    it('detects "vérification de sécurité"', async () => {
      const page = makePageWithBody('Vérification de sécurité requise.');
      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).rejects.toThrow(/security check/i);
    });
  });

  describe('does NOT trigger on normal page content', () => {
    it('passes when body has normal welcome text', async () => {
      const page = makePageWithBody('Welcome to Facebook! Your feed is loading.');
      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).resolves.toBeUndefined();
    });

    it('passes when body is empty', async () => {
      const page = makePageWithBody('');
      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).resolves.toBeUndefined();
    });

    it('passes when body has unrelated "confirm" text', async () => {
      const page = makePageWithBody('Please confirm your email address.');
      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).resolves.toBeUndefined();
    });
  });

  describe('detects login form (bad/expired cookies)', () => {
    it('detects login form element', async () => {
      const page = makePageWithBody('Welcome back');
      page.evaluate = vi.fn(async (fn) => {
        if (typeof fn === 'function') {
          const fnStr = fn.toString();
          if (fnStr.includes('hasLoginForm') || fnStr.includes('hasSecurityCheck')) {
            return { hasLoginForm: true, hasLoginButton: false, hasSecurityCheck: false };
          }
          return fn;
        }
        return fn;
      });

      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).rejects.toThrow(/authentication failed/i);
    });

    it('detects "Log in" + "password" text', async () => {
      const page = makePageWithBody('Log in with your password');
      page.evaluate = vi.fn(async (fn) => {
        if (typeof fn === 'function') {
          const fnStr = fn.toString();
          if (fnStr.includes('hasLoginForm') || fnStr.includes('hasSecurityCheck')) {
            return { hasLoginForm: false, hasLoginButton: true, hasSecurityCheck: false };
          }
          return fn;
        }
        return fn;
      });

      await expect(
        loginWithCookie(page, { c_user: '123', xs: 'abc' })
      ).rejects.toThrow(/authentication failed/i);
    });
  });

  describe('error messages do not leak cookie values', () => {
    it('security check error does not contain c_user or xs', async () => {
      const page = makePageWithBody('confirm that you are a real person');
      const secretCUser = '99999999999';
      const secretXs = 'super_secret_xs_value';

      try {
        await loginWithCookie(page, { c_user: secretCUser, xs: secretXs });
      } catch (e) {
        expect(e.message).not.toContain(secretCUser);
        expect(e.message).not.toContain(secretXs);
      }

      const allConsole = [...consoleWarnSpy.mock.calls.flat(), ...consoleErrorSpy.mock.calls.flat()].join(' ');
      expect(allConsole).not.toContain(secretCUser);
      expect(allConsole).not.toContain(secretXs);
    });

    it('login failed error does not contain cookie values', async () => {
      const page = makePageWithBody('Log in with password');
      page.evaluate = vi.fn(async (fn) => {
        if (typeof fn === 'function') {
          const fnStr = fn.toString();
          if (fnStr.includes('hasLoginForm') || fnStr.includes('hasSecurityCheck')) {
            return { hasLoginForm: false, hasLoginButton: true, hasSecurityCheck: false };
          }
          return fn;
        }
        return fn;
      });

      const secretCUser = '88888888888';
      const secretXs = 'another_secret_xs';

      try {
        await loginWithCookie(page, { c_user: secretCUser, xs: secretXs });
      } catch (e) {
        expect(e.message).not.toContain(secretCUser);
        expect(e.message).not.toContain(secretXs);
      }
    });
  });
});
