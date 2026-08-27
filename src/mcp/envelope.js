// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * 3-Layer JSON Envelope for MCP tool responses.
 *
 * Wraps every scrape/social tool result in a stable envelope with platform
 * detection, record extraction, 30-record preview, and automatic artifact
 * export for large payloads.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import { exportArtifact } from './artifact-exporter.js';

/**
 * @typedef {Object} ToolEnvelope
 * @property {boolean} success
 * @property {string} platform
 * @property {ToolMeta} meta
 * @property {unknown[]} data
 * @property {ToolSummary} summary
 * @property {import('../core/types.js').ErrorEnvelope} [error]
 */

/**
 * Success/error meta. For successful envelopes only {@link tool}, {@link durationMs},
 * {@link totalRecords} and optional {@link datasetArtifactPath} are present.
 * Error envelopes may keep additional diagnostic fields for backwards compatibility.
 *
 * @typedef {Object} ToolMeta
 * @property {string} tool
 * @property {number} durationMs
 * @property {number} totalRecords
 * @property {string} [platform]
 * @property {string} [generatedAt]
 * @property {string} [startedAt]
 * @property {string} [datasetArtifactPath]
 */

/**
 * @typedef {Object} ToolSummary
 * @property {number} count
 * @property {boolean} hasMore
 * @property {string[]} [sampleIds]
 */

const PREVIEW_LIMIT = 30;
const ARTIFACT_THRESHOLD = 100;

/** @type {string[]} */
const IDENTIFIER_PRIORITY = [
  'id',
  'externalId',
  'postId',
  'username',
  'handle',
  'url',
  'query',
];

/**
 * Detect the platform from tool arguments, raw result, or tool-name prefix.
 *
 * Priority:
 * 1. args.platform
 * 2. rawResult.platform
 * 3. tool-name prefix (x_facebook_*, x_threads_*, x_bluesky_*, x_mastodon_*,
 *    generic x_ defaults to twitter)
 * 4. 'unknown'
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} [args]
 * @param {unknown} [rawResult]
 * @returns {string}
 */
export function detectPlatform(toolName, args = {}, rawResult) {
  if (args?.platform && typeof args.platform === 'string') {
    return args.platform;
  }

  const result = /** @type {Record<string, unknown> | undefined} */ (
    rawResult && typeof rawResult === 'object' ? rawResult : undefined
  );
  if (result?.platform && typeof result.platform === 'string') {
    return result.platform;
  }

  if (toolName.startsWith('x_facebook_')) return 'facebook';
  if (toolName.startsWith('x_threads_')) return 'threads';
  if (toolName.startsWith('x_bluesky_')) return 'bluesky';
  if (toolName.startsWith('x_mastodon_')) return 'mastodon';
  if (toolName === 'x_actions_list') return 'universal';
  if (toolName === 'x_list_platforms') return 'universal';
  if (toolName.startsWith('x_')) return 'twitter';

  return 'unknown';
}

/**
 * Extract a flat array of records from a crawler/scraper result.
 *
 * Order: direct array, then comments, posts, items, data; a single
 * non-array object becomes a one-item array.
 *
 * @param {unknown} rawResult
 * @returns {unknown[]}
 */
function extractRecords(rawResult) {
  if (Array.isArray(rawResult)) {
    return rawResult;
  }

  if (rawResult && typeof rawResult === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (rawResult);

    for (const key of ['comments', 'posts', 'items', 'data']) {
      const value = obj[key];
      if (Array.isArray(value)) {
        return value;
      }
    }

    // Single non-array object.
    return [obj];
  }

  return [];
}

/**
 * Build sampleIds from the preview records. Up to 5 string identifiers are
 * collected, one per record, using the identifier priority list. Records with
 * no string identifier are omitted and not padded.
 *
 * @param {unknown[]} previewRecords
 * @returns {string[]}
 */
function buildSampleIds(previewRecords) {
  /** @type {string[]} */
  const sampleIds = [];

  for (const record of previewRecords) {
    if (sampleIds.length >= 5) break;
    if (!record || typeof record !== 'object') continue;

    const obj = /** @type {Record<string, unknown>} */ (record);
    for (const key of IDENTIFIER_PRIORITY) {
      const value = obj[key];
      if (typeof value === 'string' && value.length > 0) {
        sampleIds.push(value);
        break;
      }
    }
  }

  return sampleIds;
}

