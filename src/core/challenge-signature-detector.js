// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions — ChallengeSignatureDetector (Story 27.3)
 *
 * Single source of truth for bot-detection / challenge-page signatures.
 * Used by both AbstractApiClient (HTTP response body/headers/status) and
 * AbstractCrawler (Puppeteer page.content()).
 *
 * Pure sync. Returns a normalized ChallengeResult:
 *   { detected, type, confidence, suggestedHibernationMs, signature }
 *
 * The catalog is data-driven — an array of signature entries with weighted
 * patterns. A platform validator can append scoped overrides via
 * `registerPlatformSignatures(platform, sigs)` without touching core code.
 *
 * Confidence is the sum of matched pattern weights, normalized by the
 * signature's max weight. `detected` fires when `confidence >= 0.5`.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

const MINUTE = 60 * 1000;

/** Suggested hibernation windows per challenge class. */
const HIBERNATION = /** @type {const} */ ({
  cloudflare_managed: 5 * MINUTE,
  cloudflare_turnstile: 5 * MINUTE,
  cloudflare_interstitial: 5 * MINUTE,
  arkose: 30 * MINUTE,
  recaptcha: 10 * MINUTE,
  hcaptcha: 10 * MINUTE,
  platform_checkpoint: 15 * MINUTE,
  platform_unusual_login: 15 * MINUTE,
  platform_account_locked: 30 * MINUTE,
  platform_challenge_required: 15 * MINUTE,
  generic_captcha: 10 * MINUTE,
  unknown: 10 * MINUTE,
});

/**
 * @typedef {Object} ChallengePattern
 * @property {'substr'|'regex'|'header'|'status'} kind
 * @property {string|number} value  - substring, regex source, header name, or status code
 * @property {number} weight        - contribution to confidence when matched
 * @property {string} [headerValue] - optional expected header value substring
 */

/**
 * @typedef {Object} ChallengeSignature
 * @property {string} id
 * @property {string} type               - one of the keys of HIBERNATION
 * @property {ChallengePattern[]} patterns
 * @property {number} [hibernationMs]    - override default for this type
 * @property {'http'|'dom'|'both'} [appliesTo]
 * @property {string} [platform]         - scoped to a platform when set
 */

/**
 * Built-in signature catalog. Each entry's `weight` values are relative —
 * confidence = (sum of matched weights) / (max achievable weight for the
 * signature). Threshold for `detected` is 0.5.
 * @type {ChallengeSignature[]}
 */
