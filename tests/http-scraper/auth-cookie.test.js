// by nichxbt
/**
 * Tests for TwitterAuth — Cookie parsing, save/load, loginWithCookies, CSRF, accessors
 *
 * Uses vitest with mocked fetch. No real network requests.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwitterAuth, AuthError, parseCookieString } from '../../src/scrapers/twitter/http/auth.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock Response. */
function mockResponse(body, { status = 200, headers = {}, setCookies = [] } = {}) {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      ...headersObj,
      get: (name) => headersObj.get(name),
      getSetCookie: () => setCookies,
    },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const VALID_COOKIE_STRING = 'auth_token=abc123; ct0=csrf_tok; twid=u%3D999; guest_id=v1%3A1234';

const VERIFY_CREDENTIALS_RESPONSE = {
  id: 999,
  id_str: '999',
  name: 'Test User',
  screen_name: 'testuser',
};

// ---------------------------------------------------------------------------
// 1. Cookie String Parsing
// ---------------------------------------------------------------------------

describe('parseCookieString', () => {
  it('extracts all required cookies from a standard string', () => {
    const cookies = parseCookieString(VALID_COOKIE_STRING);
    expect(cookies.auth_token).toBe('abc123');
    expect(cookies.ct0).toBe('csrf_tok');
    expect(cookies.twid).toBe('u%3D999');
    expect(cookies.guest_id).toBe('v1%3A1234');
  });

  it('handles cookies without spaces after semicolons', () => {
    const cookies = parseCookieString('auth_token=x;ct0=y;twid=z');
    expect(cookies.auth_token).toBe('x');
    expect(cookies.ct0).toBe('y');
    expect(cookies.twid).toBe('z');
  });

  it('handles empty or falsy input', () => {
    expect(parseCookieString('')).toEqual({});
    expect(parseCookieString(null)).toEqual({});
    expect(parseCookieString(undefined)).toEqual({});
  });

  it('handles values containing equals signs', () => {
    const cookies = parseCookieString('ct0=abc=def==; auth_token=tok');
    expect(cookies.ct0).toBe('abc=def==');
    expect(cookies.auth_token).toBe('tok');
  });

  it('extracts full set of known Twitter cookies', () => {
    const full =
      'auth_token=at; ct0=csrf; twid=tw; guest_id=gi; guest_id_marketing=gim; guest_id_ads=gia; personalization_id=pid; kdt=kdt_val';
    const cookies = parseCookieString(full);
    expect(Object.keys(cookies)).toHaveLength(8);
    expect(cookies.kdt).toBe('kdt_val');
    expect(cookies.personalization_id).toBe('pid');
  });
});

// ---------------------------------------------------------------------------
// 5. Cookie Save/Load Round-trip
// ---------------------------------------------------------------------------

