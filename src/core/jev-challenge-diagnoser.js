// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions — JevChallengeDiagnoser (Story 42.4)
 *
 * Semantic second opinion for suspicious HTTP 2xx responses and empty scrapes.
 * The static `ChallengeSignatureDetector` stays first-line on every response;
 * this module is only consulted on the rare branch where the detector missed
 * but a platform validator still flags false-200/checkpoint — or when a crawl
 * returned 0 records over a suspicious last response.
 *
 * Flow: response body → `extractSnippet` (≤500 chars text) →
 * `jevBrain.decide(snippet, { pageStatus: Choice })` → `jev.gate(answer,
 * { action: 'pageStatus' })`. Gate `act` + verdict `bot_challenge`/`login_wall`
 * → caller escalates (BotChallengeError + hibernate notify-trio, same as the
 * static-detector path). `rate_limited` is label-only — the rate-limit path
 * already governs it. Degraded Jev output never escalates.
 *
 * Env:
 *   JEV_CHALLENGE_DIAG        — kill-switch, default ON; only 0|false|off|no disables.
 *   JEV_THRESHOLD_PAGESTATUS  — confidence threshold for the pageStatus gate (default 0.8).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { JevBrain } from '../agents/jevBrain.js';

const SNIPPET_MAX_CHARS = 500;
/** Bound on input BEFORE any regex runs — multi-MB bodies must not reach the HTML stripper. */
const SNIPPET_PRESCAN_CHARS = 64 * 1024;
const DEFAULT_PAGESTATUS_THRESHOLD = 0.8;

/** Verdicts that escalate to BotChallengeError when the gate acts. */
const ESCALATABLE_VERDICTS = new Set(['bot_challenge', 'login_wall']);

/**
 * Jev Choice question used for page-status classification.
 * `ok`/`rate_limited` never escalate; only `bot_challenge`/`login_wall` do.
 * @type {import('../agents/jevBrain.js').JevQuestion}
 */
const PAGE_STATUS_QUESTION = {
  type: 'choice',
  instructions:
    'You are given the first ~500 characters of text extracted from an HTTP response body ' +
    '(HTML stripped to text, or serialized JSON). Classify what the upstream platform actually returned.',
  criteria: {
    ok: 'A normal page or API payload — real content, even if the requested list is legitimately empty.',
    bot_challenge:
      'An anti-bot checkpoint or challenge page — captcha, "verify you are human", ' +
      '"Just a moment", JavaScript/browser-verification interstitial, unusual-traffic wall.',
    login_wall:
      'An authentication wall — a login/sign-in form, session-expired notice, or a redirect ' +
      'demanding credentials before content is served.',
    rate_limited:
      'A rate-limit or throttling notice — "too many requests", "slow down", ' +
      'retry-later style body (the dedicated rate-limit path already handles this).',
  },
};

/**
 * Kill-switch polarity: feature is ON by default and only an explicit
 * 0|false|off|no disables it. Deliberately NOT `isEnvTruthy` — truthy-polarity
 * would default the feature OFF whenever the env is unset.
 * @param {string | boolean | undefined | null} val
 * @returns {boolean}
 */
export function isJevChallengeDiagEnabled(val = process.env.JEV_CHALLENGE_DIAG) {
  if (typeof val === 'boolean') return val;
  if (val === undefined || val === null || val === '') return true;
  const normalized = String(val).trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no');
}

/**
 * Resolve the pageStatus confidence threshold from env/config, default 0.8.
 * @param {string | number | undefined | null} val
 * @returns {number}
 */
export function resolvePageStatusThreshold(val = process.env.JEV_THRESHOLD_PAGESTATUS) {
  let resolved;
  if (typeof val === 'number') {
    resolved = Number.isFinite(val) ? val : DEFAULT_PAGESTATUS_THRESHOLD;
  } else if (val === undefined || val === null || val === '') {
    resolved = DEFAULT_PAGESTATUS_THRESHOLD;
  } else {
    const parsed = parseFloat(String(val));
    resolved = Number.isFinite(parsed) ? parsed : DEFAULT_PAGESTATUS_THRESHOLD;
  }
  // Confidence is a probability — clamp to [0,1] so env typos can't move the gate.
  return Math.min(1, Math.max(0, resolved));
}