const BUILTIN_SIGNATURES = [
  // ---- Cloudflare ----------------------------------------------------
  {
    id: 'cf-managed',
    type: 'cloudflare_managed',
    appliesTo: 'both',
    patterns: [
      { kind: 'substr', value: 'cf-challenge', weight: 0.8 },
      { kind: 'substr', value: 'cf-chl-bypass', weight: 1.0 },
      { kind: 'substr', value: 'cf-challenge-running', weight: 1.0 },
      { kind: 'substr', value: 'challenge-running', weight: 0.7 },
      { kind: 'substr', value: '__cf_chl', weight: 1.0 },
      { kind: 'substr', value: 'cf-browser-verification', weight: 0.9 },
      { kind: 'substr', value: 'Just a moment...', weight: 0.6 },
      { kind: 'substr', value: 'Attention Required! | Cloudflare', weight: 0.9 },
      { kind: 'substr', value: 'cf-error-code', weight: 0.5 },
      { kind: 'header', value: 'cf-mitigated', headerValue: 'challenge', weight: 1.0 },
      { kind: 'header', value: 'server', headerValue: 'cloudflare', weight: 0.2 },
    ],
  },
  {
    id: 'cf-turnstile',
    type: 'cloudflare_turnstile',
    appliesTo: 'both',
    patterns: [
      { kind: 'substr', value: 'cf-turnstile', weight: 1.0 },
      { kind: 'substr', value: 'challenges.cloudflare.com/turnstile', weight: 1.0 },
      { kind: 'substr', value: 'turnstile.render', weight: 0.8 },
      { kind: 'substr', value: 'data-sitekey', weight: 0.2 }, // generic — small weight
    ],
  },
  {
    id: 'cf-interstitial',
    type: 'cloudflare_interstitial',
    appliesTo: 'both',
    patterns: [
      { kind: 'regex', value: '<title>\\s*Just a moment', weight: 1.0 },
      { kind: 'substr', value: '/cdn-cgi/challenge-platform/', weight: 1.0 },
      { kind: 'substr', value: 'cf-chl-widget', weight: 0.9 },
    ],
  },
  // ---- Arkose / FunCaptcha -------------------------------------------
  {
    id: 'arkose',
    type: 'arkose',
    appliesTo: 'both',
    patterns: [
      { kind: 'substr', value: 'arkoselabs.com', weight: 1.0 },
      { kind: 'substr', value: 'client-api.arkoselabs.com', weight: 1.0 },
      { kind: 'substr', value: 'funcaptcha', weight: 0.9 },
      { kind: 'substr', value: 'arkose', weight: 0.7 },
      { kind: 'substr', value: 'data-callback="onCompleted"', weight: 0.3 },
    ],
  },
  // ---- Generic captcha -----------------------------------------------
  {
    id: 'recaptcha',
    type: 'recaptcha',
    appliesTo: 'both',
    patterns: [
      { kind: 'substr', value: 'g-recaptcha', weight: 1.0 },
      { kind: 'substr', value: 'www.google.com/recaptcha', weight: 1.0 },
      { kind: 'substr', value: 'grecaptcha.execute', weight: 0.9 },
    ],
  },
  {
    id: 'hcaptcha',
    type: 'hcaptcha',
    appliesTo: 'both',
    patterns: [
      { kind: 'substr', value: 'hcaptcha.com', weight: 1.0 },
      { kind: 'substr', value: 'h-captcha', weight: 0.9 },
    ],
  },
  {
    id: 'generic-captcha',
    type: 'generic_captcha',
    appliesTo: 'both',
    patterns: [
      { kind: 'substr', value: 'captcha', weight: 0.4 },
      { kind: 'substr', value: 'data-testid="challenge"', weight: 0.6 },
      { kind: 'substr', value: 'window.__初始状态', weight: 0.8 }, // Weibo sentinel
    ],
  },
  // ---- Platform-specific ----------------------------------------------
  {
    id: 'fb-checkpoint',
    type: 'platform_checkpoint',
    appliesTo: 'both',
    platform: 'facebook',
    patterns: [
      { kind: 'regex', value: 'facebook\\.com/checkpoint|/checkpoint/', weight: 1.0 },
      { kind: 'substr', value: 'checkpoint', weight: 0.6 },
      { kind: 'substr', value: 'Your account has been temporarily locked', weight: 1.0 },
    ],
  },
  {
    id: 'tw-unusual-login',
    type: 'platform_unusual_login',
    appliesTo: 'both',
    platform: 'twitter',
    patterns: [
      { kind: 'substr', value: 'unusual-login', weight: 1.0 },
      { kind: 'substr', value: 'unusual login', weight: 0.9 },
      { kind: 'substr', value: 'verify your account', weight: 0.6 },
    ],
  },
  {
    id: 'tw-account-locked',
    type: 'platform_account_locked',
    appliesTo: 'both',
    platform: 'twitter',
    patterns: [
      { kind: 'substr', value: 'account_locked', weight: 1.0 },
      { kind: 'substr', value: '"code":326', weight: 1.0 },
      { kind: 'substr', value: '"code": 326', weight: 1.0 },
      { kind: 'substr', value: 'temporarily locked', weight: 0.9 },
    ],
  },
  {
    id: 'ig-challenge-required',
    type: 'platform_challenge_required',
    appliesTo: 'both',
    platform: 'instagram',
    patterns: [
      { kind: 'substr', value: 'challenge_required', weight: 1.0 },
      { kind: 'substr', value: '"challenge":{', weight: 0.8 },
      { kind: 'substr', value: 'checkpoint_required', weight: 1.0 },
    ],
  },
  // ---- Status code boosters -------------------------------------------
  {
    id: 'http-403-challenge',
    type: 'unknown',
    appliesTo: 'http',
    patterns: [
      { kind: 'status', value: 403, weight: 0.4 },
      { kind: 'substr', value: 'challenge', weight: 0.3 },
    ],
  },
];

/**
 * @typedef {Object} ChallengeResult
 * @property {boolean} detected
 * @property {string} type                - one of HIBERNATION keys
 * @property {number} confidence          - [0,1]
 * @property {number} suggestedHibernationMs
 * @property {string|null} signature      - id of the matched signature
 * @property {string[]} matchedPatterns   - debug: which pattern ids fired
 */

