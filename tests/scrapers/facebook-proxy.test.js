// tests/scrapers/facebook-proxy.test.js
// Story 5.3 — AC3, AC6: browser-free tests for rotateProxy (all 3 providers).
// Network boundary stubbed via fetchImpl seam. Fixtures in tests/scrapers/fixtures/.
// by nichxbt

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rotateProxy } from '../../src/scrapers/facebook/proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, 'fixtures');

/**
 * Build a fetchImpl stub that returns the contents of a fixture file.
 * The API key is NOT part of the stub — its value is opaque to these tests (NFR3).
 */
function makeStub(fixtureFile) {
  const text = readFileSync(join(FIXTURES, fixtureFile), 'utf-8');
  return async (_url, _init) => ({ status: 200, text: async () => text });
}

// ============================================================================
// Input validation
// ============================================================================

describe('rotateProxy input validation', () => {
  it('throws for unknown provider', async () => {
    await expect(rotateProxy('badprovider', 'key123')).rejects.toThrow(/unknown provider/);
  });

  it('throws for empty string key', async () => {
    await expect(rotateProxy('proxyfb', '')).rejects.toThrow(/key is required/);
  });

  it('throws for null key', async () => {
    await expect(rotateProxy('tmproxy', null)).rejects.toThrow(/key is required/);
  });

  it('throws for whitespace-only key', async () => {
    await expect(rotateProxy('shoplike', '   ')).rejects.toThrow(/key is required/);
  });
});

// ============================================================================
// proxyfb
// ============================================================================

describe('rotateProxy — proxyfb', () => {
  it('success fixture → normalized descriptor', async () => {
    const result = await rotateProxy('proxyfb', 'testkey', {
      fetchImpl: makeStub('proxy-proxyfb-success.json'),
    });
    expect(result).toEqual({
      proxy: '203.0.113.10:8080',
      server: 'http://203.0.113.10:8080',
      username: 'testuser',
      password: 'testpass',
    });
  });

  it('malformed fixture → null (never throws)', async () => {
    const result = await rotateProxy('proxyfb', 'testkey', {
      fetchImpl: makeStub('proxy-proxyfb-malformed.json'),
    });
    expect(result).toBeNull();
  });
});

// ============================================================================
// tmproxy
// ============================================================================

describe('rotateProxy — tmproxy', () => {
  it('success fixture → normalized descriptor', async () => {
    const result = await rotateProxy('tmproxy', 'testkey', {
      fetchImpl: makeStub('proxy-tmproxy-success.json'),
    });
    expect(result).toEqual({
      proxy: '203.0.113.20:8888',
      server: 'http://203.0.113.20:8888',
      username: 'tmuser',
      password: 'tmpass',
    });
  });

  it('malformed fixture → null (never throws)', async () => {
    const result = await rotateProxy('tmproxy', 'testkey', {
      fetchImpl: makeStub('proxy-tmproxy-malformed.json'),
    });
    expect(result).toBeNull();
  });
});

// ============================================================================
// shoplike
// ============================================================================

describe('rotateProxy — shoplike', () => {
  it('success fixture → normalized descriptor', async () => {
    const result = await rotateProxy('shoplike', 'testkey', {
      fetchImpl: makeStub('proxy-shoplike-success.json'),
    });
    expect(result).toEqual({
      proxy: '203.0.113.30:9090',
      server: 'http://203.0.113.30:9090',
      username: 'sluser',
      password: 'slpass',
    });
  });

  it('malformed fixture → null (never throws)', async () => {
    const result = await rotateProxy('shoplike', 'testkey', {
      fetchImpl: makeStub('proxy-shoplike-malformed.json'),
    });
    expect(result).toBeNull();
  });
});

// ============================================================================
// Network error handling
// ============================================================================

describe('rotateProxy network error', () => {
  it('returns null when fetchImpl throws (never re-throws)', async () => {
    const fetchImpl = async () => { throw new Error('network down'); };
    const result = await rotateProxy('proxyfb', 'testkey', { fetchImpl });
    expect(result).toBeNull();
  });
});

// ============================================================================
// Descriptor shape integrity (AC4 shape-match verification)
// ============================================================================

