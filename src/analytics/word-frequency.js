// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Word Frequency Analyzer — N-gram keyword & hashtag extraction.
 *
 * Pure JavaScript, zero external NLP dependencies.
 * Supports Vietnamese compound-word recovery via bigram-of-syllables.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Stopword loading
// ============================================================================

/** @type {Map<string, Set<string>>} */
const STOPWORDS = new Map();

/**
 * Load a stopwords file into a Set.
 * @param {string} lang — language code (e.g. 'vi', 'en')
 * @returns {Set<string> | null} loaded set, or null if file missing
 */
function loadStopwords(lang) {
  if (STOPWORDS.has(lang)) return /** @type {Set<string>} */ (STOPWORDS.get(lang));
  try {
    const filePath = join(__dirname, 'stopwords', `${lang}.txt`);
    const text = readFileSync(filePath, 'utf-8');
    const words = new Set(
      text.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0)
    );
    STOPWORDS.set(lang, words);
    return words;
  } catch {
    return null;
  }
}

// ============================================================================
// Hashtag extraction
// ============================================================================

const HASHTAG_RE = /#(?=[\p{L}])[\p{L}\p{N}_]+/gu;

/**
 * Extract hashtags from raw text (before tokenization strips '#').
 * @param {string} text
 * @returns {string[]} lowercased, NFC-normalized hashtag strings (no '#')
 */
function extractHashtags(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(HASHTAG_RE) || [];
  return matches.map(m => m.slice(1).normalize('NFC').toLowerCase());
}

// ============================================================================
// Tokenization
// ============================================================================

const PUNCT_RE = /[.,;:!?'"()\[\]{}<>«»—–\-\/\\|@$%^&*+=~`#]/g;

/**
 * Tokenize text into syllable-level tokens.
 * NFC-normalizes and lowercases. Strips punctuation.
 * @param {string} text
 * @returns {string[]} array of normalized tokens
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(PUNCT_RE, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

// ============================================================================
// Frequency counting
// ============================================================================

/**
 * @typedef {Object} KeywordFrequencyResult
 * @property {Array<{term: string, count: number}>} unigrams
 * @property {Array<{term: string, count: number}>} bigrams
 * @property {Array<{tag: string, count: number}>} hashtags
 * @property {number} totalTokens
 * @property {string} lang
 */

/**
 * Extract keyword and hashtag frequency from content items.
 *
 * @param {Array<{content?: string}>} items -- PostItem[] or CommentItem[] (or any objects with a `content` string field)
 * @param {Object} [options]
 * @param {number} [options.minLength] -- minimum token length to include (clamped to >= 1)
 * @param {number} [options.topN] -- max results per category (default 10, clamped to >= 0)
 * @param {string} [options.lang] -- language code for stopwords ('vi', 'en'; unsupported langs skip filtering)
 * @param {boolean} [options.removeStopwords] -- whether to filter stopwords (default true)
 * @returns {KeywordFrequencyResult}
 */
export function extractKeywordFrequency(items, options = {}) {
  const minLength = Math.max(1, Math.floor(options.minLength ?? 1));
  const topN = Math.max(0, Math.floor(options.topN ?? 10));
  const lang = options.lang || 'auto';
  const removeStopwords = options.removeStopwords !== false;

  const stopwordSet = removeStopwords ? loadStopwords(lang) : null;

  /** @type {Map<string, number>} */
  const unigramCounts = new Map();
  /** @type {Map<string, number>} */
  const bigramCounts = new Map();
  /** @type {Map<string, number>} */
  const hashtagCounts = new Map();
  let totalTokens = 0;

  if (!Array.isArray(items) || items.length === 0) {
    return { unigrams: [], bigrams: [], hashtags: [], totalTokens: 0, lang };
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const content = item.content;
    if (typeof content !== 'string' || content.trim().length === 0) continue;

    // Extract hashtags from raw text before tokenization
    for (const tag of extractHashtags(content)) {
      hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
    }

    // Tokenize into syllables
    const tokens = tokenize(content);
    if (tokens.length === 0) continue;

    // Build filtered token stream and track stopword positions
    /** @type {string[]} */
    const filteredTokens = [];
    /** @type {Set<number>} indices in `tokens` that were stopwords */
    const stopwordIndices = new Set();

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (stopwordSet && stopwordSet.has(token)) {
        stopwordIndices.add(i);
        continue; // skip stopword
      }
      if (token.length < minLength) {
        continue; // skip short tokens but don't break bigram chain for minLength
      }
      filteredTokens.push(token);
    }

    totalTokens += filteredTokens.length;

    // Unigrams — count each filtered token
    for (const token of filteredTokens) {
      unigramCounts.set(token, (unigramCounts.get(token) || 0) + 1);
    }

    // Bigrams — build from filtered tokens but must not span stopwords or punctuation
    // We track the original token index to check for stopword gaps
    /** @type {number[]} */
    const filteredOrigIndices = [];
    for (let i = 0; i < tokens.length; i++) {
      if (stopwordIndices.has(i)) continue;
      if (tokens[i].length < minLength) continue;
      filteredOrigIndices.push(i);
    }

    for (let j = 0; j < filteredTokens.length - 1; j++) {
      const origIdx1 = filteredOrigIndices[j];
      const origIdx2 = filteredOrigIndices[j + 1];
      // Check no stopword between them in original stream
      let hasStopwordBetween = false;
      for (let k = origIdx1 + 1; k < origIdx2; k++) {
        if (stopwordIndices.has(k)) {
          hasStopwordBetween = true;
          break;
        }
      }
      if (hasStopwordBetween) continue;

      const bigram = `${filteredTokens[j]} ${filteredTokens[j + 1]}`;
      bigramCounts.set(bigram, (bigramCounts.get(bigram) || 0) + 1);
    }
  }

  // Deterministic sort: count desc, term asc
  const sortEntries = (/** @type {Map<string, number>} */ map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topN)
      .map(([term, count]) => ({ term, count }));

  const sortHashtags = (/** @type {Map<string, number>} */ map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topN)
      .map(([tag, count]) => ({ tag, count }));

  return {
    unigrams: sortEntries(unigramCounts),
    bigrams: sortEntries(bigramCounts),
    hashtags: sortHashtags(hashtagCounts),
    totalTokens,
    lang,
  };
}
