// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TypeScript definitions for Exporter Utility (Story 10.3).
 * @author nich (@nichxbt)
 * @license MIT
 */

export interface ExportOptions {
  format: 'jsonl' | 'csv';
  outputPath: string;
  compress?: boolean;
  platform?: string;
  keyword?: string;
  fromDate?: string | Date;
  toDate?: string | Date;
  includeComments?: boolean;
  prisma?: import('@prisma/client').PrismaClient;
}

export interface ExportResult {
  rowCount: number;
  outputPath: string;
  compressed: boolean;
}

export declare const CSV_COLUMNS: string[];

export declare function sanitizeContent(text: string | null | undefined): string;

export declare function escapeCsvCell(val: unknown): string;

export declare function formatCsvRow(
  type: 'post' | 'comment',
  record: Record<string, unknown>
): string;

export declare function exportDataset(options: ExportOptions): Promise<ExportResult>;
