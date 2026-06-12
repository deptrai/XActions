// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Story 5.1 — Facebook GraphQL/HTTP layer tests.
 * Browser-free: parser runs on HTML fixtures; fetchers run via injected fetchImpl stubs.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  parseFacebookTokens,
  getFacebookTokens,
  buildCookieString,
  getPagesFromCookie,
  checkMessengerCTA,
  MESSENGER_CTA_DOC_ID,
} from '../../src/scrapers/facebook/graphql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const LOGGED_IN_HTML = fixture('facebook-home-loggedin.html');
const LOGGED_OUT_HTML = fixture('facebook-home-loggedout.html');

/** Build a fetch-API-compatible stub returning the given body/status. */
function stubFetch(body, status = 200) {
  return vi.fn(async () => ({ status, text: async () => body }));
}

// ============================================================================
// AC1 / AC4 — parseFacebookTokens (pure, browser-free)
// ============================================================================

describe('parseFacebookTokens', () => {
  it('extracts all 6 tokens from a logged-in fixture', () => {
    const t = parseFacebookTokens(LOGGED_IN_HTML);
    expect(t.fb_dtsg).toBe('NAf-1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789:9876543210');
    expect(t.lsd).toBe('AVqr_synthLSDtoken_xZ');
    expect(t.jazoest).toBe('25813');
    expect(t.hsi).toBe('7412345678901234567');
    expect(t.spin_r).toBe('1011223344');
    expect(t.spin_t).toBe('1749580000');
  });

  it('keeps the NAf prefix on fb_dtsg', () => {
    const t = parseFacebookTokens(LOGGED_IN_HTML);
    expect(t.fb_dtsg.startsWith('NAf')).toBe(true);
  });

  it('returns null (not undefined) for every field on a logged-out page', () => {
    const t = parseFacebookTokens(LOGGED_OUT_HTML);
    for (const key of ['fb_dtsg', 'lsd', 'jazoest', 'hsi', 'spin_r', 'spin_t']) {
      expect(t[key], `${key} should be null`).toBeNull();
    }
  });

  it('returns the full 6-field shape even when input is empty', () => {
    const t = parseFacebookTokens('');
    expect(Object.keys(t).sort()).toEqual(
      ['fb_dtsg', 'hsi', 'jazoest', 'lsd', 'spin_r', 'spin_t'].sort()
    );
  });

  it('does not throw on null/undefined input', () => {
    expect(() => parseFacebookTokens(null)).not.toThrow();
    expect(() => parseFacebookTokens(undefined)).not.toThrow();
    expect(parseFacebookTokens(null).fb_dtsg).toBeNull();
  });
});

// ============================================================================
// AC2 / AC3 / AC4 — getFacebookTokens (fetchImpl seam, NFR3)
// ============================================================================

describe('getFacebookTokens', () => {
  it('fetches and parses tokens from a logged-in page via fetchImpl stub', async () => {
    const fetchImpl = stubFetch(LOGGED_IN_HTML);
    const t = await getFacebookTokens('c_user=100012345678901; xs=secret', { fetchImpl });
    expect(t.fb_dtsg).toContain('NAf');
    expect(t.lsd).toBe('AVqr_synthLSDtoken_xZ');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('sends the cookie in the Cookie header', async () => {
    const fetchImpl = stubFetch(LOGGED_IN_HTML);
    await getFacebookTokens('c_user=1; xs=abc', { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Cookie).toBe('c_user=1; xs=abc');
    expect(init.headers['User-Agent']).toContain('Mozilla');
  });

  it('returns null-field object on a logged-out page (no throw)', async () => {
    const fetchImpl = stubFetch(LOGGED_OUT_HTML, 200);
    const t = await getFacebookTokens('datr=onlyguest', { fetchImpl });
    expect(t.fb_dtsg).toBeNull();
    expect(t.lsd).toBeNull();
  });

  it('throws a generic message on network error — no cookie value leaked', async () => {
    const secret = 'xs=SUPER_SECRET_SESSION_TOKEN';
    const fetchImpl = vi.fn(async () => { throw new Error(`connect failed for ${secret}`); });
    let msg = '';
    try {
      await getFacebookTokens(`c_user=1; ${secret}`, { fetchImpl });
    } catch (e) { msg = e.message; }
    expect(msg).toMatch(/network error/i);
    expect(msg).not.toContain('SUPER_SECRET_SESSION_TOKEN');
  });

  it('throws on HTTP 5xx', async () => {
    const fetchImpl = stubFetch('', 503);
    await expect(getFacebookTokens('c_user=1', { fetchImpl })).rejects.toThrow(/HTTP 503/);
  });

  it('no cookie value appears anywhere in the returned token object', async () => {
    const fetchImpl = stubFetch(LOGGED_IN_HTML);
    const secret = 'SECRET_XS_VALUE_ZZZ';
    const t = await getFacebookTokens(`c_user=1; xs=${secret}`, { fetchImpl });
    expect(JSON.stringify(t)).not.toContain(secret);
  });
});

// ============================================================================
// buildCookieString
// ============================================================================

describe('buildCookieString', () => {
  it('converts { c_user, xs } into a cookie string', () => {
    expect(buildCookieString({ c_user: '123', xs: 'abc' })).toBe('c_user=123; xs=abc');
  });

  it('appends extra pairs and skips empty values', () => {
    const s = buildCookieString({ c_user: '123', xs: '' }, { datr: 'd1' });
    expect(s).toBe('c_user=123; datr=d1');
  });
});

// ============================================================================
// AC5 — getPagesFromCookie (multi-step fetchImpl stub: HTML per URL)
// ============================================================================

const PAGES_JSON = fixture('facebook-pages-response.json');

/** Route a stub response by URL substring. */
function routedFetch(routes) {
  return vi.fn(async (url) => {
    for (const [needle, resp] of routes) {
      if (url.includes(needle)) {
        return { status: resp.status ?? 200, text: async () => resp.body ?? '' };
      }
    }
    return { status: 404, text: async () => '' };
  });
}

describe('getPagesFromCookie', () => {
  const COOKIE = 'c_user=100012345678901; xs=secret';

  it('resolves pages through the full adsmanager → billing → graph flow', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'window.location="/manage/?act=1234567890"' }],
      ['billing_hub', { status: 200, body: 'token here EAAGsynthEaagToken123 end' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie(COOKIE, { fetchImpl });
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({
      pageId: '100000000000001',
      additionalProfileId: '200000000000001',
      name: 'Demo Coffee Shop',
      accessToken: 'SYNTH_PAGE_TOKEN_AAA',
    });
  });

  it('falls back to billing hub when adsmanager 403s', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 403, body: '' }],
      ['billing_hub', { status: 200, body: 'act=9998887776 ... EAAGfallbackTok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie(COOKIE, { fetchImpl });
    expect(pages).toHaveLength(2);
  });

  it('returns [] when no ad-account id can be scraped', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'no account here' }],
      ['billing_hub', { status: 200, body: 'also nothing' }],
    ]);
    expect(await getPagesFromCookie(COOKIE, { fetchImpl })).toEqual([]);
  });

  it('returns [] when EAAG token is absent', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'no eaag token on this page' }],
    ]);
    expect(await getPagesFromCookie(COOKIE, { fetchImpl })).toEqual([]);
  });

  it('returns [] on a Graph API error response (no throw)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: '{"error":{"message":"bad token"}}' }],
    ]);
    expect(await getPagesFromCookie(COOKIE, { fetchImpl })).toEqual([]);
  });

  it('returns [] when cookie has no c_user/uid', async () => {
    const fetchImpl = routedFetch([]);
    expect(await getPagesFromCookie('datr=noUid', { fetchImpl })).toEqual([]);
  });
});

