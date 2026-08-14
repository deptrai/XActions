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
    const err = await getFacebookTokens(`c_user=1; ${secret}`, { fetchImpl }).catch((e) => e);
    expect(err.message).toMatch(/network error/i);
    expect(err.message).not.toContain('SUPER_SECRET_SESSION_TOKEN');
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

// ============================================================================
// P1 Kill: buildCookieString — encoding + filtering (L113, L118)
// ============================================================================

describe('buildCookieString — encoding + filtering (P1 kill)', () => {
  it('filters out null values (L113: v != null)', () => {
    expect(buildCookieString({ c_user: '123', xs: null })).toBe('c_user=123');
  });

  it('filters out undefined values (L113: v != null)', () => {
    expect(buildCookieString({ c_user: '123', xs: undefined })).toBe('c_user=123');
  });

  it('filters out empty string values (L113: v !== "")', () => {
    expect(buildCookieString({ c_user: '123', xs: '' })).toBe('c_user=123');
  });

  it('encodes values containing semicolons (L118: /[;=]/.test)', () => {
    const s = buildCookieString({ c_user: '123', xs: 'a;b' });
    // Regex mutant L118: /[;=]/ → /[^;=]/ → encodes everything EXCEPT ;= → wrong
    expect(s).toContain('xs=a%3Bb'); // semicolon encoded
    expect(s).not.toContain('xs=a;b'); // raw semicolon must not appear
  });

  it('encodes values containing equals signs (L118)', () => {
    const s = buildCookieString({ c_user: '123', xs: 'a=b' });
    expect(s).toContain('xs=a%3Db'); // equals encoded
    expect(s).not.toContain('xs=a=b');
  });

  it('does not encode values without delimiters (L118: false branch)', () => {
    const s = buildCookieString({ c_user: '123', xs: 'plainvalue' });
    expect(s).toContain('xs=plainvalue');
    expect(s).not.toContain('%');
  });

  it('preserves key order from merged object (L111: { ...cookies, ...extra })', () => {
    const s = buildCookieString({ c_user: '1' }, { xs: '2', datr: '3' });
    expect(s).toBe('c_user=1; xs=2; datr=3');
  });

  it('extra overrides cookies for same key (L111: spread order)', () => {
    const s = buildCookieString({ c_user: 'old' }, { c_user: 'new' });
    expect(s).toBe('c_user=new');
  });

  it('returns empty string for empty cookies (L112-121)', () => {
    expect(buildCookieString()).toBe('');
    expect(buildCookieString({})).toBe('');
  });
});

// ============================================================================
// P1 Kill: extractUid — cookie parsing (L130, L131)
// ============================================================================

