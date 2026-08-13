// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Facebook proxy rotation module (Story 5.3 — Auth modes & proxy rotation, Epic 5).
 *
 * Port of SST_TOOL_FB/Tech_Meta/proxyfb.cs, proxyTM.cs, shopLike.cs.
 * C# source confirmed in repo at:
 *   auto-crawl-tiktok-post-fb/automation-facebook/SST_TOOL_FB/Tech_Meta/
 *
 * Two-step fallback (primary → fallback) matches C# exactly:
 *   proxyfb:  GET changeProxy → if success!="True"              → GET getProxy
 *   tmproxy:  POST get-new-proxy → if code!="0"                 → POST get-current-proxy
 *   shoplike: GET getNewProxy (http) → if !status.includes("success") → GET getCurrentProxy (https)
 *
 * Normalized descriptor: { proxy:'host:port', server:'http://host:port', username?, password? }
 *   server   → --proxy-server= launch arg in createBrowser
 *   username/password → page.authenticate({ username, password })
 *
 * NFR3: provider API key is NEVER logged or echoed in errors.
 * @author nich (@nichxbt)
 * @license BSL 1.1
 */

// by nichxbt

import axios from 'axios';

// Firefox 58 User-Agent — matches C# proxyfb.cs + shopLike.cs exactly.
const FIREFOX_UA = 'Mozilla/5.0(Windows NT 10.0; WOW64; rv:58.0) Gecko/20100101 Firefox/58.0';

// ============================================================================
// Provider configuration (two-step primary → fallback per C# source)
//
// SECURITY — key exposure:
//   proxyfb / shoplike: API key is embedded as a URL query param. This is
//   REQUIRED by the real APIs and cannot be moved to a header. These URLs
//   MUST NEVER be logged, included in error messages, or surfaced in any output.
//   tmproxy: key is in the POST JSON body — also must never be logged.
//   All catch() blocks below are intentionally binding-free (no `catch (err)`)
//   so err.config.url cannot be accidentally referenced.
// ============================================================================

const PROVIDERS = {
  proxyfb: {
    // C# proxyfb.cs: GET changeProxy (primary), GET getProxy (fallback)
    // SECURITY: URL contains API key — NEVER LOG THIS URL.
    primaryUrl:  (k) => `http://api.proxyfb.com/api/changeProxy.php?key=${encodeURIComponent(k)}`,
    fallbackUrl: (k) => `http://api.proxyfb.com/api/getProxy.php?key=${encodeURIComponent(k)}`,
    method:      'GET',
    headers:     { 'User-Agent': FIREFOX_UA },
    primaryOk:   (p) => p?.success === 'True',
    fallbackOk:  (p) => p?.success === 'True',
  },
  tmproxy: {
    // C# proxyTM.cs: POST get-new-proxy (primary), POST get-current-proxy (fallback)
    // SECURITY: API key is in JSON body — NEVER LOG REQUEST BODY.
    primaryUrl:  () => 'https://tmproxy.com/api/proxy/get-new-proxy',
    fallbackUrl: () => 'https://tmproxy.com/api/proxy/get-current-proxy',
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    body:        (k) => JSON.stringify({ api_key: k }),
    primaryOk:   (p) => p?.code === '0',
    fallbackOk:  (p) => p?.code === '0',
  },
  shoplike: {
    // C# shopLike.cs: GET getNewProxy/HTTP (primary), GET getCurrentProxy/HTTPS (fallback)
    // SECURITY: URL contains access_token — NEVER LOG THIS URL.
    primaryUrl:  (k) => `http://proxy.shoplike.vn/Api/getNewProxy?access_token=${encodeURIComponent(k)}`,
    fallbackUrl: (k) => `https://proxy.shoplike.vn/Api/getCurrentProxy?access_token=${encodeURIComponent(k)}`,
    method:      'GET',
    headers:     { 'User-Agent': FIREFOX_UA },
    primaryOk:   (p) => typeof p?.status === 'string' && p.status.includes('success'),
    fallbackOk:  (p) => typeof p?.status === 'string' && p.status.includes('success'),
  },
};

/** Validated allow-list derived from provider keys — do NOT hard-code strings elsewhere. */
const VALID_PROVIDERS = Object.keys(PROVIDERS);

// ============================================================================
// fetchImpl seam (mirrors graphql.js defaultFetch exactly)
// Tests inject a stub via options.fetchImpl; real network only hits in production.
// ============================================================================

async function defaultFetch(url, init = {}) {
  const res = await axios.request({
    url,
    method: init.method || 'GET',
    headers: init.headers,
    data: init.body,
    responseType: 'text',
    transformResponse: [(d) => d],
    maxRedirects: 5,
    validateStatus: () => true,
  });
  const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  return { status: res.status, text: async () => text };
}

// ============================================================================
// Normalizer — builds canonical descriptor from parsed host/port/creds.
// Returns null if host or port is falsy — never throws.
// ============================================================================

/**
 * @param {string} host
 * @param {string|number} port
 * @param {string|null} [username]
 * @param {string|null} [password]
 * @returns {{ proxy: string, server: string, username?: string, password?: string }|null}
 */
function buildDescriptor(host, port, username, password) {
  if (!host || !port) return null;
  const proxy = `${host}:${port}`;
  const server = `http://${proxy}`;
  /** @type {Record<string,string>} */
  const desc = { proxy, server };
  if (username) desc.username = username;
  if (password) desc.password = password;
  return desc;
}

// ============================================================================
// Flat-string proxy parser — shared by all 3 C# providers.
// All three return the proxy as a flat colon-delimited string: "host:port[:user[:pass]]"
// Password may contain colons — take parts.slice(3).join(':') for the password.
// ============================================================================

