// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/** Type declarations for the `report` CLI command module. */

export type AccountReport = Record<string, unknown>;
export function registerReportCommand(program: import("commander").Command): void;
export function reportFor(scraper: unknown, username: string, limit: number): Promise<AccountReport>;
export function printReport(report: AccountReport): void;
export function printComparison(reports: AccountReport[]): void;
export const WEEKDAYS: readonly string[];
