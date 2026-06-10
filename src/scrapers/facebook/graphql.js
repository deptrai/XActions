// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Facebook GraphQL/HTTP helper layer (Story 5.1 — Messenger Port, Epic 5).
 *
 * Browser-free port of three SST_TOOL_FB (C# WinForms) features:
 *   (a) token scraper   — fb_dtsg, lsd, jazoest, hsi, __spin_r, __spin_t
 *   (b) page list        — ad account → facebook_pages via Graph API
 *   (c) Messenger CTA    — GraphQL doc_id eligibility check
 *
 * Story 5.2 (Messenger share campaign) consumes getFacebookTokens +
 * getPagesFromCookie + checkMessengerCTA. This module is purely additive — it
 * is NOT wired into the scrape() dispatcher (per port-plan, surfaces land in 5.4).
 *
 * Design notes:
 *  - Anchored regexes (not the fragile C# .split() chain) — lesson from 1.2/1.3.
 *  - null-not-throw for missing tokens — a logged-out page legitimately has none.
 *  - options.fetchImpl seam makes every fetcher browser-free & network-free in tests.
 *  - NFR3: cookie/token values are never logged or echoed in errors.
 *
 * @author nich (@nichxbt)
 * @license BSL 1.1
 * @see SST_TOOL_FB/Main.cs:217-249 (token markers), :558-581 (CTA), getPage.cs (pages)
 * @see src/scrapers/twitter/http/{client,auth}.js (cookie-string → header pattern)
 */

import axios from 'axios';

// ============================================================================
// Constants
// ============================================================================

const FACEBOOK_HOME = 'https://www.facebook.com/';
const ADSMANAGER_URL = 'https://adsmanager.facebook.com/adsmanager/manage/all';
const BILLING_HUB_URL = 'https://business.facebook.com/billing_hub/payment_activity';

/**
 * Graph API version. Facebook deprecates versions roughly every ~2 years, so this
 * is a named constant overridable via options.graphVersion.
 */
const GRAPH_API_VERSION = 'v19.0';

/**
 * doc_id for the Messenger business-CTA eligibility GraphQL query.
 * ⚠️ Facebook may rotate this doc_id without notice. If response shape is
 * unexpected, this is the first suspect.
 */
export const MESSENGER_CTA_DOC_ID = '29460155383630960';

/**
 * Realistic browser headers mirroring the C# xNet request headers. Reused by
 * every fetcher so Facebook serves the logged-in HTML rather than a bot wall.
 */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'viewport-width': '1920',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Upgrade-Insecure-Requests': '1',
};

// ============================================================================
// fetchImpl seam
// ============================================================================

/**
 * Default fetch implementation: a thin axios wrapper exposing the fetch-API shape
 * `(url, init) => Promise<{ status, text() }>`. Tests inject a stub instead.
 *
 * Uses `validateStatus: () => true` so non-2xx responses resolve (we inspect
 * status ourselves) rather than throwing — only genuine network errors throw.
 *
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: string }} [init]
 * @returns {Promise<{ status: number, text: () => Promise<string> }>}
 */
async function defaultFetch(url, init = {}) {
  const res = await axios.request({
    url,
    method: init.method || 'GET',
    headers: init.headers,
    data: init.body,
    responseType: 'text',
    transformResponse: [(d) => d], // keep raw text; do not auto-JSON.parse
    maxRedirects: 0, // we detect redirects ourselves (adsmanager 403 / billing)
    validateStatus: () => true,
  });
  const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  return { status: res.status, text: async () => text };
}

// ============================================================================
// Cookie helpers
// ============================================================================

/**
 * Convert the adapter's `{ c_user, xs }` object convention into the full cookie
 * string form the token scraper needs. Extra pairs (datr, etc.) may be appended
 * via `extra`. Callers (and Story 5.2) use this so they never hand-build strings.
 *
 * @param {{ c_user: string, xs: string, [k: string]: string }} cookies
 * @param {Record<string,string>} [extra] - additional name=value pairs
 * @returns {string} e.g. "c_user=123; xs=abc; datr=..."
 */
export function buildCookieString(cookies = {}, extra = {}) {
  const merged = { ...cookies, ...extra };
  return Object.entries(merged)
    .filter(([, v]) => v != null && v !== '')
    // Encode values that contain cookie-delimiter chars (`;`, `=`) to prevent
    // injection of fake cookie pairs via untrusted input. Keys are developer-
    // controlled constants so left unencoded for readability.
    .map(([k, v]) => {
      const safe = /[;=]/.test(String(v)) ? encodeURIComponent(v) : v;
      return `${k}=${safe}`;
    })
    .join('; ');
}

/**
 * Extract the numeric UID from a cookie string's `c_user` value (it IS the UID).
 * @param {string} cookie - full cookie string
 * @returns {string|null}
 */
function extractUid(cookie) {
  if (!cookie || typeof cookie !== 'string') return null;
  const m = cookie.match(/(?:^|;\s*)c_user=(\d+)/);
  return m ? m[1] : null;
}

// ============================================================================
// (a) Token parser — AC1
// ============================================================================

/**
 * Anchored regexes for each token, ported from the C# split markers but made
 * robust to surrounding-markup drift. Each captures group 1 = the token value.
 * fb_dtsg's capture already includes the `NAf` prefix.
 */
const TOKEN_PATTERNS = {
  fb_dtsg: /\{"token":"(NAf[^"]+)"/,
  lsd: /\["LSD",\[\],\{"token":"([^"]+)"/,
  jazoest: /&jazoest=(\d+)/,
  hsi: /"hsi":"([^"]+)"/,
  spin_r: /"__spin_r":(\d+)/,
  spin_t: /"__spin_t":(\d+)/,
};