// ============================================================================
// AC6 — checkMessengerCTA (URL-encoded form POST; eligible/ineligible/malformed)
// ============================================================================

const CTA_ELIGIBLE = fixture('facebook-cta-eligible.json');
const CTA_INELIGIBLE = fixture('facebook-cta-ineligible.json');
const TOKENS = { fb_dtsg: 'NAf-x', lsd: 'lsd-y', jazoest: '25813' };

describe('checkMessengerCTA', () => {
  it('exports the doc_id constant with the expected value', () => {
    expect(MESSENGER_CTA_DOC_ID).toBe('29460155383630960');
  });

  it('returns { eligible: true } when sender field is present', async () => {
    const fetchImpl = stubFetch(CTA_ELIGIBLE);
    expect(await checkMessengerCTA('200000000000001', '100012345678901', TOKENS, { fetchImpl }))
      .toEqual({ eligible: true });
  });

  it('returns { eligible: false } on a valid non-eligible response (no warn)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = stubFetch(CTA_INELIGIBLE);
    const r = await checkMessengerCTA('200000000000002', '100012345678901', TOKENS, { fetchImpl });
    expect(r).toEqual({ eligible: false });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns about possible doc_id rotation on a malformed response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = stubFetch('<html>not json garbage</html>');
    const r = await checkMessengerCTA('200000000000003', '100012345678901', TOKENS, { fetchImpl });
    expect(r).toEqual({ eligible: false });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/doc_id may be rotated/);
    warn.mockRestore();
  });

  it('POSTs a URL-encoded form (not JSON) carrying doc_id + tokens', async () => {
    const fetchImpl = stubFetch(CTA_ELIGIBLE);
    await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(init.body).toContain(`doc_id=${MESSENGER_CTA_DOC_ID}`);
    expect(init.body).toContain('fb_dtsg=NAf-x');
    expect(init.body).toContain('fb_api_req_friendly_name=MWChatBusinessCTAAdsSenderMutation');
    // variables JSON is URL-encoded
    expect(decodeURIComponent(init.body)).toContain('"page_id":"PID"');
    expect(decodeURIComponent(init.body)).toContain('"actor_id":"AID"');
  });

  it('fails closed to { eligible: false } on network error, no secret leaked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => { throw new Error('boom NAf-x secret'); });
    const r = await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    expect(r).toEqual({ eligible: false });
    expect(warn.mock.calls[0][0]).not.toContain('NAf-x');
    warn.mockRestore();
  });
});

// ============================================================================
// Integration (#12) — the 3 functions wire together without TypeError
// ============================================================================

describe('integration: tokens → CTA shape wiring', () => {
  it('chains getFacebookTokens → getPagesFromCookie → checkMessengerCTA', async () => {
    const cookie = 'c_user=100012345678901; xs=secret';

    // 1) tokens
    const tokens = await getFacebookTokens(cookie, { fetchImpl: stubFetch(LOGGED_IN_HTML) });
    expect(tokens.fb_dtsg).toContain('NAf');

    // 2) pages
    const pages = await getPagesFromCookie(cookie, {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
      ]),
    });
    expect(pages.length).toBeGreaterThan(0);

    // 3) CTA — pageId from (b), actorId = uid from c_user, tokens from (a)
    const uid = cookie.match(/c_user=(\d+)/)[1];
    const r = await checkMessengerCTA(pages[0].pageId, uid, tokens, {
      fetchImpl: stubFetch(CTA_ELIGIBLE),
    });
    expect(r).toEqual({ eligible: true });
  });
});