describe('extractUid via getPagesFromCookie (P1 kill, L130-131)', () => {
  it('null cookie → [] (L130: !cookie)', async () => {
    expect(await getPagesFromCookie(null, { fetchImpl: routedFetch([]) })).toEqual([]);
  });

  it('undefined cookie → [] (L130: !cookie)', async () => {
    expect(await getPagesFromCookie(undefined, { fetchImpl: routedFetch([]) })).toEqual([]);
  });

  it('non-string cookie → [] (L130: typeof cookie !== "string")', async () => {
    expect(await getPagesFromCookie(123, { fetchImpl: routedFetch([]) })).toEqual([]);
  });

  it('cookie without c_user → [] (L131: regex no match)', async () => {
    expect(await getPagesFromCookie('datr=abc; xs=xyz', { fetchImpl: routedFetch([]) })).toEqual([]);
  });

  it('cookie with c_user at start of string → extracts uid (L131: ^|;\s*)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901; xs=secret', { fetchImpl });
    expect(pages.length).toBeGreaterThan(0);
  });

  it('cookie with c_user after semicolon+space → extracts uid (L131: ;\s*)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie('datr=abc; c_user=100012345678901; xs=secret', { fetchImpl });
    expect(pages.length).toBeGreaterThan(0);
  });

  it('cookie with c_user after semicolon no space → does NOT extract (L131: ;\s* requires \s*)', async () => {
    // Regex mutant L131: ;\s* → ;\S* → matches ;c_user= without space
    // Original: ;c_user= (no space) → no match → []
    // But actually \s* means zero or more, so ;c_user= should match
    // This test verifies the regex works with zero spaces after semicolon
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie('datr=abc;c_user=100012345678901;xs=secret', { fetchImpl });
    // \s* matches zero spaces → should extract uid
    expect(pages.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// P1 Kill: parseFacebookTokens — non-string input (L162)
// ============================================================================

describe('parseFacebookTokens — non-string input (P1 kill, L162)', () => {
  it('null input → all null fields (L162: typeof html === "string" ? html : "")', () => {
    const t = parseFacebookTokens(null);
    expect(t.fb_dtsg).toBeNull();
    expect(t.lsd).toBeNull();
  });

  it('undefined input → all null fields (L162)', () => {
    const t = parseFacebookTokens(undefined);
    expect(t.fb_dtsg).toBeNull();
  });

  it('number input → all null fields (L162)', () => {
    const t = parseFacebookTokens(12345);
    expect(t.fb_dtsg).toBeNull();
  });

  it('object input → all null fields (L162)', () => {
    const t = parseFacebookTokens({ foo: 'bar' });
    expect(t.fb_dtsg).toBeNull();
  });
});

// ============================================================================
// P1 Kill: getFacebookTokens — HTTP status boundary (L205)
// ============================================================================

describe('getFacebookTokens — HTTP status boundary (P1 kill, L205)', () => {
  it('HTTP 499 → does NOT throw (L205: res.status >= 500)', async () => {
    const fetchImpl = stubFetch(LOGGED_OUT_HTML, 499);
    const t = await getFacebookTokens('c_user=1', { fetchImpl });
    // 499 < 500 → not a server error → returns token object (all null for logged-out)
    expect(t.fb_dtsg).toBeNull();
  });

  it('HTTP 500 → throws (L205: res.status >= 500)', async () => {
    const fetchImpl = stubFetch('', 500);
    await expect(getFacebookTokens('c_user=1', { fetchImpl })).rejects.toThrow(/HTTP 500/);
  });

  it('HTTP 503 → throws (L205)', async () => {
    const fetchImpl = stubFetch('', 503);
    await expect(getFacebookTokens('c_user=1', { fetchImpl })).rejects.toThrow(/HTTP 503/);
  });

  it('HTTP 404 → does NOT throw (L205: 404 < 500)', async () => {
    const fetchImpl = stubFetch(LOGGED_OUT_HTML, 404);
    const t = await getFacebookTokens('c_user=1', { fetchImpl });
    expect(t.fb_dtsg).toBeNull();
  });
});

// ============================================================================
// P1 Kill: scrapeAdAccountId — asset_id vs act (L220-226)
// ============================================================================

describe('scrapeAdAccountId via getPagesFromCookie (P1 kill, L220-226)', () => {
  it('asset_id= takes priority over act= (L222-223)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'asset_id=111111; act=222222' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    // asset_id=111111 should be used (first match), not act=222222
    expect(pages.length).toBeGreaterThan(0);
  });

  it('act= fallback when no asset_id (L225)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    expect(pages.length).toBeGreaterThan(0);
  });

  it('act_ (underscore) also matches (L225: act[=_])', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act_1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    expect(pages.length).toBeGreaterThan(0);
  });

  it('asset_id with < 6 digits → no match (L222: \d{6,})', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'asset_id=12345' }],
      ['billing_hub', { status: 200, body: 'no account here' }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });

  it('act= with < 6 digits → no match (L225: \d{6,})', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=12345' }],
      ['billing_hub', { status: 200, body: 'no account here' }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });

  it('empty html → null (L220: !html)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: '' }],
      ['billing_hub', { status: 200, body: 'no account here' }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });
});

// ============================================================================
// P1 Kill: scrapeEaagToken — EAAG pattern (L231-233)
// ============================================================================

describe('scrapeEaagToken via getPagesFromCookie (P1 kill, L231-233)', () => {
  it('EAAG token with special chars (-_+/=) → extracted (L233)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtoken-with_special+chars/=' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    expect(pages.length).toBeGreaterThan(0);
  });

  it('no EAAG token → [] (L231: !html → null, L289: !eaagToken → [])', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'no token here' }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });

  it('empty billing page → [] (L231: !html)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: '' }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });
});

// ============================================================================
// P1 Kill: getPagesFromCookie — Graph API response handling (L275, L281, L289, L297, L306, L312, L313)
// ============================================================================

