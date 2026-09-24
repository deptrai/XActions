// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 47.2 — Viral DNA Miner Dashboard screen tests.
 *
 * Verifies that:
 *   - apps/web/app/viral-miner/page.tsx exists and defines ViralMinerPage
 *   - Contains platform selections (X, TikTok, Facebook, etc.)
 *   - Contains hook distributions and top patterns
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
const pagePath = resolve(rootDir, 'apps', 'web', 'app', 'viral-miner', 'page.tsx');

describe('Story 47.2 — Viral DNA Miner Dashboard Screen', () => {
  it('viral-miner page component exists', () => {
    expect(existsSync(pagePath)).toBe(true);
  });

  it('page includes core platforms in configuration', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain("'x'");
    expect(src).toContain("'tiktok'");
    expect(src).toContain("'facebook'");
    expect(src).toContain("'threads'");
    expect(src).toContain("'linkedin'");
  });

  it('page defines Hook Archetype Distribution chart items', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('How-to / Actionable');
    expect(src).toContain('Contrast / Myth-busting');
    expect(src).toContain('Curiosity / Question');
    expect(src).toContain('Hot Take / Controversial');
  });

  it('page provides mining trigger and progress tracking', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('handleStartMining');
    expect(src).toContain('Run Mining');
    expect(src).toContain('Scraped Posts');
    expect(src).toContain('Classified Archetypes');
  });
});
