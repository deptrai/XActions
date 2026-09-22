// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Intelligence – Sentiment Detection
// =============================================================================

import type { Sentiment } from '../types'

const POSITIVE_PATTERN =
  /\b(great|awesome|love|amazing|excellent|fantastic|wonderful|thanks|thank you|agree|yes|exactly|perfect|brilliant|cool|nice)\b/

const NEGATIVE_PATTERN =
  /\b(terrible|awful|hate|stupid|ridiculous|annoying|frustrating|wrong|disagree|no way|nonsense|horrible|sucks|worst)\b/

const FRUSTRATED_PATTERN =
  /\b(can't believe|sick of|tired of|fed up|give me a break|seriously|come on|enough)\b/

const QUESTION_STARTERS =
  /^(what|how|why|when|where|who|which|can|could|would|do|does|is|are|will|should|have|has)\b/

/**
 * Lightweight, keyword + pattern-based sentiment detection.
 * No LLM call required — runs synchronously.
 */
export function detectSentiment(text: string): Sentiment {
  const lower = text.toLowerCase().trim()

  // Question detection
  if (lower.includes('?') || QUESTION_STARTERS.test(lower)) {
    return 'question'
  }

  // Frustrated signals (check before generic negative)
  if (FRUSTRATED_PATTERN.test(lower)) return 'frustrated'

  // Excited signals (ALL CAPS, repeated exclamation marks)
  const letters = text.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 10 && letters === letters.toUpperCase()) return 'excited'
  if ((text.match(/!/g) || []).length >= 2) return 'excited'

  // Positive signals
  if (POSITIVE_PATTERN.test(lower)) return 'positive'

  // Negative signals
  if (NEGATIVE_PATTERN.test(lower)) return 'negative'

  return 'neutral'
}

export interface JevSentimentOptions {
  /** Optional custom Jev or AI classifier function */
  jevClassifier?: (text: string) => Promise<{ sentiment: Sentiment; confidence: number } | null>
  /** Timeout in ms before racing falls back to regex (default: 400ms) */
  timeoutMs?: number
  /** Confidence threshold for accepting Jev classification (default: 0.65) */
  confidenceThreshold?: number
}

export interface SentimentAnalysisResult {
  sentiment: Sentiment
  confidence: number
  source: 'jev' | 'rules'
}

/**
 * Dual-Speed Non-Blocking Sentiment Detection (Story 44.3).
 *
 * Runs a fast-path regex check while racing an injected Jev classifier
 * against a 400ms timeout window.
 * If Jev succeeds within budget with confidence >= threshold, its result is returned.
 * If Jev times out, throws, or yields low confidence, instantly falls back to
 * synchronous pattern-based detection.
 *
 * Voice pipeline audio loop NEVER blocks or crashes.
 */
export async function detectSentimentAsync(
  text: string,
  options: JevSentimentOptions = {}
): Promise<SentimentAnalysisResult> {
  const defaultSentiment = detectSentiment(text)

  if (!options.jevClassifier || !text || typeof text !== 'string' || !text.trim()) {
    return {
      sentiment: defaultSentiment,
      confidence: 1.0,
      source: 'rules',
    }
  }

  const timeoutMs = options.timeoutMs ?? 400
  const threshold = options.confidenceThreshold ?? 0.65

  try {
    const jevPromise = options.jevClassifier(text).catch(() => null)
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    )

    const jevResult = await Promise.race([jevPromise, timeoutPromise])

    if (jevResult && jevResult.confidence >= threshold) {
      return {
        sentiment: jevResult.sentiment,
        confidence: jevResult.confidence,
        source: 'jev',
      }
    }
  } catch {
    // Fail-safe: ignore errors and return synchronous baseline
  }

  return {
    sentiment: defaultSentiment,
    confidence: 0.8,
    source: 'rules',
  }
}
