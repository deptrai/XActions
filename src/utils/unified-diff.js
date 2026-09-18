// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * unified-diff — Generate unified-diff format patches for JSON config files.
 * Produces standard unified diff output targeting `canary-targets.json` style
 * flat JSON structures. Uses LCS-based line diff — no external dependencies.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

/**
 * Compute longest common subsequence between two arrays of lines.
 * Returns edit operations as [{ type: 'equal'|'add'|'del', line, aIdx, bIdx }].
 *
 * @param {string[]} aLines
 * @param {string[]} bLines
 * @returns {Array<{ type: 'equal'|'add'|'del', line: string, aIdx?: number, bIdx?: number }>}
 */
function computeLineDiff(aLines, bLines) {
  const m = aLines.length;
  const n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      ops.push({ type: 'equal', line: aLines[i], aIdx: i, bIdx: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', line: aLines[i], aIdx: i });
      i++;
    } else {
      ops.push({ type: 'add', line: bLines[j], bIdx: j });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: 'del', line: aLines[i], aIdx: i });
    i++;
  }
  while (j < n) {
    ops.push({ type: 'add', line: bLines[j], bIdx: j });
    j++;
  }
  return ops;
}

/**
 * Group diff operations into hunks with a configurable context size.
 * @param {Array} ops
 * @param {number} context
 * @returns {Array<{ aStart: number, aLen: number, bStart: number, bLen: number, lines: string[] }>}
 */
function buildHunks(ops, context = 3) {
  const changeIdx = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== 'equal') changeIdx.push(i);
  }
  if (changeIdx.length === 0) return [];

  const ranges = [];
  let start = Math.max(0, changeIdx[0] - context);
  let end = Math.min(ops.length - 1, changeIdx[0] + context);

  for (let k = 1; k < changeIdx.length; k++) {
    const idx = changeIdx[k];
    if (idx - end <= context) {
      end = Math.min(ops.length - 1, idx + context);
    } else {
      ranges.push({ start, end });
      start = Math.max(0, idx - context);
      end = Math.min(ops.length - 1, idx + context);
    }
  }
  ranges.push({ start, end });

  return ranges.map(({ start: s, end: e }) => {
    const slice = ops.slice(s, e + 1);
    let aStart = null;
    let bStart = null;
    let aLen = 0;
    let bLen = 0;
    const lines = slice.map((op) => {
      if (op.type === 'equal') {
        if (aStart === null) { aStart = op.aIdx; bStart = op.bIdx; }
        aLen++;
        bLen++;
        return ` ${op.line}`;
      }
      if (op.type === 'del') {
        if (aStart === null) { aStart = op.aIdx; bStart = op.bIdx !== undefined ? op.bIdx : op.aIdx; }
        aLen++;
        return `-${op.line}`;
      }
      if (aStart === null) { aStart = op.aIdx !== undefined ? op.aIdx : op.bIdx; bStart = op.bIdx; }
      bLen++;
      return `+${op.line}`;
    });
    return { aStart: aStart ?? 0, aLen, bStart: bStart ?? 0, bLen, lines };
  });
}

/**
 * Serialize a JSON object to canonical pretty-printed lines (2-space indent).
 * @param {object} json
 * @returns {string[]}
 */
function serializeJsonLines(json) {
  return JSON.stringify(json, null, 2).split('\n');
}

/**
 * Generate a unified-diff patch for a JSON config file.
 *
 * @param {string} filePath Path label used in the ---/+++ headers (e.g. "config/canary-targets.json")
 * @param {object} originalJson Original JSON object
 * @param {object} patchedJson Patched JSON object
 * @param {object} [opts]
 * @param {number} [opts.context=3] Lines of context around each hunk
 * @returns {string} Unified-diff text (empty string when inputs are identical)
 */
export function generateJsonUnifiedDiff(filePath, originalJson, patchedJson, opts = {}) {
  const context = typeof opts.context === 'number' ? opts.context : 3;
  const aLines = serializeJsonLines(originalJson);
  const bLines = serializeJsonLines(patchedJson);

  const ops = computeLineDiff(aLines, bLines);
  const hunks = buildHunks(ops, context);
  if (hunks.length === 0) return '';

  const out = [];
  out.push(`--- a/${filePath}`);
  out.push(`+++ b/${filePath}`);
  for (const h of hunks) {
    const aStartLabel = h.aLen === 0 ? h.aStart : h.aStart + 1;
    const bStartLabel = h.bLen === 0 ? h.bStart : h.bStart + 1;
    out.push(`@@ -${aStartLabel},${h.aLen} +${bStartLabel},${h.bLen} @@`);
    for (const line of h.lines) out.push(line);
  }
  return out.join('\n') + '\n';
}

export default { generateJsonUnifiedDiff };
