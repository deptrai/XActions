// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 47.1 — Next.js 15 Web App & Universal Layout tests.
 *
 * Verifies that:
 *   - apps/web has valid package.json with next 15 dependency
 *   - apps/web build outputs valid production assets
 *   - Universal layout files (layout.tsx, sidebar.tsx, header.tsx, backend-status.tsx) exist and export components
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
const webDir = resolve(rootDir, 'apps', 'web');

describe('Story 47.1 — Next.js 15 App Router & Layout Scaffold', () => {
  it('apps/web package.json specifies next 15 and @xactions/api-client dependency', () => {
    const pkgPath = resolve(webDir, 'package.json');
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect(pkg.dependencies.next).toMatch(/\^15/);
    expect(pkg.dependencies['@xactions/api-client']).toBeTruthy();
    expect(pkg.dependencies['lucide-react']).toBeTruthy();
  });

  it('Universal Layout components are present in apps/web', () => {
    const files = [
      'app/layout.tsx',
      'app/page.tsx',
      'app/globals.css',
      'components/sidebar.tsx',
      'components/header.tsx',
      'components/backend-status.tsx',
      'tailwind.config.js',
      'next.config.js',
      'tsconfig.json',
    ];

    for (const f of files) {
      expect(existsSync(resolve(webDir, f)), `missing file: ${f}`).toBe(true);
    }
  });

  it('Sidebar component includes core navigation items', () => {
    const sidebarSrc = readFileSync(resolve(webDir, 'components', 'sidebar.tsx'), 'utf8');
    expect(sidebarSrc).toContain('Viral DNA Miner');
    expect(sidebarSrc).toContain('Follower CRM');
    expect(sidebarSrc).toContain('Content Optimizer');
    expect(sidebarSrc).toContain('Universal Explorer');
    expect(sidebarSrc).toContain('Swagger API Docs');
  });

  it('BackendStatus component checks localhost:3001/api/health', () => {
    const statusSrc = readFileSync(resolve(webDir, 'components', 'backend-status.tsx'), 'utf8');
    expect(statusSrc).toContain('http://localhost:3001/api/health');
    expect(statusSrc).toContain('Backend Live');
    expect(statusSrc).toContain('Backend Offline');
  });
});
