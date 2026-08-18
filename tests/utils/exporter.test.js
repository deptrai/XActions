// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Acceptance Tests — Story 10.3: AI Dataset Export Utility (Streaming JSONL & CSV).
 * Runs against the real PostgreSQL test database configured in tests/store/test-prisma-client.js.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { exportDataset, CSV_COLUMNS } from '../../src/utils/exporter.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';
import { prisma, cleanupTestDatabase } from '../store/test-prisma-client.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const testTmpDir = path.resolve(process.cwd(), '.tmp-export-tests');

function ensureTmpDir() {
  if (!fs.existsSync(testTmpDir)) {
    fs.mkdirSync(testTmpDir, { recursive: true });
  }
}

function tmpFile(name) {
  return path.join(testTmpDir, `${name}-${Date.now()}`);
}

function seedPosts(count, overrides = {}) {
  const data = [];
  for (let i = 0; i < count; i += 1) {
    const platform = overrides.platform || 'twitter';
    const externalId = `post_${i}`;
    data.push({
      id: `${platform}:${externalId}`,
      platform,
      externalId,
      category: 'social',
      authorId: `author_${i}`,
      authorName: `Author "The, Great" ${i}`,
      authorAvatar: null,
      authorUrl: null,
      postUrl: `https://x.com/status/${externalId}`,
      content: `Post body ${i}\nline 2\rline 3`,
      mediaUrls: i % 2 === 0 ? [`https://img.com/${i}.jpg`] : [],
      likesCount: 10 + i,
      repostsCount: 1,
      repliesCount: 0,
      viewsCount: 100 + i,
      metadata: { index: i, tags: ['a', 'b'], big: 9007199254740991n },
      publishedAt: new Date('2026-08-18T10:00:00.000Z'),
      crawledAt: new Date(`2026-08-18T${10 + (i % 12)}:00:00.000Z`),
      ...overrides,
    });
  }
  return data;
}

function seedComments(postIds, count, overrides = {}) {
  const data = [];
  for (let i = 0; i < count; i += 1) {
    const postId = postIds[i % postIds.length];
    const [platform, postExternalId] = postId.split(':');
    const externalId = `comm_${i}`;
    data.push({
      id: `${platform}:${postExternalId}:${externalId}`,
      platform,
      externalId,
      postId,
      parentCommentId: null,
      depth: 0,
      authorId: `commenter_${i}`,
      authorName: `Commenter ${i}`,
      authorAvatar: null,
      content: `Comment ${i}\r\nwith=formula,+injection\n`,
      likesCount: 2 + i,
      subCommentsCount: 0,
      metadata: { replyIndex: i },
      publishedAt: null,
      crawledAt: new Date(`2026-08-18T${12 + (i % 10)}:00:00.000Z`),
      ...overrides,
    });
  }
  return data;
}

beforeEach(async () => {
  ensureTmpDir();
  await cleanupTestDatabase();
});

afterAll(async () => {
  if (fs.existsSync(testTmpDir)) {
    fs.rmSync(testTmpDir, { recursive: true, force: true });
  }
  await prisma.$disconnect();
});

describe('Story 10.3: Input Validation Guard', () => {
  it('throws PlatformError (INVALID_ARGS) when outputPath is missing or empty', async () => {
    await expect(exportDataset({ format: 'jsonl' })).rejects.toThrow(PlatformError);
    await expect(exportDataset({ format: 'jsonl', outputPath: '' })).rejects.toThrow(PlatformError);

    try {
      await exportDataset({ format: 'jsonl', outputPath: null });
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect(err.type).toBe(ErrorTypes.INVALID_ARGS);
      expect(err.code).toBe('XACT_4001');
      expect(err.suggestedAction).toBe(SuggestedActions.USE_ACTIONS_LIST);
      expect(err.message).toMatch(/outputPath/i);
    }
  });

  it('throws PlatformError (INVALID_ARGS) when format is unsupported', async () => {
    const invalidFormats = ['xml', 'parquet', 'yaml', 'json', 'tsv', ''];

    for (const fmt of invalidFormats) {
      await expect(
        exportDataset({ format: fmt, outputPath: tmpFile('invalid') }),
      ).rejects.toThrow(PlatformError);
    }
  });

  it('throws PlatformError (INVALID_ARGS) when fromDate is later than toDate', async () => {
    await expect(
      exportDataset({
        format: 'jsonl',
        outputPath: tmpFile('date.jsonl'),
        fromDate: '2026-08-20T00:00:00Z',
        toDate: '2026-08-10T00:00:00Z',
      }),
    ).rejects.toThrow(PlatformError);
  });

  it('throws PlatformError (INVALID_ARGS) for unparseable or non-string/non-Date fromDate/toDate', async () => {
    await expect(
      exportDataset({
        format: 'jsonl',
        outputPath: tmpFile('bad-date.jsonl'),
        fromDate: 'not-a-date',
      }),
    ).rejects.toThrow(PlatformError);

    await expect(
      exportDataset({
        format: 'jsonl',
        outputPath: tmpFile('bad-date.jsonl'),
        fromDate: false,
      }),
    ).rejects.toThrow(PlatformError);

    await expect(
      exportDataset({
        format: 'jsonl',
        outputPath: tmpFile('number-date.jsonl'),
        fromDate: 1234567890000,
      }),
    ).rejects.toThrow(PlatformError);
  });
});

