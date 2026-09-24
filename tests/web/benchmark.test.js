// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 48.3 — Scraper Benchmark & Reliability Scorecard screen tests.
 *
 * Verifies that:
 *   - apps/web/app/benchmark/page.tsx exists and defines BenchmarkPage
 *   - Interacts with /api/benchmark/summary and /api/benchmark/probe-all
 *   - Renders 4-pillar scorecard KPI cards (Tier A, B, C, Avg Score)
 *   - Renders results table with filter tabs and search box
 *   - Supports drill-down modal for scraper metrics
 *   - Handles empty states and canary probe triggers
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
const pagePath = resolve(rootDir, 'apps', 'web', 'app', 'benchmark', 'page.tsx');

describe('Story 48.3 — Scraper Reliability Scorecard Screen (/benchmark)', () => {
  it('benchmark page component exists', () => {
    expect(existsSync(pagePath)).toBe(true);
  });

  it('page uses "use client" directive', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src.startsWith("'use client'") || src.startsWith('"use client"')).toBe(true);
  });

  it('page interacts with benchmark summary and canary probe endpoints', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('/api/benchmark/summary');
    expect(src).toContain('/api/benchmark/probe-all');
    expect(src).toContain('handleRunProbes');
  });

  it('page renders KPI cards for health tiers and average score', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Total Scrapers');
    expect(src).toContain('Tier A (Healthy)');
    expect(src).toContain('Tier B (Degraded)');
    expect(src).toContain('Tier C (Alert)');
    expect(src).toContain('Avg Fleet Score');
  });

  it('page renders results table, filters, and 4-pillar drill-down modal', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('activeFilter');
    expect(src).toContain('searchQuery');
    expect(src).toContain('Stability (Reliability)');
    expect(src).toContain('Quality (Completeness)');
    expect(src).toContain('Noise (Signal-to-Noise)');
    expect(src).toContain('Cost (Compute / Retries)');
    expect(src).toContain('selectedScraper');
  });

  it('page handles empty benchmark state', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('No benchmark data');
  });
});
