// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — jev-verify harness unit tests (fetch stubbed — no real API calls)
// Covers: buildQuestions isSpam parity, evaluate, summarize, checkFloors,
// validateCorpusItems, and main() gate wiring → exit codes → --out payload.
// by nichxbt

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import {
  buildQuestions,
  evaluate,
  summarize,
  checkFloors,
  validateCorpusItems,
  main,
} from '../../scripts/jev-verify/verify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

// Real gate config — tests must track the shipped files, not stale copies
const FLOORS = JSON.parse(readFileSync(join(repoRoot, 'scripts/jev-verify/floors.json'), 'utf-8'));
const BASELINE = JSON.parse(readFileSync(join(repoRoot, 'scripts/jev-verify/baseline.json'), 'utf-8'));
const CORPUS = JSON.parse(readFileSync(join(repoRoot, 'scripts/jev-verify/corpus.json'), 'utf-8'));
const TRUTH_BY_TEXT = new Map(CORPUS.items.map(i => [i.text, i.truth]));

const SHARED_SPAM_INSTRUCTION =
  'This post is spam, bait, scam, or airdrop-farming — not mere self-promotion';

const makeItem = (over = {}) => ({
  id: 'x1',
  lang: 'vi',
  text: 'sample tweet text',
  author: 'tester',
  truth: { relevant: 1, spam: 0, replyWorthy: 1 },
  ...over,
});

const makeAnswers = (over = {}) => ({
  relevance: { score: 3, confidence: 0.9 },
  action: { choice: 'like', confidence: 0.8 },
  isSpam: { noul: 0.1 },
  replyWorthy: { noul: 0.7 },
  ...over,
});