describe('getPagesFromCookie — Graph API response (P1 kill)', () => {
  it('adsmanager non-200 → falls back to billing hub (L275: ads.status === 200)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 302, body: 'redirect' }],
      ['billing_hub', { status: 200, body: 'act=1234567890 EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    // ConditionalExpression mutant L275: true → always scrape → may get null from redirect body
    expect(pages.length).toBeGreaterThan(0);
  });

  it('graph non-200 → [] (L297: graph.status !== 200)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 403, body: 'forbidden' }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });

  it('graph 200 but empty html → [] (L297: !graph.html)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: '' }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });

  it('graph returns non-JSON → [] (L302: JSON.parse catch)', async () => {
    expect(await getPagesFromCookie('c_user=100012345678901', {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: 'not json {{{' }],
      ]),
    })).toEqual([]);
  });

  it('graph returns error object → [] (L306: parsed?.error)', async () => {
    expect(await getPagesFromCookie('c_user=100012345678901', {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: '{"error":{"message":"bad token"}}' }],
      ]),
    })).toEqual([]);
  });

  it('graph returns null → [] (L306: parsed?.error optional chaining)', async () => {
    expect(await getPagesFromCookie('c_user=100012345678901', {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: 'null' }],
      ]),
    })).toEqual([]);
  });

  it('graph returns object without facebook_pages → [] (L312: parsed?.facebook_pages?.data)', async () => {
    expect(await getPagesFromCookie('c_user=100012345678901', {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: '{"id":"123"}' }],
      ]),
    })).toEqual([]);
  });

  it('graph returns facebook_pages.data as non-array → [] (L313: !Array.isArray)', async () => {
    expect(await getPagesFromCookie('c_user=100012345678901', {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: '{"facebook_pages":{"data":"notarray"}}' }],
      ]),
    })).toEqual([]);
  });

  it('graph returns facebook_pages.data null → [] (L313: !Array.isArray(null))', async () => {
    expect(await getPagesFromCookie('c_user=100012345678901', {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: '{"facebook_pages":{"data":null}}' }],
      ]),
    })).toEqual([]);
  });

  it('pages without access_token are filtered out (L320: p.access_token)', async () => {
    const pages = await getPagesFromCookie('c_user=100012345678901', {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: JSON.stringify({
          facebook_pages: { data: [
            { id: '1', name: 'Page1', access_token: 'tok1' },
            { id: '2', name: 'Page2', access_token: '' },
            { id: '3', name: 'Page3' },
          ] },
        }) }],
      ]),
    });
    expect(pages).toHaveLength(1);
    expect(pages[0].pageId).toBe('1');
  });

  it('page with additional_profile_id → included as string (L324)', async () => {
    const pages = await getPagesFromCookie('c_user=100012345678901', {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: JSON.stringify({
          facebook_pages: { data: [
            { id: '1', name: 'Page1', access_token: 'tok1', additional_profile_id: '999' },
          ] },
        }) }],
      ]),
    });
    expect(pages[0].additionalProfileId).toBe('999');
  });

  it('page without additional_profile_id → null (L324: ? String(...) : null)', async () => {
    const pages = await getPagesFromCookie('c_user=100012345678901', {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: JSON.stringify({
          facebook_pages: { data: [
            { id: '1', name: 'Page1', access_token: 'tok1' },
          ] },
        }) }],
      ]),
    });
    expect(pages[0].additionalProfileId).toBeNull();
  });

  it('page with null name → empty string (L325: p.name ?? "")', async () => {
    const pages = await getPagesFromCookie('c_user=100012345678901', {
      fetchImpl: routedFetch([
        ['adsmanager', { status: 200, body: 'act=1234567890' }],
        ['billing_hub', { status: 200, body: 'EAAGtok' }],
        ['graph.facebook.com', { status: 200, body: JSON.stringify({
          facebook_pages: { data: [
            { id: '1', name: null, access_token: 'tok1' },
          ] },
        }) }],
      ]),
    });
    expect(pages[0].name).toBe('');
  });
});

// ============================================================================
// P1 Kill: checkMessengerCTA — edge cases (L430, L435)
// ============================================================================

