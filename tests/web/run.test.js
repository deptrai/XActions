// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 48.3 — Automation Command Runner screen tests.
 *
 * Verifies that:
 *   - apps/web/app/run/page.tsx exists and defines RunPage
 *   - Has command input, execute button, and output log area
 *   - Provides preset commands interacting with /api/operations
 *   - Supports copy output and clear logs actions
 *   - Tracks execution status (running, completed, failed)
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
const pagePath = resolve(rootDir, 'apps', 'web', 'app', 'run', 'page.tsx');

describe('Story 48.3 — Automation Command Runner Screen (/run)', () => {
  it('run page component exists', () => {
    expect(existsSync(pagePath)).toBe(true);
  });

  it('page uses "use client" directive', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src.startsWith("'use client'") || src.startsWith('"use client"')).toBe(true);
  });

  it('page provides command input, execute button, and output log area', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Command Runner');
    expect(src).toContain('Execute Command');
    expect(src).toContain('handleExecute');
    expect(src).toContain('Console Output');
    expect(src).toContain('logs');
  });

  it('page defines preset commands targeting /api/operations', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('PRESET_COMMANDS');
    expect(src).toContain('/api/operations/unfollow-non-followers');
    expect(src).toContain('/api/operations/detect-unfollowers');
    expect(src).toContain('/api/benchmark/probe-all');
    expect(src).toContain('/api/health');
  });

  it('page supports payload configuration and status states', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('customBody');
    expect(src).toContain('status');
    expect(src).toContain('handleCopyLogs');
    expect(src).toContain('handleClearLogs');
  });
});
