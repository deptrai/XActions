/**
 * MCP Bridge for XActions REST Server (api/server.js).
 *
 * Allows api/server.js to serve the Streamable-HTTP MCP endpoint at /mcp
 * alongside the web dashboard, enabling Nowing and other AI agents to connect
 * on the primary API port (default 3001) without requiring a separate daemon.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { identifyConsumer, runWithConsumerContext } from '../../src/mcp/consumer-context.js';
import { createMcpPaymentMiddleware, mcpPricingHandler } from '../../src/mcp/x402-mcp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {Map<string, { server: any, transport: StreamableHTTPServerTransport }>} */
const sessions = new Map();

export function setupMcpRoutes(app) {
  // Pricing endpoint for x402 discovery
  app.get('/mcp/pricing', mcpPricingHandler);

  // Health check for MCP capability
  app.get('/mcp/health', (_req, res) => {
    res.json({ status: 'ok', transport: 'http', sessions: sessions.size });
  });

  // Mount payment middleware if configured
  app.use('/mcp', createMcpPaymentMiddleware());

  // Dual-purpose /mcp handler:
  // 1. Browser GET requesting HTML -> serve dashboard/mcp.html
  // 2. Agent POST/GET/DELETE -> delegate to StreamableHTTPServerTransport
  app.all('/mcp', async (req, res, next) => {
    // If it is a browser requesting the web page, serve HTML
    if (req.method === 'GET' && req.accepts('html') && !req.headers['mcp-session-id'] && req.headers['accept']?.includes('text/html')) {
      return res.sendFile(path.join(__dirname, '../../dashboard/mcp.html'));
    }

    // Consumer authentication / identification (AD-20)
    const consumer = identifyConsumer(req);
    req.xactionsConsumer = { consumerId: consumer.consumerId, apiKeyValid: consumer.apiKeyValid };

    if (consumer.apiKeyRequired && !consumer.apiKeyValid) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({
        code: 'XACT_4010',
        type: 'auth_expired',
        message: 'Invalid or missing Bearer token for XActions MCP API',
        statusCode: 401,
        isRetryable: false,
        retryAfterMs: 0,
        retryAfter: 0,
        suggestedAction: 'relogin',
      });
    }

    const sessionId = req.headers['mcp-session-id'];

    // Existing session
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      await runWithConsumerContext(consumer, () => session.transport.handleRequest(req, res, req.body));
      return;
    }

    // New session via POST (initialize)
    if (req.method === 'POST' && !sessionId) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, { server, transport });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
      await runWithConsumerContext(consumer, () => transport.handleRequest(req, res, req.body));
      return;
    }

    // Unmatched request
    res.status(400).json({
      error: 'Invalid MCP request. Send POST to /mcp without session header to initialize, or include mcp-session-id for active sessions.',
    });
  });
}
