// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 27.3 — base-client integration with ChallengeSignatureDetector.
 * Real impl: real AbstractApiClient, real AccountPool, real AdaptiveRateGovernor,
 * real SessionHealthOrchestrator, real ChallengeSignatureDetector.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from 'node:http';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { SessionHealthOrchestrator } from '../../src/core/session-health-orchestrator.js';
import { ChallengeSignatureDetector } from '../../src/core/challenge-signature-detector.js';
import { BotChallengeError, RateLimitError, AuthSessionExpiredError } from '../../src/core/error-envelope.js';
import { globalJevChallengeDiagnoser } from '../../src/core/jev-challenge-diagnoser.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

class TestApiClient extends AbstractApiClient {
  name = 'test-challenge-client';
  platform = 'twitter';
  requiresAuth = true;
}

let upstream;
let upstreamPort;

beforeAll(async () => {
  upstream = createServer((req, res) => {
    // Always return a Cloudflare challenge HTML
    res.writeHead(403, { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge' });
    res.end(`<!DOCTYPE html><html><head><title>Just a moment...</title></head>
      <body><div class="cf-challenge-running">Verifying you are human</div>
      <script>window.__cf_chl = {};</script></body></html>`);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const addr = upstream.address();
  upstreamPort = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(async () => {
  if (upstream) await new Promise((resolve) => upstream.close(resolve));
});

describe('Story 27.3 — base-client ChallengeSignatureDetector integration', () => {
  it('[P0] challenge response → markUnavailable(bot_challenge, suggestedHibernationMs) + recordBotChallenge fired', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_chl']);
    const governor = new AdaptiveRateGovernor();
    const orchestrator = new SessionHealthOrchestrator({ accountPool, governor });
    const detector = new ChallengeSignatureDetector();

    // Spy markUnavailable to capture the FIRST call reason (later retry may overwrite)
    const markCalls = [];
    const origMark = accountPool.markUnavailable.bind(accountPool);
    accountPool.markUnavailable = (id, reason, ms, platform) => {
      markCalls.push({ id, reason, ms, platform });
      return origMark(id, reason, ms, platform);
    };

    const client = new TestApiClient({
      accountPool,
      governor,
      healthOrchestrator: orchestrator,
      challengeDetector: detector,
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      maxAccountRotations: 0,
      httpClient: async () => ({
        status: 403,
        headers: { 'cf-mitigated': 'challenge' },
        data: `<html><body>cf-chl-bypass</body><div class="cf-challenge-running"></div></html>`,
      }),
    });

    // Pipeline retries → final throw is generic PlatformError, but the
    // FIRST markUnavailable call must carry 'bot_challenge' + 5min hibernation.
    await expect(
      client.request('GET', `http://127.0.0.1:${upstreamPort}/test`, { accountId: 'acct_chl' })
    ).rejects.toThrow();

    const firstMark = markCalls.find(c => c.reason === 'bot_challenge');
    expect(firstMark).toBeDefined();
    expect(firstMark.id).toBe('acct_chl');
    expect(firstMark.ms).toBe(5 * 60 * 1000); // cloudflare_managed suggested
    expect(firstMark.platform).toBe('twitter');

    // Governor + orchestrator got the bot_challenge signal
    expect(governor.isHibernating('twitter:acct_chl')).toBe(true);
    const orchScore = orchestrator.getHealthScore('twitter', 'acct_chl');
    expect(orchScore).toBeLessThan(70);
  });

  it('[P1] challenge detection flows through detector with correct type + signature', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_chl2']);
    const detector = new ChallengeSignatureDetector();

    // Spy on detectFromResponse to capture the ChallengeResult the client saw
    const seenResults = [];
    const origDetect = detector.detectFromResponse.bind(detector);
    detector.detectFromResponse = (response, opts) => {
      const r = origDetect(response, opts);
      seenResults.push(r);
      return r;
    };

    const markCalls = [];
    const origMark = accountPool.markUnavailable.bind(accountPool);
    accountPool.markUnavailable = (id, reason, ms, platform) => {
      markCalls.push({ id, reason, ms, platform });
      return origMark(id, reason, ms, platform);
    };

    const client = new TestApiClient({
      accountPool,
      challengeDetector: detector,
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      maxAccountRotations: 0,
      httpClient: async () => ({
        status: 403,
        headers: {},
        data: 'cf-chl-bypass challenge-running',
      }),
    });

    await expect(
      client.request('GET', 'http://127.0.0.1:8080/test', { accountId: 'acct_chl2' })
    ).rejects.toThrow();

    // Detector saw a cloudflare_managed signature
    const chlResult = seenResults.find(r => r.detected);
    expect(chlResult).toBeDefined();
    expect(chlResult.type).toBe('cloudflare_managed');
    expect(chlResult.signature).toBe('cf-managed');
    expect(chlResult.suggestedHibernationMs).toBe(5 * 60 * 1000);

    // markUnavailable used the suggested hibernation
    const chlMark = markCalls.find(c => c.reason === 'bot_challenge');
    expect(chlMark).toBeDefined();
    expect(chlMark.ms).toBe(5 * 60 * 1000);
  });

  it('[P1] clean response → no challenge detection, no markUnavailable', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_clean']);
    const governor = new AdaptiveRateGovernor();
    const orchestrator = new SessionHealthOrchestrator({ accountPool, governor });

    const client = new TestApiClient({
      accountPool,
      governor,
      healthOrchestrator: orchestrator,
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      httpClient: async () => ({ status: 200, headers: {}, data: { ok: true, user: 'alice' } }),
    });

    const res = await client.request('GET', 'http://127.0.0.1:8080/clean', { accountId: 'acct_clean' });
    expect(res.status).toBe(200);
    expect(accountPool.getNextAvailable('twitter')).toBe('acct_clean');
    expect(governor.isHibernating('twitter:acct_clean')).toBe(false);
  });
  it('[P0] F-5: false-200 challenge response throws BotChallengeError and does not double-record penalty', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_false200']);
    const governor = new AdaptiveRateGovernor();
    const orchestrator = new SessionHealthOrchestrator({ accountPool, governor });
    const detector = new ChallengeSignatureDetector();

    // Client WITHOUT responseValidator (default null)
    const client = new TestApiClient({
      accountPool,
      governor,
      healthOrchestrator: orchestrator,
      challengeDetector: detector,
      responseValidator: null, // explicit null
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      httpClient: async () => ({
        status: 200, // False 200!
        headers: {},
        data: '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div class="cf-challenge-running"></div></body></html>',
      }),
    });

    let thrownError = null;
    try {
      await client.request('GET', 'http://127.0.0.1:8080/test', { accountId: 'acct_false200' });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(BotChallengeError);
    expect(thrownError.details?.challengeType).toBe('cloudflare_managed');
    expect(thrownError.details?.challengeSignature).toBe('cf-managed');

    // Account hibernated in governor with suggested duration
    expect(governor.isHibernating('twitter:acct_false200')).toBe(true);

    // Verify health orchestrator only got 1 bot challenge penalty (score should be 100 - 18 consecErr - 15 botChallenge = 67, NOT double-penalized to ~34)
    const score = orchestrator.getHealthScore('twitter', 'acct_false200');
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it('[P0] F-6 & F-7: terminal 403 challenge preserves bot_challenge and suggested hibernation duration', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_term403']);
    const governor = new AdaptiveRateGovernor();
    const detector = new ChallengeSignatureDetector();

    const client = new TestApiClient({
      accountPool,
      governor,
      challengeDetector: detector,
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1, // Will exhaust on attempt 0
      httpClient: async () => ({
        status: 403,
        headers: { 'cf-mitigated': 'challenge' },
        data: '<html><body>cf-chl-bypass</body></html>',
      }),
    });

    try {
      await client.request('GET', 'http://127.0.0.1:8080/test', { accountId: 'acct_term403' });
    } catch (err) {
      expect(err).toBeInstanceOf(BotChallengeError);
      expect(err.details?.challengeType).toBe('cloudflare_managed');
      expect(err.details?.suggestedHibernationMs).toBe(5 * 60 * 1000);
    }

    // Account remains hibernated as bot_challenge, NOT overwritten by rate_limit
    expect(governor.isHibernating('twitter:acct_term403')).toBe(true);
    expect(governor.getHibernationReason('twitter:acct_term403')).toBe('bot_challenge');
  });
});

describe('Story 42.4 — Jev second opinion on validator-flagged 2xx (detector miss)', () => {
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

  function makeJevBrain(choice, confidence, degraded = false) {
    const brain = new JevBrain({ apiKey: 'test-jev-key' });
    brain.decide = vi.fn().mockResolvedValue(
      degraded
        ? {
            answers: {},
            usage: { input_tokens: 0, output_tokens: 0 },
            meta: { degraded: true, reason: 'missing-key', source: 'llmbrain' },
          }
        : {
            answers: { pageStatus: { type: 'choice', choice, confidence } },
            usage: { input_tokens: 10, output_tokens: 3 },
            meta: { degraded: false, source: 'jev' },
          },
    );
    return brain;
  }

  // Validator that flags the response as suspicious (false-200 or login wall)
  // but does NOT flag isBotChallenge — the static detector also misses because
  // the body carries no known signature.
  function makeValidator({ isFalse200 = true, isLoginWall = false } = {}) {
    return {
      platform: 'twitter',
      isFalse200: () => isFalse200,
      isBotChallenge: () => false,
      isRateLimit: () => false,
      isLoginWall: () => isLoginWall,
      isAuthExpired: () => false,
      isValidPayload: () => true,
      validateResponse: () => ({
        isValid: false,
        isFalse200,
        isCheckpoint: isLoginWall,
        isRateLimit: false,
        isAuthExpired: false,
        reason: isLoginWall ? 'login_wall' : 'false_200',
      }),
    };
  }

  it('[P0] JEV_CHALLENGE: validator false-200 + detector miss + Jev bot_challenge conf≥0.8 → BotChallengeError + notify-trio', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_jev']);
    const governor = new AdaptiveRateGovernor();
    const orchestrator = new SessionHealthOrchestrator({ accountPool, governor });
    const detector = new ChallengeSignatureDetector();
    const brain = makeJevBrain('bot_challenge', 0.92);
    globalJevChallengeDiagnoser.brain = brain;

    const markCalls = [];
    const origMark = accountPool.markUnavailable.bind(accountPool);
    accountPool.markUnavailable = (id, reason, ms, platform) => {
      markCalls.push({ id, reason, ms, platform });
      return origMark(id, reason, ms, platform);
    };

    const client = new TestApiClient({
      accountPool,
      governor,
      healthOrchestrator: orchestrator,
      challengeDetector: detector,
      responseValidator: makeValidator({ isFalse200: true }),
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      maxAccountRotations: 0,
      httpClient: async () => ({
        status: 200,
        headers: {},
        // Novel challenge variant — no known signature substrings.
        data: '<html><body><form>Please solve this puzzle to prove you are real</form></body></html>',
      }),
    });

    let thrown = null;
    try {
      await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_jev' });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BotChallengeError);
    expect(thrown.code).toBe('XACT_4030');
    expect(thrown.details?.challengeType).toBe('bot_challenge');
    expect(thrown.details?.challengeSignature).toBe('jev_semantic');
    expect(thrown.details?.confidence).toBe(0.92);

    // Exactly one Jev consult — never on the hot path
    expect(brain.decide).toHaveBeenCalledTimes(1);
    const [snippet, questions] = brain.decide.mock.calls[0];
    expect(typeof snippet).toBe('string');
    expect(snippet.length).toBeLessThanOrEqual(500);
    expect(questions.pageStatus.type).toBe('choice');

    // Notify-trio ran before the throw: pool → governor → orchestrator
    const jevMark = markCalls.find((c) => c.reason === 'bot_challenge');
    expect(jevMark).toBeDefined();
    expect(jevMark.id).toBe('acct_jev');
    expect(jevMark.ms).toBe(20 * 60 * 1000);
    expect(governor.isHibernating('twitter:acct_jev')).toBe(true);
    expect(governor.getHibernationReason('twitter:acct_jev')).toBe('bot_challenge');
    expect(orchestrator.getHealthScore('twitter', 'acct_jev')).toBeLessThan(100);
  });

  it('[P0] VALIDATOR_LOGIN_WALL: isLoginWall + detector miss + Jev login_wall conf≥0.8 → BotChallengeError (new escalation)', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_wall']);
    const governor = new AdaptiveRateGovernor();
    const detector = new ChallengeSignatureDetector();
    const brain = makeJevBrain('login_wall', 0.85);
    globalJevChallengeDiagnoser.brain = brain;

    const client = new TestApiClient({
      accountPool,
      governor,
      challengeDetector: detector,
      responseValidator: makeValidator({ isFalse200: false, isLoginWall: true }),
      platform: 'twitter',
      maxProxyRetries: 1,
      maxAccountRotations: 0,
      httpClient: async () => ({
        status: 200,
        headers: {},
        data: '<html><body><p>You must authenticate to view this resource</p></body></html>',
      }),
    });

    let thrown = null;
    try {
      // requiresAuth:false at the REQUEST level — the class field `requiresAuth = true`
      // is assigned after super() and overwrites any constructor option, so only the
      // per-request opt makes this a genuinely no-auth call (XACT_4010 path does not
      // own it → Jev may escalate).
      await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_wall', requiresAuth: false });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BotChallengeError);
    expect(thrown.details?.challengeType).toBe('login_wall');
    expect(governor.isHibernating('twitter:acct_wall')).toBe(true);
  });

  it('[P1] MID_CONF: Jev bot_challenge conf 0.7 < threshold → no throw, no hibernate, response returned', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_mid']);
    const governor = new AdaptiveRateGovernor();
    const brain = makeJevBrain('bot_challenge', 0.7);
    globalJevChallengeDiagnoser.brain = brain;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = new TestApiClient({
      accountPool,
      governor,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: makeValidator({ isFalse200: true }),
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      httpClient: async () => ({ status: 200, headers: {}, data: { items: [] } }),
    });

    const res = await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_mid' });
    expect(res.status).toBe(200);
    expect(brain.decide).toHaveBeenCalledTimes(1);
    expect(governor.isHibernating('twitter:acct_mid')).toBe(false);
    warn.mockRestore();
  });

  it('[P1] DEGRADED: Jev degraded → response returned, zero side-effects', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_deg']);
    const governor = new AdaptiveRateGovernor();
    const brain = makeJevBrain('bot_challenge', 0.99, true);
    globalJevChallengeDiagnoser.brain = brain;

    const client = new TestApiClient({
      accountPool,
      governor,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: makeValidator({ isFalse200: true }),
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      httpClient: async () => ({ status: 200, headers: {}, data: { items: [] } }),
    });

    const res = await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_deg' });
    expect(res.status).toBe(200);
    expect(governor.isHibernating('twitter:acct_deg')).toBe(false);
    expect(accountPool.getNextAvailable('twitter')).toBe('acct_deg');
  });

  it('[P1] KILL_SWITCH: diagnoser disabled → no Jev call, legacy flow', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_kill']);
    const brain = makeJevBrain('bot_challenge', 0.99);
    globalJevChallengeDiagnoser.brain = brain;
    globalJevChallengeDiagnoser.enabled = false; // JEV_CHALLENGE_DIAG=0 equivalent

    const client = new TestApiClient({
      accountPool,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: makeValidator({ isFalse200: true }),
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      httpClient: async () => ({ status: 200, headers: {}, data: { items: [] } }),
    });

    const res = await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_kill' });
    expect(res.status).toBe(200);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('[P1] no validator flags → Jev never consulted (hot path untouched)', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_clean2']);
    const brain = makeJevBrain('bot_challenge', 0.99);
    globalJevChallengeDiagnoser.brain = brain;

    const client = new TestApiClient({
      accountPool,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: makeValidator({ isFalse200: false, isLoginWall: false }),
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      httpClient: async () => ({ status: 200, headers: {}, data: { items: [{ id: 'p1' }] } }),
    });

    const res = await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_clean2' });
    expect(res.status).toBe(200);
    expect(brain.decide).not.toHaveBeenCalled();
    // Snippet still stashed for the crawler-level 0-records hook
    expect(typeof client.lastResponseSnippet).toBe('string');
  });

  it('[P1] HAPPY_EMPTY: validator-flagged 200 + Jev ok → returned, no notify, _lastJevDiag cached for dedupe', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_happy']);
    const governor = new AdaptiveRateGovernor();
    const brain = makeJevBrain('ok', 0.9);
    globalJevChallengeDiagnoser.brain = brain;
    const markSpy = vi.spyOn(accountPool, 'markUnavailable');

    const client = new TestApiClient({
      accountPool,
      governor,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: makeValidator({ isFalse200: true }),
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      httpClient: async () => ({ status: 200, headers: {}, data: { items: [] } }),
    });

    const res = await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_happy' });
    expect(res.status).toBe(200);
    expect(brain.decide).toHaveBeenCalledTimes(1);
    expect(markSpy).not.toHaveBeenCalled();
    expect(governor.isHibernating('twitter:acct_happy')).toBe(false);
    // Non-escalating diagnosis is cached so the crawler hook can reuse it
    expect(client._lastJevDiag?.diag?.verdict).toBe('ok');
    expect(client._lastJevDiag?.snippet).toBe(client.lastResponseSnippet);
  });

  it('[P0] dedicated path: validator.isRateLimit → RateLimitError, Jev never consulted', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_rl']);
    const governor = new AdaptiveRateGovernor();
    const brain = makeJevBrain('bot_challenge', 0.99);
    globalJevChallengeDiagnoser.brain = brain;

    const validator = {
      ...makeValidator({ isFalse200: true }),
      isRateLimit: () => true, // 2xx body the dedicated rate-limit path owns
    };

    const client = new TestApiClient({
      accountPool,
      governor,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: validator,
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      maxAccountRotations: 0,
      httpClient: async () => ({ status: 200, headers: {}, data: 'rate limited, slow down' }),
    });

    let thrown = null;
    try {
      await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_rl' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RateLimitError);
    expect(thrown.code).toBe('XACT_4290');
    expect(brain.decide).not.toHaveBeenCalled();
    expect(governor.getHibernationReason('twitter:acct_rl')).toBe('rate_limit');
  });

  it('[P0] dedicated path: authed login wall → XACT_4010, Jev never consulted', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_authwall']);
    const brain = makeJevBrain('login_wall', 0.99);
    globalJevChallengeDiagnoser.brain = brain;

    const client = new TestApiClient({
      accountPool,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: makeValidator({ isFalse200: true, isLoginWall: true }),
      requiresAuth: true, // requiresAuth + login wall → AuthSessionExpiredError owns it
      platform: 'twitter',
      maxProxyRetries: 1,
      maxAccountRotations: 0,
      httpClient: async () => ({ status: 200, headers: {}, data: '<html><body>Sign in to continue</body></html>' }),
    });

    let thrown = null;
    try {
      await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_authwall' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AuthSessionExpiredError);
    expect(thrown.code).toBe('XACT_4010');
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('[P0] detector-positive response → Jev decide never called (static path owns it)', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_static']);
    const brain = makeJevBrain('bot_challenge', 0.99);
    globalJevChallengeDiagnoser.brain = brain;

    const client = new TestApiClient({
      accountPool,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: makeValidator({ isFalse200: true }), // validator WOULD flag — irrelevant, static fired first
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      maxAccountRotations: 0,
      httpClient: async () => ({
        status: 200,
        headers: {},
        data: '<html><body><div class="cf-challenge-running">cf-chl-bypass</div></body></html>',
      }),
    });

    let thrown = null;
    try {
      await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_static' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BotChallengeError);
    expect(thrown.details?.challengeSignature).not.toBe('jev_semantic');
    expect(brain.decide).not.toHaveBeenCalled();
    // Evidence cleared before the throw so a swallowing handler can't re-diagnose
    expect(client.lastResponseSnippet).toBeNull();
    expect(client._lastJevDiag).toBeNull();
  });

  it('[P1] throwing validateResponse never vetoes proven flags (G3)', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_vthrow']);
    const brain = makeJevBrain('ok', 0.9);
    globalJevChallengeDiagnoser.brain = brain;

    const validator = {
      platform: 'twitter',
      isFalse200: () => true, // already proven — must survive validateResponse throwing
      isBotChallenge: () => false,
      isRateLimit: () => false,
      isLoginWall: () => false,
      isValidPayload: () => true,
      validateResponse: () => { throw new Error('validator boom'); },
    };

    const client = new TestApiClient({
      accountPool,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: validator,
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      httpClient: async () => ({ status: 200, headers: {}, data: { items: [] } }),
    });

    const res = await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_vthrow' });
    expect(res.status).toBe(200);
    expect(brain.decide).toHaveBeenCalledTimes(1); // suspicious flag survived → Jev consulted
  });

  it('[P1] Jev escalation quarantines the proxy that served the challenge (G10)', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_proxyq']);
    const brain = makeJevBrain('bot_challenge', 0.95);
    globalJevChallengeDiagnoser.brain = brain;

    const quarantine = vi.fn();
    const proxyProvider = {
      getProxy: vi.fn(() => 'http://proxy-under-test:8888'),
      quarantine,
    };

    const client = new TestApiClient({
      accountPool,
      proxyProvider,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: makeValidator({ isFalse200: true }),
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      maxAccountRotations: 0,
      httpClient: async () => ({ status: 200, headers: {}, data: 'novel puzzle wall' }),
    });

    await expect(
      client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_proxyq' }),
    ).rejects.toThrow(BotChallengeError);
    expect(quarantine).toHaveBeenCalledWith('http://proxy-under-test:8888', 20 * 60 * 1000);
  });

  it('[P1] snippet hygiene: only response.data is evidence — headers/cookies never stashed', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_snip']);
    const brain = makeJevBrain('ok', 0.9);
    globalJevChallengeDiagnoser.brain = brain;

    const client = new TestApiClient({
      accountPool,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: makeValidator({ isFalse200: false, isLoginWall: false }),
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      httpClient: async () => ({
        status: 200,
        headers: { 'set-cookie': 'SESSION=supersecret; HttpOnly' },
        data: 'plain body text',
      }),
    });

    await client.request('GET', 'http://127.0.0.1:8080/feed', { accountId: 'acct_snip' });
    expect(client.lastResponseSnippet).toBe('plain body text');
    expect(client.lastResponseSnippet).not.toContain('SESSION');
    expect(client.lastResponseSnippet).not.toContain('supersecret');

    // String response.body is NOT evidence — only Buffer bodies are.
    client.httpClient = async () => ({ status: 200, headers: {}, body: 'cookie-ish body' });
    await client.request('GET', 'http://127.0.0.1:8080/feed2', { accountId: 'acct_snip' });
    expect(client.lastResponseSnippet).toBeNull();

    // Buffer body fallback works when data is absent.
    client.httpClient = async () => ({ status: 200, headers: {}, body: Buffer.from('<p>buffered wall</p>') });
    await client.request('GET', 'http://127.0.0.1:8080/feed3', { accountId: 'acct_snip' });
    expect(client.lastResponseSnippet).toBe('buffered wall');
  });

  it('[P1] stale snippet cleared across requests and on raw/disabled paths', async () => {
    const accountPool = new AccountPool();
    accountPool.registerAccounts('twitter', ['acct_stale']);
    const brain = makeJevBrain('ok', 0.9);
    globalJevChallengeDiagnoser.brain = brain;

    const client = new TestApiClient({
      accountPool,
      challengeDetector: new ChallengeSignatureDetector(),
      responseValidator: makeValidator({ isFalse200: false, isLoginWall: false }),
      requiresAuth: true,
      platform: 'twitter',
      maxProxyRetries: 1,
      httpClient: async () => ({ status: 200, headers: {}, data: 'first body' }),
    });

    await client.request('GET', 'http://127.0.0.1:8080/a', { accountId: 'acct_stale' });
    expect(client.lastResponseSnippet).toBe('first body');

    // Next request with empty evidence clears rather than leaving stale text.
    client.httpClient = async () => ({ status: 200, headers: {}, data: '' });
    await client.request('GET', 'http://127.0.0.1:8080/b', { accountId: 'acct_stale' });
    expect(client.lastResponseSnippet).toBeNull();

    // raw:true never stashes.
    client.httpClient = async () => ({ status: 200, headers: {}, data: 'raw body' });
    await client.request('GET', 'http://127.0.0.1:8080/c', { accountId: 'acct_stale', raw: true });
    expect(client.lastResponseSnippet).toBeNull();

    // Disabled diagnoser never stashes.
    globalJevChallengeDiagnoser.enabled = false;
    client.httpClient = async () => ({ status: 200, headers: {}, data: 'normal body' });
    await client.request('GET', 'http://127.0.0.1:8080/d', { accountId: 'acct_stale' });
    expect(client.lastResponseSnippet).toBeNull();
  });
});

