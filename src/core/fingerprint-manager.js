// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions — FingerprintManager (Story 27.1)
 *
 * Manages a pool of *complete*, internally-consistent browser fingerprints and
 * binds them to a geo-consistent proxy region so platforms cannot fingerprint
 * XActions via TLS/JA4 mismatches, inconsistent timezone/locale, or proxy-UA
 * mismatch.
 *
 * A fingerprint is a stable, immutable value object assigned per
 * `platform:accountId`. It persists to `SocialAccount.metadata.fingerprint`
 * when the account is registered there; otherwise it lives in an in-memory
 * `Map` for the process lifetime. Fingerprints never rotate on their own —
 * `rotateForAccount()` is explicit, to avoid the rapid rotation that triggers
 * re-auth flows.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * @typedef {Object} Fingerprint
 * @property {string} userAgent
 * @property {{ width: number, height: number }} viewport
 * @property {string} timezone
 * @property {string} locale
 * @property {number} colorDepth
 * @property {string} platform            - navigator.platform (e.g. 'Win32','MacIntel')
 * @property {{ vendor: string, renderer: string }} webgl
 * @property {string[]} fonts
 * @property {number} hardwareConcurrency - navigator.hardwareConcurrency
 * @property {number} deviceMemory        - navigator.deviceMemory (GB)
 * @property {string} browserFamily       - 'chrome'|'firefox'|'safari'
 * @property {string} osFamily            - 'windows'|'mac'|'linux'
 * @property {string} [region]            - bound proxy region (when known)
 */

import { browserFamilyFromUA, TlsProfileProvider } from './tls-profile-provider.js';

/** @param {number} min @param {number} max @returns {number} */
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
/** @param {any[]} arr @returns {any} */
const pick = (arr) => arr[rand(0, arr.length - 1)];

// ---------------------------------------------------------------------------
// Fingerprint profile pool — each entry is internally consistent: the UA's
// OS + browser family determines platform, WebGL, hardwareConcurrency and
// deviceMemory so no field contradicts the UA string.
// ---------------------------------------------------------------------------

/**
 * @param {string} ua
 * @param {{ platform: string, osFamily: 'windows'|'mac'|'linux', webglVendor: string, webglRenderer: string, hwConcurrency: number[], deviceMemory: number[], fonts: string[] }} spec
 * @returns {Fingerprint}
 */
function makeProfile(ua, { platform, osFamily, webglVendor, webglRenderer, hwConcurrency, deviceMemory, fonts }) {
  return {
    userAgent: ua,
    viewport: { width: rand(1280, 1920), height: rand(720, 1080) },
    timezone: 'UTC',
    locale: 'en-US',
    colorDepth: pick([24, 32]),
    platform,
    webgl: { vendor: webglVendor, renderer: webglRenderer },
    fonts,
    hardwareConcurrency: pick(hwConcurrency),
    deviceMemory: pick(deviceMemory),
    browserFamily: browserFamilyFromUA(ua),
    osFamily,
  };
}

const WIN_FONTS = ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Segoe UI', 'Times New Roman', 'Verdana'];
const MAC_FONTS = ['American Typewriter', 'Avenir', 'Geneva', 'Helvetica', 'Menlo', 'Monaco', 'San Francisco', 'Times'];
const LINUX_FONTS = ['DejaVu Sans', 'DejaVu Serif', 'FreeSans', 'Liberation Sans', 'Noto Sans', 'Ubuntu'];