/**
 * Pure token parser. Takes raw facebook.com HTML, returns the 6-field token
 * object. Any token not found → that field is `null` (caller decides if fatal).
 *
 * @param {string} html - raw HTML string
 * @returns {{ fb_dtsg: string|null, lsd: string|null, jazoest: string|null,
 *             hsi: string|null, spin_r: string|null, spin_t: string|null }}
 */
export function parseFacebookTokens(html) {
  const source = typeof html === 'string' ? html : '';
  /** @type {Record<string, string|null>} */
  const tokens = {};
  for (const [key, pattern] of Object.entries(TOKEN_PATTERNS)) {
    const match = source.match(pattern);
    tokens[key] = match ? match[1] : null;
  }
  return tokens;
}

// ============================================================================
// (a) Token fetcher — AC2, AC3
// ============================================================================

/**
 * Fetch facebook.com with the given cookie and parse the 6 session tokens.
 *
 * NFR3: the cookie value is never logged or echoed. A logged-out response
 * (no tokens parseable) resolves to a null-field token object — only a genuine
 * network/HTTP-transport error throws, with a generic message.
 *
 * @param {string} cookie - full cookie string ("c_user=..; xs=..; datr=..; ..")
 * @param {object} [options]
 * @param {Function} [options.fetchImpl=defaultFetch] - fetch-API-shaped seam
 * @returns {Promise<{ fb_dtsg, lsd, jazoest, hsi, spin_r, spin_t }>}
 * @throws {Error} generic message on network/HTTP transport failure
 */
export async function getFacebookTokens(cookie, options = {}) {
  const { fetchImpl = defaultFetch } = options;

  let res;
  try {
    res = await fetchImpl(FACEBOOK_HOME, {
      method: 'GET',
      headers: { ...BROWSER_HEADERS, Cookie: cookie },
    });
  } catch {
    // Never surface the cookie or the underlying error detail (may echo headers).
    throw new Error('❌ Facebook token fetch failed: network error');
  }

  // A 5xx (or any transport-level non-response) is a real failure; a logged-out
  // 200/redirect page is NOT — it just yields null tokens below.
  if (res.status >= 500) {
    throw new Error(`❌ Facebook token fetch failed: HTTP ${res.status}`);
  }

  const html = await res.text();
  return parseFacebookTokens(html);
}

