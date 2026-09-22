// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions A2A — Semantic Intent Router via Jev
 * Disambiguates complex or natural-language task requests to select the best skill.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { JevBrain } from '../agents/jevBrain.js';
import { searchSkills, getSkillById } from './skillRegistry.js';

const MAX_CANDIDATES = 6;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.70;

let _jevBrain = null;

function getJevBrain() {
  if (!_jevBrain) {
    _jevBrain = new JevBrain({});
  }
  return _jevBrain;
}

/**
 * Route a task or natural language query to the most appropriate A2A skill.
 *
 * Flow:
 * 1. Filter candidates using keyword / category search (up to MAX_CANDIDATES).
 * 2. If exactly one strong candidate exists, return directly.
 * 3. If multiple candidates exist, call Jev Choice to disambiguate.
 * 4. Apply confidence gate (>= 0.70). If low confidence, request disambiguation.
 *
 * @param {string} query - The task or user query description.
 * @param {object} [options={}]
 * @param {Array<object>} [options.candidateSkills] - Explicit candidate list override.
 * @param {number} [options.confidenceThreshold=0.70]
 * @param {JevBrain} [options.brain] - Injected JevBrain instance (for tests / custom config).
 * @returns {Promise<{
 *   skillId: string|null,
 *   confidence: number,
 *   disambiguationNeeded: boolean,
 *   candidates: Array<{ id: string, name: string, description: string }>,
 *   source: 'direct'|'jev'|'fallback',
 *   degraded: boolean
 * }>}
 */
export async function routeTaskIntent(query, options = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return {
      skillId: null,
      confidence: 0,
      disambiguationNeeded: false,
      candidates: [],
      source: 'direct',
      degraded: false,
    };
  }

  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const brain = options.brain || getJevBrain();

  // 1. Determine candidate skills
  let candidates = options.candidateSkills || [];
  if (candidates.length === 0) {
    // Extract keywords by splitting on whitespace
    const words = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const seenIds = new Set();
    const collected = [];

    for (const w of words) {
      const matches = searchSkills(w);
      for (const m of matches) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          collected.push(m);
        }
      }
      if (collected.length >= MAX_CANDIDATES * 2) break;
    }

    candidates = collected.slice(0, MAX_CANDIDATES);
  } else {
    candidates = candidates.slice(0, MAX_CANDIDATES);
  }

  // If no candidates found at all, return null
  if (candidates.length === 0) {
    return {
      skillId: null,
      confidence: 0,
      disambiguationNeeded: false,
      candidates: [],
      source: 'direct',
      degraded: false,
    };
  }

  // If only 1 candidate found, return direct match
  if (candidates.length === 1) {
    return {
      skillId: candidates[0].id,
      confidence: 1.0,
      disambiguationNeeded: false,
      candidates,
      source: 'direct',
      degraded: false,
    };
  }

  // 2. Prepare Jev Choice criteria
  const criteria = {};
  for (const c of candidates) {
    // Create compact, descriptive summary for criteria
    const cleanId = c.id.replace(/^xactions\./, '');
    criteria[cleanId] = (c.description || c.name || cleanId).slice(0, 80);
  }
  criteria.unclear = 'None of the above or intent is too vague';

  const questions = {
    selectedSkill: {
      type: 'choice',
      instructions: `Which automated skill best accomplishes the task: "${query}"?`,
      criteria,
    },
  };

  const decision = await brain.decide({ taskQuery: query }, questions);

  // Handle degraded state (no key / budget / network error)
  if (decision.meta?.degraded) {
    return {
      skillId: candidates[0]?.id || null,
      confidence: 0.5,
      disambiguationNeeded: false,
      candidates,
      source: 'fallback',
      degraded: true,
    };
  }

  const answer = decision.answers?.selectedSkill || {};
  const choice = answer.choice;
  const confidence = answer.confidence ?? 0;

  // If Jev indicates unclear or confidence is too low
  if (choice === 'unclear' || confidence < threshold) {
    return {
      skillId: null,
      confidence,
      disambiguationNeeded: true,
      candidates,
      source: 'jev',
      degraded: false,
    };
  }

  // Match choice back to actual candidate skill ID
  const matched = candidates.find(
    (c) => c.id.replace(/^xactions\./, '') === choice || c.id === choice
  );

  return {
    skillId: matched ? matched.id : null,
    confidence,
    disambiguationNeeded: !matched,
    candidates,
    source: 'jev',
    degraded: false,
  };
}