describe('rotateProxy descriptor shape (AC4 shape-match)', () => {
  it('server field starts with http:// (feeds --proxy-server= directly)', async () => {
    const result = await rotateProxy('proxyfb', 'testkey', {
      fetchImpl: makeStub('proxy-proxyfb-success.json'),
    });
    expect(result.server).toMatch(/^http:\/\//);
  });

  it('proxy field is raw host:port (no http:// prefix)', async () => {
    const result = await rotateProxy('proxyfb', 'testkey', {
      fetchImpl: makeStub('proxy-proxyfb-success.json'),
    });
    expect(result.proxy).not.toMatch(/^https?:\/\//);
    expect(result.proxy).toMatch(/^[^/]+:\d+$/);
  });

  it('descriptor contains username and password when creds in response', async () => {
    const result = await rotateProxy('proxyfb', 'testkey', {
      fetchImpl: makeStub('proxy-proxyfb-success.json'),
    });
    expect(result).toHaveProperty('username');
    expect(result).toHaveProperty('password');
  });
});

// ============================================================================
// Two-step fallback behavior (primary fail → fallback success)
// Matches C# source: proxyfb.cs, proxyTM.cs, shopLike.cs primary→fallback pattern.
// ============================================================================

/**
 * Build a stub that returns different responses per call index.
 * Call 0 = primary endpoint, call 1 = fallback endpoint.
 * @param {string[]} fixtureFiles - fixture filenames per call order
 */
function makeSequentialStub(fixtureFiles) {
  let callIdx = 0;
  return async (_url, _init) => {
    const file = fixtureFiles[callIdx] ?? fixtureFiles[fixtureFiles.length - 1];
    callIdx++;
    const text = readFileSync(join(FIXTURES, file), 'utf-8');
    return { status: 200, text: async () => text };
  };
}

describe('rotateProxy — proxyfb fallback (primary non-True → fallback called)', () => {
  it('primary returns success="False" → fallback called → returns descriptor', async () => {
    // Primary: success != "True"  →  fallback: success == "True"
    const stub = makeSequentialStub([
      'proxy-proxyfb-malformed.json',  // primary returns broken/non-True → okFn fails
      'proxy-proxyfb-success.json',    // fallback returns real shape → descriptor
    ]);
    const result = await rotateProxy('proxyfb', 'testkey', { fetchImpl: stub });
    expect(result).toEqual({
      proxy: '203.0.113.10:8080',
      server: 'http://203.0.113.10:8080',
      username: 'testuser',
      password: 'testpass',
    });
  });

  it('both primary and fallback fail → returns null', async () => {
    const stub = makeSequentialStub([
      'proxy-proxyfb-malformed.json',
      'proxy-proxyfb-malformed.json',
    ]);
    const result = await rotateProxy('proxyfb', 'testkey', { fetchImpl: stub });
    expect(result).toBeNull();
  });
});

describe('rotateProxy — tmproxy fallback (primary code!="0" → fallback called)', () => {
  it('primary returns code="1" → fallback called → returns descriptor', async () => {
    const stub = makeSequentialStub([
      'proxy-tmproxy-malformed.json',  // primary: code != "0"
      'proxy-tmproxy-success.json',    // fallback: code == "0"
    ]);
    const result = await rotateProxy('tmproxy', 'testkey', { fetchImpl: stub });
    expect(result).toEqual({
      proxy: '203.0.113.20:8888',
      server: 'http://203.0.113.20:8888',
      username: 'tmuser',
      password: 'tmpass',
    });
  });
});

describe('rotateProxy — shoplike fallback (primary status !contains "success" → fallback called)', () => {
  it('primary status does not contain "success" → fallback called → returns descriptor', async () => {
    const stub = makeSequentialStub([
      'proxy-shoplike-malformed.json', // primary: status does not contain "success"
      'proxy-shoplike-success.json',   // fallback: status contains "success"
    ]);
    const result = await rotateProxy('shoplike', 'testkey', { fetchImpl: stub });
    expect(result).toEqual({
      proxy: '203.0.113.30:9090',
      server: 'http://203.0.113.30:9090',
      username: 'sluser',
      password: 'slpass',
    });
  });
});

// ============================================================================
// P1 Kill: parseFlatProxy edge cases (L112, L117, L118, L133, L135, L138, L140)
// ============================================================================

describe('rotateProxy — parseFlatProxy edge cases (P1 kill)', () => {
  /** Helper: build a stub that returns the given JSON string as response. */
  function jsonStub(jsonStr) {
    return async () => ({ status: 200, text: async () => jsonStr });
  }

  it('proxy with only host:port (no creds) → no username/password fields', async () => {
    // L117/L118: if (username) / if (password) — with no creds, fields absent
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: '10.0.0.1:80' })),
    });
    expect(result).toEqual({
      proxy: '10.0.0.1:80',
      server: 'http://10.0.0.1:80',
    });
    expect(result).not.toHaveProperty('username');
    expect(result).not.toHaveProperty('password');
  });

  it('proxy with host:port:user (3 parts) → username present, password absent', async () => {
    // L138: parts.length > 2 → username = parts[2]
    // L140: parts.length > 3 → false → password = null
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: '10.0.0.1:80:user1' })),
    });
    expect(result.username).toBe('user1');
    expect(result).not.toHaveProperty('password');
  });

  it('proxy with host:port:user:pass (4 parts) → both username and password', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: '10.0.0.1:80:user1:pass1' })),
    });
    expect(result.username).toBe('user1');
    expect(result.password).toBe('pass1');
  });

  it('proxy with password containing colons (5+ parts) → password rejoined', async () => {
    // L140: parts.slice(3).join(':') — password with colons
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: '10.0.0.1:80:user1:pass:with:colons' })),
    });
    expect(result.username).toBe('user1');
    expect(result.password).toBe('pass:with:colons');
  });

  it('proxy with exactly 2 parts (boundary, L135: parts.length < 2)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: '10.0.0.1:80' })),
    });
    expect(result).not.toBeNull();
    expect(result.proxy).toBe('10.0.0.1:80');
  });

  it('proxy with 1 part (no colon) → null (L133: !raw.includes(":"))', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 'noColonHere' })),
    });
    // L133: typeof raw !== 'string' || !raw.includes(':') → return null
    expect(result).toBeNull();
  });

  it('proxy with empty host → null (L112: !host)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: ':80' })),
    });
    // L112: if (!host || !port) return null — host is '' (falsy)
    expect(result).toBeNull();
  });

  it('proxy with empty port → null (L112: !port)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: '10.0.0.1:' })),
    });
    expect(result).toBeNull();
  });

  it('proxy with empty username (3 parts, parts[2] = "") → username absent (L138: parts[2] || null)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: '10.0.0.1:80:' })),
    });
    // parts[2] = '' → '' || null → null → if (username) false → no username field
    expect(result).not.toHaveProperty('username');
  });

  it('non-string proxy field → null (L133: typeof raw !== "string")', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 12345 })),
    });
    expect(result).toBeNull();
  });
});

