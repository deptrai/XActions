// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Jev Write-Path Gate (Story 43.2)
// Semantic quality + safety gate before any public write.
// by nichxbt

import { JevBrain } from '../agents/jevBrain.js';

/**
 * Semantic write-path gate — evaluates content quality + safety before posting.
 *
 * One `decide()` call with four questions:
 *   - `virality`  — Score 0-3: how likely this content will get engagement.
 *   - `clarity`   — Score 0-3: how clear and well-written the content is.
 *   - `onBrand`   — Score 0-3: how well it fits a professional/tech persona.
 *   - `toxic`     — Noul: probability this is harmful, offensive, or policy-violating.
 *
 * Verdict rules:
 *   - `toxic.noul >= 0.5` → `'block'` (absolute — never post toxic content)
 *   - avg(virality, clarity, onBrand) >= 2 → `'send'` (high quality, ship it)
 *   - otherwise → `'review'` (borderline — human or LLM review recommended)
 *   - degraded → `'review'` with all scores null (conservative — no signal)
 *
 * @param {string} content — text content to evaluate.
 * @param {Object} [options]
 * @param {JevBrain} [options.brain] — pre-built JevBrain.
 * @returns {Promise<{verdict: 'send'|'block'|'review', scores: {virality:number, clarity:number, onBrand:number}|null, toxic: {noul:number}|null, degraded: boolean}>}
 */
export async function writeGate(content, { brain } = {}) {
  if (!content || typeof content !== 'string' || !content.trim()) {
    return { verdict: 'block', scores: null, toxic: null, degraded: false };
  }

  const jev = brain || new JevBrain({});

  const decision = await jev.decide(
    { content: content.slice(0, 2000) }, // cap at 2k chars for token efficiency
    {
      virality: {
        type: 'score',
        instructions: 'How likely is this content to get meaningful engagement (likes, replies, shares) on X/Twitter?',
        criteria: ['unlikely to engage', 'low engagement', 'good engagement potential', 'high viral potential'],
      },
      clarity: {
        type: 'score',
        instructions: 'How clear, well-written, and readable is this content?',
        criteria: ['confusing or garbled', 'somewhat unclear', 'clear and readable', 'exceptionally clear'],
      },
      onBrand: {
        type: 'score',
        instructions: 'How well does this content fit a professional tech/AI thought-leader persona?',
        criteria: ['completely off-brand', 'weak fit', 'good fit', 'perfect fit'],
      },
      toxic: {
        type: 'noul',
        instructions: 'This content contains hate speech, harassment, harmful misinformation, or violates platform content policies',
      },
    },
  );

  if (decision.meta.degraded) {
    return { verdict: 'review', scores: null, toxic: null, degraded: true };
  }

  const virality = decision.answers.virality?.score ?? 0;
  const clarity = decision.answers.clarity?.score ?? 0;
  const onBrand = decision.answers.onBrand?.score ?? 0;
  const toxicNoul = decision.answers.toxic?.noul ?? 0;

  const scores = { virality, clarity, onBrand };
  const toxic = { noul: toxicNoul };

  if (toxicNoul >= 0.5) {
    return { verdict: 'block', scores, toxic, degraded: false };
  }

  const avgScore = (virality + clarity + onBrand) / 3;
  const verdict = avgScore >= 2 ? 'send' : 'review';
  return { verdict, scores, toxic, degraded: false };
}

/**
 * Quick toxicity check — single Noul question, no quality scores.
 * Used by xspace moderation and anywhere a lightweight safety check suffices.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {JevBrain} [options.brain]
 * @param {number} [options.threshold] — block if noul >= this (default 0.5).
 * @returns {Promise<{blocked: boolean, noul: number, degraded: boolean}>}
 */
export async function checkToxic(text, { brain, threshold = 0.5 } = {}) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { blocked: true, noul: 1, degraded: false };
  }

  const jev = brain || new JevBrain({});
  const decision = await jev.decide(
    { content: text.slice(0, 2000) },
    {
      toxic: {
        type: 'noul',
        instructions: 'This content contains hate speech, harassment, harmful misinformation, or violates platform content policies',
      },
    },
  );

  if (decision.meta.degraded) {
    return { blocked: false, noul: 0, degraded: true };
  }

  const noul = decision.answers.toxic?.noul ?? 0;
  return { blocked: noul >= threshold, noul, degraded: false };
}
