// Type declarations for src/scraping/paginationEngine.js
// Broad types to satisfy the JSDoc migration while the implementation is
// typed in a later phase.

export interface PaginationOptions extends Record<string, unknown> {}

export class PaginationEngine {
  constructor(options?: PaginationOptions);
  scrapeWithPagination(
    page: Record<string, unknown>,
    extractFn: (page: Record<string, unknown>) => unknown[],
    options?: PaginationOptions
  ): Promise<Record<string, unknown>[]>;
}

export class RetryPolicy {
  constructor(options?: PaginationOptions);
  shouldRetry(error: unknown, attempt: number): boolean;
  getDelay(attempt: number): number;
}

export interface DatasetData {
  items?: Record<string, unknown>[];
  total?: number;
  offset?: number;
  limit?: number;
}

export class DatasetStore {
  constructor(dataset: string, sessionCookie?: string);
  getData(options?: PaginationOptions): Promise<DatasetData>;
  getItems(): Promise<Record<string, unknown>[]>;
  save(): Promise<void>;
}

export function listDatasets(): Promise<Record<string, unknown>[]>;
