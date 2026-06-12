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
