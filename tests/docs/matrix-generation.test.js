// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for canonical action matrix generation (Story 20.1).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CANONICAL_24 = [
  'twitter', 'bluesky', 'mastodon', 'facebook', 'threads', 'reddit', 'medium', 'instagram',
  'tiktok', 'youtube', 'zalo', 'tiktokshop', 'fnb', 'healthcare', 'ipvietnam', 'automotive',
  'b2b_registry_extended', 'linkedin', 'batdongsan', 'chotot', 'shopee', 'topcv', 'vietnamworks', 'masothue',
];

describe('action matrix generation', () => {
  it('generates valid docs/canonical-action-matrix.json with all 24 platforms', async () => {
    // Run the generation script to ensure it produces fresh output
    const { execSync } = await import('node:child_process');
    const scriptPath = path.join(process.cwd(), 'scripts/generate-action-matrix.js');
    assert.ok(fs.existsSync(scriptPath), 'Expected scripts/generate-action-matrix.js to exist');
    execSync(`node ${scriptPath}`, { cwd: process.cwd(), stdio: 'pipe' });

    const jsonPath = path.join(process.cwd(), 'docs/canonical-action-matrix.json');
    assert.ok(fs.existsSync(jsonPath), 'Expected docs/canonical-action-matrix.json to exist');

    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    assert.ok(data.generated);
    assert.ok(data.platforms);

    for (const canonical of CANONICAL_24) {
      assert.ok(data.platforms[canonical], `Expected platform ${canonical} in action matrix json`);
      assert.ok(Array.isArray(data.platforms[canonical].actions));
    }
  });

  it('generates valid docs/canonical-action-matrix.md with markdown table', async () => {
    const mdPath = path.join(process.cwd(), 'docs/canonical-action-matrix.md');
    assert.ok(fs.existsSync(mdPath), 'Expected docs/canonical-action-matrix.md to exist');

    const content = fs.readFileSync(mdPath, 'utf8');
    assert.ok(content.includes('# Canonical Action/Arg Matrix'));
    assert.ok(content.includes('| Platform | Category | Action | Required Args | Optional Args | Example |'));

    for (const canonical of CANONICAL_24) {
      assert.ok(content.includes(`| ${canonical} |`), `Expected platform ${canonical} in action matrix md`);
    }
  });
});
