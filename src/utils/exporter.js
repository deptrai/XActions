// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Dataset Export Utility (Streaming JSONL & CSV with Sanitization).
 * Story 10.3 — Reads from PostgreSQL via Prisma cursor pagination and writes with backpressure.
 * @author nich (@nichxbt)
 * @license MIT
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';

/**
 * @typedef {Object} ExportOptions
 * @property {'jsonl' | 'csv'} format
 * @property {string} outputPath
 * @property {boolean} [compress=false]
 * @property {string} [platform]
 * @property {string} [keyword]
 * @property {string | Date} [fromDate]
 * @property {string | Date} [toDate]
 * @property {boolean} [includeComments=true]
 * @property {import('@prisma/client').PrismaClient} [prisma]
 */

/**
 * @typedef {Object} ExportResult
 * @property {number} rowCount
 * @property {string} outputPath
 * @property {boolean} compressed
 */

export const CSV_COLUMNS = [
  'type',
  'id',
  'platform',
  'category',
  'externalId',
  'postId',
  'parentCommentId',
  'depth',
  'authorId',
  'authorName',
  'authorAvatar',
  'authorUrl',
  'postUrl',
  'content',
  'likesCount',
  'repostsCount',
  'repliesCount',
  'viewsCount',
  'subCommentsCount',
  'mediaUrls',
  'metadata',
  'publishedAt',
  'crawledAt',
];

/**
 * Sanitize newline characters in content to single spaces (AD-9 Rule 3).
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function sanitizeContent(text) {
  return String(text ?? '').replace(/\r\n|\r|\n/g, ' ');
}

/**
 * Escape a CSV cell value according to RFC 4180 rules with formula injection defense.
 * @param {unknown} val
 * @returns {string}
 */
