// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/** Type declarations for the XActions CLI shared helpers. */

export const CONFIG_DIR: string;
export const CONFIG_FILE: string;

export function loadConfig(): Promise<Record<string, unknown>>;
export function saveConfig(config: Record<string, unknown>): Promise<void>;

/**
 * @param {number|string} num
 */
export function formatNumber(num: number | string): string;

export function createHttpScraper(): Promise<import("../client/index.js").Scraper>;

/**
 * @throws {Error} When results is empty
 */
export function assertNotEmpty<T>(results: T[] | undefined | null, what: string, hint: string): asserts results is T[];

export const AUTH_HINT: string;

export function smartOutput(
  data: unknown[],
  options: { json?: boolean; googleSheets?: string; output?: string; sheetName?: string; sheetMode?: string },
  defaultName?: string,
): Promise<void>;

/**
 * @throws {Error} When value is not a positive integer
 */
export function parseCliPositiveInt(value: unknown, fieldName: string): number;

/**
 * @throws {Error} When value is not a non-negative integer
 */
export function parseCliNonNegativeInt(value: unknown, fieldName: string): number;

export function printCliError(error: Error, options?: { json?: boolean }): void;

export function disconnectPrisma(prisma: { $disconnect(): Promise<void> } | undefined): Promise<void>;
