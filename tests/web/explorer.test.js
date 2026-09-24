// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 47.5 — Universal Data Explorer & Export screen tests.
 *
 * Verifies that:
 *   - apps/web/app/explorer/page.tsx exists and defines UniversalExplorerPage
 *   - Supports 4 domains: jobs, real_estate, enterprises, social
 *   - Implements CSV export with UTF-8 BOM
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..', '..');
const pagePath = resolve(rootDir, 'apps', 'web', 'app', 'explorer', 'page.tsx');

describe('Story 47.5 — Universal Data Explorer & Export Screen', () => {
  it('explorer page component exists', () => {
    expect(existsSync(pagePath)).toBe(true);
  });

  it('page defines all 4 cross-industry categories', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('jobs:');
    expect(src).toContain('real_estate:');
    expect(src).toContain('enterprises:');
    expect(src).toContain('social:');
    expect(src).toContain('Jobs & Hiring');
    expect(src).toContain('Real Estate');
    expect(src).toContain('Company Registry');
    expect(src).toContain('Social Intelligence');
  });

  it('page implements UTF-8 BOM CSV export', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('handleExportCSV');
    expect(src.includes('\uFEFF')).toBe(true);
    expect(src).toContain('text/csv;charset=utf-8;');
    expect(src).toContain('xactions-');
  });
});
