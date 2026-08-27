// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * In-memory dataset artifact exporter for MCP tool results.
 *
 * Writes JSONL (default) or CSV artifacts with sanitized content to
 * XACTIONS_ARTIFACT_DIR or _bmad-output/datasets/.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import fs from 'node:fs/promises';
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
    const lines = records.map((record) => {
      /** @type {Record<string, unknown> | unknown} */
      const clone =
        record && typeof record === 'object'
          ? structuredClone(/** @type {Record<string, unknown>} */ (record))
          : record;
      if (clone && typeof clone === 'object') {
        const recordObj = /** @type {Record<string, unknown>} */ (clone);
        if (typeof recordObj.content === 'string') {
          recordObj.content = sanitizeContent(recordObj.content);
        }
      }
      return JSON.stringify(clone, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );
    });
    await fs.writeFile(filePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
  } else {
    const header = buildCsvHeader(records);
    const rows = records.map((record) => formatCsvRow(record, header));
    const output = [header.join(','), ...rows].join('\n') + (records.length ? '\n' : '');
    await fs.writeFile(filePath, output, 'utf-8');
  }

  return filePath;
}

/**
 * Build the CSV header from the first record's keys.
 *
 * @param {unknown[]} records
 * @returns {string[]}
 */
function buildCsvHeader(records) {
  if (records.length === 0) return [];
  const first = records[0];
  if (first && typeof first === 'object') {
    return Object.keys(/** @type {Record<string, unknown>} */ (first));
  }
  return ['value'];
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
