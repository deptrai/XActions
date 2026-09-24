// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Next.js Admin & Infrastructure control tests.
 *
 * Verifies that:
 *   - apps/web/app/admin/page.tsx exists and defines AdminPage
 *   - Displays core system control tabs (checkpoints, proxies, stream, payments)
 *   - Interacts with /api/checkpoints
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
const pagePath = resolve(rootDir, 'apps', 'web', 'app', 'admin', 'page.tsx');

describe('Next.js Modern Admin Page', () => {
  it('admin page component exists', () => {
    expect(existsSync(pagePath)).toBe(true);
  });

  it('page provides core infrastructure tabs', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Jobs & Checkpoints');
    expect(src).toContain('Proxies & Accounts');
    expect(src).toContain('Stream Metrics & Alerts');
    expect(src).toContain('x402 Micropayments');
  });

  it('page defines crawler jobs and proxy nodes table structures', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('INITIAL_CHECKPOINTS');
    expect(src).toContain('INITIAL_PROXIES');
    expect(src).toContain('crawler');
    expect(src).toContain('latency');
  });

  it('page interacts with backend checkpoint endpoints', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('http://localhost:3001/api/checkpoints');
    expect(src).toContain('handleAction');
  });
});
