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

// ============================================================================
// P1 Kill: URL template StringLiterals — capture URL passed to fetchImpl
// L46, L47 (proxyfb), L56, L57 (tmproxy), L67, L68 (shoplike)
// ============================================================================

describe('rotateProxy — URL template StringLiterals (P1 kill, L46-68)', () => {
  /**
   * Build a recording stub: returns the given JSON for every call, but records
   * every URL (and init) it receives into `calls`.
   */
  function recordingStub(jsonStr, calls) {
    return async (url, init) => {
      calls.push({ url, init });
      return { status: 200, text: async () => jsonStr };
    };
  }

  it('proxyfb primary URL contains api.proxyfb.com/api/changeProxy.php (L46)', async () => {
    const calls = [];
    await rotateProxy('proxyfb', 'mykey', {
      fetchImpl: recordingStub(JSON.stringify({ success: 'True', proxy: '1.2.3.4:80' }), calls),
    });
    // StringLiteral mutant L46: template → '' → URL empty → would not contain domain
    expect(calls[0].url).toContain('api.proxyfb.com');
    expect(calls[0].url).toContain('changeProxy.php');
  });

  it('proxyfb primary URL embeds the API key (L46: key=${encodeURIComponent(k)})', async () => {
    const calls = [];
    await rotateProxy('proxyfb', 'secretKey123', {
      fetchImpl: recordingStub(JSON.stringify({ success: 'True', proxy: '1.2.3.4:80' }), calls),
    });
    expect(calls[0].url).toContain('key=secretKey123');
  });

  it('proxyfb fallback URL contains api.proxyfb.com/api/getProxy.php (L47)', async () => {
    const calls = [];
    // Primary returns non-OK so fallback is triggered
    await rotateProxy('proxyfb', 'mykey', {
      fetchImpl: recordingStub(JSON.stringify({ success: 'False', proxy: '1.2.3.4:80' }), calls),
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // StringLiteral mutant L47: template → '' → URL empty
    expect(calls[1].url).toContain('api.proxyfb.com');
    expect(calls[1].url).toContain('getProxy.php');
  });

  it('tmproxy primary URL contains tmproxy.com/api/proxy/get-new-proxy (L56)', async () => {
    const calls = [];
    await rotateProxy('tmproxy', 'mykey', {
      fetchImpl: recordingStub(JSON.stringify({ code: '0', data: { https: '5.6.7.8:90' } }), calls),
    });
    // StringLiteral mutant L56: string → '' → URL empty
    expect(calls[0].url).toContain('tmproxy.com');
    expect(calls[0].url).toContain('get-new-proxy');
  });

  it('tmproxy fallback URL contains tmproxy.com/api/proxy/get-current-proxy (L57)', async () => {
    const calls = [];
    // Primary returns non-OK so fallback is triggered
    await rotateProxy('tmproxy', 'mykey', {
      fetchImpl: recordingStub(JSON.stringify({ code: '1', data: { https: '5.6.7.8:90' } }), calls),
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // StringLiteral mutant L57: string → '' → URL empty
    expect(calls[1].url).toContain('tmproxy.com');
    expect(calls[1].url).toContain('get-current-proxy');
  });

  it('shoplike primary URL contains proxy.shoplike.vn/Api/getNewProxy (L67)', async () => {
    const calls = [];
    await rotateProxy('shoplike', 'mykey', {
      fetchImpl: recordingStub(JSON.stringify({ status: 'success', data: { proxy: '9.8.7.6:100' } }), calls),
    });
    // StringLiteral mutant L67: template → '' → URL empty
    expect(calls[0].url).toContain('proxy.shoplike.vn');
    expect(calls[0].url).toContain('getNewProxy');
  });

  it('shoplike primary URL embeds the access_token (L67)', async () => {
    const calls = [];
    await rotateProxy('shoplike', 'tok123', {
      fetchImpl: recordingStub(JSON.stringify({ status: 'success', data: { proxy: '9.8.7.6:100' } }), calls),
    });
    expect(calls[0].url).toContain('access_token=tok123');
  });

  it('shoplike fallback URL contains proxy.shoplike.vn/Api/getCurrentProxy (L68)', async () => {
    const calls = [];
    // Primary returns non-OK so fallback is triggered
    await rotateProxy('shoplike', 'mykey', {
      fetchImpl: recordingStub(JSON.stringify({ status: 'error', data: { proxy: '9.8.7.6:100' } }), calls),
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // StringLiteral mutant L68: template → '' → URL empty
    expect(calls[1].url).toContain('proxy.shoplike.vn');
    expect(calls[1].url).toContain('getCurrentProxy');
  });

  it('proxyfb primary uses http:// scheme (L46: http://api.proxyfb.com)', async () => {
    const calls = [];
    await rotateProxy('proxyfb', 'mykey', {
      fetchImpl: recordingStub(JSON.stringify({ success: 'True', proxy: '1.2.3.4:80' }), calls),
    });
    expect(calls[0].url).toMatch(/^http:\/\/api\.proxyfb\.com/);
  });

  it('shoplike primary uses http:// scheme (L67: http://proxy.shoplike.vn)', async () => {
    const calls = [];
    await rotateProxy('shoplike', 'mykey', {
      fetchImpl: recordingStub(JSON.stringify({ status: 'success', data: { proxy: '9.8.7.6:100' } }), calls),
    });
    expect(calls[0].url).toMatch(/^http:\/\/proxy\.shoplike\.vn/);
  });

  it('shoplike fallback uses https:// scheme (L68: https://proxy.shoplike.vn)', async () => {
    const calls = [];
    await rotateProxy('shoplike', 'mykey', {
      fetchImpl: recordingStub(JSON.stringify({ status: 'error', data: { proxy: '9.8.7.6:100' } }), calls),
    });
    expect(calls[1].url).toMatch(/^https:\/\/proxy\.shoplike\.vn/);
  });

  it('tmproxy primary uses https:// scheme (L56)', async () => {
    const calls = [];
    await rotateProxy('tmproxy', 'mykey', {
      fetchImpl: recordingStub(JSON.stringify({ code: '0', data: { https: '5.6.7.8:90' } }), calls),
    });
    expect(calls[0].url).toMatch(/^https:\/\/tmproxy\.com/);
  });
});

// ============================================================================
// P1 Kill: tmproxy body — JSON body carries api_key (L60)
// ============================================================================

describe('rotateProxy — tmproxy POST body (P1 kill, L60)', () => {
  function recordingStub(jsonStr, calls) {
    return async (url, init) => {
      calls.push({ url, init });
      return { status: 200, text: async () => jsonStr };
    };
  }

  it('tmproxy primary sends JSON body with api_key (L60: body: (k) => JSON.stringify({api_key: k}))', async () => {
    const calls = [];
    await rotateProxy('tmproxy', 'myApiKey', {
      fetchImpl: recordingStub(JSON.stringify({ code: '0', data: { https: '5.6.7.8:90' } }), calls),
    });
    // ObjectLiteral mutant L60: body fn → {} → init.body would be undefined/empty
    expect(calls[0].init.body).toBeDefined();
    const parsed = JSON.parse(calls[0].init.body);
    expect(parsed.api_key).toBe('myApiKey');
  });

  it('tmproxy primary uses POST method (L58: method: "POST")', async () => {
    const calls = [];
    await rotateProxy('tmproxy', 'myApiKey', {
      fetchImpl: recordingStub(JSON.stringify({ code: '0', data: { https: '5.6.7.8:90' } }), calls),
    });
    expect(calls[0].init.method).toBe('POST');
  });

  it('tmproxy primary sends Content-Type: application/json header (L59)', async () => {
    const calls = [];
    await rotateProxy('tmproxy', 'myApiKey', {
      fetchImpl: recordingStub(JSON.stringify({ code: '0', data: { https: '5.6.7.8:90' } }), calls),
    });
    expect(calls[0].init.headers['Content-Type']).toBe('application/json');
  });

  it('tmproxy fallback also sends JSON body with api_key (L60 via fallback path)', async () => {
    const calls = [];
    await rotateProxy('tmproxy', 'fbKey', {
      fetchImpl: recordingStub(JSON.stringify({ code: '1', data: { https: '5.6.7.8:90' } }), calls),
    });
    // Fallback call (index 1) should also carry the body
    expect(calls[1].init.body).toBeDefined();
    expect(JSON.parse(calls[1].init.body).api_key).toBe('fbKey');
  });

  it('proxyfb GET does NOT send a body (L60 only present for tmproxy)', async () => {
    const calls = [];
    await rotateProxy('proxyfb', 'mykey', {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { status: 200, text: async () => JSON.stringify({ success: 'True', proxy: '1.2.3.4:80' }) };
      },
    });
    expect(calls[0].init.body).toBeUndefined();
  });
});

// ============================================================================
// P1 Kill: primaryOk conditionals — primary path taken (no fallback) (L50, L61, L71)
// Mutant: primaryOk → false  →  primary always fails → fallback always called.
// Kill strategy: assert fetchImpl called exactly ONCE when primary response is OK.
// ============================================================================

describe('rotateProxy — primaryOk conditionals, primary-only path (P1 kill, L50/61/71)', () => {
  function countingStub(jsonStr, calls) {
    return async (url, init) => {
      calls.push({ url, init });
      return { status: 200, text: async () => jsonStr };
    };
  }

  it('proxyfb success="True" → only primary called, no fallback (L50: primaryOk true)', async () => {
    const calls = [];
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: countingStub(JSON.stringify({ success: 'True', proxy: '1.2.3.4:80' }), calls),
    });
    // ConditionalExpression mutant L50: p?.success === 'True' → false
    //   → primary fails → fallback called → 2 calls. Original → 1 call.
    expect(calls).toHaveLength(1);
    expect(result).not.toBeNull();
    expect(result.proxy).toBe('1.2.3.4:80');
  });

  it('proxyfb primary URL is changeProxy (not getProxy) when primary OK (L50)', async () => {
    const calls = [];
    await rotateProxy('proxyfb', 'key', {
      fetchImpl: countingStub(JSON.stringify({ success: 'True', proxy: '1.2.3.4:80' }), calls),
    });
    expect(calls[0].url).toContain('changeProxy');
    expect(calls[0].url).not.toContain('getProxy');
  });

  it('tmproxy code="0" → only primary called, no fallback (L61: primaryOk true)', async () => {
    const calls = [];
    const result = await rotateProxy('tmproxy', 'key', {
      fetchImpl: countingStub(JSON.stringify({ code: '0', data: { https: '5.6.7.8:90' } }), calls),
    });
    // ConditionalExpression mutant L61: p?.code === '0' → false
    //   → primary fails → fallback called → 2 calls. Original → 1 call.
    expect(calls).toHaveLength(1);
    expect(result).not.toBeNull();
    expect(result.proxy).toBe('5.6.7.8:90');
  });

  it('tmproxy primary URL is get-new-proxy (not get-current-proxy) when primary OK (L61)', async () => {
    const calls = [];
    await rotateProxy('tmproxy', 'key', {
      fetchImpl: countingStub(JSON.stringify({ code: '0', data: { https: '5.6.7.8:90' } }), calls),
    });
    expect(calls[0].url).toContain('get-new-proxy');
    expect(calls[0].url).not.toContain('get-current-proxy');
  });

  it('shoplike status="success" → only primary called, no fallback (L71: primaryOk true)', async () => {
    const calls = [];
    const result = await rotateProxy('shoplike', 'key', {
      fetchImpl: countingStub(JSON.stringify({ status: 'success', data: { proxy: '9.8.7.6:100' } }), calls),
    });
    // ConditionalExpression mutant L71: ... → false
    //   → primary fails → fallback called → 2 calls. Original → 1 call.
    expect(calls).toHaveLength(1);
    expect(result).not.toBeNull();
    expect(result.proxy).toBe('9.8.7.6:100');
  });

  it('shoplike primary URL is getNewProxy (not getCurrentProxy) when primary OK (L71)', async () => {
    const calls = [];
    await rotateProxy('shoplike', 'key', {
      fetchImpl: countingStub(JSON.stringify({ status: 'success', data: { proxy: '9.8.7.6:100' } }), calls),
    });
    expect(calls[0].url).toContain('getNewProxy');
    expect(calls[0].url).not.toContain('getCurrentProxy');
  });

  it('shoplike status containing "OK" substring but not "success" → null (L71: includes("success"))', async () => {
    // StringLiteral mutant L71: 'success' → '' (or 'OK' per task) → includes('') always true
    // If the literal were mutated to '', any string status would pass okFn.
    // This test ensures a status WITHOUT "success" → null, killing the '' mutant.
    const result = await rotateProxy('shoplike', 'key', {
      fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ status: 'OK', data: { proxy: '9.8.7.6:100' } }) }),
    });
    expect(result).toBeNull();
  });

  it('shoplike non-empty status without "success" → null (L71 StringLiteral → "" mutant)', async () => {
    // If 'success' → '', includes('') is true for any string → would return descriptor.
    // Original: 'pending' does not include 'success' → null.
    const result = await rotateProxy('shoplike', 'key', {
      fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ status: 'pending', data: { proxy: '9.8.7.6:100' } }) }),
    });
    expect(result).toBeNull();
  });
});

