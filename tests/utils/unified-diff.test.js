// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 39.2 — unified-diff for canary-targets.json patches.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import { describe, test, expect } from 'vitest';
import { generateJsonUnifiedDiff } from '../../src/utils/unified-diff.js';

describe('generateJsonUnifiedDiff', () => {
  test('identical inputs produce empty diff', () => {
    const a = { foo: 'bar' };
    const b = { foo: 'bar' };
    expect(generateJsonUnifiedDiff('config/x.json', a, b)).toBe('');
  });

  test('emits ---/+++ headers with file path', () => {
    const a = { foo: 'a' };
    const b = { foo: 'b' };
    const patch = generateJsonUnifiedDiff('config/x.json', a, b);
    expect(patch).toContain('--- a/config/x.json');
    expect(patch).toContain('+++ b/config/x.json');
    expect(patch).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(patch).toContain('-  "foo": "a"');
    expect(patch).toContain('+  "foo": "b"');
  });

  test('handles canary-targets selectorChain replacement', () => {
    const original = {
      twitter: [
        {
          name: 'twitter-profile',
          url: 'https://x.com/nasa',
          selectorChain: ['[data-testid="OldSel"]', 'main [role="main"]'],
        },
      ],
    };
    const patched = {
      twitter: [
        {
          name: 'twitter-profile',
          url: 'https://x.com/nasa',
          selectorChain: ['[data-testid="NewSel"]', 'main [role="main"]'],
        },
      ],
    };
    const patch = generateJsonUnifiedDiff('config/canary-targets.json', original, patched);
    expect(patch).toContain('--- a/config/canary-targets.json');
    expect(patch).toContain('+++ b/config/canary-targets.json');
    expect(patch).toContain('-        "[data-testid=\\"OldSel\\"]",');
    expect(patch).toContain('+        "[data-testid=\\"NewSel\\"]",');
  });

  test('additions-only diff', () => {
    const a = { x: ['a'] };
    const b = { x: ['a', 'b'] };
    const patch = generateJsonUnifiedDiff('f.json', a, b);
    expect(patch).toContain('+    "b"');
  });

  test('deletion-only diff', () => {
    const a = { x: ['a', 'b'] };
    const b = { x: ['a'] };
    const patch = generateJsonUnifiedDiff('f.json', a, b);
    expect(patch).toContain('-    "b"');
  });
});