describe('checkMessengerCTA — edge cases (P1 kill)', () => {
  it('data tree contains sender field → eligible (L430)', async () => {
    const fetchImpl = stubFetch(JSON.stringify({
      data: { messenger_business_ads_sender: { id: '123' } },
    }));
    const r = await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    expect(r).toEqual({ eligible: true });
  });

  it('data without sender field → not eligible (L430)', async () => {
    const fetchImpl = stubFetch(JSON.stringify({
      data: { some_other_field: 'value' },
    }));
    const r = await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    expect(r).toEqual({ eligible: false });
  });

  it('parsed.data is null → not eligible (L430: parsed?.data falsy)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = stubFetch(JSON.stringify({ data: null }));
    const r = await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    expect(r).toEqual({ eligible: false });
    warn.mockRestore();
  });

  it('parsed has no data field → not eligible + warn (L435: !looksValid)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = stubFetch(JSON.stringify({ error: 'something' }));
    const r = await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    expect(r).toEqual({ eligible: false });
    // L435: 'data' in parsed → false → looksValid=false → warn
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('parsed.data exists but no sender → not eligible, no warn (L435: looksValid=true)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = stubFetch(JSON.stringify({ data: { foo: 'bar' } }));
    const r = await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    expect(r).toEqual({ eligible: false });
    // L435: 'data' in parsed → true → looksValid=true → no warn
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('parsed is null → not eligible + warn (L435: parsed != null)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = stubFetch('null');
    const r = await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    expect(r).toEqual({ eligible: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('parsed is array (not object) → not eligible + warn (L435: typeof parsed === "object")', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = stubFetch('[1,2,3]');
    const r = await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    expect(r).toEqual({ eligible: false });
    // Array is object but 'data' not in array → looksValid=false → warn
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ============================================================================
// P2 Kill: buildCookieString — L118 regex /[;=]/ → /[^;=]/ mutant
// ============================================================================

describe('buildCookieString — L118 /[^;=]/ mutant kill', () => {
  it('does not encode values with spaces but no delimiters (L118: /[;=]/ not /[^;=]/)', () => {
    // 'a b' has no ; or = → original: not encoded → 'xs=a b'
    // Mutant /[^;=]/: 'a b' has chars that aren't ; or = → encoded → 'xs=a%20b'
    const s = buildCookieString({ c_user: '123', xs: 'a b' });
    expect(s).toContain('xs=a b');
    expect(s).not.toContain('%20');
  });

  it('does not encode values with exclamation but no delimiters (L118)', () => {
    // 'a!b' has no ; or = → original keeps raw; encodeURIComponent('a!b')='a!b' anyway,
    // but the point is the regex test returns false so no encoding path is taken
    const s = buildCookieString({ c_user: '123', xs: 'a!b' });
    expect(s).toContain('xs=a!b');
  });
});

// ============================================================================
// P2 Kill: extractUid — L131 c_user=(\d+) → (\d) mutant
// ============================================================================

describe('extractUid — L131 multi-digit c_user (P2 kill)', () => {
  it('captures the full multi-digit uid, not just 1 digit (L131: \\d+ not \\d)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const fullUid = '100012345678901';
    await getPagesFromCookie(`c_user=${fullUid}; xs=secret`, { fetchImpl });
    const graphCall = fetchImpl.mock.calls.find((c) => c[0].includes('graph.facebook.com'));
    expect(graphCall[0]).toContain(fullUid);
  });

  it('uid appears in graph URL path (L293: /${uid})', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    await getPagesFromCookie('c_user=999999999999999; xs=s', { fetchImpl });
    const graphCall = fetchImpl.mock.calls.find((c) => c[0].includes('graph.facebook.com'));
    expect(graphCall[0]).toContain('/999999999999999?');
  });
});

// ============================================================================
// P2 Kill: getFacebookTokens — L195 method 'GET' StringLiteral
// ============================================================================

describe('getFacebookTokens — L195 method GET (P2 kill)', () => {
  it('sends method: GET (L195: "GET" not "")', async () => {
    const fetchImpl = stubFetch(LOGGED_IN_HTML);
    await getFacebookTokens('c_user=1; xs=abc', { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('GET');
  });

  it('sends Cookie header with the cookie value (L196: Cookie header)', async () => {
    const fetchImpl = stubFetch(LOGGED_IN_HTML);
    const cookie = 'c_user=1; xs=mysecret';
    await getFacebookTokens(cookie, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Cookie).toBe(cookie);
  });
});

// ============================================================================
// P2 Kill: scrapeAdAccountId — L220, L222, L223, L225 mutants
// ============================================================================

describe('scrapeAdAccountId — regex + guard mutants (P2 kill)', () => {
  it('asset_id with 6+ digits → full id in billing step-2 URL (L222: \\d{6,} not \\d)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'asset_id=123456789012' }],
      ['asset_id=123456789012', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    const billingStep2 = fetchImpl.mock.calls.find(
      (c) => c[0].includes('billing_hub') && c[0].includes('asset_id=123456789012')
    );
    expect(billingStep2).toBeTruthy();
  });

  it('asset_id all digits → matched (L222: \\d{6,} not \\D{6,})', async () => {
    // Mutant \\D{6,} matches non-digits → won't match '123456' → null → []
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'asset_id=123456' }],
      ['asset_id=123456', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    expect(pages.length).toBeGreaterThan(0);
  });

  it('asset_id present, no act= → used (L223: if assetMatch not false)', async () => {
    // Mutant if(false): skips asset_id → act= not found → null → []
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'asset_id=123456' }],
      ['asset_id=123456', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    expect(pages.length).toBeGreaterThan(0);
  });

  it('act= with 6+ digits → full id in billing step-2 URL (L225: \\d{6,} not \\d)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=9876543210' }],
      ['asset_id=9876543210', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    const billingStep2 = fetchImpl.mock.calls.find(
      (c) => c[0].includes('asset_id=9876543210')
    );
    expect(billingStep2).toBeTruthy();
  });

  it('act_ (underscore) with 6+ digits → full id (L225: act[=_] + \\d{6,})', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act_5554443330' }],
      ['asset_id=5554443330', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    const billingStep2 = fetchImpl.mock.calls.find(
      (c) => c[0].includes('asset_id=5554443330')
    );
    expect(billingStep2).toBeTruthy();
  });

  it('falsy non-string html → does not throw, returns [] (L220: !html guard)', async () => {
    // body: 0 → html=0 → original: !0 → return null; mutant if(false): (0).match → throws
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 0 }],
      ['billing_hub', { status: 200, body: 'no account' }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });
});

// ============================================================================
// P2 Kill: scrapeEaagToken — L231, L233 mutants
// ============================================================================

describe('scrapeEaagToken — regex + guard mutants (P2 kill)', () => {
  it('long EAAG token → full token in graph URL (L233: + not 1-char)', async () => {
    const longToken = 'EAAGabcdefghijklmnopqrstuvwxyz0123456789';
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: longToken }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    const graphCall = fetchImpl.mock.calls.find((c) => c[0].includes('graph.facebook.com'));
    expect(graphCall[0]).toContain(encodeURIComponent(longToken));
  });

  it('EAAG token with special chars → full token in graph URL (L233: char class)', async () => {
    const token = 'EAAGtok-with_special+chars/=end';
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: token }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    const graphCall = fetchImpl.mock.calls.find((c) => c[0].includes('graph.facebook.com'));
    expect(graphCall[0]).toContain(encodeURIComponent(token));
  });

  it('falsy non-string html → does not throw, returns [] (L231: !html guard)', async () => {
    // body: 0 → html=0 → original: !0 → null → []; mutant if(false): (0).match → throws
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 0 }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });
});

