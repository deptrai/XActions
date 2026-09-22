// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Example Plugin: Content Moderation
// Filters inappropriate content from agent responses and optionally from
// incoming transcriptions.
// =============================================================================

import type { Plugin, PluginContext } from '../../packages/core/src/plugins/types'
import type { TranscriptionEvent } from '../../packages/core/src/types'

/** Words/patterns that trigger content filtering. Customize for your use case. */
const DEFAULT_BLOCKED_PATTERNS = [
  /\b(offensive|inappropriate|harmful)\b/i,
]

export interface ModerationOptions {
  /** Custom blocked patterns (defaults to a basic built-in list) */
  blockedPatterns?: RegExp[]
  /** Whether to also filter incoming transcriptions (default: false) */
  filterInput?: boolean
  /** Replacement response when content is blocked (default: null = veto) */
  replacement?: string | null
  /** Optional Jev toxicity checker — async semantic check (Story 43.2).
   * When provided, isBlockedAsync uses it; isBlocked stays regex-only. */
  jevChecker?: (text: string) => Promise<{ blocked: boolean; noul: number; degraded: boolean }>
}

export function createModerationPlugin(options: ModerationOptions = {}): Plugin {
  const patterns = options.blockedPatterns ?? DEFAULT_BLOCKED_PATTERNS
  const filterInput = options.filterInput ?? false
  const replacement = options.replacement ?? null

  let context: PluginContext

  function isBlocked(text: string): boolean {
    return patterns.some((p) => p.test(text))
  }

  /**
   * Async semantic toxicity check via injected jevChecker.
   * Returns true if Jev flags the text as toxic (noul >= threshold).
   * Falls back to regex isBlocked when jevChecker is not configured or degraded.
   */
  async function isBlockedAsync(text: string): Promise<boolean> {
    if (isBlocked(text)) return true // regex catch first (fast)
    if (!options.jevChecker) return false
    try {
      const result = await options.jevChecker(text)
      if (result.degraded) return false // conservative — Jev down → don't block
      return result.blocked
    } catch {
      return false // checker error → don't block
    }
  }

  return {
    name: 'content-moderation',
    version: '1.0.0',
    description: 'Filters inappropriate content from responses',

    async onInit(ctx) {
      context = ctx
      context.log('info', `Moderation plugin initialized with ${patterns.length} pattern(s)`)
    },

    async onResponse(text: string): Promise<string | null> {
      if (isBlocked(text)) {
        context.log('warn', 'Response blocked by moderation filter', { text: text.slice(0, 100) })
        return replacement // null = veto the response entirely
      }
      return text
    },

    async onTranscription(result: TranscriptionEvent): Promise<TranscriptionEvent | null> {
      if (filterInput && isBlocked(result.text)) {
        context.log('warn', 'Transcription blocked by moderation filter', {
          speaker: result.speaker,
          text: result.text.slice(0, 100),
        })
        return null
      }
      return result
    },
  }
}
