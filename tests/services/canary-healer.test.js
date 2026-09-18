// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 39.2 — CanaryHealer orchestration tests.
 * Uses real file I/O on temp config, real AutoSelectorFallback + SelectorSandbox
 * with injected page harnesses (no vi.mock).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CanaryHealer } from '../../src/services/canary-healer.js';
import { AutoSelectorFallback } from '../../src/core/auto-selector-fallback.js';
import { SelectorSandbox } from '../../src/services/selector-sandbox.js';

function makeTmpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-healer-'));
  const cfgPath = path.join(dir, 'canary-targets.json');
  const config = {
    twitter: [
      {
        name: 'twitter-profile',
        url: 'https://x.com/nasa',
        selectorChain: ['[data-testid="OldSel"]', 'main [role="main"]'],
        expectedShape: {
          tagName: 'div',
          attributes: { 'data-testid': 'UserName' },
        },
      },
    ],
  };
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
  return { dir, cfgPath, config };
}

function makeInvestigationFallback(candidates) {
  return new AutoSelectorFallback({
    browserFactory: async () => ({
      async newPage() {
        return {
          async goto() {},
          async evaluate() { return candidates; },
          async close() {},
        };
      },
      async close() {},
    }),
    delayMs: 0,
  });
}

function makeValidatingSandbox(validateFn) {
  const sb = new SelectorSandbox({ browserFactory: async () => ({}) });
  // Override validate for testing — bypass browser entirely
  sb.validate = validateFn;
  return sb;
}

describe('CanaryHealer', () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpConfig(); });
  afterEach(() => { fs.rmSync(tmp.dir, { recursive: true, force: true }); });

  test('INVALID_TARGET: throws on unknown platform', async () => {
    const healer = new CanaryHealer({ configPath: tmp.cfgPath });
    await expect(healer.heal('foo', 'bar')).rejects.toThrow(/Unknown platform or target/);
  });

  test('INVALID_TARGET: throws on unknown target name', async () => {
    const healer = new CanaryHealer({ configPath: tmp.cfgPath });
    await expect(healer.heal('twitter', 'nope')).rejects.toThrow(/Unknown platform or target/);
  });

  test('NO_CANDIDATES: returns no-candidates status when investigate yields nothing', async () => {
    const fallback = makeInvestigationFallback([]);
    const healer = new CanaryHealer({
      configPath: tmp.cfgPath,
      autoSelectorFallback: fallback,
      selectorSandbox: makeValidatingSandbox(async () => ({ valid: false })),
      execFn: async () => { throw new Error('gh not installed'); },
    });
    const res = await healer.heal('twitter', 'twitter-profile', { createIssue: false });
    expect(res.status).toBe('no-candidates');
    expect(res.message).toMatch(/No valid replacement selectors found/);
    expect(res.candidateCount).toBe(0);
  });

  test('SANDBOX_FAIL: rejected candidates captured in rejectionReasons', async () => {
    const candidates = [
      { selector: '[data-testid="Bad1"]', confidenceScore: 0.5, strategy: 'data-testid', matchedOn: 'x', snippet: '' },
      { selector: '[data-testid="Good"]', confidenceScore: 0.9, strategy: 'data-testid', matchedOn: 'x', snippet: '' },
    ];
    const fallback = makeInvestigationFallback(candidates);
    const sb = makeValidatingSandbox(async (url, sel) =>
      sel === '[data-testid="Good"]'
        ? { valid: true, extractedSample: { tagName: 'div' } }
        : { valid: false, error: 'shape mismatch' }
    );
    const healer = new CanaryHealer({
      configPath: tmp.cfgPath,
      autoSelectorFallback: fallback,
      selectorSandbox: sb,
      execFn: async () => { throw new Error('gh not installed'); },
    });
    const res = await healer.heal('twitter', 'twitter-profile', { preview: true });
    expect(res.status).toBe('preview');
    expect(res.validatedCandidates).toHaveLength(1);
    expect(res.rejectionReasons).toHaveLength(1);
    expect(res.rejectionReasons[0].selector).toBe('[data-testid="Bad1"]');
    expect(res.newChain[0]).toBe('[data-testid="Good"]');
  });

  test('PREVIEW: returns unified-diff, does not write file or invoke gh', async () => {
    const candidates = [
      { selector: '[data-testid="NewSel"]', confidenceScore: 0.95, strategy: 'data-testid', matchedOn: 'x', snippet: '' },
    ];
    const healer = new CanaryHealer({
      configPath: tmp.cfgPath,
      autoSelectorFallback: makeInvestigationFallback(candidates),
      selectorSandbox: makeValidatingSandbox(async () => ({ valid: true, extractedSample: {} })),
      execFn: async () => { throw new Error('gh should not be called in preview'); },
    });
    const res = await healer.heal('twitter', 'twitter-profile', { preview: true });
    expect(res.status).toBe('preview');
    expect(res.patch).toContain('--- a/config/canary-targets.json');
    expect(res.patch).toContain('-        "[data-testid=\\"OldSel\\"]",');
    expect(res.patch).toContain('+        "[data-testid=\\"NewSel\\"]",');
  });

  test('PATCH_FILE: writes .patch file when --output specified', async () => {
    const candidates = [
      { selector: '[data-testid="NewSel"]', confidenceScore: 0.95, strategy: 'data-testid', matchedOn: 'x', snippet: '' },
    ];
    const outPath = path.join(tmp.dir, 'out.patch');
    const healer = new CanaryHealer({
      configPath: tmp.cfgPath,
      autoSelectorFallback: makeInvestigationFallback(candidates),
      selectorSandbox: makeValidatingSandbox(async () => ({ valid: true })),
      execFn: async () => { throw new Error('gh not installed'); },
    });
    const res = await healer.heal('twitter', 'twitter-profile', { output: outPath });
    expect(res.status).toBe('patch-file');
    expect(fs.existsSync(outPath)).toBe(true);
    const body = fs.readFileSync(outPath, 'utf8');
    expect(body).toContain('--- a/config/canary-targets.json');
    expect(body).toContain('+        "[data-testid=\\"NewSel\\"]",');
  });

  test('GH_CLI_MISSING: falls back to patch file when gh not on PATH', async () => {
    const candidates = [
      { selector: '[data-testid="NewSel"]', confidenceScore: 0.95, strategy: 'data-testid', matchedOn: 'x', snippet: '' },
    ];
    const cwd = process.cwd();
    const autoPatchPath = path.join(cwd, 'canary-heal-twitter-twitter-profile.patch');
    try {
      const healer = new CanaryHealer({
        configPath: tmp.cfgPath,
        autoSelectorFallback: makeInvestigationFallback(candidates),
        selectorSandbox: makeValidatingSandbox(async () => ({ valid: true })),
        execFn: async (cmd) => {
          if (cmd === 'gh') throw new Error('not installed');
          throw new Error('unexpected exec ' + cmd);
        },
      });
      const res = await healer.heal('twitter', 'twitter-profile', {});
      expect(res.status).toBe('patch-file');
      expect(res.message).toMatch(/gh CLI not found/);
      expect(res.patchFile).toBe(autoPatchPath);
      expect(fs.existsSync(autoPatchPath)).toBe(true);
    } finally {
      try { fs.unlinkSync(autoPatchPath); } catch { /* ignore */ }
    }
  });
});
