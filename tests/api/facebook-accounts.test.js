// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// tests/api/facebook-accounts.test.js
// Story 5.5 — AC2, AC9: browser-free, DB-free tests for account API helpers.
// Tests pure validation logic + AES-256 encrypt/decrypt roundtrip.
// Route integration (DB, auth, Express) requires a running server — same constraint
// as x402-integration.test.js.
// by nichxbt

import { describe, it, expect } from 'vitest';
import { validateAccountBody, encrypt, decrypt } from '../../api/routes/facebookAccounts.js';

// ============================================================================
// validateAccountBody — AC1 / AC2 validation rules
// ============================================================================

describe('validateAccountBody', () => {
  it('returns null for valid input', () => {
    expect(validateAccountBody({ label: 'Main', c_user: '1234567890', xs: 'abc' })).toBeNull();
  });

  it('accepts c_user with 20 digits (max boundary)', () => {
    expect(validateAccountBody({ label: 'x', c_user: '12345678901234567890', xs: 'xs' })).toBeNull();
  });

  it('returns error for missing label', () => {
    expect(validateAccountBody({ c_user: '1234567890', xs: 'xs' })).toMatch(/label.*required/i);
  });

  it('returns error for empty label', () => {
    expect(validateAccountBody({ label: '', c_user: '1234567890', xs: 'xs' })).toMatch(/label.*required/i);
  });

  it('returns error for whitespace-only label', () => {
    expect(validateAccountBody({ label: '   ', c_user: '1234567890', xs: 'xs' })).toMatch(/label.*required/i);
  });

  it('returns error for label > 50 chars', () => {
    expect(validateAccountBody({ label: 'a'.repeat(51), c_user: '1234567890', xs: 'xs' }))
      .toMatch(/50/);
  });

  it('returns error for non-numeric c_user', () => {
    expect(validateAccountBody({ label: 'x', c_user: 'abc123', xs: 'xs' })).toMatch(/c_user/i);
  });

  it('returns error for c_user too short (< 10 digits)', () => {
    expect(validateAccountBody({ label: 'x', c_user: '123456789', xs: 'xs' })).toMatch(/c_user/i);
  });

  it('returns error for c_user too long (> 20 digits)', () => {
    expect(validateAccountBody({ label: 'x', c_user: '123456789012345678901', xs: 'xs' })).toMatch(/c_user/i);
  });

  it('returns error for missing xs', () => {
    expect(validateAccountBody({ label: 'x', c_user: '1234567890' })).toMatch(/xs.*required/i);
  });

  it('returns error for empty xs', () => {
    expect(validateAccountBody({ label: 'x', c_user: '1234567890', xs: '' })).toMatch(/xs.*required/i);
  });

  it('is null/undefined-safe (never throws)', () => {
    expect(() => validateAccountBody(null)).not.toThrow();
    expect(() => validateAccountBody(undefined)).not.toThrow();
    expect(validateAccountBody(null)).toMatch(/label/i);
  });
});

// ============================================================================
// encrypt / decrypt roundtrip — AES-256-GCM (AC2 #4, AC9 #25)
// ============================================================================

describe('encrypt / decrypt roundtrip', () => {
  it('decrypt(encrypt(x)) === x for a cookie JSON payload', () => {
    const payload = JSON.stringify({ c_user: '1234567890', xs: 'xs_token_abc' });
    expect(decrypt(encrypt(payload))).toBe(payload);
  });

  it('decrypt returns null for invalid/garbage input (no throw)', () => {
    expect(decrypt('not-valid')).toBeNull();
    expect(decrypt('')).toBeNull();
    expect(decrypt(null)).toBeNull();
  });

  it('encrypted value never equals the plaintext', () => {
    const plain = 'secret_payload';
    const enc = encrypt(plain);
    expect(enc).not.toBe(plain);
    expect(enc).not.toContain(plain);
  });

  it('two encryptions of same plaintext produce different ciphertext (random IV)', () => {
    const plain = 'same_payload';
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });
});

// ============================================================================
// NFR3 — encrypted output never leaks raw cookie values (AC9 #25)
// ============================================================================

describe('NFR3 — encrypt never leaks cookie values in output', () => {
  it('encrypted output does not contain raw c_user value', () => {
    const c_user = '9876543210';
    const enc = encrypt(JSON.stringify({ c_user, xs: 'xs_val' }));
    expect(enc).not.toContain(c_user);
  });

  it('encrypted output does not contain raw xs value', () => {
    const xs = 'super_secret_xs_value_nfr3';
    const enc = encrypt(JSON.stringify({ c_user: '1234567890', xs }));
    expect(enc).not.toContain(xs);
  });
});
