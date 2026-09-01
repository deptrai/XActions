// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 11.9 (AD-20) — MCP HTTP transport consumer identification & quota e2e.
 * Starts the real HTTP transport on an ephemeral port and talks to it over
 * real HTTP. No mocks.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { request as undiciRequest } from 'undici';

/** MCP protocol version used for initialize payloads. */
const PROTOCOL_VERSION = '2025-03-26';

/**
 * POST JSON and parse the response. The Streamable HTTP transport answers with
 * either a plain JSON body or an SSE stream (when the client accepts
 * text/event-stream) — both are handled here.
 *
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @param {unknown} [body]
 */
async function postJson(url, headers = {}, body) {
  const res = await undiciRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const text = res.body ? await res.body.text() : '';
  let data = null;
  const contentType = String(res.headers['content-type'] || '');
  if (contentType.includes('text/event-stream')) {
    // Take the last `data:` event line that parses as JSON-RPC.
    const lines = text.split('\n').filter((line) => line.startsWith('data:'));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i].slice(5).trim());
        if (parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed || parsed.method)) {
          data = parsed;
          break;
        }
      } catch {
        // try the next (earlier) line
      }
    }
  } else {
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
  }
  return { status: res.statusCode, headers: res.headers, text, data };
}

function initializeRequest() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'vitest-ad20-client', version: '1.0.0' },
    },
  };
}

