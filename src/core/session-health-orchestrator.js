// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions — SessionHealthOrchestrator (Story 27.2)
 *
 * Computes a continuous health score [0,100] per `platform:accountId` from six
 * signals — consecutive errors, rate-limit frequency, bot-challenge frequency,
 * average latency, payload completeness, and proxy health — and drives an
 * automatic circuit breaker with a recovery probe.
 *
 * Design: the orchestrator is a *layer above* the existing primitives. It never
 * re-implements hibernation — it calls `AdaptiveRateGovernor.hibernateAccount`
 * and `AccountPool.markUnavailable`/`markAvailable` (Epic 27 DoD: no duplicate
 * governor/pool logic). The recovery probe is injected (`probeFn`) because the
 * orchestrator lives in `src/core` and does not know how to call a platform's
 * read-only action — the caller/admin registers the probe per account.
 *
 * Breaker states: `closed` → `open` (score<30, account `sick`, excluded from
 * rotation) → `half-open` (after cooldown) → `closed` (probe ok) / `open`
 * (probe fail, exponential backoff ×2 capped).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

const SICK_THRESHOLD = 30;
const REOPEN_SCORE = 60;
const BASE_COOLDOWN_MS = 60 * 1000;         // 1 min
const MAX_COOLDOWN_MS = 30 * 60 * 1000;     // 30 min cap

/** @param {string} platform @param {string} accountId @returns {string} */
const keyOf = (platform, accountId) => `${platform || 'default'}:${accountId}`;

/** Fresh metric bucket for an account. */
function freshMetrics() {
  return {
    consecutiveErrors: 0,
    totalErrors: 0,
    rateLimits: 0,
    botChallenges: 0,
    totalLatencyMs: 0,
    latencySamples: 0,
    payloadIncomplete: 0,
    payloadComplete: 0,
    proxyUnhealthy: false,
    lastEventAt: 0,
  };
}

/**
 * @typedef {Object} CircuitBreakerState
 * @property {'closed'|'open'|'half-open'} state
 * @property {number} failures            - consecutive failed probes/opens
 * @property {number} nextProbeAt         - epoch ms when open→half-open allowed
 * @property {number} openedAt            - epoch ms the breaker last opened
 */

export class SessionHealthOrchestrator {
  /**
   * @param {Object} [options]
   * @param {import('./adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {import('./account-pool.js').AccountPool} [options.accountPool]
   * @param {number} [options.sickThreshold]
   * @param {number} [options.baseCooldownMs]
   * @param {number} [options.maxCooldownMs]
   * @param {() => number} [options.now] - injectable clock for deterministic tests
   */
  constructor(options = {}) {
    this._governor = options.governor || null;
    this._accountPool = options.accountPool || null;
    this._sickThreshold = options.sickThreshold ?? SICK_THRESHOLD;
    this._baseCooldownMs = options.baseCooldownMs ?? BASE_COOLDOWN_MS;
    this._maxCooldownMs = options.maxCooldownMs ?? MAX_COOLDOWN_MS;
    this._now = typeof options.now === 'function' ? options.now : () => Date.now();
    /** @type {Map<string, ReturnType<typeof freshMetrics>>} */
    this._metrics = new Map();
    /** @type {Map<string, CircuitBreakerState>} */
    this._breakers = new Map();
    /** @type {Map<string, {score:number}>} */
    this._scores = new Map();
    /** @type {Map<string, (accountId:string, platform:string)=>Promise<{success:boolean, complete?:boolean, challenge?:boolean}>|{success:boolean, complete?:boolean, challenge?:boolean}>} */
    this._probes = new Map();
    /** @type {Set<string>} */
    this._probing = new Set();
  }

  /** @param {string} platform @param {string} accountId */
  _key(platform, accountId) { return keyOf(platform, accountId); }

  /** @param {string} platform @param {string} accountId */
  _metricsFor(platform, accountId) {
    const key = this._key(platform, accountId);
    let m = this._metrics.get(key);
    if (!m) { m = freshMetrics(); this._metrics.set(key, m); }
    return m;
  }

  /** @param {string} platform @param {string} accountId @returns {CircuitBreakerState} */
  _breakerFor(platform, accountId) {
    const key = this._key(platform, accountId);
    let b = this._breakers.get(key);
    if (!b) { b = { state: 'closed', failures: 0, nextProbeAt: 0, openedAt: 0 }; this._breakers.set(key, b); }
    return b;
  }

  // ------------------------------------------------------------------
  // Signal feeds — called by base-client / base-crawler / admin paths.
  // ------------------------------------------------------------------

  /** @param {string} platform @param {string} accountId */
  recordSuccess(platform, accountId) {
    const m = this._metricsFor(platform, accountId);
    m.consecutiveErrors = 0;
    m.payloadComplete++;
    m.lastEventAt = this._now();
    this._recompute(platform, accountId);
  }