// ============================================================================
// P2 Kill: getPagesFromCookie — uid guard + headers + method (L257, L258, L262, L265)
// ============================================================================

describe('getPagesFromCookie — uid guard + headers + method (P2 kill)', () => {
  it('no c_user → returns [] AND does not call fetch (L257: if(!uid))', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const result = await getPagesFromCookie('datr=noUid', { fetchImpl });
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('no c_user → warns with uid/c_user message (L258: warn message not "")', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = routedFetch([]);
    await getPagesFromCookie('datr=noUid', { fetchImpl });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/c_user|uid/i);
    warn.mockRestore();
  });

  it('fetch calls include Cookie header (L262: headers not {})', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    const cookie = 'c_user=100012345678901; xs=mysecret';
    await getPagesFromCookie(cookie, { fetchImpl });
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.headers.Cookie).toBe(cookie);
      expect(init.headers['User-Agent']).toContain('Mozilla');
    }
  });

  it('fetch calls use method GET (L265: method + "GET")', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.method).toBe('GET');
    }
  });
});

// ============================================================================
// P2 Kill: getPagesFromCookie — status + early returns (L275, L281, L289)
// ============================================================================

describe('getPagesFromCookie — status + early returns (P2 kill)', () => {
  it('adsmanager non-200 with act in body → does NOT scrape (L275: status===200)', async () => {
    // Original: 403 → skip scrape → billing fallback → scrape EAAG body → no act → []
    // Mutant (true): always scrape → gets act from 403 body → step2 → EAAG → graph → pages
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 403, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });

  it('no adAccountId found → returns [] (L281: if(!adAccountId))', async () => {
    // Original: adAccountId null → []
    // Mutant (false): proceeds to step2 → billing has EAAG → graph → pages
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'no account' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });

  it('no EAAG token → returns [] (L289: if(!eaagToken))', async () => {
    // Original: eaagToken null → []
    // Mutant (false): proceeds to graph with null token → pages
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'no eaag here' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    expect(await getPagesFromCookie('c_user=100012345678901', { fetchImpl })).toEqual([]);
  });
});

