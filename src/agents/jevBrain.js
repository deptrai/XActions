// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Jev Brain Module
// Typed-Decision Engine powered by TypeSafe Jev (System One)
// by nichxbt

import { globalDistributedTokenBucket } from '../core/distributed-token-bucket.js';

const JEV_API_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @typedef {Object} JevQuestion
 * @property {'choice'|'score'|'noul'} type
 * @property {string} instructions
 * @property {Record<string, string>|string[]} [criteria]
 */

/**
 * @typedef {Object} JevAnswerChoice
 * @property {'choice'} type
 * @property {string} choice
 * @property {number} confidence
 * @property {Record<string, number>} [probabilities]
 */

/**
 * @typedef {Object} JevAnswerScore
 * @property {'score'} type
 * @property {number} score
 * @property {number} confidence
 * @property {Record<string, string>} [legend]
 * @property {Record<string, number>} [probabilities]
 */

/**
 * @typedef {Object} JevAnswerNoul
 * @property {'noul'} type
 * @property {number} noul
 */

/**
 * @typedef {Object} JevConfig
 * @property {string} [apiKey]
 * @property {string} [endpoint]
 * @property {string} [model]
 * @property {number} [timeoutMs]
 * @property {Record<string, number>} [confidenceThresholds]
 * @property {any} [fallbackLLM]
 * @property {number} [dailyBudgetUsd]
 */

/**
 * JevBrain — Dedicated decision plane using TypeSafe Jev System One model.
 */