describe('saveCookies / loadCookies', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xactions-auth-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('round-trips cookies through save and load (unencrypted)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(VERIFY_CREDENTIALS_RESPONSE),
    );
    const auth = new TwitterAuth({ fetch: fetchMock });
    auth.setCookies({ auth_token: 'tok1', ct0: 'csrf1', twid: 'u%3D999' });

    const fp = path.join(tmpDir, 'cookies.json');
    await auth.saveCookies(fp);

    // Verify file is valid JSON array
    const raw = JSON.parse(await fs.readFile(fp, 'utf8'));
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.find((c) => c.name === 'auth_token').value).toBe('tok1');

    // Load into a new auth instance
    const auth2 = new TwitterAuth({ fetch: fetchMock });
    const loaded = await auth2.loadCookies(fp);

    expect(loaded).toBe(true);
    expect(auth2.getCookies().auth_token).toBe('tok1');
    expect(auth2.getCookies().ct0).toBe('csrf1');
  });

  it('encrypts sensitive cookies when encryption key is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(VERIFY_CREDENTIALS_RESPONSE),
    );
    const key = 'my-secret-key-123';
    const auth = new TwitterAuth({ fetch: fetchMock, encryptionKey: key });
    auth.setCookies({ auth_token: 'secret_tok', ct0: 'secret_csrf', twid: 'plain' });

    const fp = path.join(tmpDir, 'encrypted.json');
    await auth.saveCookies(fp);

    // Verify the auth_token value is NOT plaintext
    const raw = JSON.parse(await fs.readFile(fp, 'utf8'));
    const authCookie = raw.find((c) => c.name === 'auth_token');
    expect(authCookie.value).not.toBe('secret_tok');
    expect(authCookie.encrypted).toBe(true);

    // twid should remain plaintext
    const twidCookie = raw.find((c) => c.name === 'twid');
    expect(twidCookie.value).toBe('plain');
    expect(twidCookie.encrypted).toBeUndefined();

    // Load should decrypt
    const auth2 = new TwitterAuth({ fetch: fetchMock, encryptionKey: key });
    const loaded = await auth2.loadCookies(fp);
    expect(loaded).toBe(true);
    expect(auth2.getCookies().auth_token).toBe('secret_tok');
    expect(auth2.getCookies().ct0).toBe('secret_csrf');
  });

  it('returns false for missing file', async () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    const loaded = await auth.loadCookies(path.join(tmpDir, 'missing.json'));
    expect(loaded).toBe(false);
  });

  it('returns false for invalid JSON', async () => {
    const fp = path.join(tmpDir, 'bad.json');
    await fs.writeFile(fp, 'NOT JSON AT ALL', 'utf8');

    const auth = new TwitterAuth({ fetch: vi.fn() });
    expect(await auth.loadCookies(fp)).toBe(false);
  });

  it('returns false when loaded cookies have no auth_token', async () => {
    const fp = path.join(tmpDir, 'no-auth.json');
    await fs.writeFile(fp, JSON.stringify([{ name: 'ct0', value: 'x' }]), 'utf8');

    const auth = new TwitterAuth({ fetch: vi.fn() });
    expect(await auth.loadCookies(fp)).toBe(false);
  });

  it('returns false when session validation fails after loading', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({}, { status: 401 }));
    const fp = path.join(tmpDir, 'expired.json');
    await fs.writeFile(
      fp,
      JSON.stringify([
        { name: 'auth_token', value: 'old' },
        { name: 'ct0', value: 'old_csrf' },
      ]),
      'utf8',
    );

    const auth = new TwitterAuth({ fetch: fetchMock });
    expect(await auth.loadCookies(fp)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. loginWithCookies
// ---------------------------------------------------------------------------

describe('loginWithCookies', () => {
  it('parses cookies and validates session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(VERIFY_CREDENTIALS_RESPONSE),
    );
    const auth = new TwitterAuth({ fetch: fetchMock });

    const user = await auth.loginWithCookies(VALID_COOKIE_STRING);

    expect(user).toEqual({ id: '999', username: 'testuser', name: 'Test User' });
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getCsrfToken()).toBe('csrf_tok');
  });

  it('throws AuthError when auth_token is missing', async () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    await expect(auth.loginWithCookies('ct0=val')).rejects.toThrow(AuthError);
    await expect(auth.loginWithCookies('ct0=val')).rejects.toThrow(/auth_token/);
  });

  it('throws AuthError when ct0 is missing', async () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    await expect(auth.loginWithCookies('auth_token=val')).rejects.toThrow(/ct0/);
  });

  it('throws AuthError when session validation fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({}, { status: 403 }));
    const auth = new TwitterAuth({ fetch: fetchMock });

    await expect(auth.loginWithCookies(VALID_COOKIE_STRING)).rejects.toThrow(AuthError);
    expect(auth.isAuthenticated()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. CSRF Token Extraction
// ---------------------------------------------------------------------------

describe('CSRF token extraction', () => {
  it('getCsrfToken returns ct0 from cookies', () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    auth.setCookies({ auth_token: 'x', ct0: 'my_csrf_token' });

    expect(auth.getCsrfToken()).toBe('my_csrf_token');
  });

  it('getCsrfToken returns null when no ct0 cookie', () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    expect(auth.getCsrfToken()).toBeNull();
  });

  it('x-csrf-token header matches ct0 cookie in authenticated headers', () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    auth.setCookies({ auth_token: 'tok', ct0: 'csrf_value_123' });

    const headers = auth.getHeaders(true);
    expect(headers['x-csrf-token']).toBe('csrf_value_123');
    expect(headers['x-csrf-token']).toBe(auth.getCsrfToken());
  });
});

// ---------------------------------------------------------------------------
// 10. isAuthenticated / getUser / getCookieString
// ---------------------------------------------------------------------------

describe('accessors', () => {
  it('isAuthenticated returns false with no cookies', () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns true when auth_token and ct0 are set', () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    auth.setCookies({ auth_token: 'a', ct0: 'b' });
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('getUser returns null before login', () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    expect(auth.getUser()).toBeNull();
  });

  it('getUser returns user info after login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(VERIFY_CREDENTIALS_RESPONSE),
    );
    const auth = new TwitterAuth({ fetch: fetchMock });
    await auth.loginWithCookies(VALID_COOKIE_STRING);

    const user = auth.getUser();
    expect(user).toEqual({ id: '999', username: 'testuser', name: 'Test User' });
  });

  it('getCookieString builds semicolon-separated string', () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    auth.setCookies({ auth_token: 'tok', ct0: 'csrf' });

    const str = auth.getCookieString();
    expect(str).toContain('auth_token=tok');
    expect(str).toContain('ct0=csrf');
    expect(str).toContain('; ');
  });
});
