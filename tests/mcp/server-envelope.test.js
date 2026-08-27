// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MCP 3-Layer JSON Envelope — direct unit tests (Story 14.2)
 *
 * Tests wrapToolResult and wrapToolError without mocks, covering platform
 * detection, record extraction, 30-record preview, artifact export, and
 * error-envelope shape.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { wrapToolResult, wrapToolError } from '../../src/mcp/envelope.js';
import { RateLimitError } from '../../src/core/error-envelope.js';

let artifactDir;

beforeAll(async () => {
  artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xactions-envelope-'));
  process.env.XACTIONS_ARTIFACT_DIR = artifactDir;
});

afterAll(async () => {
  delete process.env.XACTIONS_ARTIFACT_DIR;
  await fs.rm(artifactDir, { recursive: true, force: true });
});

function makeRecords(count, prefix = 'record') {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    content: `${prefix} ${i + 1}`,
  }));
}

describe('wrapToolResult', () => {
  it('builds a 3-Layer JSON Envelope for a direct array result', async () => {
    const records = makeRecords(5);
    const envelope = await wrapToolResult('x_get_tweets', records, Date.now());

    assert.equal(envelope.success, true);
    assert.equal(envelope.platform, 'twitter');
    assert.equal(envelope.meta.tool, 'x_get_tweets');
    assert.equal(typeof envelope.meta.generatedAt, 'string');
    assert.equal(typeof envelope.meta.startedAt, 'string');
    assert.equal(typeof envelope.meta.durationMs, 'number');
    assert.equal(envelope.meta.totalRecords, 5);
    assert.equal(envelope.summary.count, 5);
    assert.equal(envelope.summary.hasMore, false);
    assert.ok(Array.isArray(envelope.summary.sampleIds));
    assert.equal(envelope.summary.sampleIds.length, 5);
    assert.ok(Array.isArray(envelope.data));
    assert.equal(envelope.data.length, 5);
    assert.equal(envelope.meta.datasetArtifactPath, undefined);
  });

  it('detects platform from args.platform', async () => {
    const envelope = await wrapToolResult('x_crawl_post', [], 0, { args: { platform: 'threads' } });
    assert.equal(envelope.platform, 'threads');
  });

  it('detects platform from rawResult.platform', async () => {
    const envelope = await wrapToolResult('x_crawl_post', { platform: 'bluesky' }, 0);
    assert.equal(envelope.platform, 'bluesky');
  });

  it('detects facebook from x_facebook_ tool prefix', async () => {
    const envelope = await wrapToolResult('x_facebook_search', [], 0);
    assert.equal(envelope.platform, 'facebook');
  });

  it('detects threads from x_threads_ tool prefix', async () => {
    const envelope = await wrapToolResult('x_threads_post', [], 0);
    assert.equal(envelope.platform, 'threads');
  });

  it('detects bluesky from x_bluesky_ tool prefix', async () => {
    const envelope = await wrapToolResult('x_bluesky_search', [], 0);
    assert.equal(envelope.platform, 'bluesky');
  });

  it('detects mastodon from x_mastodon_ tool prefix', async () => {
    const envelope = await wrapToolResult('x_mastodon_search', [], 0);
    assert.equal(envelope.platform, 'mastodon');
  });

  it('detects universal for x_actions_list', async () => {
    const envelope = await wrapToolResult('x_actions_list', {}, 0);
    assert.equal(envelope.platform, 'universal');
  });

  it('falls back to twitter for generic x_ prefix', async () => {
    const envelope = await wrapToolResult('x_unknown_tool', [], 0);
    assert.equal(envelope.platform, 'twitter');
  });

  it('falls back to unknown for non-x tools', async () => {
    const envelope = await wrapToolResult('some_other_tool', [], 0);
    assert.equal(envelope.platform, 'unknown');
  });

  it('extracts records from the comments field of an object', async () => {
    const comments = makeRecords(5, 'comment');
    const envelope = await wrapToolResult('x_crawl_comments_tree', { comments, extra: 'ignored' }, 0);
    assert.equal(envelope.summary.count, 5);
    assert.equal(envelope.data.length, 5);
  });

  it('extracts records from the posts field of an object', async () => {
    const posts = makeRecords(5, 'post');
    const envelope = await wrapToolResult('x_crawl_post', { posts }, 0);
    assert.equal(envelope.summary.count, 5);
    assert.equal(envelope.data.length, 5);
  });

  it('extracts records from the items field of an object', async () => {
    const items = makeRecords(5, 'item');
    const envelope = await wrapToolResult('x_get_tweets', { items }, 0);
    assert.equal(envelope.summary.count, 5);
    assert.equal(envelope.data.length, 5);
  });

  it('extracts records from the data field of an object', async () => {
    const data = makeRecords(5, 'item');
    const envelope = await wrapToolResult('x_get_tweets', { data }, 0);
    assert.equal(envelope.summary.count, 5);
    assert.equal(envelope.data.length, 5);
  });

  it('wraps a single non-array object as one record', async () => {
    const envelope = await wrapToolResult('x_crawl_post', { id: '1', content: 'hello' }, 0);
    assert.equal(envelope.summary.count, 1);
    assert.equal(envelope.data.length, 1);
    assert.equal(envelope.data[0].id, '1');
  });

  it('limits preview to 30 records and reports hasMore', async () => {
    const records = makeRecords(50);
    const envelope = await wrapToolResult('x_get_tweets', records, 0);
    assert.equal(envelope.summary.count, 50);
    assert.equal(envelope.data.length, 30);
    assert.equal(envelope.summary.hasMore, true);
  });

  it('does not claim hasMore when count equals the preview limit', async () => {
    const records = makeRecords(30);
    const envelope = await wrapToolResult('x_get_tweets', records, 0);
    assert.equal(envelope.data.length, 30);
    assert.equal(envelope.summary.hasMore, false);
  });

  it('exports a JSONL artifact when totalRecords > 100', async () => {
    const records = makeRecords(105);
    const envelope = await wrapToolResult('x_get_tweets', records, 0, { args: { platform: 'twitter' } });

    assert.equal(envelope.summary.count, 105);
    assert.equal(envelope.data.length, 30);
    assert.equal(envelope.summary.hasMore, true);
    assert.ok(typeof envelope.meta.datasetArtifactPath === 'string');
    assert.ok(envelope.meta.datasetArtifactPath.endsWith('.jsonl'));

    const fileContent = await fs.readFile(envelope.meta.datasetArtifactPath, 'utf-8');
    assert.ok(fileContent.endsWith('\n'));

    const lines = fileContent.trim().split('\n');
    assert.equal(lines.length, 105);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.equal(typeof parsed.id, 'string');
    }
  });

  it('exports a CSV artifact when format is csv and totalRecords > 100', async () => {
    const records = makeRecords(105);
    const envelope = await wrapToolResult('x_get_tweets', records, 0, { args: { platform: 'twitter' }, format: 'csv' });

    assert.ok(typeof envelope.meta.datasetArtifactPath === 'string');
    assert.ok(envelope.meta.datasetArtifactPath.endsWith('.csv'));

    const fileContent = await fs.readFile(envelope.meta.datasetArtifactPath, 'utf-8');
    const lines = fileContent.trim().split('\n');
    assert.equal(lines.length, 106); // header + 105 rows
    assert.ok(lines[0].split(',').includes('id'));
    assert.ok(lines[0].split(',').includes('content'));
  });
});

