// by nichxbt
// Coverage expansion (TEA automate): shared chokepoint runGuardedBatch + assertFacebookUrl.
// Exercises validation branches, safety invariants, and seam behaviors not covered by the
// per-story suites. Browser-free, DB-free, no vi.mock — real fns + injected seams only.

import { describe, it, expect } from 'vitest';
import {
  runGuardedBatch,
  assertFacebookUrl,
  ACCOUNT_RISK_WARNING,
} from '../../api/services/facebookAutomation.js';

// Delay spy: records every (min,max); never sleeps.
function makeDelaySpy() {
  const calls = [];
  const spy = async (min, max) => { calls.push([min, max]); };
  spy.calls = calls;
  return spy;
}

// ── runGuardedBatch: dry-run gate ────────────────────────────────────────────

describe('runGuardedBatch — dry-run gate', () => {
  it('dryRun:null stays dry-run (strict === false gate), never a real write', async () => {
    let actionCalls = 0;
    const result = await runGuardedBatch(['a', 'b'], async () => { actionCalls++; }, { dryRun: null });
    expect(result.dryRun).toBe(true);
    expect(result.attempted).toBe(0);
    expect(actionCalls).toBe(0);
    expect(result.preview).toEqual([
      { target: 'a', action: 'pending' },
      { target: 'b', action: 'pending' },
    ]);
    expect(result.warning).toBeNull();
  });

  it('dry-run preview carries the raw item as target (non-string items preserved)', async () => {
    const obj = { id: 1 };
    const result = await runGuardedBatch([obj, 42], async () => {}, {});
    expect(result.preview).toEqual([
      { target: obj, action: 'pending' },
      { target: 42, action: 'pending' },
    ]);
  });
});

// ── runGuardedBatch: input + option validation ───────────────────────────────

describe('runGuardedBatch — validation', () => {
  it('items not an array → throws', async () => {
    await expect(runGuardedBatch('nope', async () => {}, {})).rejects.toThrow('items must be an array');
    await expect(runGuardedBatch(null, async () => {}, {})).rejects.toThrow('items must be an array');
  });

  it('maxBatch invalid (0 / -1 / NaN / Infinity) → throws (even in dry-run)', async () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      await expect(runGuardedBatch(['a'], async () => {}, { maxBatch: bad })).rejects.toThrow('maxBatch');
    }
  });

  it('maxRetry invalid (-1 / NaN / Infinity) → throws', async () => {
    for (const bad of [-1, NaN, Infinity]) {
      await expect(runGuardedBatch(['a'], async () => {}, { maxRetry: bad })).rejects.toThrow('maxRetry');
    }
  });

  it('actionFn not a function on a real run → throws before any write', async () => {
    await expect(
      runGuardedBatch(['a'], null, { dryRun: false }),
    ).rejects.toThrow('actionFn must be a function');
  });

  it('delayMin:null / delayMax:null normalize to defaults (1000/3000), no throw', async () => {
    const delay = makeDelaySpy();
    await runGuardedBatch(['a', 'b'], async () => {}, {
      dryRun: false, delay, maxRetry: 0, delayMin: null, delayMax: null,
    });
    expect(delay.calls).toEqual([[1000, 3000]]);
  });
});

// ── runGuardedBatch: retry semantics ─────────────────────────────────────────

describe('runGuardedBatch — retry', () => {
  it('maxRetry:2 → a persistently failing item is attempted exactly 3 times (1 + maxRetry)', async () => {
    let attempts = 0;
    const result = await runGuardedBatch(['x'], async () => {
      attempts++; throw new Error('boom');
    }, { dryRun: false, delay: makeDelaySpy(), maxRetry: 2 });
    expect(attempts).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].error).toBe('boom');
  });

  it('default maxRetry (1) → a failing item is retried once (2 attempts total)', async () => {
    let attempts = 0;
    await runGuardedBatch(['x'], async () => {
      attempts++; throw new Error('boom');
    }, { dryRun: false, delay: makeDelaySpy() });
    expect(attempts).toBe(2);
  });

  it('a transient failure that succeeds on retry → ok:true, counted once', async () => {
    let attempts = 0;
    const result = await runGuardedBatch(['x'], async () => {
      attempts++;
      if (attempts === 1) throw new Error('transient');
    }, { dryRun: false, delay: makeDelaySpy(), maxRetry: 1 });
    expect(attempts).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].ok).toBe(true);
  });
});

// ── runGuardedBatch: per-item + seams ────────────────────────────────────────