function toolCallRequest(id, name, args = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

describe('Story 11.9 — MCP HTTP consumer identification & multi-consumer quota (AD-20)', () => {
  let mod;
  let httpServer;
  let baseUrl;
  let savedEnv;

  beforeAll(async () => {
    savedEnv = {
      PORT: process.env.PORT,
      XACTIONS_MCP_API_KEY: process.env.XACTIONS_MCP_API_KEY,
      XACTIONS_API_TOKEN: process.env.XACTIONS_API_TOKEN,
      XACTIONS_MODE: process.env.XACTIONS_MODE,
    };
    delete process.env.XACTIONS_MCP_API_KEY;
    delete process.env.XACTIONS_API_TOKEN;
    process.env.XACTIONS_MODE = 'local';
    process.env.PORT = '0';

    vi.resetModules();
    mod = await import('../../src/mcp/server.js');
    await mod.initializeBackend();
    httpServer = await mod.startHttpTransport();
    const address = httpServer.address();
    const port = typeof address === 'object' && address ? address.port : 3001;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    try {
      await new Promise((resolve) => httpServer.close(resolve));
    } catch {
      // best-effort cleanup
    }
    if (savedEnv.PORT === undefined) delete process.env.PORT;
    else process.env.PORT = savedEnv.PORT;
    if (savedEnv.XACTIONS_MCP_API_KEY === undefined) delete process.env.XACTIONS_MCP_API_KEY;
    else process.env.XACTIONS_MCP_API_KEY = savedEnv.XACTIONS_MCP_API_KEY;
    if (savedEnv.XACTIONS_API_TOKEN === undefined) delete process.env.XACTIONS_API_TOKEN;
    else process.env.XACTIONS_API_TOKEN = savedEnv.XACTIONS_API_TOKEN;
    if (savedEnv.XACTIONS_MODE === undefined) delete process.env.XACTIONS_MODE;
    else process.env.XACTIONS_MODE = savedEnv.XACTIONS_MODE;
  });

  /**
   * Open a session and return its id.
   * @param {Record<string, string>} [headers]
   */
  async function openSession(headers = {}) {
    const init = await postJson(`${baseUrl}/mcp`, headers, initializeRequest());
    expect(init.status).toBe(200);
    const sessionId = init.headers['mcp-session-id'];
    expect(sessionId).toBeTruthy();
    return sessionId;
  }

  test('AC-1: X-Consumer-Id header is accepted and a tool call succeeds', async () => {
    const sessionId = await openSession({ 'X-Consumer-Id': 'chainlens' });
    const res = await postJson(
      `${baseUrl}/mcp`,
      { 'mcp-session-id': sessionId, 'X-Consumer-Id': 'chainlens' },
      toolCallRequest(2, 'x_list_platforms')
    );
    expect(res.status).toBe(200);
    expect(res.data).not.toBeNull();
    expect(res.data.error).toBeUndefined();
    const envelope = JSON.parse(res.data.result.content[0].text);
    expect(envelope.success).not.toBe(false);
  });

  test('AC-2: invalid Bearer token with XACTIONS_MCP_API_KEY configured returns 401 XACT_4010', async () => {
    process.env.XACTIONS_MCP_API_KEY = 'test-secret-key-ad20';
    try {
      const res = await postJson(
        `${baseUrl}/mcp`,
        { 'X-Consumer-Id': 'chainlens', Authorization: 'Bearer wrong-token' },
        initializeRequest()
      );
      expect(res.status).toBe(401);
      expect(res.data).toMatchObject({
        code: 'XACT_4010',
        type: 'auth_expired',
        statusCode: 401,
        isRetryable: false,
        suggestedAction: 'relogin',
      });
      expect(res.data.message).toContain('Bearer');

      // A valid token gets through to the MCP handler.
      const ok = await postJson(
        `${baseUrl}/mcp`,
        {
          'X-Consumer-Id': 'chainlens',
          Authorization: 'Bearer test-secret-key-ad20',
        },
        initializeRequest()
      );
      expect(ok.status).toBe(200);
    } finally {
      delete process.env.XACTIONS_MCP_API_KEY;
    }
  });

  test('AC-3: no API key configured means dev mode — no Bearer required', async () => {
    const sessionId = await openSession();
    expect(sessionId).toBeTruthy();
  });

  test('AC-6: exceeding the consumer quota returns the XACT_4291 rate-limit envelope', async () => {
    const { globalAdaptiveRateGovernor } = await import('../../src/core/index.js');
    const previousLimit = globalAdaptiveRateGovernor.getConsumerStatus('chainlens').rpmLimit;

    // Tighten chainlens to 1 RPM so the second call trips the gate.
    globalAdaptiveRateGovernor.setConsumerQuota('chainlens', { rpmLimit: 1 });
    try {
      const sessionId = await openSession({ 'X-Consumer-Id': 'chainlens' });

      const first = await postJson(
        `${baseUrl}/mcp`,
        { 'mcp-session-id': sessionId, 'X-Consumer-Id': 'chainlens' },
        toolCallRequest(2, 'x_list_platforms')
      );
      expect(first.status).toBe(200);
      expect(first.data.error).toBeUndefined();

      const second = await postJson(
        `${baseUrl}/mcp`,
        { 'mcp-session-id': sessionId, 'X-Consumer-Id': 'chainlens' },
        toolCallRequest(3, 'x_list_platforms')
      );
      expect(second.status).toBe(200); // quota errors are MCP results, not transport errors
      expect(second.data.result?.isError).toBe(true);
      const envelope = JSON.parse(second.data.result.content[0].text);
      expect(envelope.success).toBe(false);
      const error = envelope.error;
      expect(error.code).toBe('XACT_4291');
      expect(error.type).toBe('rate_limit');
      expect(error.statusCode).toBe(429);
      expect(error.suggestedAction).toBe('reduce_rate');
      expect(error.message).toContain('chainlens');
      expect(error.isRetryable).toBe(true);
    } finally {
      globalAdaptiveRateGovernor.setConsumerQuota('chainlens', { rpmLimit: previousLimit });
    }
  });

  test('internal consumer traffic is never quota-gated', async () => {
    const sessionId = await openSession({ 'X-Consumer-Id': 'internal' });
    for (let i = 0; i < 3; i++) {
      const res = await postJson(
        `${baseUrl}/mcp`,
        { 'mcp-session-id': sessionId, 'X-Consumer-Id': 'internal' },
        toolCallRequest(10 + i, 'x_list_platforms')
      );
      expect(res.status).toBe(200);
      expect(res.data.error).toBeUndefined();
    }
  });
});