/**
 * Extract a bounded plain-text snippet (≤500 chars) from a response body.
 * HTML → strip script/style + tags, collapse whitespace.
 * Object → JSON.stringify then slice. Buffer → utf8 text.
 * Returns '' when there is nothing usable — callers skip Jev on empty.
 * @param {unknown} body
 * @param {number} [maxChars]
 * @returns {string}
 */
export function extractSnippet(body, maxChars = SNIPPET_MAX_CHARS) {
  if (body === null || body === undefined) return '';

  let text;
  if (typeof body === 'string') {
    text = body;
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
    text = body.subarray(0, SNIPPET_PRESCAN_CHARS).toString('utf8');
  } else if (typeof body === 'object') {
    try {
      text = JSON.stringify(body);
    } catch {
      // Circular/BigInt bodies carry no usable evidence — never fall back to
      // String(body) ('[object Object]' would just waste a paid decide call).
      return '';
    }
  } else {
    text = String(body);
  }

  if (!text || typeof text !== 'string') return '';

  // Bound BEFORE the HTML/whitespace regexes — a huge body must not make the
  // stripper scan megabytes on the hot path.
  if (text.length > SNIPPET_PRESCAN_CHARS) text = text.slice(0, SNIPPET_PRESCAN_CHARS);

  // Strip HTML only when it really looks like markup (`<tag`, `</tag`,
  // `<!doctype`, `<!--`). Bare '<'/'>' inside JSON (urls, comparisons,
  // '{"a":"<","b":">"}') must not trigger the stripper and mangle evidence.
  if (/<[a-zA-Z!/][^>]*>/.test(text)) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ');
  }

  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, maxChars);
}

/**
 * JevChallengeDiagnoser — bounded, degrade-safe wrapper around `jevBrain` for
 * challenge/soft-block second opinions. Never throws; returns null (skipped)
 * or a diagnosis object `{ verdict, confidence, gate, escalate, degraded }`.
 */
export class JevChallengeDiagnoser {
  /**
   * @param {object} [options]
   * @param {import('../agents/jevBrain.js').JevBrain | any} [options.brain] - injected brain (tests fake at this IO boundary); lazy-constructed JevBrain when omitted
   * @param {boolean | string} [options.enabled] - explicit override for JEV_CHALLENGE_DIAG (string values normalized via isJevChallengeDiagEnabled)
   * @param {number} [options.threshold] - explicit override for JEV_THRESHOLD_PAGESTATUS
   */
  constructor(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    /** @type {any} — JevBrain instance (real or test fake); null until first diagnose */
    this.brain = opts.brain || null;
    /** @type {boolean} — true when the brain was injected rather than lazy-built */
    this._injectedBrain = Boolean(opts.brain);
    // Explicit overrides only — when unset, env is re-resolved on EVERY
    // diagnose() call so the module-eval singleton honors `.env` files loaded
    // after import and runtime env changes (G8).
    this._enabledOverride =
      opts.enabled !== undefined
        ? typeof opts.enabled === 'string'
          ? isJevChallengeDiagEnabled(opts.enabled)
          : Boolean(opts.enabled)
        : undefined;
    this._thresholdOverride = Number.isFinite(opts.threshold) ? opts.threshold : undefined;
  }

  /** @returns {boolean} — explicit override when given, else live env resolution */
  get enabled() {
    return this._enabledOverride !== undefined ? this._enabledOverride : isJevChallengeDiagEnabled();
  }

  /** @param {boolean | undefined} val — set an explicit override; `undefined` returns to env resolution */
  set enabled(val) {
    this._enabledOverride = val === undefined ? undefined : Boolean(val);
  }

  /** @returns {number} — explicit override when given, else live env resolution, clamped [0,1] */
  get threshold() {
    const t = this._thresholdOverride !== undefined ? this._thresholdOverride : resolvePageStatusThreshold();
    return Math.min(1, Math.max(0, t));
  }