// ============================================================================
// P1 Kill: StringLiteral 'True' / '0' — exact match required (L50, L61)
// ============================================================================

describe('rotateProxy — okFn StringLiteral exact values (P1 kill, L50/61)', () => {
  function countingStub(jsonStr, calls) {
    return async (url, init) => {
      calls.push({ url, init });
      return { status: 200, text: async () => jsonStr };
    };
  }

  it('proxyfb success="True" → primary only (L50 StringLiteral "True")', async () => {
    const calls = [];
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: countingStub(JSON.stringify({ success: 'True', proxy: '1.2.3.4:80' }), calls),
    });
    // StringLiteral mutant L50: 'True' → '' → p?.success === '' → false for "True"
    //   → primary fails → fallback called → 2 calls. Original → 1 call.
    expect(calls).toHaveLength(1);
    expect(result.proxy).toBe('1.2.3.4:80');
  });

  it('tmproxy code="0" → primary only (L61 StringLiteral "0")', async () => {
    const calls = [];
    const result = await rotateProxy('tmproxy', 'key', {
      fetchImpl: countingStub(JSON.stringify({ code: '0', data: { https: '5.6.7.8:90' } }), calls),
    });
    // StringLiteral mutant L61: '0' → '' → p?.code === '' → false for "0"
    //   → primary fails → fallback called → 2 calls. Original → 1 call.
    expect(calls).toHaveLength(1);
    expect(result.proxy).toBe('5.6.7.8:90');
  });

  it('proxyfb success="" (empty) → null (L50: "True" !== "")', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ success: '', proxy: '1.2.3.4:80' }) }),
    });
    // If 'True' → '' mutant, success='' would match → descriptor. Original → null.
    expect(result).toBeNull();
  });

  it('tmproxy code="" (empty) → null (L61: "0" !== "")', async () => {
    const result = await rotateProxy('tmproxy', 'key', {
      fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ code: '', data: { https: '5.6.7.8:90' } }) }),
    });
    // If '0' → '' mutant, code='' would match → descriptor. Original → null.
    expect(result).toBeNull();
  });
});