  /** @param {string} platform @param {string} accountId */
  recordError(platform, accountId) {
    const m = this._metricsFor(platform, accountId);
    m.consecutiveErrors++;
    m.totalErrors++;
    m.lastEventAt = this._now();
    this._recompute(platform, accountId);
  }

  /** @param {string} platform @param {string} accountId */
  recordRateLimit(platform, accountId) {
    const m = this._metricsFor(platform, accountId);
    m.rateLimits++;
    m.consecutiveErrors++;
    m.lastEventAt = this._now();
    this._recompute(platform, accountId);
  }

  /** @param {string} platform @param {string} accountId */
  recordBotChallenge(platform, accountId) {
    const m = this._metricsFor(platform, accountId);
    m.botChallenges++;
    m.consecutiveErrors++;
    m.lastEventAt = this._now();
    this._recompute(platform, accountId);
  }

  /** @param {string} platform @param {string} accountId @param {number} latencyMs */
  recordLatency(platform, accountId, latencyMs) {
    const m = this._metricsFor(platform, accountId);
    if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0) {
      m.totalLatencyMs += latencyMs;
      m.latencySamples++;
    }
    m.lastEventAt = this._now();
    this._recompute(platform, accountId);
  }

  /** @param {string} platform @param {string} accountId @param {boolean} complete */
  recordPayload(platform, accountId, complete) {
    const m = this._metricsFor(platform, accountId);
    if (complete) { m.payloadComplete++; m.consecutiveErrors = 0; }
    else { m.payloadIncomplete++; m.consecutiveErrors++; }
    m.lastEventAt = this._now();
    this._recompute(platform, accountId);
  }

  /** @param {string} platform @param {string} accountId @param {boolean} healthy */
  recordProxyHealth(platform, accountId, healthy) {
    const m = this._metricsFor(platform, accountId);
    m.proxyUnhealthy = !healthy;
    m.lastEventAt = this._now();
    this._recompute(platform, accountId);
  }

  // ------------------------------------------------------------------
  // Scoring
  // ------------------------------------------------------------------

  /**
   * Compute the health score [0,100] for an account from its metrics.
   * Deterministic weighted penalty model (see spec Design Notes).
   * @param {string} platform @param {string} accountId
   * @returns {number}
   */
  getHealthScore(platform, accountId) {
    const key = this._key(platform, accountId);
    const stored = this._scores.get(key);
    return stored ? stored.score : 100;
  }

  /** @param {ReturnType<typeof freshMetrics>} m */
  _avgLatency(m) { return m.latencySamples ? m.totalLatencyMs / m.latencySamples : 0; }

  /** @param {string} platform @param {string} accountId */
  _recompute(platform, accountId) {
    const key = this._key(platform, accountId);
    const m = this._metricsFor(platform, accountId);
    const avg = this._avgLatency(m);
    const latencyPenalty = avg > 8000 ? 20 : avg > 3000 ? 10 : 0;
    const score = Math.max(0, Math.min(100, Math.round(
      100
      - Math.min(75, 18 * m.consecutiveErrors)
      - Math.min(30, 10 * m.rateLimits)
      - Math.min(30, 15 * m.botChallenges)
      - latencyPenalty
      - Math.min(24, 12 * m.payloadIncomplete)
      - (m.proxyUnhealthy ? 15 : 0)
    )));
    this._scores.set(key, { score });
    // Drive breaker state from score.
    if (score < this._sickThreshold) this._open(platform, accountId);
    return score;
  }

  // ------------------------------------------------------------------
  // Circuit breaker
  // ------------------------------------------------------------------

  /** @param {string} platform @param {string} accountId */
  _open(platform, accountId) {
    const b = this._breakerFor(platform, accountId);
    const now = this._now();
    if (b.state === 'open') return; // already open
    b.state = 'open';
    b.openedAt = now;
    b.nextProbeAt = now + this._cooldownFor(b.failures);
    this._markSick(platform, accountId);
  }

  /** @param {number} failures */
  _cooldownFor(failures) {
    const safeFailures = Math.min(Math.max(0, failures), 20);
    const ms = this._baseCooldownMs * Math.pow(2, safeFailures);
    return Math.min(this._maxCooldownMs, ms);
  }

  /** @param {string} platform @param {string} accountId */
  _markSick(platform, accountId) {
    try {
      if (this._accountPool && typeof this._accountPool.markUnavailable === 'function') {
        this._accountPool.markUnavailable(accountId, 'sick', this._maxCooldownMs, platform);
      }
    } catch { /* pool optional */ }
    try {
      if (this._governor && typeof this._governor.hibernateAccount === 'function') {
        this._governor.hibernateAccount(accountId, 'sick', this._maxCooldownMs, platform);
      }
    } catch { /* governor optional */ }
  }

  /** @param {string} platform @param {string} accountId */
  _markActive(platform, accountId) {
    try {
      if (this._accountPool && typeof this._accountPool.markAvailable === 'function') {
        this._accountPool.markAvailable(accountId, platform);
      }
    } catch { /* optional */ }
    try {
      if (this._governor && typeof this._governor.wakeAccount === 'function') {
        this._governor.wakeAccount(accountId, platform);
      }
    } catch { /* optional */ }
  }

  /**
   * Register the recovery probe for an account. `probeFn` performs a cheap,
   * read-only action (e.g. `profile`) through a fresh proxy and returns
   * `{ success, complete?, challenge? }`. When no probe is registered,
   * `checkRecovery` treats half-open as a manual wake (markAvailable + score 60).
   * @param {string} platform @param {string} accountId @param {(accountId:string, platform:string)=>Promise<{success:boolean, complete?:boolean, challenge?:boolean}>|{success:boolean, complete?:boolean, challenge?:boolean}} probeFn
   */
  registerProbe(platform, accountId, probeFn) {
    this._probes.set(this._key(platform, accountId), probeFn);
  }

  /**
   * Lazily advance the breaker: when `open` and cooldown elapsed, go `half-open`
   * and run the probe; close on success, re-open with backoff on failure.
   * Called from the request path (canAccountRequest) or an admin probe action.
   * @param {string} platform @param {string} accountId
   * @returns {Promise<CircuitBreakerState>}
   */
  /**
   * @param {string} platform
   * @param {string} accountId
   * @param {Object} [options]
   * @param {boolean} [options.force=false] - bypass cooldown (used by operator manual probe)
   * @returns {Promise<CircuitBreakerState>}
   */
  async checkRecovery(platform, accountId, options = {}) {
    const b = this._breakerFor(platform, accountId);
    const now = this._now();
    if (b.state === 'closed') return b;
    if (b.state === 'open') {
      const force = options && options.force === true;
      if (!force && now < b.nextProbeAt) return b;  // still cooling down
      b.state = 'half-open';
    }
    // half-open → run probe
    const key = this._key(platform, accountId);
    if (this._probing.has(key)) return b;
    this._probing.add(key);
    try {
      const probe = this._probes.get(key);
      /** @type {{ success: boolean, complete?: boolean, challenge?: boolean }} */
      let result = { success: true, complete: true };
      if (typeof probe === 'function') {
        try { result = await probe(accountId, platform); }
        catch { result = { success: false }; }
      } else {
        // No probe registered → manual-wake semantics, conservative reopen.
        console.warn(`⚠️ [SessionHealth] no probeFn for ${platform}:${accountId} — manual-wake reopen`);
      }
      if (result && result.success && result.complete !== false && !result.challenge) {
        this._close(platform, accountId);
      } else {
        b.failures++;
        b.state = 'open';
        b.openedAt = this._now();
        b.nextProbeAt = b.openedAt + this._cooldownFor(b.failures);
        this._markSick(platform, accountId);
        // keep score low on failed probe
        this._scores.set(key, { score: Math.min(this._scores.get(key)?.score ?? 0, this._sickThreshold - 1) });
      }
    } finally {
      this._probing.delete(key);
    }
    return b;
  }

  /** @param {string} platform @param {string} accountId */
  _close(platform, accountId) {
    const b = this._breakerFor(platform, accountId);
    b.state = 'closed';
    b.failures = 0;
    b.nextProbeAt = 0;
    // Reset to a conservative healthy score and clear error streak.
    const m = this._metricsFor(platform, accountId);
    m.consecutiveErrors = 0; m.rateLimits = 0; m.botChallenges = 0;
    m.payloadIncomplete = 0; m.proxyUnhealthy = false;
    this._scores.set(this._key(platform, accountId), { score: REOPEN_SCORE });
    this._markActive(platform, accountId);
  }

  /**
   * Manual wake — close the breaker and mark active regardless of score.
   * @param {string} platform @param {string} accountId
   */
  wake(platform, accountId) { this._close(platform, accountId); }

  /**
   * Whether the account may serve traffic (breaker not open).
   * @param {string} platform @param {string} accountId @returns {boolean}
   */
  isAvailable(platform, accountId) {
    const b = this._breakerFor(platform, accountId);
    return b.state !== 'open';
  }

  /**
   * @returns {{ healthScores: Record<string, number>, circuitBreakerStates: Record<string, CircuitBreakerState> }}
   */
  getStatus() {
    /** @type {Record<string, number>} */
    const healthScores = {};
    for (const [key, v] of this._scores) healthScores[key] = v.score;
    /** @type {Record<string, CircuitBreakerState>} */
    const circuitBreakerStates = {};
    for (const [key, b] of this._breakers) circuitBreakerStates[key] = { ...b };
    return { healthScores, circuitBreakerStates };
  }
}

export const globalSessionHealthOrchestrator = new SessionHealthOrchestrator();
export default SessionHealthOrchestrator;
