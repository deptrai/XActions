// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 42.4 — JevChallengeDiagnoser: semantic second opinion for suspicious
 * 2xx responses and 0-record scrapes. No-network: a real JevBrain instance is
 * injected with `decide` stubbed (fakes-at-IO-boundary convention); the real
 * `gate()` + `pageStatus` threshold is exercised.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  JevChallengeDiagnoser,
  globalJevChallengeDiagnoser,
  extractSnippet,
  isJevChallengeDiagEnabled,
  resolvePageStatusThreshold,
} from '../../src/core/jev-challenge-diagnoser.js';
import { JevBrain } from '../../src/agents/jevBrain.js';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { ChallengeSignatureDetector } from '../../src/core/challenge-signature-detector.js';
import { BotChallengeError } from '../../src/core/error-envelope.js';

function makeBrain(choice, confidence, { degraded = false, reason } = {}) {
  const brain = new JevBrain({ apiKey: 'test-jev-key' });
  brain.decide = vi.fn().mockResolvedValue(
    degraded
      ? {
          answers: {},
          usage: { input_tokens: 0, output_tokens: 0 },
          meta: { degraded: true, reason: reason || 'missing-key', source: 'llmbrain' },
        }
      : {
          answers: {
            pageStatus: { type: 'choice', choice, confidence },
          },
          usage: { input_tokens: 10, output_tokens: 3 },
          meta: { degraded: false, source: 'jev' },
        },
  );
  return brain;
}