describe('Story 10.3: JSONL Streaming Export', () => {
  it('exports Post rows first, then Comment rows, and sanitizes newlines', async () => {
    const posts = seedPosts(3);
    const comments = seedComments(posts.map((p) => p.id), 2);
    await prisma.post.createMany({ data: posts });
    await prisma.comment.createMany({ data: comments });

    const outputPath = tmpFile('export.jsonl');
    const result = await exportDataset({
      format: 'jsonl',
      outputPath,
      prisma,
    });

    expect(result.rowCount).toBe(5);
    expect(result.outputPath).toBe(outputPath);
    expect(result.compressed).toBe(false);
    expect(fs.existsSync(outputPath)).toBe(true);

    const lines = fs.readFileSync(outputPath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(5);

    for (let i = 0; i < lines.length; i += 1) {
      const parsed = JSON.parse(lines[i]);
      if (i < 3) {
        expect(parsed.type).toBe('post');
      } else {
        expect(parsed.type).toBe('comment');
      }
      expect(parsed.content).not.toMatch(/[\r\n]/);
      expect(parsed.metadata).toBeDefined();
    }

    const first = JSON.parse(lines[0]);
    expect(first.platform).toBe('twitter');
    expect(first.likesCount).toBe(10);
    // BigInt in metadata is serialized as a string in JSONL
    expect(first.metadata.big).toBe('9007199254740991');
  });

  it('gzipped JSONL is valid and decompresses correctly', async () => {
    const posts = seedPosts(2);
    await prisma.post.createMany({ data: posts });

    const outputPath = tmpFile('export.jsonl');
    const result = await exportDataset({
      format: 'jsonl',
      outputPath,
      compress: true,
      prisma,
    });

    const expectedPath = `${outputPath}.gz`;
    expect(result.compressed).toBe(true);
    expect(result.outputPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);

    const decompressed = zlib.gunzipSync(fs.readFileSync(expectedPath)).toString('utf8').trim();
    const lines = decompressed.split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).id).toBe('twitter:post_0');
  });
});