/**
 * Wrap a successful tool result in the 3-Layer JSON Envelope.
 *
 * @param {string} toolName
 * @param {unknown} rawResult
 * @param {number} startedAt
 * @param {Object} [options]
 * @param {Record<string, unknown>} [options.args]
 * @param {string} [options.format]
 * @returns {Promise<ToolEnvelope>}
 */
export async function wrapToolResult(toolName, rawResult, startedAt, options = {}) {
  const platform = detectPlatform(toolName, options.args, rawResult);
  const records = extractRecords(rawResult);
  const totalRecords = records.length;
  const data = records.slice(0, PREVIEW_LIMIT);
  const hasMore = totalRecords > data.length;

  const durationMs = Math.max(0, Date.now() - startedAt);

  // AC-2: summary.count is the number of records returned in data; sampleIds
  // are taken from the preview records using the identifier priority list.
  const sampleIds = buildSampleIds(data);

  /** @type {ToolMeta} */
  const meta = {
    tool: toolName,
    durationMs,
    totalRecords,
  };

  /** @type {ToolSummary} */
  const summary = {
    count: data.length,
    hasMore,
    ...(sampleIds.length > 0 ? { sampleIds } : {}),
  };

  if (totalRecords > ARTIFACT_THRESHOLD) {
    const artifactFormat =
      options.format || options.args?.artifactFormat || 'jsonl';
    try {
      meta.datasetArtifactPath = await exportArtifact(records, {
        tool: toolName,
        platform,
        format: /** @type {'jsonl' | 'csv'} */ (artifactFormat),
      });
    } catch (artifactErr) {
      // Edge Case: artifact write failure → XACT_5002, preserve data preview.
      /** @type {import('../core/types.js').ErrorEnvelope} */
      const errorEnvelope = {
        code: 'XACT_5002',
        type: ErrorTypes.INTERNAL,
        message: artifactErr instanceof Error ? artifactErr.message : String(artifactErr),
        statusCode: 500,
        isRetryable: false,
        retryAfterMs: 0,
        retryAfter: 0,
        suggestedAction: SuggestedActions.CONTACT_SUPPORT,
        platform,
      };

      return {
        success: false,
        platform,
        meta,
        data,
        summary,
        error: errorEnvelope,
      };
    }
  }

  return {
    success: true,
    platform,
    meta,
    data,
    summary,
  };
}

/**
 * Wrap an error in the standard 3-Layer JSON Envelope.
 *
 * @param {unknown} error
 * @param {string} toolName
 * @param {Object} [options]
 * @param {Record<string, unknown>} [options.args]
 * @param {number} [options.totalRecords]
 * @returns {ToolEnvelope}
 */
export function wrapToolError(error, toolName, options = {}) {
  const platform =
    options.args?.platform && typeof options.args.platform === 'string'
      ? options.args.platform
      : detectPlatform(toolName, options.args);

  /** @type {import('../core/types.js').ErrorEnvelope} */
  let errorEnvelope;

  if (error instanceof PlatformError) {
    errorEnvelope = error.toEnvelope();
  } else if (error instanceof Error) {
    errorEnvelope = {
      code: /** @type {any} */ (error).code || 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message: error.message,
      statusCode: 500,
      isRetryable: false,
      retryAfterMs: 0,
      retryAfter: 0,
      suggestedAction: SuggestedActions.CONTACT_SUPPORT,
      accountId: /** @type {any} */ (error).accountId,
      platform,
    };
  } else if (
    error &&
    typeof error === 'object' &&
    'isError' in error &&
    /** @type {any} */ (error).isError === true &&
    Array.isArray(/** @type {any} */ (error).content)
  ) {
    const legacyMessage = /** @type {any} */ (error).content[0]?.text || 'Unknown error';
    errorEnvelope = {
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message: legacyMessage,
      statusCode: 500,
      isRetryable: false,
      retryAfterMs: 0,
      retryAfter: 0,
      suggestedAction: SuggestedActions.CONTACT_SUPPORT,
      platform,
    };
  } else {
    const message = typeof error === 'string' ? error : 'Unknown error';
    errorEnvelope = {
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message,
      statusCode: 500,
      isRetryable: false,
      retryAfterMs: 0,
      retryAfter: 0,
      suggestedAction: SuggestedActions.CONTACT_SUPPORT,
      platform,
    };
  }

  const now = new Date().toISOString();

  return {
    success: false,
    platform,
    meta: {
      tool: toolName,
      platform,
      generatedAt: now,
      startedAt: now,
      durationMs: 0,
      totalRecords: options.totalRecords ?? 0,
    },
    data: [],
    summary: {
      count: 0,
      hasMore: false,
    },
    error: errorEnvelope,
  };
}
