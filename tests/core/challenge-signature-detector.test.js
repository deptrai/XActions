// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 27.3 — ChallengeSignatureDetector unit tests (real impl, no mocks).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ChallengeSignatureDetector, globalChallengeSignatureDetector } from '../../src/core/challenge-signature-detector.js';

const MINUTE = 60 * 1000;

describe('Story 27.3 — ChallengeSignatureDetector', () => {
  it('[P0] returns safe default on empty/null input', () => {
    const d = new ChallengeSignatureDetector();
    for (const v of [null, undefined, '', {}, { body: '' }, { body: null }]) {
      const r = d.detect(v);
      expect(r.detected).toBe(false);
      expect(r.type).toBe('unknown');
      expect(r.confidence).toBe(0);
      expect(r.signature).toBeNull();
    }
  });

  it('[P0] CLOUDFLARE_MANAGED — detects challenge-running + cf-chl signatures', () => {
    const d = new ChallengeSignatureDetector();
    const html = `<!DOCTYPE html><html><head><title>Just a moment...</title></head>
      <body><div class="cf-challenge-running">Verifying</div>
      <script>window.__cf_chl = {};</script></body></html>`;
    const r = d.detect({ body: html });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('cloudflare_managed');
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
    expect(r.suggestedHibernationMs).toBe(5 * MINUTE);
  });

  it('[P0] CLOUDFLARE_TURNSTILE — detects turnstile markers', () => {
    const d = new ChallengeSignatureDetector();
    const html = `<div class="cf-turnstile" data-sitekey="0xAAAA"></div>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>`;
    const r = d.detect({ body: html });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('cloudflare_turnstile');
    expect(r.suggestedHibernationMs).toBe(5 * MINUTE);
  });

  it('[P0] ARKOSE — detects arkoselabs + funcaptcha', () => {
    const d = new ChallengeSignatureDetector();
    const html = `<script src="https://client-api.arkoselabs.com/v2/api.js"></script>
      <div id="funcaptcha"></div>`;
    const r = d.detect({ body: html });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('arkose');
    expect(r.suggestedHibernationMs).toBe(30 * MINUTE);
  });

  it('[P0] Facebook checkpoint — detects via URL or body', () => {
    const d = new ChallengeSignatureDetector();
    const r1 = d.detect({ body: '<html></html>', url: 'https://www.facebook.com/checkpoint/?next=', platform: 'facebook' });
    expect(r1.detected).toBe(true);
    expect(r1.type).toBe('platform_checkpoint');

    const r2 = d.detect({ body: '<html><body>Your account has been temporarily locked</body></html>', platform: 'facebook' });
    expect(r2.detected).toBe(true);
  });

  it('[P0] Twitter account_locked / unusual-login via JSON body', () => {
    const d = new ChallengeSignatureDetector();
    const r1 = d.detect({
      body: JSON.stringify({ errors: [{ code: 326, message: 'account_locked' }] }),
      platform: 'twitter',
    });
    expect(r1.detected).toBe(true);
    expect(r1.type).toBe('platform_account_locked');

    const r2 = d.detect({ body: 'unusual-login detected', platform: 'twitter' });
    expect(r2.detected).toBe(true);
    expect(r2.type).toBe('platform_unusual_login');
  });

  it('[P0] Generic captcha + data-testid challenge', () => {
    const d = new ChallengeSignatureDetector();
    const r = d.detect({ body: '<div data-testid="challenge">Please verify</div>' });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('generic_captcha');
  });

  it('[P0] CLEAN_RESPONSE — normal HTML/JSON returns detected:false', () => {
    const d = new ChallengeSignatureDetector();
    const r1 = d.detect({ body: '<html><body><p>Hello world</p></body></html>' });
    expect(r1.detected).toBe(false);
    const r2 = d.detect({ body: JSON.stringify({ data: { user: { id: 1 } } }) });
    expect(r2.detected).toBe(false);
  });

  it('[P0] detectFromHtml — Puppeteer page.content() path', () => {
    const d = new ChallengeSignatureDetector();
    const html = `<html><head><title>Just a moment...</title></head>
      <body><div id="cf-challenge-running">Wait</div></body></html>`;
    const r = d.detectFromHtml(html);
    expect(r.detected).toBe(true);
    expect(r.type).toBe('cloudflare_managed');
  });

  it('[P1] detectFromResponse — axios-style response', () => {
    const d = new ChallengeSignatureDetector();
    const response = {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' },
      data: '<html><body>cf-chl-bypass</body></html>',
    };
    const r = d.detectFromResponse(response);
    expect(r.detected).toBe(true);
    expect(r.type).toBe('cloudflare_managed');
  });

  it('[P1] registerPlatformSignatures — custom sig per platform', () => {
    const d = new ChallengeSignatureDetector();
    d.registerPlatformSignatures('weibo', [{
      id: 'weibo-init',
      type: 'platform_checkpoint',
      appliesTo: 'dom',
      patterns: [{ kind: 'substr', value: 'window.__初始状态 = {', weight: 1.0 }],
    }]);
    const r = d.detectFromHtml('<script>window.__初始状态 = {"x":1}</script>', { platform: 'weibo' });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('platform_checkpoint');
    expect(r.signature).toBe('weibo-init');
  });

  it('[P1] confidence is bounded [0,1]', () => {
    const d = new ChallengeSignatureDetector();
    const html = 'cf-chl-bypass __cf_chl challenge-running cf-turnstile arkoselabs.com funcaptcha';
    const r = d.detect({ body: html });
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('[P1] detector does not throw on malformed regex in platform sig', () => {
    const d = new ChallengeSignatureDetector();
    d.registerPlatformSignatures('x', [{
      id: 'bad',
      type: 'generic_captcha',
      patterns: [{ kind: 'regex', value: '(((', weight: 1 }],
    }]);
    const r = d.detect({ body: 'test', platform: 'x' });
    expect(r).toBeDefined();
    expect(typeof r.detected).toBe('boolean');
  });

  it('[P1] globalChallengeSignatureDetector is a shared instance', () => {
    expect(globalChallengeSignatureDetector).toBeInstanceOf(ChallengeSignatureDetector);
    const r = globalChallengeSignatureDetector.detect({ body: 'cf-chl-bypass' });
    expect(r.detected).toBe(true);
  });
  it('[P0] F-1: clean 200 response containing word "challenge" is not detected', () => {
    const d = new ChallengeSignatureDetector();
    const r = d.detect({
      statusCode: 200,
      body: 'Welcome to the 30-day coding challenge! Win prizes by completing challenges daily.',
    });
    expect(r.detected).toBe(false);
    expect(r.type).toBe('unknown');

    // But status 403 with word "challenge" triggers detection
    const r403 = d.detect({
      statusCode: 403,
      body: 'Access denied: bot challenge required',
    });
    expect(r403.detected).toBe(true);
    expect(r403.signature).toBe('http-403-challenge');
  });

  it('[P0] F-2: plain "captcha" mention in text alone does not trigger false positive', () => {
    const d = new ChallengeSignatureDetector();
    const r = d.detect({
      statusCode: 200,
      body: 'We discussed how captcha technology evolved over the past decade.',
    });
    expect(r.detected).toBe(false);
  });

  it('[P0] F-3: cf-challenge pattern matches cloudflare_managed', () => {
    const d = new ChallengeSignatureDetector();
    const r = d.detectFromHtml('<div class="cf-challenge">Please wait</div>');
    expect(r.detected).toBe(true);
    expect(r.type).toBe('cloudflare_managed');
  });

  it('[P0] F-4: DOM detection matches Twitter account_locked and unusual-login in HTML', () => {
    const d = new ChallengeSignatureDetector();
    const rLocked = d.detectFromHtml('<div>Your account is account_locked. Please reset.</div>', { platform: 'twitter' });
    expect(rLocked.detected).toBe(true);
    expect(rLocked.type).toBe('platform_account_locked');

    const rUnusual = d.detectFromHtml('<div>unusual-login detected on your account</div>', { platform: 'twitter' });
    expect(rUnusual.detected).toBe(true);
    expect(rUnusual.type).toBe('platform_unusual_login');
  });

  it('[P1] F-7: null options does not throw TypeError in detectFromHtml or detectFromResponse', () => {
    const d = new ChallengeSignatureDetector();
    expect(() => d.detectFromHtml('<div class="cf-challenge"></div>', null)).not.toThrow();
    expect(() => d.detectFromResponse({ status: 200, data: 'hello' }, null)).not.toThrow();
  });

  it('[P1] Headers object with .get() method is supported in header patterns', () => {
    const d = new ChallengeSignatureDetector();
    // Simulate Fetch/Undici Headers instance
    const headers = new Map([['cf-mitigated', 'challenge']]);
    const mockHeaders = {
      get: (name) => headers.get(name.toLowerCase()) || null,
    };
    const r = d.detect({
      body: 'access denied',
      headers: mockHeaders,
    });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('cloudflare_managed');
  });

  it('[P1] status 403 provides +0.2 confidence boost to matched signature', () => {
    const d = new ChallengeSignatureDetector();
    // Just a moment alone has weight 0.6
    const r200 = d.detect({ body: 'Just a moment...', statusCode: 200 });
    const r403 = d.detect({ body: 'Just a moment...', statusCode: 403 });
    expect(r403.confidence).toBeGreaterThan(r200.confidence);
    expect(r403.confidence - r200.confidence).toBeCloseTo(0.2, 1);
  });

  it('[P1] platform signatures match when platform parameter is omitted but URL contains platform path', () => {
    const d = new ChallengeSignatureDetector();
    const r = d.detect({ url: 'https://www.facebook.com/checkpoint/?next=home' });
    expect(r.detected).toBe(true);
    expect(r.type).toBe('platform_checkpoint');
  });
});