const PROFILES = [
  // Windows + Chrome
  ...['131.0.0.0', '130.0.0.0', '129.0.0.0'].map((v) => () =>
    makeProfile(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`, {
      platform: 'Win32', osFamily: 'windows', webglVendor: 'Google Inc. (Intel)',
      webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630, Direct3D11 vs_5_0 ps_5_0)',
      hwConcurrency: [4, 8, 12, 16], deviceMemory: [8, 16], fonts: WIN_FONTS,
    })),
  // Windows + Firefox
  () => makeProfile('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0', {
    platform: 'Win32', osFamily: 'windows', webglVendor: 'Mozilla',
    webglRenderer: 'Mozilla — ANGLE (Intel, Intel(R) UHD Graphics 630, Direct3D11 vs_5_0 ps_5_0)',
    hwConcurrency: [4, 8, 16], deviceMemory: [8, 16], fonts: WIN_FONTS,
  }),
  // macOS + Chrome
  ...['131.0.0.0', '130.0.0.0'].map((v) => () =>
    makeProfile(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`, {
      platform: 'MacIntel', osFamily: 'mac', webglVendor: 'Google Inc. (Apple)',
      webglRenderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)',
      hwConcurrency: [8, 10], deviceMemory: [8, 16], fonts: MAC_FONTS,
    })),
  // macOS + Safari
  () => makeProfile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15', {
    platform: 'MacIntel', osFamily: 'mac', webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple GPU',
    hwConcurrency: [8, 10], deviceMemory: [8, 16], fonts: MAC_FONTS,
  }),
  // macOS + Firefox
  () => makeProfile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:121.0) Gecko/20100101 Firefox/121.0', {
    platform: 'MacIntel', osFamily: 'mac', webglVendor: 'Mozilla',
    webglRenderer: 'Mozilla — Apple M1',
    hwConcurrency: [8, 10], deviceMemory: [8, 16], fonts: MAC_FONTS,
  }),
  // Linux + Chrome
  () => makeProfile('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', {
    platform: 'Linux x86_64', osFamily: 'linux', webglVendor: 'Google Inc. (Mesa)',
    webglRenderer: 'ANGLE (Mesa, llvmpipe, OpenGL 4.5)',
    hwConcurrency: [4, 8], deviceMemory: [8, 16], fonts: LINUX_FONTS,
  }),
  // Linux + Firefox
  () => makeProfile('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', {
    platform: 'Linux x86_64', osFamily: 'linux', webglVendor: 'Mozilla',
    webglRenderer: 'Mozilla — Mesa llvmpipe',
    hwConcurrency: [4, 8], deviceMemory: [8, 16], fonts: LINUX_FONTS,
  }),
];

// ---------------------------------------------------------------------------
// Region → timezone/locale map. Timezone + locale are the *only* fields a
// region influences — identity stays unique per account.
// ---------------------------------------------------------------------------