const makeSummary = (over = {}) => ({
  evaluated: 52,
  relevance: 0.85,
  spam: 0.98,
  byLang: { vi: 0.92, en: 0.8, mixed: 1.0 },
  tokens: { in: 1000, out: 200 },
  wallMs: 5000,
  cost: 0.000042,
  ...over,
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const jevOk = (answers) => ({
  ok: true,
  status: 200,
  json: async () => ({ answers, usage: { input_tokens: 10, output_tokens: 5 } }),
  text: async () => JSON.stringify({ answers }),
});

// Answers that score a perfect run — derive truth from the request's tweet text
const correctAnswers = () => mockFetch.mockImplementation(async (_url, opts) => {
  const { state } = JSON.parse(opts.body);
  const truth = TRUTH_BY_TEXT.get(state.tweet) ?? { relevant: 0, spam: 0 };
  return jevOk({
    relevance: { score: truth.relevant ? 3 : 0, confidence: 0.9 },
    action: { choice: 'ignore', confidence: 0.9 },
    isSpam: { noul: truth.spam ? 0.9 : 0.1 },
    replyWorthy: { noul: 0.5 },
  });
});

const tmpOut = () => join(tmpdir(), `jev-verify-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

describe('buildQuestions', () => {
  it('returns the four-question set with typed primitives', () => {
    const q = buildQuestions(['ai', 'llm']);
    expect(q.relevance.type).toBe('score');
    expect(q.action.type).toBe('choice');
    expect(q.isSpam.type).toBe('noul');
    expect(q.replyWorthy.type).toBe('noul');
    expect(q.relevance.criteria).toHaveLength(4);
    expect(Object.keys(q.action.criteria)).toEqual(
      expect.arrayContaining(['ignore', 'like', 'bookmark', 'reply', 'quote']),
    );
  });

  it('isSpam instruction is the human-approved literal', () => {
    expect(buildQuestions([]).isSpam.instructions).toBe(SHARED_SPAM_INSTRUCTION);
  });

  it('isSpam instruction is byte-identical across harness + 3 prod sites', () => {
    const prodFiles = [
      'src/agents/thoughtLeaderAgent.js',
      'src/algorithmBuilder.js',
    ];
    const literal = buildQuestions([]).isSpam.instructions;
    let prodHits = 0;
    for (const rel of prodFiles) {
      const src = readFileSync(join(repoRoot, rel), 'utf-8');
      const matches = src.split(`instructions: '${literal}'`).length - 1;
      prodHits += matches;
      expect(matches, `${rel} must contain the shared isSpam literal`).toBeGreaterThan(0);
    }
    // 2 sites in thoughtLeaderAgent + 1 in algorithmBuilder
    expect(prodHits).toBe(3);
  });
});

describe('evaluate', () => {
  it('maps relevance score >= 2 to pred.relevant = 1', () => {
    const ev = evaluate(makeItem(), makeAnswers({ relevance: { score: 2, confidence: 0.8 } }));
    expect(ev.pred.relevant).toBe(1);
    expect(ev.hit.relevant).toBe(true);
  });

  it('maps relevance score < 2 to pred.relevant = 0', () => {
    const ev = evaluate(makeItem(), makeAnswers({ relevance: { score: 1, confidence: 0.8 } }));
    expect(ev.pred.relevant).toBe(0);
    expect(ev.hit.relevant).toBe(false);
  });

  it('maps isSpam noul >= 0.6 to pred.spam = 1', () => {
    const item = makeItem({ truth: { relevant: 1, spam: 1, replyWorthy: 0 } });
    const ev = evaluate(item, makeAnswers({ isSpam: { noul: 0.6 } }));
    expect(ev.pred.spam).toBe(1);
    expect(ev.hit.spam).toBe(true);
  });

  it('maps isSpam noul < 0.6 to pred.spam = 0', () => {
    const ev = evaluate(makeItem(), makeAnswers({ isSpam: { noul: 0.59 } }));
    expect(ev.pred.spam).toBe(0);
    expect(ev.hit.spam).toBe(true);
  });

  it('does not throw on undefined answers — null preds miss truth', () => {
    const ev = evaluate(makeItem(), undefined);
    expect(ev.relScore).toBeNull();
    expect(ev.spam).toBeNull();
    expect(ev.action).toBeNull();
    expect(ev.pred).toEqual({ relevant: 0, spam: 0 });
  });

  it('does not throw on partial answers', () => {
    const ev = evaluate(makeItem(), { isSpam: { noul: 0.9 } });
    expect(ev.relScore).toBeNull();
    expect(ev.spam).toBe(0.9);
    expect(ev.pred.spam).toBe(1);
    expect(ev.pred.relevant).toBe(0);
  });

  it('pins missing-answer → truth=0 semantics (why main treats missing answers as item errors)', () => {
    // A truth=0 item scores HITS on null preds — silently inflating accuracy.
    // This is why the main loop must reject responses lacking an answers object.
    const ev = evaluate(makeItem({ truth: { relevant: 0, spam: 0, replyWorthy: 0 } }), undefined);
    expect(ev.hit.relevant).toBe(true);
    expect(ev.hit.spam).toBe(true);
  });
});

describe('summarize', () => {
  it('computes relevance/spam accuracy over evaluated items', () => {
    const results = [
      { lang: 'vi', hit: { relevant: true, spam: true } },
      { lang: 'vi', hit: { relevant: false, spam: true } },
      { lang: 'en', hit: { relevant: true, spam: false } },
      { lang: 'en', hit: { relevant: true, spam: true } },
    ];
    const s = summarize(results);
    expect(s.evaluated).toBe(4);
    expect(s.relevance).toBeCloseTo(0.75);
    expect(s.spam).toBeCloseTo(0.75);
  });

  it('byLang is combined accuracy (relevant && spam hit) per lang', () => {
    const results = [
      { lang: 'vi', hit: { relevant: true, spam: true } },   // combined hit
      { lang: 'vi', hit: { relevant: true, spam: false } },  // miss
      { lang: 'en', hit: { relevant: true, spam: true } },   // hit
      { lang: 'en', hit: { relevant: false, spam: false } }, // miss
    ];
    const s = summarize(results);
    expect(s.byLang.vi).toBeCloseTo(0.5);
    expect(s.byLang.en).toBeCloseTo(0.5);
  });

  it('computes token totals and $42/B input cost', () => {
    const s = summarize([{ lang: 'vi', hit: { relevant: true, spam: true } }], {
      tokens: { in: 1e9, out: 500 },
    });
    expect(s.tokens.in).toBe(1e9);
    expect(s.cost).toBeCloseTo(42);
  });

  it('empty results → zero metrics, no throw', () => {
    const s = summarize([]);
    expect(s.evaluated).toBe(0);
    expect(s.relevance).toBe(0);
    expect(s.byLang).toEqual({});
  });
});

describe('checkFloors', () => {
  it('passes when every metric clears its floor', () => {
    const v = checkFloors(makeSummary(), {
      floors: FLOORS, baseline: BASELINE, errors: 0, totalItems: 52,
    });
    expect(v.ok).toBe(true);
    expect(v.breaches).toHaveLength(0);
  });

  it('breaches on spam accuracy below 0.95 floor', () => {
    const v = checkFloors(makeSummary({ spam: 0.93 }), {
      floors: FLOORS, baseline: BASELINE, errors: 0, totalItems: 52,
    });
    expect(v.ok).toBe(false);
    const b = v.breaches.find(b => b.metric === 'spam');
    expect(b).toBeDefined();
    expect(b.message).toContain('93.0% < floor 95.0%');
  });

  it('breaches on vi accuracy below 0.85 floor', () => {
    const v = checkFloors(makeSummary({ byLang: { vi: 0.8, en: 0.8 } }), {
      floors: FLOORS, baseline: BASELINE, errors: 0, totalItems: 52,
    });
    expect(v.ok).toBe(false);
    expect(v.breaches.some(b => b.metric === 'vi')).toBe(true);
  });

  it('breaches on relevance below 0.75 floor', () => {
    const v = checkFloors(makeSummary({ relevance: 0.7 }), {
      floors: FLOORS, baseline: BASELINE, errors: 0, totalItems: 52,
    });
    expect(v.ok).toBe(false);
    expect(v.breaches.some(b => b.metric === 'relevance')).toBe(true);
  });

  it('enforces any metric placed in floors.overall (generic iteration)', () => {
    const floors = { overall: { relevance: 0.9 }, byLang: {}, driftWarnDelta: 0.05, maxItemErrorRate: 0.2 };
    const v = checkFloors(makeSummary({ relevance: 0.85 }), {
      floors, baseline: {}, errors: 0, totalItems: 52,
    });
    expect(v.ok).toBe(false);
    expect(v.breaches).toHaveLength(1);
    expect(v.breaches[0].metric).toBe('relevance');
  });

  it('warns (not fails) on drift >= driftWarnDelta while still above floor', () => {
    // relevance 0.79 vs baseline ~0.846 → delta ~0.056 >= 0.05, still >= floor 0.75
    const v = checkFloors(makeSummary({ relevance: 0.79 }), {
      floors: FLOORS, baseline: BASELINE, errors: 0, totalItems: 52,
    });
    expect(v.ok).toBe(true);
    expect(v.breaches).toHaveLength(0);
    const w = v.warnings.find(w => w.metric === 'relevance');
    expect(w).toBeDefined();
    expect(w.message).toContain('drifted');
  });

  it('applies drift check to byLang baseline keys (vi/mixed/en)', () => {
    const v = checkFloors(makeSummary({ byLang: { vi: 0.85, en: 0.7, mixed: 0.9 } }), {
      floors: FLOORS, baseline: BASELINE, errors: 0, totalItems: 52,
    });
    // en: baseline ~0.774 → 0.7 ≈ -0.074 drift (en has no floor → warning)
    // mixed: baseline 1.0 → 0.9 = -0.10 drift (no floor → warning)
    expect(v.ok).toBe(true);
    expect(v.warnings.some(w => w.metric === 'en')).toBe(true);
    expect(v.warnings.some(w => w.metric === 'mixed')).toBe(true);
  });

  it('warns when a baseline metric is absent from the summary (no silent skip)', () => {
    const v = checkFloors(makeSummary({ byLang: { vi: 0.95, en: 0.8 } }), {
      floors: FLOORS, baseline: BASELINE, errors: 0, totalItems: 52,
    });
    expect(v.warnings.some(w => w.metric === 'mixed')).toBe(true);
    expect(v.warnings.find(w => w.metric === 'mixed').message).toContain('absent');
  });

  it('invalidates the run when item error rate exceeds maxItemErrorRate', () => {
    const v = checkFloors(makeSummary(), {
      floors: FLOORS, baseline: BASELINE, errors: 11, totalItems: 52,
    });
    expect(v.ok).toBe(false);
    expect(v.errorRate).toBeCloseTo(11 / 52);
    expect(v.breaches.some(b => b.metric === 'errorRate')).toBe(true);
    // floors not evaluated on a thin sample — no floor breaches reported
    expect(v.breaches.every(b => b.metric === 'errorRate' || b.metric === 'corpus')).toBe(true);
  });

  it('does not invalidate at exactly maxItemErrorRate', () => {
    const v = checkFloors(makeSummary(), {
      floors: FLOORS, baseline: BASELINE, errors: 10, totalItems: 50,
    });
    expect(v.errorRate).toBeCloseTo(0.2);
    expect(v.breaches.some(b => b.metric === 'errorRate')).toBe(false);
  });

  it('breaches when corpus is below minimum (< 50)', () => {
    const v = checkFloors(makeSummary({ evaluated: 40 }), {
      floors: FLOORS, baseline: BASELINE, errors: 0, totalItems: 40,
    });
    expect(v.ok).toBe(false);
    expect(v.breaches.some(b => b.metric === 'corpus')).toBe(true);
    expect(v.breaches.find(b => b.metric === 'corpus').message).toContain('(40 < 50)');
  });

  it('honors floors.minItems over the default 50', () => {
    const floors = { ...FLOORS, minItems: 60 };
    const v = checkFloors(makeSummary(), {
      floors, baseline: BASELINE, errors: 0, totalItems: 52,
    });
    expect(v.breaches.some(b => b.metric === 'corpus')).toBe(true);
  });
});

describe('validateCorpusItems', () => {
  it('shipped corpus is fully valid', () => {
    const { valid, bad } = validateCorpusItems(CORPUS.items);
    expect(bad).toEqual([]);
    expect(valid).toHaveLength(CORPUS.items.length);
  });

  it('flags duplicate ids, empty text, bad lang, non-binary truth', () => {
    const { bad } = validateCorpusItems([
      makeItem({ id: 'a', truth: { relevant: 1, spam: 0 } }),
      makeItem({ id: 'a' }),                                     // duplicate id
      makeItem({ id: 'b', text: '  ' }),                          // empty text
      makeItem({ id: 'c', lang: 'fr' }),                          // bad lang
      makeItem({ id: 'd', truth: { relevant: 2, spam: 0 } }),     // truth not 0|1
      makeItem({ id: 'e', truth: { relevant: 1, spam: 'no' } }),  // truth not 0|1
    ]);
    expect(bad).toHaveLength(5);
    expect(bad.map(b => b.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('main() — gate wiring → exit code → --out', () => {
  let logSpy;

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv('TYPESAFE_API_KEY', 'test-jev-key');
    vi.stubEnv('TYPESAFE_API_ENDPOINT', '');
    vi.stubEnv('GITHUB_SHA', '');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('passing run → exit 0 + full --out payload with gate verdict', async () => {
    correctAnswers();
    const out = tmpOut();
    const code = await main(['--ci', '--out', out]);
    expect(code).toBe(0);
    const payload = JSON.parse(readFileSync(out, 'utf-8'));
    expect(payload.evaluated).toBe(CORPUS.items.length);
    expect(payload.totalItems).toBe(CORPUS.items.length);
    expect(payload.gate.ok).toBe(true);
    expect(payload.model).toBe('jev-latest');
    expect(payload.endpoint).toBe('https://api.typesafe.ai/v1/systemone');
    expect(payload.errors).toBe(0);
  });

  it('floor breach → exit 1 + ::error:: emitted + --out still written', async () => {
    // Inverted spam predictions → spam accuracy 0 < 0.95 floor
    mockFetch.mockImplementation(async (_url, opts) => {
      const { state } = JSON.parse(opts.body);
      const truth = TRUTH_BY_TEXT.get(state.tweet) ?? { relevant: 0, spam: 0 };
      return jevOk({
        relevance: { score: truth.relevant ? 3 : 0, confidence: 0.9 },
        isSpam: { noul: truth.spam ? 0.1 : 0.9 },
      });
    });
    const out = tmpOut();
    const code = await main(['--ci', '--out', out]);
    expect(code).toBe(1);
    const logged = logSpy.mock.calls.flat().join('\n');
    expect(logged).toContain('::error::');
    expect(logged).toContain('spam accuracy');
    const payload = JSON.parse(readFileSync(out, 'utf-8'));
    expect(payload.gate.ok).toBe(false);
    expect(payload.gate.breaches.some(b => b.metric === 'spam')).toBe(true);
  });

  it('response missing answers object → counted as item error, not accuracy', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ usage: { input_tokens: 1, output_tokens: 1 } }), // no answers
      text: async () => '{}',
    }));
    const out = tmpOut();
    const code = await main(['--ci', '--out', out]);
    expect(code).toBe(1); // error rate 100% → run invalid
    const payload = JSON.parse(readFileSync(out, 'utf-8'));
    expect(payload.errors).toBe(CORPUS.items.length);
  });

  it('--validate → exit 0 on shipped corpus + gate config, no fetch calls', async () => {
    const code = await main(['--validate']);
    expect(code).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('bad flags → exit 1 (unknown arg, --out without value)', async () => {
    expect(await main(['--bogus'])).toBe(1);
    expect(await main(['--out'])).toBe(1);
    expect(await main(['--out', '--ci'])).toBe(1);
    expect(await main(['--out='])).toBe(1);
  });

  it('missing API key → exit 1 + minimal --out payload', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const out = tmpOut();
    const code = await main(['--ci', '--out', out]);
    expect(code).toBe(1);
    const payload = JSON.parse(readFileSync(out, 'utf-8'));
    expect(payload.error).toContain('TYPESAFE_API_KEY');
    expect(payload.errors).toBe(0);
    expect(payload.errorItems).toEqual([]);
  });
});