describe('wrapToolError', () => {
  it('produces a standard 3-Layer error envelope for an Error', () => {
    const err = new Error('something broke');
    const envelope = wrapToolError(err, 'x_get_tweets', { args: { platform: 'twitter' } });

    assert.equal(envelope.success, false);
    assert.equal(envelope.platform, 'twitter');
    assert.ok(Array.isArray(envelope.data));
    assert.equal(envelope.data.length, 0);
    assert.equal(envelope.summary.count, 0);
    assert.equal(envelope.summary.hasMore, false);
    assert.ok(envelope.error);
    assert.equal(envelope.error.code, 'XACT_5000');
    assert.equal(envelope.error.type, 'internal');
    assert.equal(envelope.error.message, 'something broke');
    assert.equal(envelope.error.statusCode, 500);
    assert.equal(envelope.error.isRetryable, false);
    assert.equal(typeof envelope.error.retryAfterMs, 'number');
    assert.equal(typeof envelope.error.retryAfter, 'number');
    assert.equal(envelope.error.suggestedAction, 'contact_support');
    assert.equal(envelope.error.platform, 'twitter');
  });

  it('preserves error.code when present on the Error', () => {
    const err = new Error('bad request');
    err.code = 'XACT_4001';
    const envelope = wrapToolError(err, 'x_crawl_post');
    assert.equal(envelope.error.code, 'XACT_4001');
  });

  it('wraps a PlatformError using its toEnvelope()', () => {
    const err = new RateLimitError({ retryAfterMs: 5000, platform: 'facebook' });
    const envelope = wrapToolError(err, 'x_facebook_search');

    assert.equal(envelope.platform, 'facebook');
    assert.equal(envelope.error.type, 'rate_limit');
    assert.equal(envelope.error.isRetryable, true);
    assert.equal(envelope.error.statusCode, 429);
    assert.equal(envelope.error.suggestedAction, 'rotate_proxy');
  });

  it('wraps a legacy MCP error result', () => {
    const legacy = { isError: true, content: [{ type: 'text', text: 'legacy failure' }] };
    const envelope = wrapToolError(legacy, 'x_legacy_tool', { args: {} });

    assert.equal(envelope.success, false);
    assert.equal(envelope.error.message, 'legacy failure');
    assert.equal(envelope.error.code, 'XACT_5000');
    assert.equal(envelope.error.type, 'internal');
  });

  it('wraps a plain string error', () => {
    const envelope = wrapToolError('plain string error', 'x_tool');
    assert.equal(envelope.error.message, 'plain string error');
    assert.equal(envelope.error.code, 'XACT_5000');
  });
});