const REGION_GEO = {
  us: { timezones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'], locale: 'en-US' },
  ca: { timezones: ['America/Toronto', 'America/Vancouver'], locale: 'en-CA' },
  gb: { timezones: ['Europe/London'], locale: 'en-GB' },
  uk: { timezones: ['Europe/London'], locale: 'en-GB' },
  de: { timezones: ['Europe/Berlin'], locale: 'de-DE' },
  fr: { timezones: ['Europe/Paris'], locale: 'fr-FR' },
  eu: { timezones: ['Europe/Berlin', 'Europe/Paris', 'Europe/Madrid'], locale: 'en-GB' },
  jp: { timezones: ['Asia/Tokyo'], locale: 'ja-JP' },
  sg: { timezones: ['Asia/Singapore'], locale: 'en-SG' },
  vn: { timezones: ['Asia/Ho_Chi_Minh'], locale: 'vi-VN' },
  au: { timezones: ['Australia/Sydney', 'Australia/Melbourne'], locale: 'en-AU' },
};

// Fallback timezone/locale per OS family — used when the proxy region is
// unknown so the fingerprint stays internally consistent with the UA OS.
const OS_GEO = {
  windows: { timezone: 'America/New_York', locale: 'en-US' },
  mac: { timezone: 'America/Los_Angeles', locale: 'en-US' },
  linux: { timezone: 'Europe/London', locale: 'en-GB' },
};

const FINGERPRINT_VERSION = 1;
/** @param {string} platform @param {string} accountId @returns {string} */
const keyOf = (platform, accountId) => `${platform || 'default'}:${accountId}`;

/**
 * Manages complete, geo-consistent, per-account browser fingerprints.
 */
export class FingerprintManager {
  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient | null} [options.prisma] - for SocialAccount persistence
   * @param {TlsProfileProvider} [options.tlsProvider]
   * @param {{ get(k:string):any, set(k:string,v:any):any }} [options.store] - injected KV store (deterministic persist for tests)
   */
  constructor(options = {}) {
    this._prisma = options.prisma === undefined ? undefined : options.prisma;
    this._tlsProvider = options.tlsProvider instanceof TlsProfileProvider ? options.tlsProvider : new TlsProfileProvider();
    this._store = options.store || null;
    /** @type {Map<string, Fingerprint>} */
    this._byAccount = new Map();
    /** @type {Map<string, string>} */
    this._regionByAccount = new Map();
  }

  async _resolvePrisma() {
    if (this._prisma !== undefined) return this._prisma;
    try {
      const { default: prisma } = await import('../../api/lib/prisma.js');
      this._prisma = prisma || null;
    } catch {
      this._prisma = null;
    }
    return this._prisma;
  }

  /** @param {string} platform @param {string} accountId */
  _key(platform, accountId) { return keyOf(platform, accountId); }

  /**
   * Extract a region key from a proxy record/url.
   * @param {object|string|null|undefined} proxy
   * @returns {string|null}
   */
  _regionFromProxy(proxy) {
    if (!proxy) return null;
    const rec = /** @type {any} */ (proxy);
    const raw = typeof proxy === 'object' ? (rec.region || rec.country) : null;
    if (!raw) return null;
    const r = String(raw).toLowerCase().trim();
    return r || null;
  }

  /**
   * Bind an account to a proxy region so future fingerprints derive a
   * geo-consistent timezone/locale. Idempotent.
   * @param {string} accountId
   * @param {string} region
   */
  bindProxyRegion(accountId, region) {
    if (!accountId || !region) return;
    this._regionByAccount.set(String(accountId), String(region).toLowerCase());
  }

  /**
   * Apply region geo to a freshly generated profile.
   * @param {Fingerprint} fp
   * @param {string|null} region
   * @returns {Fingerprint}
   */
  _applyGeo(fp, region) {
    const geo = region && REGION_GEO[/** @type {keyof typeof REGION_GEO} */ (region)];
    if (geo) {
      fp.timezone = pick(geo.timezones);
      fp.locale = geo.locale;
    } else {
      const os = (/** @type {Record<string,{timezone:string,locale:string}>} */ (OS_GEO))[fp.osFamily] || OS_GEO.windows;
      fp.timezone = os.timezone;
      fp.locale = os.locale;
    }
    if (region) fp.region = region;
    return fp;
  }

  /** Generate a fresh fingerprint. @param {string|null} region @returns {Fingerprint} */
  _generate(region) {
    const fp = pick(PROFILES)();
    return this._applyGeo(fp, region);
  }

  // ---- persistence (injected store → SocialAccount → in-memory) ----

  /** @param {string} platform @param {string} accountId @returns {Promise<Fingerprint|null>} */
  async _loadPersisted(platform, accountId) {
    const key = this._key(platform, accountId);
    if (this._store && typeof this._store.get === 'function') {
      try {
        const rec = await this._store.get(key);
        // Store persists { version, fingerprint, region } — unwrap the value.
        return rec && rec.fingerprint ? rec.fingerprint : (rec && rec.userAgent ? rec : null);
      } catch { return null; }
    }
    const prisma = await this._resolvePrisma();
    if (!prisma || !prisma.socialAccount) return null;
    try {
      const acc = await prisma.socialAccount.findFirst({
        where: { platform, OR: [{ label: accountId }, { metadata: { path: ['accountId'], equals: accountId } }] },
        select: { metadata: true },
      });
      const meta = acc && acc.metadata;
      /** @type {any} */
      const fp = meta && typeof meta === 'object' ? (/** @type {any} */ (meta).fingerprint) : null;
      return fp && fp.fingerprint ? fp.fingerprint : null;
    } catch { return null; }
  }

  /** @param {string} platform @param {string} accountId @param {Fingerprint} fingerprint @returns {Promise<void>} */
  async _persist(platform, accountId, fingerprint) {
    const key = this._key(platform, accountId);
    const record = { version: FINGERPRINT_VERSION, fingerprint, region: fingerprint.region || null, savedAt: new Date().toISOString() };
    if (this._store && typeof this._store.set === 'function') {
      try { await this._store.set(key, record); } catch { /* in-memory still authoritative */ }
      return;
    }
    const prisma = await this._resolvePrisma();
    if (!prisma || !prisma.socialAccount) return;
    try {
      const acc = await prisma.socialAccount.findFirst({
        where: { platform, OR: [{ label: accountId }, { metadata: { path: ['accountId'], equals: accountId } }] },
        select: { id: true, metadata: true },
      });
      if (!acc) return; // unmanaged account → in-memory only
      const metadata = Object.assign({}, acc.metadata || {}, { fingerprint: record });
      await prisma.socialAccount.update({ where: { id: acc.id }, data: { metadata } });
    } catch (err) {
      console.warn(`⚠️ [FingerprintManager] persist failed for ${key}: ${(err instanceof Error ? err.message : String(err))}`);
    }
  }

  /**
   * Get (or lazily create) the stable fingerprint for an account.
   * Callers may omit `platform` (defaults to 'default').
   * @param {string} platform
   * @param {string} accountId
   * @param {Object} [options]
   * @param {object|string} [options.proxy] - proxy record/url (source of region)
   * @returns {Promise<Fingerprint>}
   */
  async getForAccount(platform, accountId, options = {}) {
    if (accountId == null || accountId === '') throw new TypeError('FingerprintManager.getForAccount requires an accountId');
    const key = this._key(platform, accountId);

    const region = this._regionFromProxy(options.proxy) || this._regionByAccount.get(String(accountId)) || null;
    if (region) this._regionByAccount.set(String(accountId), region);

    const existing = this._byAccount.get(key);
    if (existing) return existing;

    const persisted = await this._loadPersisted(platform, accountId);
    if (persisted && persisted.userAgent && persisted.webgl && Array.isArray(persisted.fonts)) {
      this._byAccount.set(key, persisted);
      return persisted;
    }

    const fp = this._generate(region);
    this._byAccount.set(key, fp);
    await this._persist(platform, accountId, fp);
    return fp;
  }

  /**
   * Explicitly rotate an account's fingerprint. Generates a new fingerprint,
   * overwrites persistence and the in-memory map. Does NOT invalidate in-flight
   * stealth pages — only subsequent launches pick it up.
   * @param {string} platform
   * @param {string} accountId
   * @param {Object} [options]
   * @param {object|string} [options.proxy]
   * @returns {Promise<Fingerprint>}
   */
  async rotateForAccount(platform, accountId, options = {}) {
    if (accountId == null || accountId === '') throw new TypeError('FingerprintManager.rotateForAccount requires an accountId');
    const key = this._key(platform, accountId);
    const region = this._regionFromProxy(options.proxy) || this._regionByAccount.get(String(accountId)) || null;
    if (region) this._regionByAccount.set(String(accountId), region);
    const prev = this._byAccount.get(key);
    let fp = this._generate(region);
    // Avoid returning an identical UA on rotation when pool is small.
    if (prev && prev.userAgent === fp.userAgent) fp = this._generate(region);
    this._byAccount.set(key, fp);
    await this._persist(platform, accountId, fp);
    return fp;
  }

  /**
   * TLS profile for an account's fingerprint (best-effort JA3/JA4 hint).
   * @param {Fingerprint|string} fingerprintOrUa
   * @returns {import('./tls-profile-provider.js').TlsProfile | null}
   */
  tlsProfileFor(fingerprintOrUa) {
    try {
      return this._tlsProvider.forFingerprint(typeof fingerprintOrUa === 'string' ? { userAgent: fingerprintOrUa } : fingerprintOrUa);
    } catch (err) {
      console.warn(`⚠️ [FingerprintManager] TLS provider failed: ${(err instanceof Error ? err.message : String(err))} — no-op`);
      return null;
    }
  }

  /** @param {string} platform @param {string} accountId @returns {boolean} */
  has(platform, accountId) { return this._byAccount.has(this._key(platform, accountId)); }

  /** @returns {number} */
  get size() { return this._byAccount.size; }
}

export const globalFingerprintManager = new FingerprintManager();
export default FingerprintManager;
