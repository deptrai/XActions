// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Sentiment — Semantic Sentiment & Sarcasm Analysis via Jev
 *
 * Employs TypeSafe Jev (System One) primitives to evaluate:
 * - Sentiment nuance: enthusiastic, positive, neutral, skeptical, hostile.
 * - Sarcasm detection: detects praise masking underlying cynicism/criticism.
 * - Reputation impact score: 0 to 3 scale for CRM prioritization.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { JevBrain } from '../agents/jevBrain.js';

let _jevBrain = null;

function getJevBrain() {
  if (!_jevBrain) {
    _jevBrain = new JevBrain({});
  }
  return _jevBrain;
}

const SENTIMENT_SCORE_MAP = {
  enthusiastic: 1.0,
  positive: 0.6,
  neutral: 0.0,
  skeptical: -0.5,
  hostile: -1.0,
};

/**
 * Perform semantic sentiment analysis via Jev.
 *
 * @param {string} text
 * @param {object} [options={}]
 * @param {JevBrain} [options.brain] - Injected JevBrain instance (optional).
 * @returns {Promise<{
 *   score: number,
 *   label: 'enthusiastic'|'positive'|'neutral'|'skeptical'|'hostile',
 *   confidence: number,
 *   isSarcasm: boolean,
 *   sarcasmNoul: number,
 *   reputationImpact: number,
 *   source: 'jev'|'rules',
 *   degraded: boolean
 * }>}
 */
export async function analyzeJevSentiment(text, options = {}) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      score: 0,
      label: 'neutral',
      confidence: 0,
      isSarcasm: false,
      sarcasmNoul: 0,
      reputationImpact: 0,
      source: 'jev',
      degraded: false,
    };
  }

  const brain = options.brain || getJevBrain();

  const questions = {
    sentiment: {
      type: 'choice',
      instructions: 'What is the true sentiment of this tweet or message, taking into account sarcasm, slang, and context?',
      criteria: {
        enthusiastic: 'Extremely positive, passionate praise, excitement, championing the project',
        positive: 'Constructive, approving, supportive, favorable',
        neutral: 'Factual statement, query, balanced observation, neutral news',
        skeptical: 'Doubtful, questioning legitimacy, sarcastic criticism, suspicious',
        hostile: 'Overtly aggressive, angry, accusatory, FUD, hate, toxic attack',
      },
    },
    sarcasm: {
      type: 'noul',
      instructions: 'Is this message using sarcasm, irony, or mock praise to convey negative sentiment or ridicule?',
    },
    reputationImpact: {
      type: 'score',
      instructions: 'Rate the potential impact of this sentiment on brand/account reputation.',
      criteria: ['negligible', 'minor', 'moderate', 'significant'],
    },
  };

  const decision = await brain.decide({ text: text.slice(0, 1000) }, questions);

  // Handle degraded state -> Fallback to rule-based analysis
  if (decision.meta?.degraded) {
    const { analyzeSentiment } = await import('./sentiment.js');
    const fallback = await analyzeSentiment(text, { mode: 'rules' });
    let fallbackLabel = 'neutral';
    if (fallback.score >= 0.5) fallbackLabel = 'enthusiastic';
    else if (fallback.score > 0.05) fallbackLabel = 'positive';
    else if (fallback.score <= -0.5) fallbackLabel = 'hostile';
    else if (fallback.score < -0.05) fallbackLabel = 'skeptical';

    return {
      score: fallback.score,
      label: fallbackLabel,
      confidence: fallback.confidence,
      isSarcasm: false,
      sarcasmNoul: 0,
      reputationImpact: 1,
      source: 'rules',
      degraded: true,
    };
  }

  const sentimentAns = decision.answers?.sentiment || {};
  const sarcasmAns = decision.answers?.sarcasm || {};
  const reputationAns = decision.answers?.reputationImpact || {};

  const chosenLabel = sentimentAns.choice || 'neutral';
  const confidence = sentimentAns.confidence ?? 0;
  const sarcasmNoul = sarcasmAns.noul ?? 0;
  const isSarcasm = sarcasmNoul >= 0.50;
  const reputationImpact = reputationAns.score ?? 0;

  // Base score from label
  let score = SENTIMENT_SCORE_MAP[chosenLabel] ?? 0;

  // Sarcasm adjustment: if sarcasm is detected on positive/enthusiastic text, invert to negative
  if (isSarcasm && score > 0) {
    score = -Math.abs(score);
  }

  return {
    score,
    label: chosenLabel,
    confidence,
    isSarcasm,
    sarcasmNoul,
    reputationImpact,
    source: 'jev',
    degraded: false,
  };
}

/**
 * Batch analyze sentiments with strict limit to prevent budget overrun.
 *
 * @param {string[]} texts
 * @param {object} [options={}]
 * @returns {Promise<Array<object>>}
 */
export async function analyzeJevBatch(texts, options = {}) {
  const maxLimit = options.maxLimit ?? 50;
  const sliced = (texts || []).slice(0, maxLimit);
  const results = [];

  for (const t of sliced) {
    const res = await analyzeJevSentiment(t, options);
    results.push({ text: t.slice(0, 280), ...res });
  }

  return results;
}