export class ChallengeSignatureDetector {
  constructor() {
    /** @type {ChallengeSignature[]} */
    this._catalog = [...BUILTIN_SIGNATURES];
    /** @type {Map<string, ChallengeSignature[]>} */
    this._platformSigs = new Map();
  }

  /**
   * Register platform-scoped signatures appended to the catalog when the
   * input is tagged with a matching platform.
   * @param {string} platform
   * @param {ChallengeSignature[]} sigs
   */
  registerPlatformSignatures(platform, sigs) {
    if (!platform || !Array.isArray(sigs)) return;
    const cur = this._platformSigs.get(platform) || [];
    this._platformSigs.set(platform, [...cur, ...sigs]);
  }

  /**
   * Detect a challenge from an HTTP response.
   * @param {Object} input
   * @param {string|Buffer|Object} [input.body]
   * @param {string|Buffer|Object} [input.data]  - axios-style alias
   * @param {Object} [input.headers]
   * @param {number} [input.statusCode]
   * @param {number} [input.status]
   * @param {string} [input.url]
   * @param {string} [input.platform]
   * @returns {ChallengeResult}
   */
  detect(input = {}) {
    const safe = /** @type {Record<string, any>} */ (input && typeof input === 'object' ? input : {});
    const bodyText = this._toText(safe.body ?? safe.data ?? '');
    const url = String(safe.url || '');
    const statusCode = safe.statusCode ?? safe.status ?? 0;
    const headers = /** @type {Record<string, string>} */ (safe.headers || {});
    const platform = safe.platform || null;

    const candidates = [...this._catalog];
    if (platform && this._platformSigs.has(platform)) {
      candidates.push(...(this._platformSigs.get(platform) || []));
    }

    /** @type {{sig:ChallengeSignature, score:number, matched:string[], confidence:number} | null} */
    let best = null;

    for (const sig of candidates) {
      if (sig.appliesTo === 'dom') continue; // response-only path
      if (sig.platform && platform && sig.platform !== platform) continue;

      let score = 0;
      let topWeight = 0;
      /** @type {string[]} */
      const matched = [];

      for (const pat of sig.patterns) {
        if (this._matchPattern(pat, { bodyText, url, statusCode, headers })) {
          score += pat.weight;
          if (pat.weight > topWeight) topWeight = pat.weight;
          matched.push(`${pat.kind}:${String(pat.value).substring(0, 40)}`);
        }
      }

      if (matched.length === 0) continue;

      // Confidence: top matched weight + bonus per extra hit (capped at 1).
      const extraHits = matched.length - 1;
      let confidence = Math.min(1, topWeight + extraHits * 0.15);
      // Status 403 boost (+0.2) when non-status patterns matched
      if (statusCode === 403 && sig.id !== 'http-403-challenge' && matched.some(m => !m.startsWith('status:'))) {
        confidence = Math.min(1, confidence + 0.2);
      }
      if (confidence >= 0.5 && (!best || confidence > best.confidence)) {
        best = { sig, score, matched, confidence };
      }
    }

    if (!best) {
      return {
        detected: false,
        type: 'unknown',
        confidence: 0,
        suggestedHibernationMs: HIBERNATION.unknown,
        signature: null,
        matchedPatterns: [],
      };
    }

    const confidence = best.confidence;
    const type = best.sig.type;
    return {
      detected: true,
      type,
      confidence,
      suggestedHibernationMs: best.sig.hibernationMs ?? HIBERNATION[/** @type {keyof typeof HIBERNATION} */ (type)] ?? HIBERNATION.unknown,
      signature: best.sig.id,
      matchedPatterns: best.matched,
    };
  }