export class JevBrain {
  /**
   * @param {JevConfig} [config={}]
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.TYPESAFE_API_KEY || '';
    this.endpoint = config.endpoint || process.env.TYPESAFE_API_ENDPOINT || JEV_API_ENDPOINT;
    this.model = config.model || DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.fallbackLLM = config.fallbackLLM || null;

    // Load user-tunable thresholds per-action with defaults
    this.confidenceThresholds = {
      like: 0.60,
      reply: 0.85,
      bookmark: 0.50,
      quote: 0.75,
      follow: 0.70,
      relevance: 0.70,
      safeToSend: 0.80,
      pageStatus: 0.80,
      samePerson: 0.85,
      unfollow: 0.70,
      ...(config.confidenceThresholds || {}),
    };

    const envBudget = process.env.JEV_DAILY_BUDGET_USD !== undefined
      ? parseFloat(process.env.JEV_DAILY_BUDGET_USD)
      : 10.0;
    const rawBudget = config.dailyBudgetUsd ?? envBudget;
    this.dailyBudgetUsd = Number.isFinite(rawBudget) ? rawBudget : 10.0;

    /** @type {Map<string, { count: number, resetAt: number }>} */
    this._rateLimits = new Map();
    /** @type {{ calls: number, inputTokens: number, outputTokens: number }} */
    this._usageToday = { calls: 0, inputTokens: 0, outputTokens: 0 };
    this._usageDate = new Date().toISOString().split('T')[0];
    /** @type {((model: string, inputTokens: number, outputTokens: number) => void)|null} */
    this.onUsage = null;
  }

  // ─── Core Decision API ────────────────────────────────────────

  /**
   * Execute typed decision questions against state.
   * @param {string|Record<string, any>|any[]} state - Text-only state to evaluate
   * @param {Record<string, JevQuestion>} questions - Dict of typed questions
   * @param {Object} [options={}]
   * @param {string} [options.model]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<{
   *   answers: Record<string, JevAnswerChoice|JevAnswerScore|JevAnswerNoul|any>,
   *   usage: { input_tokens: number, output_tokens: number },
   *   meta: { degraded: boolean, reason?: string, source: 'jev'|'llmbrain' }
   * }>}
   */
  async decide(state, questions, options = {}) {
    // 1. Check if API key is present
    if (!this.apiKey) {
      return this._fallbackDecision(state, questions, 'missing-key');
    }

    // 2. Cost Governance: check DistributedTokenBucket budget ceiling
    const canAfford = await this._checkBudget();
    if (!canAfford) {
      console.warn('⚠️ [JevBrain] BUDGET_CEILING_REACHED — soft-degrading to LLMBrain fallback');
      return this._fallbackDecision(state, questions, 'budget');
    }

    if (!questions || typeof questions !== 'object' || typeof questions[Symbol.iterator] === 'function' || Array.isArray(questions)) {
      return this._fallbackDecision(state, {}, 'bad-request');
    }

    const model = options.model || this.model;
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    
    // Normalize questions schema for TypeSafe Jev API
    const normalizedQuestions = {};
    for (const [k, q] of Object.entries(questions)) {
      if (!q || typeof q !== 'object') continue;
      const clone = { ...q };
      if (clone.type === 'choice') {
        if (!clone.criteria && Array.isArray(clone.options)) {
          clone.criteria = Object.fromEntries(clone.options.map((opt) => [opt, opt]));
        } else if (Array.isArray(clone.criteria)) {
          clone.criteria = Object.fromEntries(clone.criteria.map((opt) => [opt, opt]));
        }
      } else if (clone.type === 'score') {
        if (!clone.criteria || !Array.isArray(clone.criteria) || clone.criteria.length === 0) {
          clone.criteria = ['minimal / none', 'low / mild', 'moderate / clear', 'high / extreme'];
        }
      }
      normalizedQuestions[k] = clone;
    }

    const body = {
      state,
      model,
      questions: normalizedQuestions,
    };

    let lastError = null;

    // 3. Retry Loop: 3 attempts with exponential backoff & jitter
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        // Handle Rate Limit (429) or Server Error (5xx)
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`Jev API HTTP ${res.status}`);
          if (attempt < MAX_ATTEMPTS - 1) {
            const waitMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            console.log(`⏳ [JevBrain] HTTP ${res.status} — retrying in ${Math.round(waitMs)}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
            await sleep(waitMs);
            continue;
          }
          break;
        }

        if (!res.ok) {
          clearTimeout(timer);
          const errText = await res.text().catch(() => 'unknown');
          console.warn(`⚠️ [JevBrain] API error ${res.status}: ${errText.slice(0, 150)}`);
          return this._fallbackDecision(state, questions, `http-${res.status}`);
        }

        const data = await res.json();
        if (!data || typeof data !== 'object' || !data.answers) {
          clearTimeout(timer);
          console.warn('⚠️ [JevBrain] Malformed response — missing answers field');
          return this._fallbackDecision(state, questions, 'bad-response');
        }

        const inputTokens = data.usage?.input_tokens || 0;
        const outputTokens = data.usage?.output_tokens || 0;
        this._recordUsage(inputTokens, outputTokens, model);

        return {
          answers: data.answers,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          meta: { degraded: false, source: 'jev' },
        };
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        const isTimeout = err?.name === 'AbortError' || err?.message?.includes('aborted');

        if (isTimeout) {
          console.warn(`⏳ [JevBrain] Request timed out after ${timeoutMs}ms`);
          return this._fallbackDecision(state, questions, 'timeout');
        }

        if (attempt < MAX_ATTEMPTS - 1) {
          const waitMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          console.log(`⏳ [JevBrain] Error: ${err.message} — retrying in ${Math.round(waitMs)}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
          await sleep(waitMs);
        }
      }
    }

    // All retries exhausted -> degrade gracefully
    const reason = lastError?.message?.includes('429') ? 'http-429' : 'http-5xx';
    return this._fallbackDecision(state, questions, reason);
  }

  // ─── Confidence Gate Helper ───────────────────────────────────

  /**
   * Evaluate confidence gate for an answer.
   * @param {{ confidence?: number, noul?: number }} answer
   * @param {Object} [options={}]
   * @param {number} [options.hi]
   * @param {number} [options.mid]
   * @param {string} [options.action] - Action key for lookup in confidenceThresholds
   * @returns {'act'|'review'|'skip'}
   */
  gate(answer, options = {}) {
    if (!answer) return 'skip';

    const conf = answer.confidence !== undefined ? answer.confidence : answer.noul;
    if (typeof conf !== 'number' || isNaN(conf)) return 'skip';

    const hi = options.hi ?? (options.action ? (this.confidenceThresholds[options.action] ?? 0.85) : 0.85);
    const mid = options.mid ?? (hi * 0.6);

    if (conf >= hi) return 'act';
    if (conf >= mid) return 'review';
    return 'skip';
  }

  // ─── Budget Governance (AD-42 mirror) ─────────────────────────

  /**
   * Verify whether the current daily budget allows a request.
   * Uses DistributedTokenBucket with day key 'jev:daily:YYYY-MM-DD'.
   * @private
   * @returns {Promise<boolean>}
   */
  async _checkBudget() {
    if (this.dailyBudgetUsd <= 0) return false;

    // Capacity: assuming ~$0.000024 per call, $1.00 = ~41,666 calls.
    // We scale capacity based on dailyBudgetUsd.
    const capacity = Math.max(100, Math.floor(this.dailyBudgetUsd / 0.000025));
    const today = new Date().toISOString().split('T')[0];
    const key = `jev:daily:${today}`;

    try {
      const res = await globalDistributedTokenBucket.consume(key, 1, {
        capacity,
        refillRate: 0,
        ttlSeconds: 86400,
      });
      return res.allowed;
    } catch {
      // In-memory or Redis failure shouldn't completely block calls unless budget=0
      return true;
    }
  }

  // ─── Fallback Handler ─────────────────────────────────────────

  /**
   * Degrade to LLMBrain or synthetic safe fallback.
   * @private
   */
  async _fallbackDecision(state, questions, reason) {
    const answers = {};

    // If consumer injected an LLMBrain instance and questions include relevance/consistency
    if (this.fallbackLLM) {
      for (const [qId, qDef] of Object.entries(questions)) {
        if (!qDef || typeof qDef !== 'object') continue;
        try {
          if (qId === 'relevance' && typeof this.fallbackLLM.scoreRelevance === 'function') {
            const tweetText = typeof state === 'string' ? state : state?.tweet || JSON.stringify(state);
            const keywords = state?.nicheKeywords || state?.niche || [];
            const scoreNum = await this.fallbackLLM.scoreRelevance(tweetText, Array.isArray(keywords) ? keywords : [String(keywords)]);
            answers[qId] = {
              type: 'score',
              score: Math.min(3, Math.floor(scoreNum / 25)),
              confidence: 0.5,
              rawScore: scoreNum,
            };
            continue;
          }
          if (qId === 'persona' && typeof this.fallbackLLM.checkPersonaConsistency === 'function') {
            const text = typeof state === 'string' ? state : state?.text || '';
            const res = await this.fallbackLLM.checkPersonaConsistency(text, state?.persona || {});
            answers[qId] = {
              type: 'noul',
              noul: res.consistent ? 1.0 : 0.0,
            };
            continue;
          }
        } catch {
          // Ignore fallback errors and continue to default null answers
        }
      }
    }

    // Default neutral answer structure for any unanswered questions
    for (const [qId, qDef] of Object.entries(questions)) {
      if (!qDef || typeof qDef !== 'object') continue;
      if (!answers[qId]) {
        if (qDef.type === 'choice') {
          let defaultChoice = 'ignore';
          if (qDef.criteria) {
            const keys = Array.isArray(qDef.criteria)
              ? qDef.criteria
              : Object.keys(qDef.criteria);
            if (keys.length > 0 && !keys.includes('ignore')) {
              defaultChoice = keys[0];
            }
          }
          answers[qId] = { type: 'choice', choice: defaultChoice, confidence: 0.0 };
        } else if (qDef.type === 'score') {
          answers[qId] = { type: 'score', score: 0, confidence: 0.0 };
        } else {
          answers[qId] = { type: 'noul', noul: 0.0 };
        }
      }
    }

    return {
      answers,
      usage: { input_tokens: 0, output_tokens: 0 },
      meta: { degraded: true, reason, source: 'llmbrain' },
    };
  }

  // ─── Usage Tracking ───────────────────────────────────────────

  _recordUsage(inputTokens, outputTokens, modelUsed = this.model) {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this._usageDate) {
      this._usageToday = { calls: 0, inputTokens: 0, outputTokens: 0 };
      this._usageDate = today;
    }
    this._usageToday.calls++;
    this._usageToday.inputTokens += inputTokens;
    this._usageToday.outputTokens += outputTokens;

    if (this.onUsage) {
      try { this.onUsage(modelUsed, inputTokens, outputTokens); } catch { /* noop */ }
    }
  }

  /**
   * Get today's usage statistics.
   */
  getUsageToday() {
    return { ...this._usageToday };
  }

  /**
   * Batch decide with concurrency control
   * @param {Array<{state: Object, questions: Object}>} requests - Array of {state, questions}
   * @param {Object} options - { concurrency = 10, onProgress, timeoutMs }
   * @returns {Promise<Array<{answers: Object, usage: Object, meta: Object}>>}
   */
  async batchDecide(requests, options = {}) {
    const { concurrency = 10, onProgress, timeoutMs = 30000 } = options;
    const results = [];
    const queue = [...requests.entries()];
    const inFlight = new Set();
    let completed = 0;

    const processItem = async ([index, { state, questions }]) => {
      try {
        const result = await Promise.race([
          this.decide(state, questions),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Jev timeout')), timeoutMs)
          ),
        ]);
        results[index] = result;
      } catch (err) {
        results[index] = {
          answers: null,
          usage: { degraded: true },
          meta: { error: err.message, degraded: true },
        };
      }
      completed++;
      if (onProgress) {
        onProgress({ completed, total: requests.length, index });
      }
    };

    while (queue.length > 0 || inFlight.size > 0) {
      while (inFlight.size < concurrency && queue.length > 0) {
        const item = queue.shift();
        const promise = processItem(item);
        inFlight.add(promise);
        promise.finally(() => inFlight.delete(promise));
      }
      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }

    return results;
  }

}
