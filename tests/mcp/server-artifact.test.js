// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Artifact exporter tests (Story 14.2)
 *
 * Tests exportArtifact with JSONL and CSV output, large payloads, streaming
 * backpressure, sparse CSV headers, and newline sanitization. No mocks — real
 * files are written and cleaned up.
 */

import { describe, it, beforeAll, afterAll, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exportArtifact } from '../../src/mcp/artifact-exporter.js';

let baseDir;

beforeAll(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xactions-artifact-'));
  process.env.XACTIONS_ARTIFACT_DIR = baseDir;
});

afterEach(async () => {
  for (const entry of await fs.readdir(baseDir).catch(() => [])) {
    await fs.rm(path.join(baseDir, entry), { recursive: true, force: true });
  }
});

afterAll(async () => {
  delete process.env.XACTIONS_ARTIFACT_DIR;
  await fs.rm(baseDir, { recursive: true, force: true });
});

function makeRecords(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    content: `line${i + 1}\nline${i + 2}\r\nline${i + 3}\rline${i + 4}`,
  }));
}

describe('exportArtifact', () => {
  it('exports >100 records as a valid JSONL file', async () => {
    const records = makeRecords(101);
    const filePath = await exportArtifact(records, { tool: 'x_test', platform: 'twitter', format: 'jsonl' });

    assert.ok(filePath.endsWith('.jsonl'));
    assert.ok((await fs.stat(filePath)).isFile());

    const content = await fs.readFile(filePath, 'utf-8');
    assert.ok(content.endsWith('\n'));

    const lines = content.trim().split('\n');
    assert.equal(lines.length, 101);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.equal(typeof parsed.id, 'string');
      assert.equal(typeof parsed.content, 'string');
      assert.ok(!parsed.content.includes('\n') && !parsed.content.includes('\r'));
      assert.ok(parsed.content.includes(' '));
    }
  });

  it('sanitizes content newlines in JSONL output', async () => {
    const records = [{ id: '1', content: 'a\nb\r\nc\rd' }];
    const filePath = await exportArtifact(records, { tool: 'x_test', platform: 'twitter' });

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 1);

    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.content, 'a b c d');
  });

  it('streams a large JSONL file line-by-line without OOM', async () => {
    const records = makeRecords(1000);
    const filePath = await exportArtifact(records, { tool: 'x_test', platform: 'twitter', format: 'jsonl' });

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 1000);

    const first = JSON.parse(lines[0]);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(first.id, '1');
    assert.equal(last.id, '1000');
  });

  it('does not mutate the original records when sanitizing', async () => {
    const records = [{ id: '1', content: 'a\nb' }];
    await exportArtifact(records, { tool: 'x_test', platform: 'twitter', format: 'jsonl' });

    assert.equal(records[0].content, 'a\nb');
  });

  it('exports records as a valid CSV file', async () => {
    const records = makeRecords(101);
    const filePath = await exportArtifact(records, { tool: 'x_test', platform: 'twitter', format: 'csv' });

    assert.ok(filePath.endsWith('.csv'));
    assert.ok((await fs.stat(filePath)).isFile());

    const content = await fs.readFile(filePath, 'utf-8');
    assert.ok(content.endsWith('\n'));

    const lines = content.trim().split('\n');
    assert.equal(lines.length, 102); // header + 101 rows

    const header = lines[0].split(',');
    assert.ok(header.includes('id'));
    assert.ok(header.includes('content'));

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',');
      assert.equal(
        row.length,
        header.length,
        `row ${i} has wrong column count: ${lines[i]}`
      );
      const contentIndex = header.indexOf('content');
      assert.ok(!row[contentIndex].includes('\n') && !row[contentIndex].includes('\r'));
      assert.ok(row[contentIndex].includes(' '));
    }
  });

  it('builds a sparse CSV header as the union of all record keys', async () => {
    const records = [
      { id: '1', content: 'first' },
      { id: '2', title: 'second', extra: 'value' },
      { id: '3', content: 'third', tags: 'a b' },
    ];
    const filePath = await exportArtifact(records, { tool: 'x_test', platform: 'twitter', format: 'csv' });

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 4); // header + 3 rows

    const header = lines[0].split(',');
    assert.ok(header.includes('id'));
    assert.ok(header.includes('content'));
    assert.ok(header.includes('title'));
    assert.ok(header.includes('extra'));
    assert.ok(header.includes('tags'));

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',');
      assert.equal(
        row.length,
        header.length,
        `row ${i} has wrong column count: ${lines[i]}`
      );
    }
  });

  it('sanitizes content newlines in CSV output', async () => {
    const records = [{ id: '1', content: 'a\nb\r\nc\rd' }];
    const filePath = await exportArtifact(records, { tool: 'x_test', platform: 'twitter', format: 'csv' });

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2);

    const header = lines[0].split(',');
    const row = lines[1].split(',');
    const contentIndex = header.indexOf('content');
    assert.equal(row[contentIndex], 'a b c d');
  });

  it('leaves non-string content values untouched in JSONL and CSV', async () => {
    const records = [{ id: '1', content: 42 }];

    const jsonlPath = await exportArtifact(records, { tool: 'x_test', platform: 'twitter', format: 'jsonl' });
    const jsonlContent = await fs.readFile(jsonlPath, 'utf-8');
    const jsonlParsed = JSON.parse(jsonlContent.trim().split('\n')[0]);
    assert.equal(jsonlParsed.content, 42);

    const csvPath = await exportArtifact(records, { tool: 'x_test', platform: 'twitter', format: 'csv' });
    const csvContent = await fs.readFile(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n');
    assert.equal(lines.length, 2);

    const header = lines[0].split(',');
    const row = lines[1].split(',');
    const contentIndex = header.indexOf('content');
    assert.equal(row[contentIndex], '42');
  });
});