  /** @param {number | undefined} val */
  set threshold(val) {
    this._thresholdOverride = Number.isFinite(val) ? val : undefined;
  }

  /**
   * Lazily resolve the Jev brain. Constructed on first use so importing this
   * module never requires TYPESAFE_API_KEY (degrade is JevBrain's job).
   * @returns {any}
   */
  #resolveBrain() {
    if (!this.brain) {
      this.brain = new JevBrain({
        confidenceThresholds: { pageStatus: this.threshold },
      });
    }
    return this.brain;
  }

  /**
   * Ask Jev whether a suspicious response is actually a challenge page.
   * @param {object} input
   * @param {string | unknown} [input.snippet] - pre-extracted text or a raw body (extractSnippet applied when not a string)
   * @param {string} [input.platform]
   * @param {string | null} [input.accountId]
   * @returns {Promise<{
   *   verdict: string | null,
   *   confidence: number,
   *   gate: 'act' | 'review' | 'skip',
   *   escalate: boolean,
   *   degraded: boolean,
   * } | null>} — null when skipped (disabled / empty snippet / decide threw)
   */
  async diagnose({ snippet, platform = 'unknown', accountId = null } = {}) {
    if (!this.enabled) return null;

    // extractSnippet handles strings (HTML strip + whitespace collapse + ≤500
    // slice) and raw bodies alike — empty/whitespace input returns '' → skip.
    const text = extractSnippet(snippet);
    if (!text) return null;

    let brain;
    try {
      brain = this.#resolveBrain();
    } catch (err) {
      console.warn(
        `[JevChallengeDiagnoser] brain init failed on ${platform} — skipping second opinion: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    // Keep the pageStatus threshold current per call: an explicit
    // opts.threshold applies even onto an injected brain (G11), and a
    // lazy-built brain re-reads env so post-import `.env` loads and runtime
    // changes are honored (G8). An injected brain with NO explicit threshold
    // keeps its own configuration untouched.
    try {
      if (
        brain.confidenceThresholds &&
        typeof brain.confidenceThresholds === 'object' &&
        (this._thresholdOverride !== undefined || !this._injectedBrain)
      ) {
        brain.confidenceThresholds.pageStatus = this.threshold;
      }
    } catch {
      // Threshold refresh is best-effort — gate falls back to the brain's own.
    }

    let result;
    try {
      result = await brain.decide(text, { pageStatus: PAGE_STATUS_QUESTION });
    } catch (err) {
      // jevBrain.decide() is designed not to throw — belt & suspenders anyway.
      console.warn(
        `[JevChallengeDiagnoser] decide() threw on ${platform} — skipping second opinion: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    // Degraded plane (missing key / API error / budget) → never escalate on
    // degraded data; flow stays exactly as before this story.
    if (!result || result.meta?.degraded) {
      return { verdict: null, confidence: 0, gate: 'skip', escalate: false, degraded: true };
    }

    const answer = result.answers?.pageStatus;
    const verdict = typeof answer?.choice === 'string' ? answer.choice : null;
    const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0;

    let gate = 'skip';
    try {
      gate = typeof brain.gate === 'function' ? brain.gate(answer, { action: 'pageStatus' }) : 'skip';
    } catch {
      gate = 'skip';
    }

    if (gate === 'review') {
      console.warn(
        `[JevChallengeDiagnoser] ${platform} pageStatus=${verdict ?? 'null'} conf=${confidence.toFixed(2)} ` +
          `below act threshold — review only, no escalation`,
      );
    } else if (verdict === 'rate_limited') {
      // Label for observability only — governor's rate-limit path owns this.
      console.log(
        `[JevChallengeDiagnoser] ${platform} pageStatus=rate_limited conf=${confidence.toFixed(2)} — logged, not escalated`,
      );
    }

    const escalate = gate === 'act' && ESCALATABLE_VERDICTS.has(/** @type {string} */ (verdict));
    return { verdict, confidence, gate, escalate, degraded: false };
  }
}

/** Global singleton — lazy brain; enabled/threshold resolve env per diagnose() call. */
export const globalJevChallengeDiagnoser = new JevChallengeDiagnoser();

export default JevChallengeDiagnoser;