describe('runGuardedBatch — items + seams', () => {
  it('null/undefined item is skipped with ok:false, batch continues', async () => {
    const seen = [];
    const result = await runGuardedBatch([null, 'b', undefined], async (it) => { seen.push(it); }, {
      dryRun: false, delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(seen).toEqual(['b']); // null/undefined never reach actionFn
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(2);
    const nullEntry = result.results[0];
    expect(nullEntry.ok).toBe(false);
    expect(nullEntry.error).toContain('null/undefined item skipped');
  });

  it('onProgress is called per item with {attempted,total}; a throwing onProgress never aborts the batch', async () => {
    const progress = [];
    const result = await runGuardedBatch(['a', 'b', 'c'], async () => {}, {
      dryRun: false, delay: makeDelaySpy(), maxRetry: 0,
      onProgress: ({ attempted, total }) => {
        progress.push([attempted, total]);
        throw new Error('onProgress blew up'); // must be swallowed
      },
    });
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(result.succeeded).toBe(3); // batch unaffected by the throwing callback
  });

  it('shouldStop returning true aborts remaining items', async () => {
    const seen = [];
    const result = await runGuardedBatch(['a', 'b', 'c'], async (it) => { seen.push(it); }, {
      dryRun: false, delay: makeDelaySpy(), maxRetry: 0,
      shouldStop: ({ attempted }) => attempted === 1, // stop after the first
    });
    expect(seen).toEqual(['a']);
    expect(result.attempted).toBe(1);
  });

  it('a throwing delay seam is logged and does not abort the batch', async () => {
    const seen = [];
    const throwingDelay = async () => { throw new Error('delay exploded'); };
    const result = await runGuardedBatch(['a', 'b'], async (it) => { seen.push(it); }, {
      dryRun: false, delay: throwingDelay, maxRetry: 0,
    });
    expect(seen).toEqual(['a', 'b']); // both processed despite the delay throwing between them
    expect(result.succeeded).toBe(2);
  });

  it('real-run result carries the ACCOUNT_RISK_WARNING (NFR-8 surfaced)', async () => {
    const result = await runGuardedBatch(['a'], async () => {}, {
      dryRun: false, delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(result.warning).toBe(ACCOUNT_RISK_WARNING);
    expect(result.dryRun).toBe(false);
  });
});

// ── assertFacebookUrl ────────────────────────────────────────────────────────

describe('assertFacebookUrl', () => {
  it('accepts an https facebook.com URL', () => {
    expect(() => assertFacebookUrl('https://www.facebook.com/groups/x')).not.toThrow();
  });

  it('accepts an http (non-TLS) facebook.com URL', () => {
    expect(() => assertFacebookUrl('http://facebook.com/x')).not.toThrow();
  });

  it('accepts facebook.com subdomains (m./web./business.)', () => {
    for (const host of ['m', 'web', 'business']) {
      expect(() => assertFacebookUrl(`https://${host}.facebook.com/p/1`)).not.toThrow();
    }
  });

  it('rejects non-string input (undefined / number / object) before parsing', () => {
    expect(() => assertFacebookUrl(undefined)).toThrow('non-empty string');
    expect(() => assertFacebookUrl(42)).toThrow('non-empty string');
    expect(() => assertFacebookUrl({})).toThrow('non-empty string');
  });

  it('rejects a whitespace-only string', () => {
    expect(() => assertFacebookUrl('   ')).toThrow('non-empty string');
  });

  it('rejects an unparseable URL', () => {
    expect(() => assertFacebookUrl('not a url')).toThrow('valid URL');
  });

  it('rejects non-http(s) schemes (SSRF guard: file:/ javascript:)', () => {
    expect(() => assertFacebookUrl('file:///etc/passwd')).toThrow('http(s) URL');
    expect(() => assertFacebookUrl('javascript:alert(1)')).toThrow(/http\(s\) URL|valid URL/);
  });

  it('rejects a non-facebook host (and lookalike domains)', () => {
    expect(() => assertFacebookUrl('https://evil.com/x')).toThrow('facebook.com URL');
    expect(() => assertFacebookUrl('https://notfacebook.com/x')).toThrow('facebook.com URL');
    expect(() => assertFacebookUrl('https://facebook.com.evil.com/x')).toThrow('facebook.com URL');
  });

  it('uses the supplied label in the thrown message', () => {
    expect(() => assertFacebookUrl('https://evil.com', 'myCaller: target')).toThrow('myCaller: target');
  });
});
