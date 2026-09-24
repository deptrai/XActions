// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 48.3 — System Status screen tests.
 *
 * Verifies that:
 *   - apps/web/app/status/page.tsx exists and defines StatusPage
 *   - Fetches and displays /api/health
 *   - Displays socket connection state and hibernation guard
 *   - Renders 90-day uptime history grid
 *   - Provides manual refresh button and offline warning banner
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
const pagePath = resolve(rootDir, 'apps', 'web', 'app', 'status', 'page.tsx');

describe('Story 48.3 — System Status Screen (/status)', () => {
  it('status page component exists', () => {
    expect(existsSync(pagePath)).toBe(true);
  });

  it('page uses "use client" directive', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src.startsWith("'use client'") || src.startsWith('"use client"')).toBe(true);
  });

  it('page checks /api/health and handles offline states', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('/api/health');
    expect(src).toContain('backendOffline');
    expect(src).toContain('Backend Services Offline');
    expect(src).toContain('All Systems Operational');
  });

  it('page displays socket connection state and hibernation status', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('realtimeStatus');
    expect(src).toContain('Resource Hibernation Guard');
    expect(src).toContain('hibernationActive');
  });

  it('page renders services list and uptime history grid', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('SERVICES');
    expect(src).toContain('Core Services & Subsystems');
    expect(src).toContain('uptimeDays');
    expect(src).toContain('90 days ago');
  });

  it('page provides manual refresh control', () => {
    const src = readFileSync(pagePath, 'utf8');
    expect(src).toContain('checkHealth');
    expect(src).toContain('Refresh');
  });
});
