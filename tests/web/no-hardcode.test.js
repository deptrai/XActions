// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Gate test: enforces zero hardcoded backend URLs in apps/web client code,
 * and verifies import type enforcement in lib/api.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..', '..');
const webDir = resolve(rootDir, 'apps', 'web');

function getFilesRecursively(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = resolve(dir, file);
    if (statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.next') {
        getFilesRecursively(fullPath, fileList);
      }
    } else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(file)) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Zero Hardcoded Backend URLs & Import Guards', () => {
  it('enforces 0 matches of localhost:3001 in apps/web/app, components, lib (except config.ts default fallback)', () => {
    const checkDirs = [
      resolve(webDir, 'app'),
      resolve(webDir, 'components'),
      resolve(webDir, 'lib'),
    ];

    const violations = [];

    for (const dir of checkDirs) {
      const files = getFilesRecursively(dir);
      for (const file of files) {
        // config.ts is the only allowed place for server-side fallback default
        if (file.endsWith('lib/config.ts')) continue;

        const content = readFileSync(file, 'utf8');
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (line.includes('localhost:3001')) {
            violations.push({ file, line: idx + 1, text: line.trim() });
          }
        });
      }
    }

    expect(violations).toEqual([]);
  });

  it('enforces lib/api.ts uses import type only for @xactions/api-client', () => {
    const apiHelperPath = resolve(webDir, 'lib', 'api.ts');
    const content = readFileSync(apiHelperPath, 'utf8');

    // Must match `import type { ... } from '@xactions/api-client'`
    const importLines = content
      .split('\n')
      .filter((l) => l.includes('@xactions/api-client') && l.trim().startsWith('import'));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line.trim()).toMatch(/^import\s+type\s+/);
    }
  });

  it('enforces pages/ directory is deleted and App Router is single router', () => {
    const pagesDir = resolve(webDir, 'pages');
    const exists = existsSync(pagesDir);
    expect(exists).toBe(false);
  });
});
