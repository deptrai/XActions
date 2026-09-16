// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ContentTransformer — Cross-platform content adapter and thread splitter (Story 30.2).
 *
 * Adapts unified posts (text + media + metadata) to meet platform-specific constraints:
 * - Character limits: Twitter (280), Bluesky (300), Mastodon (500), Threads (500).
 * - Thread splitting: Splits long posts into numbered threads (1/n, 2/n) using
 *   deterministic token-aware boundaries (paragraphs -> sentences -> words)
 *   while keeping URLs, mentions, and hashtags intact.
 * - Media adapting: Distributes media across thread parts per platform limits
 *   (Twitter/Bluesky/Mastodon: max 4 images, Threads: max 10 images).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../core/error-envelope.js';

/**
 * Standard character limits per platform.
 * @type {Record<string, number>}
 */
export const PLATFORM_LIMITS = {
  twitter: 280,
  x: 280,
  bluesky: 300,
  bsky: 300,
  mastodon: 500,
  masto: 500,
  threads: 500,
};

/**
 * Maximum media attachments per single post per platform.
 * @type {Record<string, number>}
 */
export const PLATFORM_MEDIA_LIMITS = {
  twitter: 4,
  x: 4,
  bluesky: 4,
  bsky: 4,
  mastodon: 4,
  masto: 4,
  threads: 10,
};

/**
 * Regex for atomic tokens that must never be split across chunks.
 * - URLs: http:// or https://
 * - Mentions: @username
 * - Hashtags: #tag
 */
const ATOMIC_TOKEN_REGEX = /(?:https?:\/\/[^\s]+|@[a-zA-Z0-9_.-]+|#[^\s#]+)/g;

/**
 * Normalize platform string to lowercase canonical name.
 * @param {string} platform
 * @returns {string}
 */
export function normalizePlatform(platform) {
  if (!platform || typeof platform !== 'string') return 'twitter';
  const clean = platform.trim().toLowerCase();
  if (clean === 'x') return 'twitter';
  if (clean === 'bsky') return 'bluesky';
  if (clean === 'masto') return 'mastodon';
  return clean;
}

/**
 * Split text into tokens/segments (preserving spaces and atomic tokens).
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeText(text) {
  // Split into paragraphs first, then words, keeping whitespace attached
  return text.split(/(?<=\s+)/);
}

/**
 * Core text splitting logic for a specific character limit.
 *
 * @param {string} text - Source text
 * @param {Object} [options={}]
 * @param {number} [options.maxChars=280] - Maximum allowed characters per chunk
 * @param {string} [options.platform='twitter'] - Platform identifier
 * @param {boolean} [options.numbering=true] - Whether to prefix with "i/total " when total > 1
 * @param {string} [options.prefixTemplate='{index}/{total} '] - Template for numbering
 * @returns {Array<{ text: string, index: number, total: number, charCount: number }>}
 */
export function splitText(text, options = {}) {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) {
    return [{ text: '', index: 1, total: 1, charCount: 0 }];
  }

  const platform = normalizePlatform(options.platform);
  const maxChars = Number(options.maxChars) || PLATFORM_LIMITS[platform] || 280;
  const numbering = options.numbering !== false;

  // If text already fits in 1 post, return as-is with no numbering prefix
  if (source.length <= maxChars) {
    return [{
      text: source,
      index: 1,
      total: 1,
      charCount: source.length,
    }];
  }

  // Iteratively determine chunks with proper numbering headroom
  // Start with an estimated total of parts
  let estimatedTotal = Math.max(2, Math.ceil(source.length / (maxChars - 10)));
  let chunks = [];

  // Helper to test if a token is atomic
  const isAtomicToken = (str) => {
    return /^https?:\/\/[^\s]+$/.test(str) || /^@[a-zA-Z0-9_.-]+$/.test(str) || /^#[^\s#]+$/.test(str);
  };

  // Helper to perform a split pass with a given total
  const performSplit = (totalTarget) => {
    const result = [];
    // Max prefix length for totalTarget, e.g. "99/99 " = 6 chars
    const samplePrefix = `${totalTarget}/${totalTarget} `;
    const budget = maxChars - (numbering ? samplePrefix.length : 0);

    if (budget <= 10) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `maxChars (${maxChars}) too small to fit thread numbering headroom`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    // Split text hierarchically:
    // 1. Paragraphs (\n\n+)
    // 2. Sentences (. | ? | ! followed by space)
    // 3. Words (whitespace)
    const paragraphs = source.split(/(?<=\n\n+)/);
    let currentChunk = '';

    for (const para of paragraphs) {
      if ((currentChunk + para).length <= budget) {
        currentChunk += para;
        continue;
      }

      // Paragraph exceeds budget -> split into sentences
      const sentences = para.split(/(?<=[.?!])\s+/);
      for (const sent of sentences) {
        if ((currentChunk + sent).length <= budget) {
          currentChunk += (currentChunk && !currentChunk.endsWith('\n') && !currentChunk.endsWith(' ') ? ' ' : '') + sent;
          continue;
        }

        // Sentence exceeds budget -> split into words
        const words = sent.split(/\s+/).filter(Boolean);
        for (const word of words) {
          // Check if a single atomic token exceeds budget
          if (word.length > budget) {
            throw new PlatformError({
              type: ErrorTypes.INVALID_ARGS,
              code: 'XACT_4001',
              message: `Single token "${word.slice(0, 30)}..." (${word.length} chars) exceeds platform limit (${budget} chars)`,
              statusCode: 400,
              suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
              platform,
            });
          }

          const separator = currentChunk ? ' ' : '';
          if ((currentChunk + separator + word).length <= budget) {
            currentChunk += separator + word;
          } else {
            if (currentChunk.trim()) {
              result.push(currentChunk.trim());
            }
            currentChunk = word;
          }
        }
      }
    }

    if (currentChunk.trim()) {
      result.push(currentChunk.trim());
    }

    return result;
  };

  chunks = performSplit(estimatedTotal);

  // If actual chunks length differs from estimate, re-run with exact total
  if (chunks.length !== estimatedTotal) {
    estimatedTotal = chunks.length;
    chunks = performSplit(estimatedTotal);
  }

  const finalTotal = chunks.length;

  return chunks.map((chunkText, idx) => {
    const index = idx + 1;
    const formattedText = numbering && finalTotal > 1
      ? `${index}/${finalTotal} ${chunkText}`
      : chunkText;

    return {
      text: formattedText,
      index,
      total: finalTotal,
      charCount: formattedText.length,
    };
  });
}

