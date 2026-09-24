// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 48.3 — Realtime Operations Monitor screen tests.
 *
 * Verifies that:
 *   - apps/web/app/monitor/page.tsx exists and defines MonitorPage
 *   - Connects to realtime client & supports polling fallback
 *   - Renders rate limit & quota progress bars
 *   - Renders live event feed with filter and clear capabilities
 *   - apps/web/lib/realtime.ts exports RealtimeClient & getRealtimeClient
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
const pagePath = resolve(rootDir, 'apps', 'web', 'app', 'monitor', 'page.tsx');
const realtimeLibPath = resolve(rootDir, 'apps', 'web', 'lib', 'realtime.ts');

describe('Story 48.3 — Operations Monitor Screen (/monitor)', () => {
  it('monitor page component and realtime lib exist', () => {
    expect(existsSync(pagePath)).toBe(true);
    expect(existsSync(realtimeLibPath)).toBe(true);
  });

  it('page uses "use client" directive', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src.startsWith("'use client'") || src.startsWith('"use client"')).toBe(true);
  });

  it('page integrates with realtime client and polling fallback', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('getRealtimeClient');
    expect(src).toContain('realtimeStatus');
    expect(src).toContain('health:update');
    expect(src).toContain('job:event');
    expect(src).toContain('/api/health');
  });

  it('page renders progress bars and quota health metrics', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Rate Limit');
    expect(src).toContain('Active Automations');
    expect(src).toContain('Active Workers');
    expect(src).toContain('job.progress');
  });

  it('page renders live event feed and filter controls', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('Live Event Feed');
    expect(src).toContain('handleClearEvents');
    expect(src).toContain('filterLevel');
  });

  it('realtime library handles socket connection and polling fallback', () => {
    const src = readFileSync(realtimeLibPath, 'utf8');
    expect(src).toContain('RealtimeClient');
    expect(src).toContain('startPolling');
    expect(src).toContain('pollHealth');
    expect(src).toContain('/api/health');
  });
});
