// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 47.4 — AI Content Optimizer Playground screen tests.
 *
 * Verifies that:
 *   - apps/web/app/optimizer/page.tsx exists and defines ContentOptimizerPage
 *   - Supports predict score, rewrite with AI, and hashtag generation
 *   - Contains viral gauge breakdown
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
const pagePath = resolve(rootDir, 'apps', 'web', 'app', 'optimizer', 'page.tsx');

describe('Story 47.4 — AI Content Optimizer Playground Screen', () => {
  it('optimizer page component exists', () => {
    expect(existsSync(pagePath)).toBe(true);
  });

  it('page provides predict score, rewrite and hashtag actions', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('handlePredict');
    expect(src).toContain('handleRewrite');
    expect(src).toContain('handleGenerateHashtags');
    expect(src).toContain('Predict Score');
    expect(src).toContain('Rewrite with AI');
  });

  it('page integrates with backend optimizer endpoints', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('/api/optimizer/predict');
    expect(src).toContain('/api/optimizer/optimize');
    expect(src).toContain('/api/optimizer/hashtags');
  });

  it('page defines viral potential gauge and breakdown metrics', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Viral Potential Score');
    expect(src).toContain('Hook Power');
    expect(src).toContain('Clarity & Tone');
    expect(src).toContain('Skimmability');
  });
});