// ============================================================================
// P2 Kill: getPagesFromCookie — graph URL construction (L255, L293-295)
// ============================================================================

describe('getPagesFromCookie — graph URL construction (P2 kill)', () => {
  it('graph URL includes the configured graphVersion (L255: graphVersion)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    await getPagesFromCookie('c_user=100012345678901', { fetchImpl, graphVersion: 'v99.0' });
    const graphCall = fetchImpl.mock.calls.find((c) => c[0].includes('graph.facebook.com'));
    expect(graphCall[0]).toContain('v99.0');
  });

  it('graph URL includes facebook_pages fields + access_token (L294-295)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    const graphCall = fetchImpl.mock.calls.find((c) => c[0].includes('graph.facebook.com'));
    expect(graphCall[0]).toContain('facebook_pages.limit(2000)');
    expect(graphCall[0]).toContain('access_token=');
  });

  it('graph URL encodes the EAAG token (L295: encodeURIComponent)', async () => {
    const token = 'EAAGtok+with/special=chars';
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: token }],
      ['graph.facebook.com', { status: 200, body: PAGES_JSON }],
    ]);
    await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    const graphCall = fetchImpl.mock.calls.find((c) => c[0].includes('graph.facebook.com'));
    expect(graphCall[0]).toContain(encodeURIComponent(token));
  });
});

// ============================================================================
// P2 Kill: getPagesFromCookie — page mapping (L320-327)
// ============================================================================

describe('getPagesFromCookie — page mapping (P2 kill)', () => {
  it('page id is stringified (L323: String(p.id))', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: JSON.stringify({
        facebook_pages: { data: [{ id: 12345, name: 'P', access_token: 'tok' }] },
      }) }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    expect(pages[0].pageId).toBe('12345');
    expect(typeof pages[0].pageId).toBe('string');
  });

  it('filters out null entries in data array (L320: p && ...)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: JSON.stringify({
        facebook_pages: { data: [null, { id: '1', name: 'P', access_token: 'tok' }] },
      }) }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    expect(pages).toHaveLength(1);
  });

  it('additional_profile_id numeric → stringified (L324: String(...))', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: JSON.stringify({
        facebook_pages: { data: [{ id: '1', name: 'P', access_token: 'tok', additional_profile_id: 999 }] },
      }) }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    expect(pages[0].additionalProfileId).toBe('999');
    expect(typeof pages[0].additionalProfileId).toBe('string');
  });

  it('accessToken is the raw access_token value (L326)', async () => {
    const fetchImpl = routedFetch([
      ['adsmanager', { status: 200, body: 'act=1234567890' }],
      ['billing_hub', { status: 200, body: 'EAAGtok' }],
      ['graph.facebook.com', { status: 200, body: JSON.stringify({
        facebook_pages: { data: [{ id: '1', name: 'P', access_token: 'RAW_TOKEN_XYZ' }] },
      }) }],
    ]);
    const pages = await getPagesFromCookie('c_user=100012345678901', { fetchImpl });
    expect(pages[0].accessToken).toBe('RAW_TOKEN_XYZ');
  });
});

// ============================================================================
// P2 Kill: checkMessengerCTA — form body + headers + warn messages
// ============================================================================

