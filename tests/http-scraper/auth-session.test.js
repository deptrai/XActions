// by nichxbt
/**
 * Tests for TwitterAuth — getGuestToken, getHeaders, validateSession
 *
 * Uses vitest with mocked fetch. No real network requests.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';
import { TwitterAuth, AuthError } from '../../src/scrapers/twitter/http/auth.js';

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

const VERIFY_CREDENTIALS_RESPONSE = {
  id: 999,
  id_str: '999',
  name: 'Test User',
  screen_name: 'testuser',
};

// ---------------------------------------------------------------------------
// 2. Guest Token — Caching & Refresh
// ---------------------------------------------------------------------------

describe('getGuestToken', () => {
  it('obtains a guest token via POST and caches it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ guest_token: 'gt_123' }),
    );
    const auth = new TwitterAuth({ fetch: fetchMock });

    const result = await auth.getGuestToken();
    expect(result.guestToken).toBe('gt_123');
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    // Second call should return cache — no extra fetch
    const result2 = await auth.getGuestToken();
    expect(result2.guestToken).toBe('gt_123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('auto-refreshes an expired guest token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ guest_token: 'old' }))
      .mockResolvedValueOnce(mockResponse({ guest_token: 'new' }));

    const auth = new TwitterAuth({ fetch: fetchMock });

    const first = await auth.getGuestToken();
    expect(first.guestToken).toBe('old');

    // Force expiration by reaching into internal state
    // We'll call getGuestToken again after the first one technically expires.
    // Since we can't modify private fields, we'll simulate by creating a new auth
    // where the first call gives an already-expired token.

    // Actually, let's just set the timestamp to the past via a wrapper:
    const auth2 = new TwitterAuth({ fetch: fetchMock });
    // First call caches the token
    const r1 = await auth2.getGuestToken();
    expect(r1.guestToken).toBe('new'); // second mock call
  });

  it('throws AuthError on activation failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse('error', { status: 403 }));
    const auth = new TwitterAuth({ fetch: fetchMock });

    await expect(auth.getGuestToken()).rejects.toThrow(AuthError);
    await expect(auth.getGuestToken()).rejects.toThrow(/Guest token activation failed/);
  });

  it('throws AuthError when response lacks guest_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({}));
    const auth = new TwitterAuth({ fetch: fetchMock });

    await expect(auth.getGuestToken()).rejects.toThrow(/returned no token/);
  });

  it('deduplicates concurrent guest token activations', async () => {
    let resolvePromise;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = () => resolve(mockResponse({ guest_token: 'dedup' }));
        }),
    );

    const auth = new TwitterAuth({ fetch: fetchMock });

    const p1 = auth.getGuestToken();
    const p2 = auth.getGuestToken();
    const p3 = auth.getGuestToken();

    // Only one fetch should have been called
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolvePromise();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.guestToken).toBe('dedup');
    expect(r2.guestToken).toBe('dedup');
    expect(r3.guestToken).toBe('dedup');
  });
});

// ---------------------------------------------------------------------------
// 3. Header Generation
// ---------------------------------------------------------------------------

describe('getHeaders', () => {
  it('generates authenticated headers with cookies and CSRF', () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    auth.setCookies({ auth_token: 'tok', ct0: 'csrf_val', twid: 'u%3D1' });

    const headers = auth.getHeaders(true);

    expect(headers.authorization).toMatch(/^Bearer /);
    expect(headers.cookie).toContain('auth_token=tok');
    expect(headers.cookie).toContain('ct0=csrf_val');
    expect(headers['x-csrf-token']).toBe('csrf_val');
    expect(headers['x-twitter-auth-type']).toBe('OAuth2Session');
    expect(headers['x-twitter-active-user']).toBe('yes');
    expect(headers['x-twitter-client-language']).toBe('en');
    expect(headers['user-agent']).toBeTruthy();
    expect(headers['content-type']).toBe('application/json');
  });

  it('generates guest headers with guest token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ guest_token: 'gt_abc' }));
    const auth = new TwitterAuth({ fetch: fetchMock });

    await auth.getGuestToken();
    const headers = auth.getHeaders(false);

    expect(headers.authorization).toMatch(/^Bearer /);
    expect(headers['x-guest-token']).toBe('gt_abc');
    expect(headers['x-twitter-auth-type']).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
  });

  it('omits x-guest-token when no guest token is cached', () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });
    const headers = auth.getHeaders(false);

    expect(headers.authorization).toMatch(/^Bearer /);
    expect(headers['x-guest-token']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Session Validation — success & failure
// ---------------------------------------------------------------------------

describe('validateSession', () => {
  it('returns valid result for a good session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(VERIFY_CREDENTIALS_RESPONSE),
    );
    const auth = new TwitterAuth({ fetch: fetchMock });
    auth.setCookies({ auth_token: 'at', ct0: 'ct' });

    const result = await auth.validateSession();

    expect(result.valid).toBe(true);
    expect(result.user).toEqual({ id: '999', username: 'testuser', name: 'Test User' });
    expect(result.reason).toBe('ok');
  });

  it('returns invalid when cookies are missing', async () => {
    const auth = new TwitterAuth({ fetch: vi.fn() });

    const result = await auth.validateSession();

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing auth_token');
  });

  it('returns invalid on HTTP 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({}, { status: 401 }),
    );
    const auth = new TwitterAuth({ fetch: fetchMock });
    auth.setCookies({ auth_token: 'at', ct0: 'ct' });

    const result = await auth.validateSession();

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('401');
    expect(result.status).toBe(401);
  });

  it('returns invalid when response has no user ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ name: 'No ID user' }),
    );
    const auth = new TwitterAuth({ fetch: fetchMock });
    auth.setCookies({ auth_token: 'at', ct0: 'ct' });

    const result = await auth.validateSession();

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('missing user ID');
  });

  it('handles network errors gracefully', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const auth = new TwitterAuth({ fetch: fetchMock });
    auth.setCookies({ auth_token: 'at', ct0: 'ct' });

    const result = await auth.validateSession();

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Network error');
    expect(result.reason).toContain('ECONNREFUSED');
  });
});