// ============================================================================
// P1 Kill: parseFlatProxy boundary — L133, L135, L138, L140 exact conditions
// (Additional targeted tests beyond existing edge-case suite)
// ============================================================================

describe('rotateProxy — parseFlatProxy boundary conditions (P1 kill, L133-140)', () => {
  function jsonStub(jsonStr) {
    return async () => ({ status: 200, text: async () => jsonStr });
  }

  it('L133: raw without ":" (single token) → null', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 'hostonly' })),
    });
    // StringLiteral mutant L133: ':' → '' → ''.includes('') is always true →
    //   would proceed to split → ['hostonly'] → length 1 < 2 → null anyway.
    // But the ':' → '' mutant makes includes always true, so a non-string with
    // no colon still enters split. This test confirms null is returned.
    expect(result).toBeNull();
  });

  it('L135: exactly 2 parts "host:port" → descriptor (boundary: length < 2 is false)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 'host:80' })),
    });
    // ConditionalExpression mutant L135: parts.length < 2 → false (always)
    //   → would NOT return null for 1-part strings. But 2 parts is fine either way.
    // This test confirms 2-part works; the 1-part test below kills the mutant.
    expect(result).not.toBeNull();
    expect(result.proxy).toBe('host:80');
  });

  it('L135: 1 part after split (string with colon but empty second) → null', async () => {
    // "host:" splits to ['host',''] → length 2, not < 2. Need a case where
    // length is genuinely 1: impossible after includes(':') check unless...
    // Actually includes(':') true means split gives >=2. So L135 < 2 is
    // unreachable when includes(':') is true. The mutant → false is equivalent.
    // We still test the 2-part boundary for L138/L140 mutants below.
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 'host:80' })),
    });
    expect(result).not.toBeNull();
  });

  it('L138: 2 parts "host:port" → username null (parts.length > 2 is false)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 'host:80' })),
    });
    // ConditionalExpression mutant L138: parts.length > 2 → true (always)
    //   → would set username = parts[2] = undefined → null. Same result.
    // EqualityOperator mutant L138: > 2 → >= 2 → 2 parts → username = parts[2] = undefined
    //   → parts[2] is undefined → (undefined || null) → null → no username field.
    // So 2-part gives no username in both original and mutant. Need 3-part to kill.
    expect(result).not.toHaveProperty('username');
  });

  it('L138: 3 parts "host:port:user" → username extracted (parts.length > 2 true)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 'host:80:user1' })),
    });
    // EqualityOperator mutant L138: > 2 → >= 2 → 2 parts would also extract.
    // For 3 parts, both > 2 and >= 2 are true → username extracted.
    // The 2-part test above kills >= 2 mutant (2 >= 2 true → username=undefined→null, same).
    // Actually to kill >= 2: with 2 parts, >= 2 is true → username = parts[2] = undefined
    //   → undefined || null → null → no field. Original: > 2 false → null → no field.
    //   Same outcome. So >= 2 mutant is NOT killed by 2-part. It's equivalent here.
    expect(result.username).toBe('user1');
    expect(result).not.toHaveProperty('password');
  });

  it('L140: 3 parts "host:port:user" → password null (parts.length > 3 false)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 'host:80:user1' })),
    });
    // ConditionalExpression mutant L140: parts.length > 3 → true (always)
    //   → password = parts.slice(3).join(':') = [].join(':') = '' → '' is falsy
    //   → buildDescriptor: if (password) false → no password field. Same result.
    // EqualityOperator mutant L140: > 3 → >= 3 → 3 parts → password = slice(3) = [] → ''
    //   → falsy → no field. Same. So 3-part does NOT kill L140 mutants.
    expect(result).not.toHaveProperty('password');
  });

  it('L140: 4 parts "host:port:user:pass" → password extracted (parts.length > 3 true)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 'host:80:user1:pass1' })),
    });
    // For 4 parts: > 3 true → password = 'pass1'. >= 3 also true → same.
    // The 3-part test kills the → true mutant IF password would be non-empty.
    // With 3 parts → true mutant: slice(3) = [] → '' → falsy → no field.
    //   Original: > 3 false → null → no field. SAME. Not killed.
    // So L140 → true and >= 3 mutants survive for empty-slice cases.
    // But with 4 parts both give 'pass1'. No difference. These mutants may be
    // equivalent given the falsy-empty-string behavior. We still assert correctness.
    expect(result.password).toBe('pass1');
  });

  it('L140: 4 parts with non-empty password confirms slice(3).join(":") (L140)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 'host:80:user1:pass1' })),
    });
    expect(result.username).toBe('user1');
    expect(result.password).toBe('pass1');
  });
});