export function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  let str = '';

  if (val instanceof Date) {
    str = isNaN(val.getTime()) ? '' : val.toISOString();
  } else if (typeof val === 'object') {
    try {
      str = JSON.stringify(val, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    } catch {
      str = '""';
    }
  } else {
    str = String(val);
  }

  // Prevent Spreadsheet Formula Injection (CWE-1236) only for raw string values.
  // Numeric Int columns (likesCount, repostsCount, etc.) must not get a leading quote.
  if (typeof val === 'string' && /^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }

  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * JSON.stringify replacer that converts BigInt values to strings.
 * @param {string} _key
 * @param {unknown} value
 * @returns {unknown}
 */
function bigIntReplacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * Format a Post or Comment database record into an escaped CSV line.
 * @param {'post' | 'comment'} type
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
export function formatCsvRow(type, record) {
  const rowValues = CSV_COLUMNS.map((col) => {
    if (col === 'type') return type;
    if (col === 'content') return escapeCsvCell(sanitizeContent(record.content));
    if (col === 'mediaUrls') {
      return Array.isArray(record.mediaUrls) ? escapeCsvCell(record.mediaUrls) : '';
    }
    if (col === 'metadata') return escapeCsvCell(record.metadata);

    const val = record[col];
    return escapeCsvCell(val);
  });

  return rowValues.join(',');
}

/**
 * Write a chunk to a stream respecting backpressure and error/close lifecycle.
 * @param {import('node:stream').Writable} stream
 * @param {string} chunk
 * @returns {Promise<void>}
 */
function writeWithDrain(stream, chunk) {
  if (!stream.write(chunk)) {
    return new Promise((resolve, reject) => {
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const onClose = () => {
        cleanup();
        reject(new Error('Stream closed prematurely'));
      };
      const cleanup = () => {
        stream.removeListener('drain', onDrain);
        stream.removeListener('error', onError);
        stream.removeListener('close', onClose);
      };
      stream.once('drain', onDrain);
      stream.once('error', onError);
      stream.once('close', onClose);
    });
  }
  return Promise.resolve();
}

/**
 * Export scraped datasets from PostgreSQL to streaming JSONL or CSV.
 * @param {ExportOptions} options
 * @returns {Promise<ExportResult>}
 */
export async function exportDataset(options = {}) {
  const {
    format,
    outputPath,
    compress = false,
    platform,
    keyword,
    fromDate,
    toDate,
    includeComments = true,
  } = options;

  // 1. Validate outputPath
  if (!outputPath || typeof outputPath !== 'string' || outputPath.trim() === '') {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'outputPath is required and must be a non-empty string',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  // 2. Validate format
  const normalizedFormat = format ? String(format).toLowerCase().trim() : '';
  if (!['jsonl', 'csv'].includes(normalizedFormat)) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `Invalid export format: "${format}". Supported formats: jsonl, csv`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  // 3. Validate Date Range (strict type checking)
  let parsedFromDate = null;
  let parsedToDate = null;

  if (fromDate !== undefined && fromDate !== null) {
    if (typeof fromDate === 'boolean' || (typeof fromDate !== 'string' && !(fromDate instanceof Date))) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid fromDate: "${fromDate}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    parsedFromDate = fromDate instanceof Date ? fromDate : new Date(fromDate);
    if (isNaN(parsedFromDate.getTime())) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid fromDate: "${fromDate}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
  }

  if (toDate !== undefined && toDate !== null) {
    if (typeof toDate === 'boolean' || (typeof toDate !== 'string' && !(toDate instanceof Date))) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid toDate: "${toDate}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    parsedToDate = toDate instanceof Date ? toDate : new Date(toDate);
    if (isNaN(parsedToDate.getTime())) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid toDate: "${toDate}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
  }

  if (parsedFromDate && parsedToDate && parsedFromDate > parsedToDate) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `fromDate (${parsedFromDate.toISOString()}) cannot be later than toDate (${parsedToDate.toISOString()})`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  // 4. Resolve Output Path and Compression Stream
  let finalOutputPath = outputPath;
  if (compress && !finalOutputPath.endsWith('.gz')) {
    finalOutputPath += '.gz';
  }

  const targetDir = path.dirname(path.resolve(finalOutputPath));
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const fileStream = fs.createWriteStream(finalOutputPath);
  const gzip = compress ? zlib.createGzip({ level: 6 }) : null;
  if (gzip) {
    gzip.pipe(fileStream);
  }
  const sink = gzip || fileStream;

  // Cross-wire stream errors so a fileStream error destroys the gzip sink
  // (and vice versa) and every pending writeWithDrain promise rejects.
  let streamError = null;
  const onFileStreamError = (err) => {
    streamError = err;
    if (gzip) gzip.destroy(err);
    fileStream.destroy(err);
  };
  const onGzipError = (err) => {
    streamError = err;
    fileStream.destroy(err);
    if (gzip) gzip.destroy(err);
  };
  fileStream.on('error', onFileStreamError);
  if (gzip) {
    gzip.on('error', onGzipError);
  }

  // 5. Resolve Prisma Client
  let prisma = options.prisma;
  if (!prisma) {
    const { default: sharedPrisma } = await import('../../api/lib/prisma.js');
    prisma = sharedPrisma;
  }

  // 6. Build Filter Where Clauses
  const wherePost = {};
  const whereComment = {};

  if (platform) {
    wherePost.platform = platform;
    whereComment.platform = platform;
  }

  if (keyword) {
    wherePost.content = { contains: keyword, mode: 'insensitive' };
    whereComment.content = { contains: keyword, mode: 'insensitive' };
  }

  if (parsedFromDate || parsedToDate) {
    wherePost.crawledAt = {};
    whereComment.crawledAt = {};
    if (parsedFromDate) {
      wherePost.crawledAt.gte = parsedFromDate;
      whereComment.crawledAt.gte = parsedFromDate;
    }
    if (parsedToDate) {
      wherePost.crawledAt.lte = parsedToDate;
      whereComment.crawledAt.lte = parsedToDate;
    }
  }

  let rowCount = 0;

  try {
    // 7. Write CSV Header (if CSV format)
    if (normalizedFormat === 'csv') {
      const headerLine = CSV_COLUMNS.join(',');
      await writeWithDrain(sink, headerLine + '\n');
    }

    // 8. Stream Post Rows (Cursor Pagination)
    let postCursor = null;
    while (true) {
      if (streamError) throw streamError;

      const query = {
        where: wherePost,
        take: 100,
        orderBy: [{ crawledAt: 'asc' }, { id: 'asc' }],
      };
      if (postCursor) {
        query.cursor = { id: postCursor };
        query.skip = 1;
      }

      const rows = await prisma.post.findMany(query);
      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        if (streamError) throw streamError;
        rowCount++;
        if (normalizedFormat === 'jsonl') {
          const jsonlItem = {
            type: 'post',
            ...row,
            content: sanitizeContent(row.content),
          };
          await writeWithDrain(sink, JSON.stringify(jsonlItem, bigIntReplacer) + '\n');
        } else {
          const csvLine = formatCsvRow('post', row);
          await writeWithDrain(sink, csvLine + '\n');
        }
        postCursor = row.id;
      }

      if (rows.length < 100) break;
    }

    // 9. Stream Comment Rows (Cursor Pagination, if enabled)
    if (includeComments !== false) {
      let commentCursor = null;
      while (true) {
        if (streamError) throw streamError;

        const query = {
          where: whereComment,
          take: 100,
          orderBy: [{ crawledAt: 'asc' }, { id: 'asc' }],
        };
        if (commentCursor) {
          query.cursor = { id: commentCursor };
          query.skip = 1;
        }

        const rows = await prisma.comment.findMany(query);
        if (!rows || rows.length === 0) break;

        for (const row of rows) {
          if (streamError) throw streamError;
          rowCount++;
          if (normalizedFormat === 'jsonl') {
            const jsonlItem = {
              type: 'comment',
              ...row,
              content: sanitizeContent(row.content),
            };
            await writeWithDrain(sink, JSON.stringify(jsonlItem, bigIntReplacer) + '\n');
          } else {
            const csvLine = formatCsvRow('comment', row);
            await writeWithDrain(sink, csvLine + '\n');
          }
          commentCursor = row.id;
        }

        if (rows.length < 100) break;
      }
    }

    // 10. Close Stream
    if (streamError) throw streamError;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        fileStream.removeListener('finish', onFinish);
        fileStream.removeListener('error', onError);
        if (gzip) gzip.removeListener('error', onError);
        fileStream.removeListener('close', onClose);
      };
      const onFinish = () => { cleanup(); resolve(); };
      const onError = (err) => { cleanup(); reject(err); };
      const onClose = () => { cleanup(); reject(new Error('Stream closed prematurely')); };

      fileStream.on('finish', onFinish);
      fileStream.on('error', onError);
      fileStream.on('close', onClose);
      if (gzip) gzip.on('error', onError);

      if (gzip) {
        gzip.end();
      } else {
        fileStream.end();
      }
    });

    return {
      rowCount,
      outputPath: finalOutputPath,
      compressed: Boolean(compress),
    };
  } catch (error) {
    if (gzip) {
      try {
        gzip.destroy();
      } catch {}
    }
    try {
      fileStream.destroy();
    } catch {}

    // Clean up partial corrupted file on failure
    try {
      if (fs.existsSync(finalOutputPath)) {
        fs.unlinkSync(finalOutputPath);
      }
    } catch {}

    throw error;
  }
}