// ============================================================================
// P1 Kill: okFn checks — exact response codes (L50, L51, L61, L62, L71, L72)
// ============================================================================

describe('rotateProxy — okFn exact response checks (P1 kill)', () => {
  function jsonStub(jsonStr) {
    return async () => ({ status: 200, text: async () => jsonStr });
  }

  it('proxyfb success="True" (exact string) → descriptor (L50: p?.success === "True")', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: '1.2.3.4:80' })),
    });
    // EqualityOperator mutant L50: === → !== → okFn inverts → null
    expect(result).not.toBeNull();
    expect(result.proxy).toBe('1.2.3.4:80');
  });

  it('proxyfb success="true" (lowercase) → null (L50: strict equality)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'true', proxy: '1.2.3.4:80' })),
    });
    // Must be exactly "True" (capital T), not "true"
    expect(result).toBeNull();
  });

  it('proxyfb success=true (boolean) → null (L50: strict equality with string)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: true, proxy: '1.2.3.4:80' })),
    });
    expect(result).toBeNull();
  });

  it('proxyfb null response → null (L50: p?.success optional chaining)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify(null)),
    });
    // OptionalChaining mutant L50: p?.success → p.success → throws on null
    expect(result).toBeNull();
  });

  it('tmproxy code="0" (exact string) → descriptor (L61: p?.code === "0")', async () => {
    const result = await rotateProxy('tmproxy', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ code: '0', data: { https: '5.6.7.8:90' } })),
    });
    expect(result).not.toBeNull();
    expect(result.proxy).toBe('5.6.7.8:90');
  });

  it('tmproxy code="1" → null (L61: code !== "0")', async () => {
    const result = await rotateProxy('tmproxy', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ code: '1', data: { https: '5.6.7.8:90' } })),
    });
    expect(result).toBeNull();
  });

  it('tmproxy code=0 (number) → null (L61: strict equality with string)', async () => {
    const result = await rotateProxy('tmproxy', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ code: 0, data: { https: '5.6.7.8:90' } })),
    });
    expect(result).toBeNull();
  });

  it('tmproxy null response → null (L61: p?.code optional chaining)', async () => {
    const result = await rotateProxy('tmproxy', 'key', {
      fetchImpl: jsonStub(JSON.stringify(null)),
    });
    expect(result).toBeNull();
  });

  it('shoplike status contains "success" → descriptor (L71)', async () => {
    const result = await rotateProxy('shoplike', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ status: 'success', data: { proxy: '9.8.7.6:100' } })),
    });
    expect(result).not.toBeNull();
    expect(result.proxy).toBe('9.8.7.6:100');
  });

  it('shoplike status does not contain "success" → null (L71)', async () => {
    const result = await rotateProxy('shoplike', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ status: 'error', data: { proxy: '9.8.7.6:100' } })),
    });
    expect(result).toBeNull();
  });

  it('shoplike null response → null (L71: p?.status optional chaining)', async () => {
    const result = await rotateProxy('shoplike', 'key', {
      fetchImpl: jsonStub(JSON.stringify(null)),
    });
    expect(result).toBeNull();
  });

  it('shoplike non-string status → null (L71: typeof p?.status === "string")', async () => {
    const result = await rotateProxy('shoplike', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ status: 200, data: { proxy: '9.8.7.6:100' } })),
    });
    expect(result).toBeNull();
  });
});