// ============================================================================
// (b) Page list — AC5
// ============================================================================

/** Scrape an ad-account id (the `act=` / `act_<digits>` param) from HTML. */
function scrapeAdAccountId(html) {
  if (!html) return null;
  // matches act=1234567890 or act_1234567890 in URLs/JSON
  const m = html.match(/act[=_](\d{6,})/);
  return m ? m[1] : null;
}

/** Scrape the long-lived EAAG... Graph token from a billing page. */
function scrapeEaagToken(html) {
  if (!html) return null;
  // EAAG tokens may contain alphanumeric + base64 chars (`-`, `_`, `+`, `/`, `=`)
  const m = html.match(/(EAAG[A-Za-z0-9\-_+/=]+)/);
  return m ? m[1] : null;
}

/**
 * Resolve the page list reachable from a session cookie. Best-effort, multi-step,
 * each step may fail independently → empty array (never throws on a "no data"
 * outcome). Page access tokens are treated as sensitive and never logged.
 *
 * Flow (ported from C# getPage.cs:GetPagesFromCookie):
 *   1.  GET adsmanager → scrape ad-account id. 403/redirect → step 1b.
 *   1b. GET billing_hub → scrape ad-account id.
 *   2.  GET billing page for that account → extract EAAG token.
 *   3.  GET graph.facebook.com/<ver>/<uid>?fields=facebook_pages...&access_token=EAAG
 *
 * @param {string} cookie - full cookie string (c_user supplies the uid)
 * @param {object} [options]
 * @param {Function} [options.fetchImpl=defaultFetch]
 * @param {string}   [options.graphVersion=GRAPH_API_VERSION]
 * @returns {Promise<Array<{ pageId: string, name: string, accessToken: string }>>}
 */
export async function getPagesFromCookie(cookie, options = {}) {
  const { fetchImpl = defaultFetch, graphVersion = GRAPH_API_VERSION } = options;
  const uid = extractUid(cookie);
  if (!uid) {
    console.warn('⚠️ Facebook page list: no c_user/uid in cookie — returning empty list');
    return [];
  }

  const headers = { ...BROWSER_HEADERS, Cookie: cookie };
  const safeGet = async (url) => {
    try {
      const res = await fetchImpl(url, { method: 'GET', headers });
      return { status: res.status, html: await res.text() };
    } catch {
      return { status: 0, html: '' }; // treated as a failed step below
    }
  };

  // --- Step 1: adsmanager → ad-account id (fallback to billing hub) ----------
  let adAccountId = null;
  const ads = await safeGet(ADSMANAGER_URL);
  if (ads.status === 200) adAccountId = scrapeAdAccountId(ads.html);
  if (!adAccountId) {
    const billing = await safeGet(BILLING_HUB_URL);
    adAccountId = scrapeAdAccountId(billing.html);
  }
  if (!adAccountId) return [];

  // --- Step 2: billing page for that account → EAAG token --------------------
  const acctPage = await safeGet(
    `${BILLING_HUB_URL}?act=${adAccountId}`
  );
  const eaagToken = scrapeEaagToken(acctPage.html);
  if (!eaagToken) return [];

  // --- Step 3: Graph API facebook_pages --------------------------------------
  const graphUrl =
    `https://graph.facebook.com/${graphVersion}/${uid}` +
    `?fields=facebook_pages.limit(2000)%7Baccess_token%2Cadditional_profile_id%2Cname%7D` +
    `&access_token=${encodeURIComponent(eaagToken)}`;
  const graph = await safeGet(graphUrl);
  if (graph.status !== 200 || !graph.html) return [];

  let parsed;
  try {
    parsed = JSON.parse(graph.html);
  } catch {
    console.warn('⚠️ Facebook page list: Graph API returned non-JSON — returning empty list');
    return [];
  }
  if (parsed?.error) {
    // Graph error object — generic warning, never echo the token/cookie.
    console.warn('⚠️ Facebook page list: Graph API error response — returning empty list');
    return [];
  }

  const data = parsed?.facebook_pages?.data;
  if (!Array.isArray(data)) {
    console.warn('⚠️ Facebook page list: unexpected response shape (no facebook_pages.data array) — returning empty list');
    return [];
  }

  return data
    .filter((p) => p && (p.additional_profile_id || p.id))
    .map((p) => ({
      pageId: String(p.additional_profile_id ?? p.id),
      name: p.name ?? '',
      accessToken: p.access_token ?? '',
    }));
}

