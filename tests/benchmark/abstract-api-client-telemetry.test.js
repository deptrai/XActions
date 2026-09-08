import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { TelemetryContext } from '../../src/core/telemetry-context.js';
import { PlatformError, ErrorTypes } from '../../src/core/error-envelope.js';

class TestClient extends AbstractApiClient {}

describe('Story 34.2: AbstractApiClient Telemetry & Transport Hooks Unit Tests', () => {
  let client;
  let mockGovernor;
  let mockProxyPool;

  beforeEach(() => {
    mockGovernor = {
      canAccountRequest: vi.fn().mockReturnValue(true),
      canConsumerRequest: vi.fn().mockReturnValue(true),
      recordRequest: vi.fn(),
      recordConsumerRequest: vi.fn(),
      recordRateLimit: vi.fn(),
      recordBotChallenge: vi.fn(),
    };

    mockProxyPool = {
      isAllQuarantined: vi.fn().mockReturnValue(false),
      getProxyAgent: vi.fn().mockReturnValue({}),
      quarantine: vi.fn(),
      getNext: vi.fn().mockReturnValue('http://proxy.local:8080'),
    };

    client = new TestClient({
      platform: 'twitter',
      requiresAuth: false,
      governor: mockGovernor,
      proxyPool: mockProxyPool,
      maxProxyRetries: 2,
      backoffBaseMs: 10,
    });
  });

  it('records successful request attempt metrics in telemetry context (AC 5)', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    client.httpClient = vi.fn().mockResolvedValue({
      status: 200,
      headers: { 'content-length': '1024' },
      data: { success: true },
    });

    const res = await client.request('GET', 'https://api.twitter.com/2/tweets', {
      telemetryContext: telemetry,
    });

    expect(res.status).toBe(200);
    const requests = telemetry.getRequestPayloads();
    expect(requests).toHaveLength(1);
    expect(requests[0].httpStatus).toBe(200);
    expect(requests[0].proxyBytes).toBe(1024);
    expect(requests[0].retries).toBe(0);
    expect(requests[0].isFalse200).toBe(false);
    expect(requests[0].isCheckpoint).toBe(false);
    expect(requests[0].proxyQuarantined).toBe(false);
    expect(requests[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records proxyBytes from response data length if content-length header is absent (AC 5)', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    client.httpClient = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.from('{"message":"hello world"}'),
      data: { message: 'hello world' },
    });

    await client.request('GET', 'https://api.twitter.com/2/tweets', {
      session: { telemetry },
    });

    const requests = telemetry.getRequestPayloads();
    expect(requests).toHaveLength(1);
    expect(requests[0].proxyBytes).toBeGreaterThan(0);
  });

  it('records retried request attempts with incrementing retry index and quarantine flag (AC 5)', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    // First attempt 429, second attempt 200
    client.httpClient = vi
      .fn()
      .mockResolvedValueOnce({
        status: 429,
        headers: { 'retry-after': '0' },
        data: { error: 'Rate limit' },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-length': '512' },
        data: { success: true },
      });

    client.requiresProxy = true;

    const res = await client.request('GET', 'https://api.twitter.com/2/tweets', {
      telemetryContext: telemetry,
    });

    expect(res.status).toBe(200);
    const requests = telemetry.getRequestPayloads();
    expect(requests).toHaveLength(2);

    // Attempt 0
    expect(requests[0].httpStatus).toBe(429);
    expect(requests[0].retries).toBe(0);
    expect(requests[0].proxyQuarantined).toBe(true);

    // Attempt 1
    expect(requests[1].httpStatus).toBe(200);
    expect(requests[1].retries).toBe(1);
    expect(requests[1].proxyQuarantined).toBe(false);
  });

  it('detects isFalse200 and isCheckpoint via responseValidator (AC 5)', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    client.responseValidator = {
      isFalse200: vi.fn().mockReturnValue(true),
      isLoginWall: vi.fn().mockReturnValue(true),
      isValidPayload: vi.fn().mockReturnValue(true),
      isRateLimit: vi.fn().mockReturnValue(false),
      isBotChallenge: vi.fn().mockReturnValue(false),
    };

    client.httpClient = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      data: { html: 'login wall' },
    });

    await client.request('GET', 'https://api.twitter.com/2/tweets', {
      telemetryContext: telemetry,
      requiresAuth: false,
    });

    const requests = telemetry.getRequestPayloads();
    expect(requests).toHaveLength(1);
    expect(requests[0].isFalse200).toBe(true);
    expect(requests[0].isCheckpoint).toBe(true);
  });

  it('resolves telemetryContext from this.telemetryContext if not in opts (AC 3, AC 5)', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    client.telemetryContext = telemetry;
    client.httpClient = vi.fn().mockResolvedValue({
      status: 200,
      headers: { 'content-length': '100' },
      data: { ok: true },
    });

    await client.request('GET', 'https://api.twitter.com/2/tweets');

    const requests = telemetry.getRequestPayloads();
    expect(requests).toHaveLength(1);
    expect(requests[0].httpStatus).toBe(200);
  });

  it('bypasses rate governor checks and recordRequest when session.isCanary is true (AC 4)', async () => {
    client.requiresAuth = true;
    const accountId = 'user_canary_01';

    client.httpClient = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      data: { ok: true },
    });

    await client.request('GET', 'https://api.twitter.com/2/tweets', {
      accountId,
      session: { isCanary: true },
      consumerId: 'nowing',
    });

    // AC 4: canAccountRequest & recordRequest should NOT be called for canary
    expect(mockGovernor.canAccountRequest).not.toHaveBeenCalled();
    expect(mockGovernor.recordRequest).not.toHaveBeenCalled();
    expect(mockGovernor.canConsumerRequest).not.toHaveBeenCalled();
    expect(mockGovernor.recordConsumerRequest).not.toHaveBeenCalled();
  });

  it('records failed request attempt when transport throws or returns error status (AC 5)', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    client.httpClient = vi.fn().mockRejectedValue(new Error('Network connection timeout'));

    await expect(
      client.request('GET', 'https://api.twitter.com/2/tweets', {
        telemetryContext: telemetry,
      })
    ).rejects.toThrow();

    const requests = telemetry.getRequestPayloads();
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests[0].httpStatus).toBe(503);
  });
  it('records telemetry attempt when transport throws non-retryable PlatformError', async () => {
    const telemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
    });

    const fatalError = new PlatformError({
      type: ErrorTypes.AUTH_FAILED,
      code: 'XACT_4010',
      message: 'Fatal auth failure',
      statusCode: 401,
      isRetryable: false,
    });

    client.httpClient = vi.fn().mockRejectedValue(fatalError);

    await expect(
      client.request('GET', 'https://api.twitter.com/2/tweets', {
        telemetryContext: telemetry,
      })
    ).rejects.toThrow('Fatal auth failure');

    const requests = telemetry.getRequestPayloads();
    expect(requests).toHaveLength(1);
    expect(requests[0].httpStatus).toBe(401);
  });

  it('inherits canary bypass from telemetryContext.source === canary even without opts.session', async () => {
    client.requiresAuth = true;
    const accountId = 'canary_user_02';

    const canaryTelemetry = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      action: 'search',
      source: 'canary',
    });

    client.httpClient = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      data: { ok: true },
    });

    // Caller passes ONLY accountId and telemetryContext, no opts.session
    await client.request('GET', 'https://api.twitter.com/2/tweets', {
      accountId,
      telemetryContext: canaryTelemetry,
      consumerId: 'nowing',
    });

    expect(mockGovernor.canAccountRequest).not.toHaveBeenCalled();
    expect(mockGovernor.recordRequest).not.toHaveBeenCalled();
    expect(mockGovernor.canConsumerRequest).not.toHaveBeenCalled();
  });

});
