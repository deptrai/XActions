// tests/scrapers/facebook-auth.test.js
// Story 5.3 — AC2, AC4, AC6: browser-free tests for generateTotp + createBrowser proxy seam.
// Uses otplib v13 generateSync API (no global state mutation needed).
// by nichxbt

import { describe, it, expect } from 'vitest';
import { generateTotp, createBrowser } from '../../src/scrapers/facebook/index.js';

// 32-char base32 seed (20 bytes — satisfies otplib v13 minimum of 16 bytes).
// RFC 6238 test vector: base32 encoding of ASCII "12345678901234567890".
const VALID_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

// Deterministic epoch pinned so the TOTP window never shifts between CI runs.
// 2001-09-09T01:46:40.000Z (Unix 1_000_000_000 s).
const FIXED_EPOCH_MS = 1_000_000_000_000;

// Expected code for VALID_SEED at FIXED_EPOCH_MS — computed from generateSync and stable.
// If this value drifts, check that otplib period/algorithm defaults have not changed.
const EXPECTED_CODE = '193713';

// ============================================================================
// generateTotp
// ============================================================================

describe('generateTotp', () => {
  it('returns the expected 6-digit code for a known seed+epoch', () => {
    const result = generateTotp(VALID_SEED, { epoch: FIXED_EPOCH_MS });
    expect(result).toBe(EXPECTED_CODE);
    expect(result).toMatch(/^\d{6}$/);
  });

  it('is deterministic: same seed+epoch → same code across multiple calls', () => {
    const first = generateTotp(VALID_SEED, { epoch: FIXED_EPOCH_MS });
    const second = generateTotp(VALID_SEED, { epoch: FIXED_EPOCH_MS });
    expect(first).toBe(second);
    expect(first).not.toBeNull();
  });

  it('returns null for empty string seed', () => {
    expect(generateTotp('')).toBeNull();
  });

  it('returns null for null seed', () => {
    expect(generateTotp(null)).toBeNull();
  });

  it('returns null for undefined seed', () => {
    expect(generateTotp(undefined)).toBeNull();
  });

  it('returns null for whitespace-only seed', () => {
    expect(generateTotp('   ')).toBeNull();
  });

  it('returns null for invalid base32 seed (otplib throws internally)', () => {
    // generateTotp must catch the internal otplib error and return null — never throw.
    expect(generateTotp('!!!NOT-VALID-BASE32!!!')).toBeNull();
  });

  it('returns null for a seed that is too short (< 16 bytes / 128 bits)', () => {
    // JBSWY3DPEHPK3PXP = 16 chars — not 32, so C# length check rejects it first.
    expect(generateTotp('JBSWY3DPEHPK3PXP')).toBeNull();
  });

  // C# MNST_DT1.cs lines 78-81 validation rules — ported to generateTotp:
  it('returns null for seed that is not exactly 32 chars (31 chars)', () => {
    // Drop last char from VALID_SEED to get a 31-char seed — must be rejected.
    expect(generateTotp(VALID_SEED.slice(0, 31))).toBeNull();
  });

  it('returns null for seed that is not exactly 32 chars (33 chars)', () => {
    // Append one char to VALID_SEED to get a 33-char seed — must be rejected.
    expect(generateTotp(VALID_SEED + 'A')).toBeNull();
  });

  it('returns null for seed containing "@" (email address, not a TOTP seed)', () => {
    // Pad to 32 chars so length check passes; "@" check must still reject it.
    expect(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3@OJQG')).toBeNull();
  });

  it('returns null for seed containing "user=" (cookie fragment, not a TOTP seed)', () => {
    // Pad to 32 chars so length check passes; "user=" check must still reject it.
    expect(generateTotp('GEZDGNBVGuser=QOJQGEZDGNBVGY3TQO')).toBeNull();
  });
});

// ============================================================================
// createBrowser — proxy arg injection via launchImpl seam (AC4, AC6)
// ============================================================================

describe('createBrowser proxy arg (launchImpl seam)', () => {
  it('includes --proxy-server=<proxy> in launch args when proxy is set', async () => {
    let capturedOpts;
    const launchImpl = async (opts) => { capturedOpts = opts; return {}; };

    await createBrowser({ proxy: 'http://203.0.113.10:8080', launchImpl });

    expect(capturedOpts.args).toContain('--proxy-server=http://203.0.113.10:8080');
    expect(capturedOpts.args).toContain('--no-sandbox');
  });

  it('does NOT include --proxy-server when proxy option is absent', async () => {
    let capturedOpts;
    const launchImpl = async (opts) => { capturedOpts = opts; return {}; };

    await createBrowser({ launchImpl });

    expect(capturedOpts.args.some((a) => a.startsWith('--proxy-server'))).toBe(false);
    expect(capturedOpts.args).toContain('--no-sandbox');
  });

  it('preserves all stealth args when proxy is set', async () => {
    let capturedOpts;
    const launchImpl = async (opts) => { capturedOpts = opts; return {}; };

    await createBrowser({ proxy: 'http://203.0.113.10:8080', launchImpl });

    const stealth = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-webrtc', // Story 6.5 — WebRTC leak prevention
    ];
    for (const arg of stealth) {
      expect(capturedOpts.args).toContain(arg);
    }
    // --disable-web-security was removed (defence-in-depth: scrapers navigate
    // same-origin and extract DOM; SOP not needed). Callers can re-add via extraArgs.
    expect(capturedOpts.args).not.toContain('--disable-web-security');
  });

  it('includes --disable-webrtc in launch args (Story 6.5 AC3, AC9)', async () => {
    let capturedOpts;
    const launchImpl = async (opts) => { capturedOpts = opts; return {}; };

    await createBrowser({ launchImpl });

    expect(capturedOpts.args).toContain('--disable-webrtc');
  });

  it('--disable-webrtc is present alongside existing stealth args (Story 6.5 AC9)', async () => {
    let capturedOpts;
    const launchImpl = async (opts) => { capturedOpts = opts; return {}; };

    await createBrowser({ proxy: 'http://203.0.113.10:8080', launchImpl });

    expect(capturedOpts.args).toContain('--disable-webrtc');
    expect(capturedOpts.args).toContain('--no-sandbox');
    expect(capturedOpts.args).toContain('--disable-setuid-sandbox');
    expect(capturedOpts.args).toContain('--disable-blink-features=AutomationControlled');
  });

  it('does not leak proxy or launchImpl into the launcher options object', async () => {
    let capturedOpts;
    const launchImpl = async (opts) => { capturedOpts = opts; return {}; };

    await createBrowser({ proxy: 'http://203.0.113.10:8080', launchImpl });

    expect(capturedOpts).not.toHaveProperty('proxy');
    expect(capturedOpts).not.toHaveProperty('launchImpl');
  });

  it('caller extraArgs are appended after stealth+proxy args', async () => {
    let capturedOpts;
    const launchImpl = async (opts) => { capturedOpts = opts; return {}; };

    await createBrowser({ proxy: 'http://203.0.113.10:8080', args: ['--my-flag'], launchImpl });

    expect(capturedOpts.args).toContain('--my-flag');
    expect(capturedOpts.args).toContain('--proxy-server=http://203.0.113.10:8080');
  });
});
