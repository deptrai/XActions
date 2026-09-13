// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions — TLS Profile Provider (Story 27.1)
 *
 * Pluggable TLS/JA4 fingerprint layer. A `TlsProfileProvider` maps a browser
 * family (derived from the session fingerprint's user-agent) to a set of TLS
 * handshake parameters — cipher-suite ordering, minimum TLS version, and ALPN —
 * so that the outbound handshake resembles the impersonated browser instead of
 * Node.js defaults.
 *
 * This is a **best-effort** interface (spec decision): when the underlying
 * transport (`got-scraping` / `undici` / a custom `https.Agent` or external
 * tool) cannot expose cipher control, callers treat a `null` profile as a
 * graceful no-op — the browser-level fingerprint still applies and the
 * acceptance criteria are satisfied.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * @typedef {Object} TlsProfile
 * @property {string} browserFamily - 'chrome' | 'firefox' | 'safari' | 'unknown'
 * @property {string[]} cipherSuites - Ordered cipher suite names (IETF names).
 * @property {string} minVersion - Minimum TLS version, e.g. 'TLSv1.2'.
 * @property {string} maxVersion - Maximum TLS version, e.g. 'TLSv1.3'.
 * @property {string[]} alpnProtocols - e.g. ['h2','http/1.1'].
 * @property {string[]} [sigAlgs] - Signature algorithms (JA3/JA4 signal).
 */

// ---------------------------------------------------------------------------
// Cipher-suite orderings per browser family.
// Order matters: JA3/JA4 fingerprints hash the *sequence* of offered ciphers.
// These are representative orderings for current stable browsers — they are
// approximations meant to look plausible, not byte-exact reproductions.
// ---------------------------------------------------------------------------

const TLS13 = ['TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256'];

const CHROME_CIPHERS = [
  ...TLS13,
  'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
  'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
  'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
  'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
  'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
  'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
  'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
  'TLS_RSA_WITH_AES_128_GCM_SHA256',
  'TLS_RSA_WITH_AES_256_GCM_SHA384',
  'TLS_RSA_WITH_AES_128_CBC_SHA',
  'TLS_RSA_WITH_AES_256_CBC_SHA',
];

const FIREFOX_CIPHERS = [
  ...TLS13,
  'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
  'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
  'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
  'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
  'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
  'TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA',
  'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA',
  'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
  'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
  'TLS_RSA_WITH_AES_128_GCM_SHA256',
  'TLS_RSA_WITH_AES_256_GCM_SHA384',
  'TLS_RSA_WITH_AES_128_CBC_SHA',
  'TLS_RSA_WITH_AES_256_CBC_SHA',
];

const SAFARI_CIPHERS = [
  ...TLS13,
  'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
  'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
  'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
  'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
  'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
  'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
  'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
  'TLS_RSA_WITH_AES_256_GCM_SHA384',
  'TLS_RSA_WITH_AES_128_GCM_SHA256',
  'TLS_RSA_WITH_AES_256_CBC_SHA',
  'TLS_RSA_WITH_AES_128_CBC_SHA',
];

const DEFAULT_SIG_ALGS = [
  'ecdsa_secp256r1_sha256',
  'rsa_pss_rsae_sha256',
  'rsa_pkcs1_sha256',
  'ecdsa_secp384r1_sha384',
  'rsa_pss_rsae_sha384',
  'rsa_pkcs1_sha384',
  'rsa_pkcs1_sha1',
];

const PROFILES = {
  chrome: { cipherSuites: CHROME_CIPHERS },
  firefox: { cipherSuites: FIREFOX_CIPHERS },
  safari: { cipherSuites: SAFARI_CIPHERS },
};

/**
 * Derive the browser family from a user-agent string.
 * Order matters: Chrome/Edge/Chromium UAs contain 'Safari' too, and Firefox
 * contains none of the others.
 * @param {string} [ua]
 * @returns {'chrome'|'firefox'|'safari'|'unknown'}
 */
export function browserFamilyFromUA(ua) {
  const s = String(ua || '');
  if (/Firefox\/|FxiOS\//i.test(s)) return 'firefox';
  if (/Edg(e|A|iOS)?\/|Chrome\/|CriOS\/|Chromium\//i.test(s)) return 'chrome';
  if (/Version\/[\d.]+.*Safari\/|Safari\//i.test(s) && !/Chrome\//i.test(s)) return 'safari';
  return 'unknown';
}

/**
 * Default TLS profile provider. Maps a browser family (or a user-agent) to a
 * representative TLS handshake profile. Returns `null` for `unknown` so callers
 * can treat it as a graceful no-op.
 */
export class TlsProfileProvider {
  /**
   * @param {Object} [options]
   * @param {Record<string, Partial<TlsProfile>>} [options.overrides] - per-family overrides merged over the defaults
   */
  constructor(options = {}) {
    this._overrides = options.overrides && typeof options.overrides === 'object' ? options.overrides : {};
  }

  /**
   * Resolve a TLS profile for a browser family or user-agent.
   * @param {string} familyOrUa - 'chrome' | 'firefox' | 'safari' OR a raw UA string.
   * @returns {TlsProfile | null}
   */
  getProfile(familyOrUa) {
    const key = /** @type {string} */ (familyOrUa);
    const family = (/** @type {Record<string, {cipherSuites:string[]}>} */ (PROFILES))[key] ? key : browserFamilyFromUA(key);
    const base = (/** @type {Record<string, {cipherSuites:string[]}>} */ (PROFILES))[family];
    if (!base) return null;
    const override = this._overrides[family] || {};
    return {
      browserFamily: family,
      cipherSuites: override.cipherSuites || base.cipherSuites.slice(),
      minVersion: override.minVersion || 'TLSv1.2',
      maxVersion: override.maxVersion || 'TLSv1.3',
      alpnProtocols: override.alpnProtocols || ['h2', 'http/1.1'],
      sigAlgs: override.sigAlgs || DEFAULT_SIG_ALGS.slice(),
    };
  }

  /**
   * Convenience: profile for a fingerprint object (uses its userAgent).
   * @param {{ userAgent?: string }} fingerprint
   * @returns {TlsProfile | null}
   */
  forFingerprint(fingerprint) {
    return this.getProfile(/** @type {string} */ (fingerprint && fingerprint.userAgent) || '');
  }
}

export const globalTlsProfileProvider = new TlsProfileProvider();
export default TlsProfileProvider;
