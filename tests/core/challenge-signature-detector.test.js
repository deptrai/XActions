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
});