/**
 * @param {string|null|undefined} raw
 * @returns {{ proxy, server, username?, password? }|null}
 */
export function parseFlatProxy(raw) {
  if (typeof raw !== 'string' || !raw.includes(':')) return null;
  const parts = raw.split(':');
  if (parts.length < 2) return null;
  const host     = parts[0] || null;
  const portStr  = parts[1] || null;
  const username = parts.length > 2 ? (parts[2] || null) : null;
  // Password may contain colons — rejoin everything after parts[2]
  const password = parts.length > 3 ? parts.slice(3).join(':') : null;
  return buildDescriptor(host, portStr, username, password);
}

// ============================================================================
// Per-provider parsers (pure — accept already-parsed JSON object)
// ============================================================================

/**
 * proxyfb response: { "success": "True", "proxy": "host:port[:user:pass]" }
 * Note: success is the STRING "True" (not boolean). C# ref: proxyfb.cs lines 25-28.
 * @param {object} parsed
 * @returns {{ proxy, server, username?, password? }|null}
 */
function parseProxyfb(parsed) {
  return parseFlatProxy(parsed?.proxy ?? null);
}

/**
 * tmproxy response: { "code": "0", "data": { "https": "host:port[:user:pass]" } }
 * Field is literally named "https" per proxyTM.cs line 23 (jobject["data"]["https"]).
 * @param {object} parsed
 * @returns {{ proxy, server, username?, password? }|null}
 */
function parseTmproxy(parsed) {
  return parseFlatProxy(parsed?.data?.https ?? null);
}

/**
 * shoplike response: { "status": "...success...", "data": { "proxy": "host:port[:user:pass]" } }
 * Status check is substring contains("success") (per shopLike.cs line 25).
 * @param {object} parsed
 * @returns {{ proxy, server, username?, password? }|null}
 */
function parseShoplike(parsed) {
  return parseFlatProxy(parsed?.data?.proxy ?? null);
}

/** Dispatch table — keyed by provider name. */
const PARSERS = { proxyfb: parseProxyfb, tmproxy: parseTmproxy, shoplike: parseShoplike };

// ============================================================================
// Internal: single attempt against one endpoint (primary or fallback).
// NFR3: never logs the URL (may contain API key) or body (may contain API key).
// Catch block is intentionally binding-free — no `catch (err)` — so
// err.config.url (which may contain the key for GET providers) cannot be logged.
// ============================================================================

/**
 * @param {object}   cfg          PROVIDERS entry
 * @param {Function} urlFn        cfg.primaryUrl or cfg.fallbackUrl
 * @param {Function} okFn         cfg.primaryOk or cfg.fallbackOk
 * @param {Function} parseFn      PARSERS[provider]
 * @param {string}   key          Provider API key (never logged)
 * @param {Function} fetchImpl    fetch-shaped seam
 * @param {string}   providerName For warn messages only (never includes key)
 * @returns {Promise<object|null>}
 */
async function _attempt(cfg, urlFn, okFn, parseFn, key, fetchImpl, providerName) {
  // SECURITY: urlFn(key) may embed the API key — never log the result of this call.
  let text;
  try {
    const res = await fetchImpl(urlFn(key), {
      method:  cfg.method,
      headers: cfg.headers,
      // body only present for tmproxy (POST); contains key — never log
      ...(cfg.body ? { body: cfg.body(key) } : {}),
    });
    text = await res.text();
  } catch {
    // Binding-free: no reference to the error object, so err.config.url cannot leak
    return null;
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!okFn(parsed)) return null;
  const descriptor = parseFn(parsed);
  if (!descriptor) {
    console.warn(
      `⚠️ rotateProxy: unexpected response shape from "${providerName}" — ` +
      `update the matching parser if the API changed`
    );
  }
  return descriptor;
}

// ============================================================================
// Main export
// ============================================================================

/**
 * Call a provider's rotate API and return a normalized proxy descriptor.
 *
 * Implements the two-step primary → fallback pattern from the C# source exactly.
 * Returns null on network failure or unexpected response shape — NEVER throws
 * on a bad response. Only throws on invalid input (unknown provider, missing key).
 * NFR3: `key` is NEVER logged or included in error messages.
 *
 * @param {'proxyfb'|'tmproxy'|'shoplike'} provider
 * @param {string} key  Provider API key/token
 * @param {{ fetchImpl?: Function }} [options]
 * @returns {Promise<{ proxy: string, server: string, username?: string, password?: string }|null>}
 * @throws {Error} Unknown provider or missing/empty key
 */
export async function rotateProxy(provider, key, options = {}) {
  if (!VALID_PROVIDERS.includes(provider)) {
    throw new Error(
      `❌ rotateProxy: unknown provider "${provider}". Valid: ${VALID_PROVIDERS.join(', ')}`
    );
  }
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error('❌ rotateProxy: key is required and must be a non-empty string');
  }

  const { fetchImpl = defaultFetch } = options;
  const cfg     = PROVIDERS[provider];
  const parseFn = PARSERS[provider];

  // Step 1: primary endpoint
  const primary = await _attempt(cfg, cfg.primaryUrl, cfg.primaryOk, parseFn, key, fetchImpl, provider);
  if (primary) return primary;

  // Step 2: fallback endpoint (triggered when primary returns non-OK response or network error)
  console.warn(`⚠️ rotateProxy: primary endpoint failed for "${provider}", trying fallback`);
  const fallback = await _attempt(cfg, cfg.fallbackUrl, cfg.fallbackOk, parseFn, key, fetchImpl, provider);
  if (fallback) return fallback;

  console.warn(`⚠️ rotateProxy: both primary and fallback failed for "${provider}"`);
  return null;
}
