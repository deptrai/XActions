// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Streaming dataset artifact exporter for MCP tool results.
 *
 * Writes JSONL (default) or CSV artifacts with sanitized content to
 * XACTIONS_ARTIFACT_DIR or _bmad-output/datasets/.
 * Uses streaming writes to avoid OOM with large payloads.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sanitizeContent, escapeCsvCell } from '../utils/exporter.js';

/**
 * @typedef {Object} ArtifactOptions
 * @property {string} tool
 * @property {string} platform
 * @property {'jsonl' | 'csv'} [format]
 */

/**
 * Write a single line to a stream, awaiting drain if backpressure is signaled.
 *
 * @param {import('node:fs').WriteStream} stream
 * @param {string} line
 * @returns {Promise<void>}
 */
async function writeWithDrain(stream, line) {
  const ok = stream.write(line);
  if (!ok) {
    await new Promise((resolve) => stream.once('drain', resolve));
  }
}

/**
 * Finalize and close a write stream.
 *
 * @param {import('node:fs').WriteStream} stream
 * @returns {Promise<void>}
 */
function closeStream(stream) {
  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.end(() => resolve());
  });
}

/**
 * Safely deep-clone a record, falling back to shallow spread if
 * structuredClone throws (e.g. for functions, DOM nodes, class instances).
 *
 * @param {unknown} record
 * @returns {unknown}
 */
function safeClone(record) {
  if (!record || typeof record !== 'object') return record;
  try {
    return structuredClone(record);
  } catch {
    return { .../** @type {Record<string, unknown>} */ (record) };
  }
}

/**
 * @param {unknown[]} records
 * @param {ArtifactOptions} options
 * @returns {Promise<string>}
 */
export async function exportArtifact(records, options) {
  const { tool, platform, format = 'jsonl' } = options;
  const normalizedFormat = String(format).toLowerCase().trim() === 'csv' ? 'csv' : 'jsonl';

  const baseDir = process.env.XACTIONS_ARTIFACT_DIR || '_bmad-output/datasets/';
  const targetDir = path.resolve(process.cwd(), baseDir);
  await fs.mkdir(targetDir, { recursive: true });

  const timestamp = Date.now();
  const uuid = randomUUID();
  const fileName = `${tool}-${platform}-${timestamp}-${uuid}.${normalizedFormat}`;
  const filePath = path.join(targetDir, fileName);

  if (normalizedFormat === 'jsonl') {
    const stream = createWriteStream(filePath, 'utf-8');
    try {
      for (const record of records) {
        const clone = safeClone(record);
        if (clone && typeof clone === 'object') {
          const recordObj = /** @type {Record<string, unknown>} */ (clone);
          if (typeof recordObj.content === 'string') {
            recordObj.content = sanitizeContent(recordObj.content);
          }
        }
        const line = JSON.stringify(clone, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        );
        await writeWithDrain(stream, line + '\n');
      }
    } finally {
      await closeStream(stream);
    }
  } else {
    const header = buildCsvHeader(records);
    const stream = createWriteStream(filePath, 'utf-8');
    try {
      await writeWithDrain(stream, header.join(',') + '\n');
      for (const record of records) {
        const row = formatCsvRow(record, header);
        await writeWithDrain(stream, row + '\n');
      }
    } finally {
      await closeStream(stream);
    }
  }

  return filePath;
}

/**
 * Build the CSV header as the union of ALL records' keys, not just the first.
 * Preserves insertion order from the first record, then appends any extra
 * keys discovered in subsequent records.
 *
 * @param {unknown[]} records
 * @returns {string[]}
 */
function buildCsvHeader(records) {
  if (records.length === 0) return [];
  /** @type {Set<string>} */
  const keySet = new Set();
  for (const record of records) {
    if (record && typeof record === 'object') {
      for (const key of Object.keys(/** @type {Record<string, unknown>} */ (record))) {
        keySet.add(key);
      }
    }
  }
  if (keySet.size === 0) return ['value'];
  return Array.from(keySet);
}

/**
 * Format a record as a CSV row using the given header.
 *
 * @param {unknown} record
 * @param {string[]} header
 * @returns {string}
 */
function formatCsvRow(record, header) {
  return header
    .map((key) => {
      let value;
      if (record && typeof record === 'object') {
        value = /** @type {Record<string, unknown>} */ (record)[key];
      } else if (key === 'value') {
        value = record;
      } else {
        value = undefined;
      }

      if (key === 'content' && typeof value === 'string') {
        value = sanitizeContent(value);
      }

      return escapeCsvCell(value);
    })
    .join(',');
}
