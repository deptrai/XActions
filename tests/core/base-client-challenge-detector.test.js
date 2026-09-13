// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 27.3 — base-client integration with ChallengeSignatureDetector.
 * Real impl: real AbstractApiClient, real AccountPool, real AdaptiveRateGovernor,
 * real SessionHealthOrchestrator, real ChallengeSignatureDetector.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { SessionHealthOrchestrator } from '../../src/core/session-health-orchestrator.js';
import { ChallengeSignatureDetector } from '../../src/core/challenge-signature-detector.js';
import { BotChallengeError } from '../../src/core/error-envelope.js';

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
});
