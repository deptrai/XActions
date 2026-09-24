import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { setupMcpRoutes } from '../../api/routes/mcp-bridge.js';

describe('XActions MCP Bridge (api/routes/mcp-bridge.js)', () => {
  const app = express();
  app.use(express.json());
  setupMcpRoutes(app);

  it('GET /mcp/health returns ok status', async () => {
    const res = await request(app).get('/mcp/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /mcp with text/html returns the dashboard HTML', async () => {
    const res = await request(app)
      .get('/mcp')
      .set('Accept', 'text/html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it('POST /mcp with JSON-RPC initialize request starts a session via Streamable-HTTP', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .set('X-Consumer-Id', 'nowing')
      .send({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'nowing-test', version: '1.0.0' },
        },
        id: 1,
      });

    expect(res.status).toBe(200);
    expect(res.headers['mcp-session-id']).toBeDefined();

    // Streamable-HTTP emits SSE event
    expect(res.text).toContain('event: message');
    expect(res.text).toContain('xactions-mcp');
  });

  it('rejects unauthenticated requests when API key is required but invalid', async () => {
    process.env.XACTIONS_MCP_API_KEY = 'secret-key';
    const res = await request(app)
      .post('/mcp')
      .set('Accept', 'application/json')
      .set('X-Consumer-Id', 'external')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('XACT_4010');
    delete process.env.XACTIONS_MCP_API_KEY;
  });
});