// ============================================================================
// P1 Kill: OptionalChaining — null/undefined nested objects (L155, L165, L175)
// ============================================================================

describe('rotateProxy — OptionalChaining null safety (P1 kill)', () => {
  function jsonStub(jsonStr) {
    return async () => ({ status: 200, text: async () => jsonStr });
  }

  it('proxyfb parsed.proxy = null → null (L155: parsed?.proxy ?? null)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: null })),
    });
    expect(result).toBeNull();
  });

  it('proxyfb parsed.proxy = undefined → null (L155)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True' })),
    });
    expect(result).toBeNull();
  });

  it('tmproxy parsed.data = null → null (L165: parsed?.data?.https ?? null)', async () => {
    const result = await rotateProxy('tmproxy', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ code: '0', data: null })),
    });
    // OptionalChaining mutant L165: parsed?.data?.https → parsed?.data.https → throws on null
    expect(result).toBeNull();
  });

  it('tmproxy parsed.data = undefined → null (L165)', async () => {
    const result = await rotateProxy('tmproxy', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ code: '0' })),
    });
    expect(result).toBeNull();
  });

  it('tmproxy parsed.data.https = null → null (L165)', async () => {
    const result = await rotateProxy('tmproxy', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ code: '0', data: { https: null } })),
    });
    expect(result).toBeNull();
  });

  it('shoplike parsed.data = null → null (L175: parsed?.data?.proxy ?? null)', async () => {
    const result = await rotateProxy('shoplike', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ status: 'success', data: null })),
    });
    expect(result).toBeNull();
  });

  it('shoplike parsed.data = undefined → null (L175)', async () => {
    const result = await rotateProxy('shoplike', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ status: 'success' })),
    });
    expect(result).toBeNull();
  });

  it('shoplike parsed.data.proxy = null → null (L175)', async () => {
    const result = await rotateProxy('shoplike', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ status: 'success', data: { proxy: null } })),
    });
    expect(result).toBeNull();
  });
});

// ============================================================================
// P1 Kill: rotateProxy input validation edge cases (L245, L250)
// ============================================================================

describe('rotateProxy — input validation edge cases (P1 kill)', () => {
  it('throws for non-string key (number) (L250: typeof key !== "string")', async () => {
    await expect(rotateProxy('proxyfb', 123)).rejects.toThrow(/key is required/);
  });

  it('throws for non-string key (object) (L250)', async () => {
    await expect(rotateProxy('proxyfb', { foo: 'bar' })).rejects.toThrow(/key is required/);
  });

  it('throws for key with only whitespace (L250: !key.trim())', async () => {
    await expect(rotateProxy('proxyfb', '\t\n')).rejects.toThrow(/key is required/);
  });

  it('error message includes provider name for unknown provider (L247)', async () => {
    // StringLiteral mutant L247: template literal → empty string
    await expect(rotateProxy('badprovider', 'key')).rejects.toThrow(/badprovider/);
  });

  it('error message includes valid providers list (L247)', async () => {
    await expect(rotateProxy('badprovider', 'key')).rejects.toThrow(/proxyfb.*tmproxy.*shoplike/);
  });
});

// ============================================================================
// P1 Kill: _attempt — JSON parse + okFn + descriptor (L209, L214, L215, L217)
// ============================================================================

describe('rotateProxy — _attempt internal logic (P1 kill)', () => {
  function jsonStub(jsonStr) {
    return async () => ({ status: 200, text: async () => jsonStr });
  }

  it('non-JSON response text → null (L214: JSON.parse catch)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: async () => ({ status: 200, text: async () => 'not json {{{' }),
    });
    expect(result).toBeNull();
  });

  it('ok response but no proxy field → null (L215: !okFn → false, L217: !descriptor)', async () => {
    // success="True" but no proxy field → parseFlatProxy(undefined) → null
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True' })),
    });
    // L217: if (!descriptor) → warn + return null (descriptor is null)
    expect(result).toBeNull();
  });

  it('okFn returns false → null (L215: !okFn(parsed))', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'False', proxy: '1.2.3.4:80' })),
    });
    // primaryOk returns false → _attempt returns null → tries fallback
    // fallback also returns same → null
    expect(result).toBeNull();
  });

  it('fetch throws → null (L209: catch block)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: async () => { throw new Error('connection refused'); },
    });
    expect(result).toBeNull();
  });

  it('valid response with empty proxy string → null (L133: !raw.includes(":"))', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: '' })),
    });
    // Empty string doesn't include ':' → parseFlatProxy returns null
    expect(result).toBeNull();
  });
});