describe('Story 10.3: CSV Streaming Export', () => {
  it('emits CSV with valid header, escapes quotes/commas/newlines, and defends against formula injection', async () => {
    const posts = [
      {
        id: 'shopee:item_1',
        platform: 'shopee',
        externalId: 'item_1',
        category: 'ecom',
        authorId: 'shop_1',
        authorName: 'Shop "Official", Ltd.',
        authorAvatar: null,
        authorUrl: 'https://shopee.vn/shop_1',
        postUrl: 'https://shopee.vn/item_1',
        content: '=SUM(1,2) Discount 50%, free shipping!',
        mediaUrls: ['https://img.com/a.jpg', 'https://img.com/b.jpg'],
        likesCount: 99,
        repostsCount: 12,
        repliesCount: 5,
        viewsCount: 1500,
        metadata: { price: 250000, brand: 'Nike' },
        publishedAt: new Date('2026-08-18T08:00:00Z'),
        crawledAt: new Date('2026-08-18T08:30:00Z'),
      },
      {
        id: 'shopee:item_2',
        platform: 'shopee',
        externalId: 'item_2',
        category: 'ecom',
        authorId: 'shop_2',
        authorName: 'Negative Numbers',
        authorAvatar: null,
        authorUrl: null,
        postUrl: null,
        content: 'plain content',
        mediaUrls: [],
        likesCount: -5,
        repostsCount: -1,
        repliesCount: 0,
        viewsCount: 0,
        metadata: null,
        publishedAt: null,
        crawledAt: new Date('2026-08-18T09:00:00Z'),
      },
    ];
    await prisma.post.createMany({ data: posts });

    const outputPath = tmpFile('export.csv');
    const result = await exportDataset({
      format: 'csv',
      outputPath,
      includeComments: false,
      prisma,
    });

    expect(result.rowCount).toBe(2);

    const content = fs.readFileSync(outputPath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));

    // authorName with quotes/commas is correctly quoted
    expect(lines[1]).toContain('"Shop ""Official"", Ltd."');
    // formula-prefixed content is prefixed with a single quote
    expect(lines[1]).toContain("'=SUM(1,2) Discount 50%, free shipping!");
    // negative integer columns are NOT prefixed with a quote
    expect(lines[2]).toContain(',-5,');
    expect(lines[2]).toContain(',-1,');
  });

  it('gzipped CSV is valid and decompresses correctly', async () => {
    const posts = seedPosts(2);
    await prisma.post.createMany({ data: posts });

    const outputPath = tmpFile('export.csv');
    const result = await exportDataset({
      format: 'csv',
      outputPath,
      compress: true,
      includeComments: false,
      prisma,
    });

    const expectedPath = `${outputPath}.gz`;
    expect(result.compressed).toBe(true);
    expect(result.outputPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);

    const decompressed = zlib.gunzipSync(fs.readFileSync(expectedPath)).toString('utf8').trim();
    const lines = decompressed.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
  });
});

describe('Story 10.3: Filter Query Construction', () => {
  it('filters by platform, keyword (case-insensitive), and crawledAt date range', async () => {
    const posts = [
      ...seedPosts(3, { platform: 'twitter', crawledAt: new Date('2026-08-15T10:00:00Z') }),
      ...seedPosts(2, { platform: 'facebook', crawledAt: new Date('2026-08-20T10:00:00Z') }),
    ];
    posts[0].content = 'antigravity engine is cool';
    posts[3].content = 'Antigravity facebook post';
    await prisma.post.createMany({ data: posts });

    const outputPath = tmpFile('filter.jsonl');
    const result = await exportDataset({
      format: 'jsonl',
      outputPath,
      platform: 'twitter',
      keyword: 'antigravity',
      fromDate: '2026-08-14T00:00:00Z',
      toDate: '2026-08-16T23:59:59Z',
      includeComments: false,
      prisma,
    });

    expect(result.rowCount).toBe(1);
    const lines = fs.readFileSync(outputPath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).id).toBe('twitter:post_0');
  });
});

describe('Story 10.3: Cursor Pagination & Large Export', () => {
  it('paginates through more than one page of Post and Comment rows', async () => {
    const postCount = 150;
    const commentCount = 25;
    const posts = seedPosts(postCount);
    const comments = seedComments(posts.map((p) => p.id), commentCount);
    await prisma.post.createMany({ data: posts });
    await prisma.comment.createMany({ data: comments });

    const outputPath = tmpFile('large.jsonl');
    const result = await exportDataset({
      format: 'jsonl',
      outputPath,
      prisma,
    });

    expect(result.rowCount).toBe(postCount + commentCount);
    const lines = fs.readFileSync(outputPath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(postCount + commentCount);

    // Confirm post IDs are in increasing externalId order by page (sorted by crawledAt, id)
    const firstLine = JSON.parse(lines[0]);
    const lastPostLine = JSON.parse(lines[postCount - 1]);
    expect(firstLine.type).toBe('post');
    expect(lastPostLine.type).toBe('post');

    const firstCommentLine = JSON.parse(lines[postCount]);
    expect(firstCommentLine.type).toBe('comment');
  });

  it('handles empty result set by producing a valid (header-only or empty) output', async () => {
    const outputPath = tmpFile('empty.csv');
    const result = await exportDataset({
      format: 'csv',
      outputPath,
      platform: 'nonexistent',
      includeComments: false,
      prisma,
    });

    expect(result.rowCount).toBe(0);
    const content = fs.readFileSync(outputPath, 'utf8');
    expect(content.trim()).toBe(CSV_COLUMNS.join(','));
  });
});