  /**
   * Detect a challenge from a rendered HTML page (Puppeteer `page.content()`).
   * @param {string} html
   * @param {Object} [opts]
   * @param {string} [opts.url]
   * @param {string} [opts.platform]
   * @returns {ChallengeResult}
   */
  detectFromHtml(html, opts = {}) {
    if (typeof html !== 'string' || !html) {
      return { detected: false, type: 'unknown', confidence: 0, suggestedHibernationMs: HIBERNATION.unknown, signature: null, matchedPatterns: [] };
    }
    const safeOpts = (opts && typeof opts === 'object') ? opts : {};
    // Reuse the same catalog — `appliesTo: 'dom' | 'both'` only
    const platform = safeOpts.platform || null;
    const url = String(safeOpts.url || '');
    const candidates = [...this._catalog];
    if (platform && this._platformSigs.has(platform)) {
      candidates.push(...(this._platformSigs.get(platform) || []));
    }

    /** @type {{sig:ChallengeSignature, score:number, matched:string[], confidence:number} | null} */
    let best = null;
    for (const sig of candidates) {
      if (sig.appliesTo === 'http') continue;
      if (sig.platform && platform && sig.platform !== platform) continue;
      let score = 0;
      let topWeight = 0;
      const matched = [];
      for (const pat of sig.patterns) {
        if (pat.kind === 'status' || pat.kind === 'header') continue; // DOM has no headers/status
        if (this._matchPattern(pat, { bodyText: html, url, statusCode: 0, headers: {} })) {
          score += pat.weight;
          if (pat.weight > topWeight) topWeight = pat.weight;
          matched.push(`${pat.kind}:${String(pat.value).substring(0, 40)}`);
        }
      }
      if (matched.length === 0) continue;
      const extraHits = matched.length - 1;
      const confidence = Math.min(1, topWeight + extraHits * 0.15);
      if (confidence >= 0.5 && (!best || confidence > best.confidence)) {
        best = { sig, score, matched, confidence };
      }
    }

    if (!best) {
      return { detected: false, type: 'unknown', confidence: 0, suggestedHibernationMs: HIBERNATION.unknown, signature: null, matchedPatterns: [] };
    }
    const confidence = best.confidence;
    const type = best.sig.type;
    return {
      detected: true,
      type,
      confidence,
      suggestedHibernationMs: best.sig.hibernationMs ?? HIBERNATION[/** @type {keyof typeof HIBERNATION} */ (type)] ?? HIBERNATION.unknown,
      signature: best.sig.id,
      matchedPatterns: best.matched,
    };
  }

  /**
   * Detect from a response object — axios/fetch-like.
   * @param {Object} response
   * @param {Object} [opts]
   * @param {string} [opts.platform]
   * @returns {ChallengeResult}
   */
  detectFromResponse(response, opts = {}) {
    const safeOpts = (opts && typeof opts === 'object') ? opts : {};
    const rec = /** @type {Record<string, any>} */ (response && typeof response === 'object' ? response : {});
    const body = rec.data ?? rec.body ?? response;
    const headers = /** @type {Record<string, string>} */ (rec.headers || {});
    const statusCode = rec.status ?? rec.statusCode ?? 0;
    const url = rec.url ?? rec.config?.url ?? '';
    return this.detect({ body, headers, statusCode, url, platform: safeOpts.platform });
  }

  /** @param {ChallengePattern} pat @param {{bodyText:string, url:string, statusCode:number, headers:Record<string,string>}} ctx @returns {boolean} */
  _matchPattern(pat, ctx) {
    const { bodyText, url, statusCode, headers } = ctx;
    switch (pat.kind) {
      case 'substr': {
        const v = String(pat.value).toLowerCase();
        return bodyText.toLowerCase().includes(v) || url.toLowerCase().includes(v);
      }
      case 'regex': {
        try {
          const re = new RegExp(String(pat.value), 'i');
          return re.test(bodyText) || re.test(url);
        } catch { return false; }
      }
      case 'header': {
        const name = String(pat.value).toLowerCase();
        const want = String(pat.headerValue || '').toLowerCase();
        if (headers && typeof /** @type {any} */ (headers).get === 'function') {
          const val = /** @type {any} */ (headers).get(name);
          if (val !== null && val !== undefined) {
            if (!want) return true;
            return String(val).toLowerCase().includes(want);
          }
        }
        for (const [k, v] of Object.entries(headers || {})) {
          if (String(k).toLowerCase() === name) {
            if (!want) return true;
            return String(v).toLowerCase().includes(want);
          }
        }
        return false;
      }
      case 'status':
        return Number(pat.value) === Number(statusCode);
      default:
        return false;
    }
  }

  /** @param {unknown} v @returns {string} */
  _toText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (Buffer.isBuffer(v)) return v.toString('utf8');
    try { return JSON.stringify(v); } catch { return String(v); }
  }
}

export const globalChallengeSignatureDetector = new ChallengeSignatureDetector();
export default ChallengeSignatureDetector;