/**
 * Chunk media items to respect platform-specific attachment limits.
 *
 * @param {Array<any>} mediaList - List of media URLs, IDs, or descriptors
 * @param {string} platform - Target platform
 * @returns {Array<Array<any>>}
 */
export function chunkMedia(mediaList = [], platform = 'twitter') {
  if (!Array.isArray(mediaList) || mediaList.length === 0) {
    return [];
  }

  const normalized = normalizePlatform(platform);
  const limit = PLATFORM_MEDIA_LIMITS[normalized] || 4;
  const chunks = [];

  for (let i = 0; i < mediaList.length; i += limit) {
    chunks.push(mediaList.slice(i, i + limit));
  }

  return chunks;
}

/**
 * Transformed post object ready for execution.
 * @typedef {Object} TransformedPost
 * @property {string} platform - Target platform
 * @property {number} index - 1-based index in the thread
 * @property {number} total - Total posts in the thread
 * @property {string} text - Formatted text for this post
 * @property {Array<any>} media - Media items attached to this post
 * @property {string} [altText] - Accessibility description
 * @property {string[]} [hashtags] - Extracted or attached hashtags
 * @property {Object} metadata - Transformation metrics
 */

/**
 * ContentTransformer main class.
 */
export class ContentTransformer {
  /**
   * Adapt a unified post payload for a specific target platform.
   *
   * @param {Object} source
   * @param {string} [source.text] - Post text/content
   * @param {string} [source.content] - Alias for text
   * @param {Array<any>} [source.media] - Media URLs or IDs
   * @param {Array<any>} [source.mediaIds] - Alias for media
   * @param {string} [source.altText] - Accessibility alt text
   * @param {string[]} [source.hashtags] - Optional hashtags to append
   * @param {string} platform - Target platform name
   * @param {Object} [options={}] - Transformation options
   * @param {boolean} [options.autoThread=true] - Whether to split into thread if too long
   * @returns {TransformedPost[]}
   */
  static transform(source = {}, platform = 'twitter', options = {}) {
    const rawText = source.text || source.content || '';
    const rawMedia = source.media || source.mediaIds || [];
    const normalizedPlatform = normalizePlatform(platform);
    const maxChars = options.maxChars || PLATFORM_LIMITS[normalizedPlatform] || 280;
    const autoThread = options.autoThread !== false;

    // 1. Text splitting
    let textChunks;
    if (autoThread) {
      textChunks = splitText(rawText, {
        maxChars,
        platform: normalizedPlatform,
        numbering: options.numbering !== false,
      });
    } else {
      textChunks = [{
        text: rawText,
        index: 1,
        total: 1,
        charCount: rawText.length,
      }];
    }

    // 2. Media distribution
    const mediaBatches = chunkMedia(rawMedia, normalizedPlatform);

    // 3. Align text chunks and media batches
    const totalPosts = Math.max(textChunks.length, mediaBatches.length || 1);
    const result = [];

    for (let i = 0; i < totalPosts; i++) {
      const textItem = textChunks[i];
      const mediaItem = mediaBatches[i] || [];
      const index = i + 1;

      const postText = textItem ? textItem.text : (totalPosts > 1 ? `${index}/${totalPosts}` : '');

      result.push({
        platform: normalizedPlatform,
        index,
        total: totalPosts,
        text: postText,
        media: mediaItem,
        mediaIds: mediaItem,
        altText: source.altText || undefined,
        hashtags: source.hashtags || undefined,
        metadata: {
          charCount: postText.length,
          sourceLength: rawText.length,
          maxLimit: maxChars,
          isThreadPart: totalPosts > 1,
        },
      });
    }

    return result;
  }

  /**
   * Adapt content across multiple platforms simultaneously.
   *
   * @param {Object} source - Post content
   * @param {string[]} platforms - Array of target platform names
   * @param {Object} [options={}] - Options
   * @returns {Record<string, TransformedPost[]>}
   */
  static transformForAll(source = {}, platforms = [], options = {}) {
    /** @type {Record<string, TransformedPost[]>} */
    const transformed = {};
    for (const p of platforms) {
      const canonical = normalizePlatform(p);
      transformed[canonical] = ContentTransformer.transform(source, canonical, options);
    }
    return transformed;
  }
}
