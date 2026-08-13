// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// tests/api/facebook-accounts.test.js
// Story 5.5 — AC2, AC9: browser-free, DB-free tests for account API helpers.
// Tests pure validation logic + AES-256 encrypt/decrypt roundtrip.
// Route integration (DB, auth, Express) requires a running server — same constraint
// as x402-integration.test.js.
// by nichxbt

import { describe, it, expect } from 'vitest';
import { validateAccountBody, encrypt, decrypt } from '../../api/routes/facebookAccounts.js';
import { nextTestId } from '../utils/test-ids.js';

// ============================================================================
// validateAccountBody — AC1 / AC2 validation rules
// ============================================================================

describe('validateAccountBody', () => {
  it(`[${nextTestId('API')}] returns null for valid input`, () => {
    expect(validateAccountBody({ label: 'Main', c_user: '1234567890', xs: 'abc' })).toBeNull();
  });

  it(`[${nextTestId('API')}] accepts c_user with 20 digits (max boundary)`, () => {
    expect(validateAccountBody({ label: 'x', c_user: '12345678901234567890', xs: 'xs' })).toBeNull();
  });

  it(`[${nextTestId('API')}] returns error for missing label`, () => {
    expect(validateAccountBody({ c_user: '1234567890', xs: 'xs' })).toMatch(/label.*required/i);
  });

  it(`[${nextTestId('API')}] returns error for empty label`, () => {
    expect(validateAccountBody({ label: '', c_user: '1234567890', xs: 'xs' })).toMatch(/label.*required/i);
  });

  it(`[${nextTestId('API')}] returns error for whitespace-only label`, () => {
    expect(validateAccountBody({ label: '   ', c_user: '1234567890', xs: 'xs' })).toMatch(/label.*required/i);
  });

  it(`[${nextTestId('API')}] returns error for label > 50 chars`, () => {
    expect(validateAccountBody({ label: 'a'.repeat(51), c_user: '1234567890', xs: 'xs' }))
      .toMatch(/50/);
  });

  it(`[${nextTestId('API')}] returns error for non-numeric c_user`, () => {
    expect(validateAccountBody({ label: 'x', c_user: 'abc123', xs: 'xs' })).toMatch(/c_user/i);
  });

  it(`[${nextTestId('API')}] returns error for c_user too short (< 10 digits)`, () => {
    expect(validateAccountBody({ label: 'x', c_user: '123456789', xs: 'xs' })).toMatch(/c_user/i);
  });

  it(`[${nextTestId('API')}] returns error for c_user too long (> 20 digits)`, () => {
    expect(validateAccountBody({ label: 'x', c_user: '123456789012345678901', xs: 'xs' })).toMatch(/c_user/i);
  });

  it(`[${nextTestId('API')}] returns error for missing xs`, () => {
    expect(validateAccountBody({ label: 'x', c_user: '1234567890' })).toMatch(/xs.*required/i);
  });

  it(`[${nextTestId('API')}] returns error for empty xs`, () => {
    expect(validateAccountBody({ label: 'x', c_user: '1234567890', xs: '' })).toMatch(/xs.*required/i);
  });

  it(`[${nextTestId('API')}] is null/undefined-safe (never throws)`, () => {
    expect(() => validateAccountBody(null)).not.toThrow();
    expect(() => validateAccountBody(undefined)).not.toThrow();
    expect(validateAccountBody(null)).toMatch(/label/i);
  });
});

// ============================================================================
// encrypt / decrypt roundtrip — AES-256-GCM (AC2 #4, AC9 #25)
// ============================================================================

describe('encrypt / decrypt roundtrip', () => {
  it(`[${nextTestId('API')}] decrypt(encrypt(x)) === x for a cookie JSON payload`, () => {
    const payload = JSON.stringify({ c_user: '1234567890', xs: 'xs_token_abc' });
    expect(decrypt(encrypt(payload))).toBe(payload);
  });

  it(`[${nextTestId('API')}] decrypt returns null for invalid/garbage input (no throw)`, () => {
    expect(decrypt('not-valid')).toBeNull();
    expect(decrypt('')).toBeNull();
    expect(decrypt(null)).toBeNull();
  });

  it(`[${nextTestId('API')}] encrypted value never equals the plaintext`, () => {
    const plain = 'secret_payload';
    const enc = encrypt(plain);
    expect(enc).not.toBe(plain);
    expect(enc).not.toContain(plain);
  });

  it(`[${nextTestId('API')}] two encryptions of same plaintext produce different ciphertext (random IV)`, () => {
    const plain = 'same_payload';
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });
});

// ============================================================================
// NFR3 — encrypted output never leaks raw cookie values (AC9 #25)
// ============================================================================

describe('NFR3 — encrypt never leaks cookie values in output', () => {
  it(`[${nextTestId('API')}] encrypted output does not contain raw c_user value`, () => {
    const c_user = '9876543210';
    const enc = encrypt(JSON.stringify({ c_user, xs: 'xs_val' }));
    expect(enc).not.toContain(c_user);
  });

  it(`[${nextTestId('API')}] encrypted output does not contain raw xs value`, () => {
    const xs = 'super_secret_xs_value_nfr3';
    const enc = encrypt(JSON.stringify({ c_user: '1234567890', xs }));
    expect(enc).not.toContain(xs);
  });
});