// ============================================================================
// (c) Messenger CTA eligibility — AC6
// ============================================================================

/**
 * Check whether a page is eligible for the Messenger business-CTA sender flow.
 *
 * POST body is a URL-encoded form (NOT JSON), matching C# Main.cs:558-581.
 * Returns `{ eligible }` based on presence of `messenger_business_ads_sender`
 * in the response. On any unexpected/ malformed shape → `{ eligible: false }`
 * plus a generic console.warn (the doc_id is the first rotation suspect).
 *
 * @param {string} pageId
 * @param {string} actorId - the session uid (c_user)
 * @param {{ fb_dtsg: string|null, lsd: string|null, jazoest: string|null }} tokens
 * @param {object} [options]
 * @param {Function} [options.fetchImpl=defaultFetch]
 * @param {string}   [options.docId=MESSENGER_CTA_DOC_ID]
 * @returns {Promise<{ eligible: boolean }>}
 */
export async function checkMessengerCTA(pageId, actorId, tokens = {}, options = {}) {
  const { fetchImpl = defaultFetch, docId = MESSENGER_CTA_DOC_ID } = options;

  const variables = JSON.stringify({ page_id: String(pageId), actor_id: String(actorId) });
  const form = new URLSearchParams({
    fb_dtsg: tokens.fb_dtsg ?? '',
    lsd: tokens.lsd ?? '',
    jazoest: tokens.jazoest ?? '',
    doc_id: docId,
    variables,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'MWChatBusinessCTAAdsSenderMutation',
  }).toString();

  let res;
  try {
    res = await fetchImpl('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'content-type': 'application/x-www-form-urlencoded',
        'x-fb-lsd': tokens.lsd ?? '',
      },
      body: form,
    });
  } catch {
    // Network failure is not "ineligible per se", but the caller contract is a
    // boolean — fail closed, no secret in the message.
    console.warn(`⚠️ Messenger CTA check failed: network error for page ${pageId}`);
    return { eligible: false };
  }

  const text = await res.text();

  // Parse JSON and check the specific key path — NOT a raw substring search.
  // text.includes('messenger_business_ads_sender') would false-positive on error
  // messages like "Field messenger_business_ads_sender does not exist".
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON response (HTML redirect, bot wall) — doc_id rotation suspect.
    console.warn(
      `⚠️ Messenger CTA doc_id may be rotated — response shape unexpected for page ${pageId}`
    );
    return { eligible: false };
  }

  // Valid JSON — check for the eligibility key in the data tree.
  if (parsed?.data && JSON.stringify(parsed.data).includes('"messenger_business_ads_sender"')) {
    return { eligible: true };
  }

  // Distinguish "not eligible" from "garbled/rotated doc_id" shape.
  const looksValid = parsed != null && typeof parsed === 'object' && 'data' in parsed;
  if (!looksValid) {
    console.warn(
      `⚠️ Messenger CTA doc_id may be rotated — response shape unexpected for page ${pageId}`
    );
  }
  return { eligible: false };
}