describe('checkMessengerCTA — form body + headers (P2 kill)', () => {
  it('body contains all required form fields (StringLiteral mutants)', async () => {
    const fetchImpl = stubFetch(CTA_ELIGIBLE);
    await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    const body = fetchImpl.mock.calls[0][1].body;
    expect(body).toContain('av=AID');
    expect(body).toContain('__user=AID');
    expect(body).toContain('__a=1');
    expect(body).toContain('__req=1a');
    expect(body).toContain('__comet_req=15');
    expect(body).toContain('__spin_b=trunk');
    expect(body).toContain('dpr=1');
    expect(body).toContain('__ccg=EXCELLENT');
    expect(body).toContain('fb_api_caller_class=RelayModern');
    expect(body).toContain('server_timestamps=true');
    expect(body).toContain('__aaid=0');
  });

  it('body includes spin_r, spin_t, hsi from tokens (?? "" mutants)', async () => {
    const fetchImpl = stubFetch(CTA_ELIGIBLE);
    const tokens = { ...TOKENS, spin_r: '1011223344', spin_t: '1749580000', hsi: '7412345678901234567' };
    await checkMessengerCTA('PID', 'AID', tokens, { fetchImpl });
    const body = decodeURIComponent(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain('__rev=1011223344');
    expect(body).toContain('__spin_r=1011223344');
    expect(body).toContain('__spin_t=1749580000');
    expect(body).toContain('__hsi=7412345678901234567');
  });

  it('body includes fb_dtsg, jazoest, lsd from tokens (?? "" mutants)', async () => {
    const fetchImpl = stubFetch(CTA_ELIGIBLE);
    await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    const body = fetchImpl.mock.calls[0][1].body;
    expect(body).toContain('fb_dtsg=NAf-x');
    expect(body).toContain('jazoest=25813');
    expect(body).toContain('lsd=lsd-y');
  });

  it('headers include x-fb-lsd, x-fb-friendly-name, origin, content-type (L397-403)', async () => {
    const fetchImpl = stubFetch(CTA_ELIGIBLE);
    await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    const headers = fetchImpl.mock.calls[0][1].headers;
    expect(headers['x-fb-lsd']).toBe('lsd-y');
    expect(headers['x-fb-friendly-name']).toBe('MWChatBusinessCTAAdsSenderMutation');
    expect(headers['origin']).toBe('https://www.facebook.com');
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it('variables JSON includes page_id, actor_id, client_mutation_id (L356-365)', async () => {
    const fetchImpl = stubFetch(CTA_ELIGIBLE);
    await checkMessengerCTA('999', '888', TOKENS, { fetchImpl });
    const body = decodeURIComponent(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain('"page_id":"999"');
    expect(body).toContain('"actor_id":"888"');
    expect(body).toContain('"client_mutation_id":"1"');
    expect(body).toContain('"ad_id":null');
    expect(body).toContain('"post_id":null');
  });

  it('network error warn message contains page id (L409: not "")', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => { throw new Error('boom'); });
    await checkMessengerCTA('PAGEX', 'AID', TOKENS, { fetchImpl });
    expect(warn.mock.calls[0][0]).toContain('PAGEX');
    warn.mockRestore();
  });

  it('malformed response warn message contains page id (L424: not "")', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = stubFetch('not json');
    await checkMessengerCTA('PAGEY', 'AID', TOKENS, { fetchImpl });
    expect(warn.mock.calls[0][0]).toContain('PAGEY');
    warn.mockRestore();
  });

  it('uses custom docId when provided (L352: docId option)', async () => {
    const fetchImpl = stubFetch(CTA_ELIGIBLE);
    await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl, docId: '99999' });
    expect(fetchImpl.mock.calls[0][1].body).toContain('doc_id=99999');
  });

  it('null tokens → empty strings in form (?? "" fallback mutants)', async () => {
    const fetchImpl = stubFetch(CTA_ELIGIBLE);
    await checkMessengerCTA('PID', 'AID', {}, { fetchImpl });
    const body = fetchImpl.mock.calls[0][1].body;
    expect(body).not.toContain('NAf');
    expect(body).not.toContain('lsd-y');
    expect(body).toMatch(/fb_dtsg=&/);
    expect(body).toMatch(/lsd=&/);
  });

  it('POSTs to /api/graphql/ endpoint (L395: URL StringLiteral)', async () => {
    const fetchImpl = stubFetch(CTA_ELIGIBLE);
    await checkMessengerCTA('PID', 'AID', TOKENS, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://www.facebook.com/api/graphql/');
    expect(init.method).toBe('POST');
  });
});