// ============================================================================
// P1 Kill: encrypt/decrypt — exact encoding strings (L49, L50, L58, L65, L66)
// ============================================================================

describe('encrypt / decrypt — exact encoding (P1 kill)', () => {
  it(`[${nextTestId('API')}] encrypt output is hex-encoded (not empty string replacement)`, () => {
    const enc = encrypt('test_payload');
    // StringLiteral mutant L49/L50: 'hex' → '' → cipher.update throws or produces binary
    // If encoding is empty, encrypt would throw or produce non-hex output
    expect(enc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it(`[${nextTestId('API')}] decrypt returns exact plaintext for roundtrip (encoding strings matter)`, () => {
    const plain = 'exact_roundtrip_test_12345';
    const enc = encrypt(plain);
    const dec = decrypt(enc);
    // StringLiteral mutant L65/L66: 'hex'/'utf8' → '' → decrypt fails or returns garbage
    expect(dec).toBe(plain);
  });

  it(`[${nextTestId('API')}] decrypt returns null for 3-part string (not 4 parts)`, () => {
    // ConditionalExpression mutant L58: false → parts.length check bypassed
    // With 3 parts, decipher.update(parts[3]) would get undefined → throw → null
    // But mutant skips the check, tries to process → may throw or return garbage
    expect(decrypt('a:b:c')).toBeNull();
  });

  it(`[${nextTestId('API')}] decrypt returns null for 5-part string (not 4 parts)`, () => {
    expect(decrypt('a:b:c:d:e')).toBeNull();
  });

  it(`[${nextTestId('API')}] decrypt handles tampered ciphertext (auth tag mismatch → null)`, () => {
    const enc = encrypt('tamper_test');
    // Flip last char of ciphertext to tamper
    const parts = enc.split(':');
    const tampered = parts[3].slice(0, -1) + (parts[3].slice(-1) === '0' ? '1' : '0');
    expect(decrypt(`${parts[0]}:${parts[1]}:${parts[2]}:${tampered}`)).toBeNull();
  });

  it(`[${nextTestId('API')}] encrypt output parts are valid hex strings (encoding strings matter)`, () => {
    // StringLiteral mutant L49/L50: 'hex' → '' → cipher.update returns Buffer, not hex string
    // When encoding is '', cipher.update returns a Buffer object, and Buffer + string = string
    // but the concatenation would produce "[object Object]" or binary garbage, not hex
    const enc = encrypt('encoding_test');
    const parts = enc.split(':');
    expect(parts).toHaveLength(4);
    // Each part must be valid hex (only 0-9a-f chars)
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
      // Must be parseable as hex
      expect(() => Buffer.from(part, 'hex')).not.toThrow();
    }
  });

  it(`[${nextTestId('API')}] decrypt with wrong encoding returns null or wrong value (encoding strings matter)`, () => {
    // StringLiteral mutant L65/L66: 'hex'/'utf8' → '' → decipher.update returns Buffer
    // This would either throw or return garbage — either way, not the original plaintext
    const plain = 'encoding_roundtrip_abc123';
    const enc = encrypt(plain);
    const dec = decrypt(enc);
    // If encoding strings are mutated to '', decrypt would fail or return garbage
    expect(dec).toBe(plain);
  });

  it(`[${nextTestId('API')}] decrypt with 3 parts returns null (parts.length check, L58)`, () => {
    // ConditionalExpression mutant L58: false → check bypassed
    // With 3 parts, parts[3] is undefined → decipher.update(undefined) throws → catch → null
    // But mutant skips the check, tries to process → may throw or return garbage
    // Key: with 3 valid hex parts, the mutant would try to process and throw
    // We need a 3-part string where parts[3] being undefined causes a distinguishable behavior
    const result = decrypt('aabbccdd:eeff0011:22334455');
    expect(result).toBeNull();
  });

  it(`[${nextTestId('API')}] decrypt with 5 parts returns null (parts.length check, L58)`, () => {
    // 5 parts should also be rejected
    const result = decrypt('aabb:bccd:eeff:0011:2233');
    expect(result).toBeNull();
  });

  it(`[${nextTestId('API')}] decrypt with exactly 4 valid hex parts but wrong data returns null`, () => {
    // 4 parts but not valid encrypted data → should return null (not throw)
    expect(decrypt('aaaa:bbbb:cccc:dddd')).toBeNull();
  });

  it(`[${nextTestId('API')}] c_user with leading/trailing spaces is trimmed before regex test (L88)`, () => {
    // MethodExpression mutant L88: String(c_user).trim() → String(c_user) (no trim)
    // With c_user = '  1234567890  ', trim gives '1234567890' (valid), no-trim gives '  1234567890  ' (invalid)
    // Original: trim → valid → null
    // Mutant: no trim → invalid → error
    expect(validateAccountBody({ label: 'x', c_user: '  1234567890  ', xs: 'xs' })).toBeNull();
  });

  it(`[${nextTestId('API')}] c_user with only leading spaces is trimmed (L88)`, () => {
    // Additional: c_user = ' 1234567890' → trim → '1234567890' (valid)
    expect(validateAccountBody({ label: 'x', c_user: ' 1234567890', xs: 'xs' })).toBeNull();
  });
});

// ============================================================================
// P1 Kill: validateAccountBody — boundary + type checks (L84, L86, L88, L90, L92)
// ============================================================================

describe('validateAccountBody — boundary + type (P1 kill)', () => {
  it(`[${nextTestId('API')}] accepts label of exactly 50 chars (boundary, not >)`, () => {
    // EqualityOperator mutant L86: > → >= → 50 chars rejected (should be accepted)
    expect(validateAccountBody({ label: 'a'.repeat(50), c_user: '1234567890', xs: 'xs' })).toBeNull();
  });

  it(`[${nextTestId('API')}] rejects label of 51 chars (boundary)`, () => {
    expect(validateAccountBody({ label: 'a'.repeat(51), c_user: '1234567890', xs: 'xs' }))
      .toMatch(/50/);
  });

  it(`[${nextTestId('API')}] rejects non-string label (number)`, () => {
    // LogicalOperator mutant L84: || → && → both conditions must be true
    // ConditionalExpression mutant L84: false → typeof check bypassed
    expect(validateAccountBody({ label: 123, c_user: '1234567890', xs: 'xs' }))
      .toMatch(/label/i);
  });

  it(`[${nextTestId('API')}] rejects non-string label (object)`, () => {
    expect(validateAccountBody({ label: { foo: 'bar' }, c_user: '1234567890', xs: 'xs' }))
      .toMatch(/label/i);
  });

  it(`[${nextTestId('API')}] trim is applied before length check on label`, () => {
    // MethodExpression mutant L86: label.trim() → label (no trim)
    // With label = 'a'.repeat(49) + '  ', trim gives 49 chars (accepted), no-trim gives 51 (rejected)
    // Original: trim → 49 → accepted (null)
    // Mutant: no trim → 51 → rejected (error message with "50")
    const labelWithSpaces = 'a'.repeat(49) + '  ';
    expect(validateAccountBody({ label: labelWithSpaces, c_user: '1234567890', xs: 'xs' })).toBeNull();
  });

  it(`[${nextTestId('API')}] c_user is coerced to string before regex test`, () => {
    // MethodExpression mutant L88: String(c_user) → c_user (no coercion)
    // With c_user as number, .trim() would throw without String()
    expect(() => validateAccountBody({ label: 'x', c_user: 1234567890, xs: 'xs' })).not.toThrow();
    expect(validateAccountBody({ label: 'x', c_user: 1234567890, xs: 'xs' })).toBeNull();
  });

  it(`[${nextTestId('API')}] rejects non-string xs (number)`, () => {
    // LogicalOperator mutant L90: || → && 
    // ConditionalExpression mutant L90: false → typeof check bypassed
    expect(validateAccountBody({ label: 'x', c_user: '1234567890', xs: 123 }))
      .toMatch(/xs/i);
  });

  it(`[${nextTestId('API')}] rejects non-string xs (object)`, () => {
    expect(validateAccountBody({ label: 'x', c_user: '1234567890', xs: { foo: 'bar' } }))
      .toMatch(/xs/i);
  });

  it(`[${nextTestId('API')}] accepts xs of exactly 4096 chars (boundary, not >)`, () => {
    // EqualityOperator mutant L92: > → >= → 4096 chars rejected (should be accepted)
    expect(validateAccountBody({ label: 'x', c_user: '1234567890', xs: 'a'.repeat(4096) })).toBeNull();
  });

  it(`[${nextTestId('API')}] rejects xs of 4097 chars (boundary)`, () => {
    expect(validateAccountBody({ label: 'x', c_user: '1234567890', xs: 'a'.repeat(4097) }))
      .toMatch(/4096/);
  });

  it(`[${nextTestId('API')}] trim is applied before length check on xs`, () => {
    // MethodExpression mutant L92: xs.trim() → xs (no trim)
    // With xs = 'a'.repeat(4095) + '  ', trim gives 4095 (accepted), no-trim gives 4097 (rejected)
    // Original: trim → 4095 → accepted (null)
    // Mutant: no trim → 4097 → rejected (error with "4096")
    const xsWithSpaces = 'a'.repeat(4095) + '  ';
    expect(validateAccountBody({ label: 'x', c_user: '1234567890', xs: xsWithSpaces })).toBeNull();
  });

  it(`[${nextTestId('API')}] rejects whitespace-only xs`, () => {
    // ConditionalExpression mutant L90: false → xs.trim().length === 0 check bypassed
    expect(validateAccountBody({ label: 'x', c_user: '1234567890', xs: '   ' }))
      .toMatch(/xs.*required/i);
  });
});