describe('extractSnippet', () => {
  it('strips HTML tags, scripts/styles, collapses whitespace', () => {
    const html = `<!DOCTYPE html><html><head><title>Hold on</title>
      <style>body{color:red}</style>
      <script>window.__x = 1;</script></head>
      <body><div class="wall">  Verify   you are
      human </div><!-- comment --></body></html>`;
    const snippet = extractSnippet(html);
    expect(snippet).not.toContain('<');
    expect(snippet).not.toContain('window.__x');
    expect(snippet).not.toContain('color:red');
    expect(snippet).toContain('Verify you are human');
    expect(snippet).not.toMatch(/\s{2,}/);
  });

  it('serializes objects via JSON.stringify and slices to 500 chars', () => {
    const obj = { items: [], note: 'x'.repeat(1000) };
    const snippet = extractSnippet(obj);
    expect(snippet.startsWith('{"items":[]')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(500);
  });

  it('slices long plain text to 500 chars', () => {
    const snippet = extractSnippet('a'.repeat(2000));
    expect(snippet.length).toBe(500);
  });

  it('returns empty string for null/undefined/empty input', () => {
    expect(extractSnippet(null)).toBe('');
    expect(extractSnippet(undefined)).toBe('');
    expect(extractSnippet('')).toBe('');
    expect(extractSnippet('   ')).toBe('');
  });

  it('decodes Buffer bodies to utf8 text', () => {
    const snippet = extractSnippet(Buffer.from('<p>checkpoint</p>'));
    expect(snippet).toBe('checkpoint');
  });

  it('bounds huge bodies before regex work and still caps at 500 chars', () => {
    const huge = `<div>${'wall '.repeat(20000)}</div>`; // ~100KB of markup
    const snippet = extractSnippet(huge);
    expect(snippet.length).toBeLessThanOrEqual(500);
    expect(snippet).not.toContain('<');
    // Buffer path is bounded too
    const hugeBuf = Buffer.from('x'.repeat(200 * 1024));
    expect(extractSnippet(hugeBuf).length).toBeLessThanOrEqual(500);
  });

  it('returns "" on JSON.stringify failure (circular / BigInt) — never "[object Object]"', () => {
    const circular = {};
    circular.self = circular;
    expect(extractSnippet(circular)).toBe('');
    expect(extractSnippet({ n: 10n })).toBe('');
  });

  it('does not mangle JSON that merely contains < / > characters', () => {
    const snippet = extractSnippet({ a: '<', b: '>' });
    expect(snippet).toContain('"a":"<"');
    expect(snippet).toContain('"b":">"');
    const cmp = extractSnippet('{"compare":"x > y, y < z"}');
    expect(cmp).toContain('x > y');
    expect(cmp).toContain('y < z');
  });
});

describe('env helpers — kill-switch polarity & threshold', () => {
  it('JEV_CHALLENGE_DIAG defaults ON; only 0|false|off|no disables', () => {
    // No-arg call reads process.env — stub unset so this is env-independent.
    vi.stubEnv('JEV_CHALLENGE_DIAG', '');
    expect(isJevChallengeDiagEnabled()).toBe(true);
    vi.unstubAllEnvs();

    expect(isJevChallengeDiagEnabled(null)).toBe(true);
    expect(isJevChallengeDiagEnabled('')).toBe(true);
    expect(isJevChallengeDiagEnabled('1')).toBe(true);
    expect(isJevChallengeDiagEnabled('true')).toBe(true);
    expect(isJevChallengeDiagEnabled('anything')).toBe(true);
    expect(isJevChallengeDiagEnabled('0')).toBe(false);
    expect(isJevChallengeDiagEnabled('false')).toBe(false);
    expect(isJevChallengeDiagEnabled('OFF')).toBe(false);
    expect(isJevChallengeDiagEnabled(' no ')).toBe(false);
    expect(isJevChallengeDiagEnabled(false)).toBe(false);
  });

  it('env JEV_CHALLENGE_DIAG=0 disables a default-constructed diagnoser', () => {
    vi.stubEnv('JEV_CHALLENGE_DIAG', '0');
    expect(isJevChallengeDiagEnabled()).toBe(false);
    const diagnoser = new JevChallengeDiagnoser({ brain: makeBrain('bot_challenge', 0.99) });
    expect(diagnoser.enabled).toBe(false);
    vi.unstubAllEnvs();
  });

  it('JEV_THRESHOLD_PAGESTATUS parses floats, defaults 0.8', () => {
    vi.stubEnv('JEV_THRESHOLD_PAGESTATUS', '');
    expect(resolvePageStatusThreshold()).toBe(0.8);
    vi.unstubAllEnvs();
    expect(resolvePageStatusThreshold('')).toBe(0.8);
    expect(resolvePageStatusThreshold('0.9')).toBe(0.9);
    expect(resolvePageStatusThreshold('garbage')).toBe(0.8);
    expect(resolvePageStatusThreshold(0.65)).toBe(0.65);
  });

  it('clamps the threshold to [0,1]', () => {
    expect(resolvePageStatusThreshold('1.5')).toBe(1);
    expect(resolvePageStatusThreshold('-0.2')).toBe(0);
    expect(resolvePageStatusThreshold(2)).toBe(1);
  });

  it('opts.enabled given as a string is normalized via the kill-switch polarity', () => {
    const brain = makeBrain('bot_challenge', 0.99);
    expect(new JevChallengeDiagnoser({ brain, enabled: '0' }).enabled).toBe(false);
    expect(new JevChallengeDiagnoser({ brain, enabled: 'off' }).enabled).toBe(false);
    expect(new JevChallengeDiagnoser({ brain, enabled: '1' }).enabled).toBe(true);
  });

  it('enabled resolves env lazily per call — post-construction env changes apply', async () => {
    const brain = makeBrain('bot_challenge', 0.99);
    vi.stubEnv('JEV_CHALLENGE_DIAG', '1');
    const diagnoser = new JevChallengeDiagnoser({ brain }); // no explicit enabled
    expect(diagnoser.enabled).toBe(true);
    // Runtime flip — a singleton constructed before this must honor it.
    vi.stubEnv('JEV_CHALLENGE_DIAG', '0');
    expect(diagnoser.enabled).toBe(false);
    expect(await diagnoser.diagnose({ snippet: 'wall', platform: 'x' })).toBeNull();
    expect(brain.decide).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe('JevChallengeDiagnoser.diagnose — I/O matrix', () => {
  it('HAPPY_EMPTY: verdict ok conf 0.9 → no escalation, one decide call', async () => {
    const brain = makeBrain('ok', 0.9);
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    const diag = await diagnoser.diagnose({ snippet: '{"items":[]}', platform: 'twitter' });
    expect(brain.decide).toHaveBeenCalledTimes(1);
    expect(diag.verdict).toBe('ok');
    expect(diag.confidence).toBe(0.9);
    expect(diag.escalate).toBe(false);
    expect(diag.degraded).toBe(false);
  });

  it('JEV_CHALLENGE: verdict bot_challenge conf 0.92 → escalate', async () => {
    const brain = makeBrain('bot_challenge', 0.92);
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    const diag = await diagnoser.diagnose({ snippet: 'Verify you are human — puzzle wall', platform: 'twitter' });
    expect(diag.escalate).toBe(true);
    expect(diag.gate).toBe('act');
    expect(diag.verdict).toBe('bot_challenge');
    expect(diag.confidence).toBe(0.92);
  });

  it('JEV_LOGIN_WALL: verdict login_wall conf 0.85 → escalate', async () => {
    const brain = makeBrain('login_wall', 0.85);
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    const diag = await diagnoser.diagnose({ snippet: 'Sign in to continue', platform: 'facebook' });
    expect(diag.escalate).toBe(true);
    expect(diag.gate).toBe('act');
  });

  it('MID_CONF: bot_challenge conf 0.7 (<0.8) → gate review, no escalate', async () => {
    const brain = makeBrain('bot_challenge', 0.7);
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diag = await diagnoser.diagnose({ snippet: 'suspicious wall', platform: 'tiktok' });
    expect(diag.escalate).toBe(false);
    expect(diag.gate).toBe('review');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('DEGRADED: meta.degraded → no escalation, degraded flagged', async () => {
    const brain = makeBrain('bot_challenge', 0.99, { degraded: true });
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    const diag = await diagnoser.diagnose({ snippet: 'wall', platform: 'twitter' });
    expect(diag.degraded).toBe(true);
    expect(diag.escalate).toBe(false);
  });

  it('RATE_LIMITED: verdict rate_limited conf 0.9 → log only, no escalate', async () => {
    const brain = makeBrain('rate_limited', 0.9);
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    const diag = await diagnoser.diagnose({ snippet: 'Too many requests, slow down', platform: 'reddit' });
    expect(diag.escalate).toBe(false);
    expect(diag.gate).toBe('act'); // high conf acts at the gate but verdict is non-escalatable
  });

  it('KILL_SWITCH: enabled=false → null, decide never called', async () => {
    const brain = makeBrain('bot_challenge', 0.99);
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: false });
    const diag = await diagnoser.diagnose({ snippet: 'wall', platform: 'twitter' });
    expect(diag).toBeNull();
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('SNIPPET_EDGE: empty snippet → null, decide never called', async () => {
    const brain = makeBrain('bot_challenge', 0.99);
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    expect(await diagnoser.diagnose({ snippet: '', platform: 'twitter' })).toBeNull();
    expect(await diagnoser.diagnose({ snippet: '   ', platform: 'twitter' })).toBeNull();
    expect(await diagnoser.diagnose({ snippet: null, platform: 'twitter' })).toBeNull();
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('decide() throwing is swallowed — diagnose returns null, never throws', async () => {
    const brain = new JevBrain({ apiKey: 'test' });
    brain.decide = vi.fn().mockRejectedValue(new Error('network boom'));
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(diagnoser.diagnose({ snippet: 'wall', platform: 'x' })).resolves.toBeNull();
    warn.mockRestore();
  });

  it('sends the pageStatus Choice question with all four criteria', async () => {
    const brain = makeBrain('ok', 0.9);
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    await diagnoser.diagnose({ snippet: 'data', platform: 'twitter' });
    const questions = brain.decide.mock.calls[0][1];
    expect(questions.pageStatus.type).toBe('choice');
    expect(Object.keys(questions.pageStatus.criteria).sort()).toEqual(
      ['bot_challenge', 'login_wall', 'ok', 'rate_limited'].sort(),
    );
  });

  it('threshold override raises the act bar (conf 0.85 < 0.9 → review)', async () => {
    const brain = new JevBrain({ apiKey: 'test', confidenceThresholds: { pageStatus: 0.9 } });
    brain.decide = vi.fn().mockResolvedValue({
      answers: { pageStatus: { type: 'choice', choice: 'bot_challenge', confidence: 0.85 } },
      usage: { input_tokens: 1, output_tokens: 1 },
      meta: { degraded: false, source: 'jev' },
    });
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true, threshold: 0.9 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diag = await diagnoser.diagnose({ snippet: 'wall', platform: 'x' });
    expect(diag.escalate).toBe(false);
    expect(diag.gate).toBe('review');
    warn.mockRestore();
  });

  it('applies an explicit opts.threshold onto an injected brain (G11)', async () => {
    // Brain ships the 0.80 default; the explicit diagnoser override must win.
    const brain = new JevBrain({ apiKey: 'test' });
    brain.decide = vi.fn().mockResolvedValue({
      answers: { pageStatus: { type: 'choice', choice: 'bot_challenge', confidence: 0.9 } },
      usage: { input_tokens: 1, output_tokens: 1 },
      meta: { degraded: false, source: 'jev' },
    });
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true, threshold: 0.95 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const diag = await diagnoser.diagnose({ snippet: 'wall', platform: 'x' });
    expect(brain.confidenceThresholds.pageStatus).toBe(0.95);
    expect(diag.gate).toBe('review'); // 0.9 < 0.95 → no escalation
    expect(diag.escalate).toBe(false);
    warn.mockRestore();
  });

  it('leaves an injected brain\'s own thresholds untouched without opts.threshold', async () => {
    const brain = new JevBrain({ apiKey: 'test', confidenceThresholds: { pageStatus: 0.5 } });
    brain.decide = vi.fn().mockResolvedValue({
      answers: { pageStatus: { type: 'choice', choice: 'bot_challenge', confidence: 0.6 } },
      usage: { input_tokens: 1, output_tokens: 1 },
      meta: { degraded: false, source: 'jev' },
    });
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    const diag = await diagnoser.diagnose({ snippet: 'wall', platform: 'x' });
    expect(brain.confidenceThresholds.pageStatus).toBe(0.5);
    expect(diag.escalate).toBe(true); // 0.6 ≥ brain's own 0.5 → act
  });

  it('accepts raw bodies (non-string snippet) via extractSnippet', async () => {
    const brain = makeBrain('bot_challenge', 0.95);
    const diagnoser = new JevChallengeDiagnoser({ brain, enabled: true });
    const diag = await diagnoser.diagnose({ snippet: { html: '<p>puzzle</p>' }, platform: 'x' });
    expect(brain.decide).toHaveBeenCalledTimes(1);
    expect(typeof brain.decide.mock.calls[0][0]).toBe('string');
    expect(diag.escalate).toBe(true);
  });
});

describe('AbstractCrawler 0-records Jev hook (CRAWLER_0_RECORDS)', () => {
  class TestCrawler extends AbstractCrawler {
    name = 'test-crawler';
  }

  let savedBrain;
  let savedEnabled;

  beforeEach(() => {
    savedBrain = globalJevChallengeDiagnoser.brain;
    savedEnabled = globalJevChallengeDiagnoser.enabled;
    globalJevChallengeDiagnoser.enabled = true;
  });

  afterEach(() => {
    globalJevChallengeDiagnoser.brain = savedBrain;
    globalJevChallengeDiagnoser.enabled = savedEnabled;
  });

  function makeCrawler(handlerResult, snippet) {
    const client = {
      governor: null,
      accountPool: null,
      sessionManager: null,
      challengeDetector: null,
      healthOrchestrator: null,
      lastResponseSnippet: null,
      _lastJevDiag: null,
      telemetryContext: null,
      isCanary: false,
    };
    const crawler = new TestCrawler({ client });
    // The snippet is seeded INSIDE the handler — in production it is stashed
    // by client.request() while the handler runs; start() clears any stale
    // evidence at entry, so pre-seeding the client would not survive.
    crawler.registerAction('scrape', async () => {
      client.lastResponseSnippet = snippet;
      return handlerResult;
    });
    return { crawler, client };
  }

  it('0 records + suspicious snippet + Jev bot_challenge → BotChallengeError from start()', async () => {
    const brain = makeBrain('bot_challenge', 0.95);
    globalJevChallengeDiagnoser.brain = brain;
    const { crawler } = makeCrawler({ items: [] }, 'verify you are human puzzle');
    await expect(crawler.start({ action: 'scrape', args: {}, session: {} })).rejects.toThrow(BotChallengeError);
    expect(brain.decide).toHaveBeenCalledTimes(1);
  });

  it('0 records + Jev ok → empty result returned, no escalation', async () => {
    const brain = makeBrain('ok', 0.9);
    globalJevChallengeDiagnoser.brain = brain;
    const { crawler } = makeCrawler({ items: [] }, '{"items":[]}');
    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    expect(result).toEqual(expect.objectContaining({ items: [] }));
    expect(brain.decide).toHaveBeenCalledTimes(1);
  });

  it('0 records but NO stashed snippet → Jev skipped, result returned', async () => {
    const brain = makeBrain('bot_challenge', 0.99);
    globalJevChallengeDiagnoser.brain = brain;
    const { crawler } = makeCrawler([], null);
    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    expect(result).toEqual([]);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('non-empty result → Jev hook never fires', async () => {
    const brain = makeBrain('bot_challenge', 0.99);
    globalJevChallengeDiagnoser.brain = brain;
    const { crawler } = makeCrawler({ items: [{ id: 'p1' }] }, 'wall snippet');
    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    expect(result.items).toHaveLength(1);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('escalation runs the notify-trio against session.accountId (pool → governor → orchestrator)', async () => {
    const brain = makeBrain('bot_challenge', 0.95);
    globalJevChallengeDiagnoser.brain = brain;

    const order = [];
    const accountPool = { markUnavailable: vi.fn(() => order.push('pool')) };
    const governor = {
      canAccountRequest: () => true,
      recordRequest: () => {},
      recordBotChallenge: vi.fn(() => order.push('governor')),
    };
    const healthOrchestrator = { recordBotChallenge: vi.fn(() => order.push('orchestrator')) };

    const client = {
      governor, accountPool, sessionManager: null, challengeDetector: null,
      healthOrchestrator, lastResponseSnippet: null, _lastJevDiag: null,
      telemetryContext: null, isCanary: false,
    };
    const crawler = new TestCrawler({ client, accountPool, governor, healthOrchestrator });
    crawler.registerAction('scrape', async () => {
      client.lastResponseSnippet = 'puzzle wall';
      return { items: [] };
    });

    await expect(
      crawler.start({ action: 'scrape', args: {}, session: { accountId: 'acct_crawler' } }),
    ).rejects.toThrow(BotChallengeError);

    expect(order).toEqual(['pool', 'governor', 'orchestrator']);
    expect(accountPool.markUnavailable).toHaveBeenCalledWith('acct_crawler', 'bot_challenge', 20 * 60 * 1000, 'test-crawler');
    expect(governor.recordBotChallenge).toHaveBeenCalledWith('acct_crawler', 'test-crawler', 20 * 60 * 1000);
    expect(healthOrchestrator.recordBotChallenge).toHaveBeenCalledWith('test-crawler', 'acct_crawler');
  });

  it('dry-run 0-records → Jev skipped entirely, no hibernate, no decide', async () => {
    const brain = makeBrain('bot_challenge', 0.99);
    globalJevChallengeDiagnoser.brain = brain;
    const accountPool = { markUnavailable: vi.fn() };
    const { crawler } = makeCrawler({ items: [] }, 'puzzle wall');
    crawler.accountPool = accountPool;
    const result = await crawler.start({ action: 'scrape', args: { dryRun: true }, session: {} });
    expect(result.items).toEqual([]);
    expect(brain.decide).not.toHaveBeenCalled();
    expect(accountPool.markUnavailable).not.toHaveBeenCalled();
  });

  it('dedupe: client-level diagnosis is reused on identical snippet — no second decide', async () => {
    const brain = makeBrain('ok', 0.9);
    globalJevChallengeDiagnoser.brain = brain;
    const { crawler, client } = makeCrawler({ items: [] }, null);
    // Simulate the client-level hook having already diagnosed this evidence.
    const priorDiag = { verdict: 'ok', confidence: 0.9, gate: 'act', escalate: false, degraded: false };
    crawler.registerAction('scrape2', async () => {
      client.lastResponseSnippet = '{"items":[]}';
      client._lastJevDiag = { snippet: '{"items":[]}', diag: priorDiag };
      return { items: [] };
    });
    const result = await crawler.start({ action: 'scrape2', args: {}, session: {} });
    expect(result.items).toEqual([]);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('dedupe: reused escalating diagnosis still throws without a new decide call', async () => {
    const brain = makeBrain('bot_challenge', 0.99);
    globalJevChallengeDiagnoser.brain = brain;
    const { crawler, client } = makeCrawler({ items: [] }, null);
    const priorDiag = { verdict: 'bot_challenge', confidence: 0.9, gate: 'act', escalate: true, degraded: false };
    crawler.registerAction('scrape3', async () => {
      client.lastResponseSnippet = 'wall';
      client._lastJevDiag = { snippet: 'wall', diag: priorDiag };
      return { items: [] };
    });
    await expect(crawler.start({ action: 'scrape3', args: {}, session: {} })).rejects.toThrow(BotChallengeError);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it("sentinel accountId 'guest' is normalized to null — notify skipped, ROTATE_PROXY suggested", async () => {
    const brain = makeBrain('bot_challenge', 0.95);
    globalJevChallengeDiagnoser.brain = brain;
    const accountPool = { markUnavailable: vi.fn() };
    const { crawler } = makeCrawler({ items: [] }, 'wall');
    crawler.accountPool = accountPool;
    let thrown = null;
    try {
      await crawler.start({ action: 'scrape', args: {}, session: { accountId: 'guest' } });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BotChallengeError);
    expect(thrown.accountId).toBeNull();
    expect(accountPool.markUnavailable).not.toHaveBeenCalled();
  });

  it('0 records + missing snippet logs a one-line skip record', async () => {
    const brain = makeBrain('bot_challenge', 0.99);
    globalJevChallengeDiagnoser.brain = brain;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { crawler } = makeCrawler([], null);
    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    expect(result).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no response snippet'));
    log.mockRestore();
  });
});

describe('client → crawler end-to-end (real AbstractApiClient inside AbstractCrawler)', () => {
  class TestApiClient extends AbstractApiClient {
    name = 'test-e2e-client';
    platform = 'twitter';
    requiresAuth = false;
  }
  class TestCrawler extends AbstractCrawler {
    name = 'test-e2e-crawler';
  }

  const flaggingValidator = {
    platform: 'twitter',
    isFalse200: () => true,
    isBotChallenge: () => false,
    isRateLimit: () => false,
    isLoginWall: () => false,
    isValidPayload: () => true,
    validateResponse: () => ({ isValid: false, isFalse200: true, isCheckpoint: false }),
  };

  let savedBrain;
  let savedEnabled;

  beforeEach(() => {
    savedBrain = globalJevChallengeDiagnoser.brain;
    savedEnabled = globalJevChallengeDiagnoser.enabled;
    globalJevChallengeDiagnoser.enabled = true;
  });

  afterEach(() => {
    globalJevChallengeDiagnoser.brain = savedBrain;
    globalJevChallengeDiagnoser.enabled = savedEnabled;
  });

  it('dedupe: client-level Jev ok → crawler 0-records hook reuses it — decide called exactly once', async () => {
    const brain = makeBrain('ok', 0.9);
    globalJevChallengeDiagnoser.brain = brain;

    const client = new TestApiClient({
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: flaggingValidator,
      maxProxyRetries: 1,
      maxAccountRotations: 0,
      httpClient: async () => ({ status: 200, headers: {}, data: { items: [] } }),
    });
    const crawler = new TestCrawler({ client });
    crawler.registerAction('scrape', async () => {
      await client.request('GET', 'http://127.0.0.1:9/feed');
      return { items: [] };
    });

    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    expect(result.items).toEqual([]);
    // One paid decide call total — the crawler hook reused _lastJevDiag.
    expect(brain.decide).toHaveBeenCalledTimes(1);
  });

  it('handler that swallows BotChallengeError → punished evidence is gone — crawler hook does not re-diagnose', async () => {
    const brain = makeBrain('bot_challenge', 0.99);
    globalJevChallengeDiagnoser.brain = brain;

    const client = new TestApiClient({
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: flaggingValidator,
      maxProxyRetries: 1,
      maxAccountRotations: 0,
      // Static detector fires on this body → BotChallengeError clears evidence.
      httpClient: async () => ({
        status: 200,
        headers: {},
        data: '<html><body><div class="cf-challenge-running">cf-chl-bypass</div></body></html>',
      }),
    });
    const crawler = new TestCrawler({ client });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    crawler.registerAction('scrape', async () => {
      try {
        await client.request('GET', 'http://127.0.0.1:9/feed');
      } catch {
        // Swallowed — the run continues and returns 0 records.
      }
      return { items: [] };
    });

    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    expect(result.items).toEqual([]);
    expect(brain.decide).not.toHaveBeenCalled(); // no re-diagnosis of punished evidence
    expect(client.lastResponseSnippet).toBeNull();
    log.mockRestore();
  });
});