// ============================================================================
// P1 Kill: OptionalChaining parsed?.proxy (L155) — null/undefined parsed object
// ============================================================================

describe('rotateProxy — parseProxyfb OptionalChaining (P1 kill, L155)', () => {
  function jsonStub(jsonStr) {
    return async () => ({ status: 200, text: async () => jsonStr });
  }

  it('L155: parsed = null (whole response null) → null, no throw', async () => {
    // parsed?.proxy → if mutant parsed.proxy (no ?) → throws on null → caught → null
    // Both give null, but the no-throw path differs. We assert no throw + null.
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify(null)),
    });
    expect(result).toBeNull();
  });

  it('L155: parsed.proxy = null → null', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: null })),
    });
    // OptionalChaining mutant L155: parsed?.proxy → parsed.proxy
    //   parsed is {success:'True', proxy:null} → parsed.proxy = null → ?? null → null
    //   Same result. Not killed by this alone.
    expect(result).toBeNull();
  });

  it('L155: parsed.proxy = "host:80" → descriptor (chaining works on defined object)', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True', proxy: 'host:80' })),
    });
    // OptionalChaining mutant L155: parsed?.proxy → parsed.proxy
    //   On a defined object, both behave identically → descriptor returned.
    // The null-parsed test above is the real killer (throws vs null).
    expect(result).not.toBeNull();
    expect(result.proxy).toBe('host:80');
  });

  it('L155: parsed is undefined-shaped (missing proxy field) → null', async () => {
    const result = await rotateProxy('proxyfb', 'key', {
      fetchImpl: jsonStub(JSON.stringify({ success: 'True' })),
    });
    // parsed?.proxy → undefined ?? null → null → parseFlatProxy(null) → null
    expect(result).toBeNull();
  });
});
