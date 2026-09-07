// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FnbPlatformResponseValidator — unit tests.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { FnbPlatformResponseValidator } from '../../../../src/scrapers/fnb/merchant/validator.js';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

describe('FnbPlatformResponseValidator', () => {
  const validator = new FnbPlatformResponseValidator();

  it('should detect rate limit via status 429', () => {
    expect(validator.isRateLimit({ status: 429, body: '' })).toBe(true);
  });

  it('should detect rate limit via body text', () => {
    expect(validator.isRateLimit({ body: 'Too Many Requests' })).toBe(true);
  });

  it('should detect bot challenge via status 403', () => {
    expect(validator.isBotChallenge({ status: 403, body: 'Just a moment...' })).toBe(true);
  });

  it('should detect bot challenge via challenge markers', () => {
    expect(validator.isBotChallenge({ body: 'Checking your browser before accessing' })).toBe(true);
  });

  it('should validate PasGo fixture as valid payload', () => {
    const html = loadFixture('pasgo-search.html');
    expect(validator.isValidPayload({ body: html })).toBe(true);
  });

  it('should validate Foody fixture as valid payload', () => {
    const html = loadFixture('foody-search.html');
    expect(validator.isValidPayload({ body: html })).toBe(true);
  });

  it('should validate Riviu fixture as valid payload', () => {
    const html = loadFixture('riviu-search.html');
    expect(validator.isValidPayload({ body: html })).toBe(true);
  });

  it('should reject challenge page as invalid payload', () => {
    const html = loadFixture('challenge.html');
    expect(validator.isValidPayload({ body: html })).toBe(false);
  });

  it('should reject empty response', () => {
    expect(validator.isValidPayload({ body: '' })).toBe(false);
  });

  it('should reject 404 response', () => {
    expect(validator.isValidPayload({ status: 404, body: 'Not Found' })).toBe(false);
  });

  it('should reject non-merchant HTML with single keyword', () => {
    const html = '<html><body>This page mentions restaurant once but has no F&B content.</body></html>';
    expect(validator.isValidPayload({ body: html })).toBe(false);
  });
});
