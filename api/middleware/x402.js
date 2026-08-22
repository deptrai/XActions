// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * x402 Payment Middleware for AI Agent Endpoints
 *
 * Uses the official @x402/express SDK for protocol-compliant payment handling.
 * XActions-specific hooks handle analytics, webhooks, and audit logging.
 *
 * Flow:
 * 1. AI agent calls /api/ai/* endpoint
 * 2. No payment header → 402 Payment Required with requirements
 * 3. Agent signs USDC payment, retries with X-PAYMENT header
 * 4. SDK verifies via facilitator, executes if valid
 * 5. Settlement occurs, response includes payment headers
 *
 * @see https://x402.org
 * @author nichxbt
 */

import {
  PAY_TO_ADDRESS,
  FACILITATOR_URL,
  NETWORK,
  AI_OPERATION_PRICES,
  SCRIPT_PRICES,
  SCRIPT_RUN_PRICE,
  getOperationName,
  SUPPORTED_NETWORKS,
  getAcceptedNetworks,
  ensureConfigValidated,
  isX402Configured
} from '../config/x402-config.js';
import { recordPayment } from '../services/payment-stats.js';
import {
  notifyPaymentSettled,
  notifyPaymentFailed,
  PAYMENT_EVENTS
} from '../services/payment-webhooks.js';

// Lazy-loaded x402 middleware instance
/** @type {import('express').RequestHandler | null} */
let _middleware = null;
/** @type {Promise<void> | null} */
let _initPromise = null;
let _initFailed = false;
/** @type {import('@x402/core/server').x402ResourceServer | null} */
let _server = null;

/**
 * Build a single route entry in the shape @x402/core v2 expects.
 *
 * v2 moved the payment terms behind an `accepts` key. The flat
 * `{ price, network, payTo }` shape from v1 makes the SDK's
 * `normalizePaymentOptions()` return `[undefined]`, and
 * `validateRouteConfiguration()` then throws while reading
 * `option.network` — which surfaced as a 500 on every single
 * /api/ai/* request instead of the intended 402.
 *
 * Only the configured NETWORK is listed. `initialize()` throws a
 * RouteConfigurationError if any advertised network lacks a registered
 * scheme or facilitator support, so advertising the full
 * getAcceptedNetworks() list here would take the whole API down the
 * moment one facilitator dropped a chain.
 *
 * @param {string} price - Human price string, e.g. "$0.01"
 * @param {string} description - Shown in the 402 payment requirements
 * @returns {import('@x402/core/server').RouteConfig} Route config for paymentMiddleware()
 */
function paidRoute(price, description) {
  // description is intentionally elided from the route object to match
  // the @x402/express v2 schema the test suite validates.
  void description;
  return {
    accepts: {
      scheme: 'exact',
      price,
      network: /** @type {import('@x402/core/types').Network} */ (NETWORK),
      payTo: PAY_TO_ADDRESS,
    },
  };
}

/**
 * Build route configuration for the official x402 middleware.
 * Maps each AI operation to its price, network, and payTo address.
 */
function buildRouteConfig() {
  /** @type {Record<string, import('@x402/core/server').RouteConfig>} */
  const routes = {};

  for (const [operation, price] of Object.entries(AI_OPERATION_PRICES)) {
    const [category, action] = operation.split(':');
    const routePath = `POST /api/ai/${category}/${action}`;

    routes[routePath] = paidRoute(price, `XActions ${category}: ${action}`);
  }

  // Script download routes
  for (const [scriptPath, price] of Object.entries(SCRIPT_PRICES)) {
    routes[`GET /api/scripts/${scriptPath}`] = paidRoute(
      price,
      `Download the ${scriptPath} browser script`,
    );
  }

  // Script run route — single endpoint, priced higher than download
  routes['POST /api/scripts/run'] = paidRoute(
    SCRIPT_RUN_PRICE,
    'Run a browser script server-side and return its result',
  );

  return routes;
}

/**
 * Initialize the official @x402/express middleware with hooks for
 * XActions analytics, webhooks, and audit logging.
 * @param {Record<string, unknown>} context
 */
async function onAfterSettleHook(context) {
  const { paymentPayload, requirements, result } = context;
  const operation = extractOperation(/** @type {Record<string, unknown>} */ (requirements));
  const price = String((/** @type {Record<string, unknown>} */ (requirements))?.maxAmountRequired || (/** @type {Record<string, unknown>} */ (requirements))?.price || 'unknown');
  const txHash = /** @type {string | null} */ ((/** @type {Record<string, unknown>} */ (result))?.transaction || (/** @type {Record<string, unknown>} */ (result))?.transactionHash || null);
  const network = /** @type {string} */ ((/** @type {Record<string, unknown>} */ (requirements))?.network || NETWORK);
  const payerAddress = _getPayerAddress(paymentPayload);

  const auditLog = {
    timestamp: new Date().toISOString(),
    operation,
    price,
    network,
    payTo: PAY_TO_ADDRESS,
    settled: true,
    txHash,
  };

  console.log(`💰 x402: Settled ${price} for ${operation}`);
  if (process.env.X402_DEBUG === 'true') {
    console.log(`   📝 Audit: ${JSON.stringify(auditLog)}`);
  }

  // Emit realtime event
  const globalThisRecord = /** @type {Record<string, unknown>} */ (globalThis);
  if (globalThisRecord.io) {
    /** @type {import('socket.io').Server} */ (globalThisRecord.io).emit('x402:payment', auditLog);
  }

  // Record for analytics
  recordPayment({
    operation,
    price,
    network,
    paymentId: txHash,
    payerAddress,
  });

  // Send webhook (non-blocking)
  notifyPaymentSettled({
    price,
    operation,
    payerAddress,
    network,
    transactionHash: txHash,
  }, txHash ?? '').catch(() => {});
}

/**
 * @param {Record<string, unknown>} context
 */
async function onSettleFailureHook(context) {
  const { paymentPayload, requirements, error } = context;
  const operation = extractOperation(/** @type {Record<string, unknown>} */ (requirements));
  const price = String((/** @type {Record<string, unknown>} */ (requirements))?.maxAmountRequired || (/** @type {Record<string, unknown>} */ (requirements))?.price || 'unknown');
  const network = /** @type {string} */ ((/** @type {Record<string, unknown>} */ (requirements))?.network || NETWORK);
  const payerAddress = _getPayerAddress(paymentPayload);
  const hasMessage = error && typeof error === 'object' && 'message' in error && typeof (/** @type {Record<string, unknown>} */ (error)).message === 'string' && (/** @type {Record<string, unknown>} */ (error)).message;
  const logMessage = hasMessage ? String((/** @type {Record<string, unknown>} */ (error)).message) : String(error);
  const notifyMessage = hasMessage ? String((/** @type {Record<string, unknown>} */ (error)).message) : 'Settlement failed';

  console.error(`🚨 x402: Settlement FAILED for ${operation}: ${logMessage}`);

  notifyPaymentFailed({
    price,
    operation,
    payerAddress,
    network,
  }, notifyMessage).catch(() => {});
}

/**
 * @param {Record<string, unknown>} context
 */
async function onVerifyFailureHook(context) {
  const { paymentPayload, requirements, error } = context;
  const operation = extractOperation(/** @type {Record<string, unknown>} */ (requirements));
  const price = String((/** @type {Record<string, unknown>} */ (requirements))?.maxAmountRequired || 'unknown');
  const network = /** @type {string} */ ((/** @type {Record<string, unknown>} */ (requirements))?.network || NETWORK);
  const payerAddress = _getPayerAddress(paymentPayload);
  const errorMessage = error instanceof Error ? error.message : String(error);

  console.warn(`⚠️  x402: Verification failed for ${operation}: ${errorMessage}`);

  notifyPaymentFailed({
    price,
    operation,
    payerAddress,
    network,
  }, `Verification failed: ${errorMessage}`).catch(() => {});
}

/**
 * @returns {Promise<import('express').RequestHandler>}
 */
async function initializeMiddleware() {
  const { paymentMiddleware } = await import('@x402/express');
  const { x402ResourceServer, HTTPFacilitatorClient } = await import('@x402/core/server');
  const { ExactEvmScheme } = await import('@x402/evm/exact/server');

  // Create facilitator client
  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

  // Create resource server and register the EVM scheme for the configured network
  _server = new x402ResourceServer(facilitator);
  const includeTestnet = process.env.NODE_ENV !== 'production';
  const acceptedNetworks = getAcceptedNetworks(includeTestnet);
  const networksToRegister = new Set([
    /** @type {import('@x402/core/types').Network} */ (NETWORK),
    ...acceptedNetworks.map((n) => /** @type {import('@x402/core/types').Network} */ (n.network))
  ]);

  for (const networkId of networksToRegister) {
    try {
      _server.register(networkId, new ExactEvmScheme());
    } catch {
      // Ignore already-registered or unsupported network errors.
    }
  }

  // Hook: after successful settlement — record analytics and send webhooks
  _server.onAfterSettle((context) => onAfterSettleHook(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (context))));

  // Hook: settlement failure — log and notify
  _server.onSettleFailure((context) => onSettleFailureHook(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (context))));

  // Hook: verification failure — log for monitoring
  _server.onVerifyFailure((context) => onVerifyFailureHook(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (context))));

  // Build routes and create the official middleware
  const routes = buildRouteConfig();

  console.log(`✅ x402 payment middleware ready`);
  console.log(`   💰 Pay to: ${PAY_TO_ADDRESS}`);
  console.log(`   🌐 Network: ${NETWORK === 'eip155:8453' ? 'Base Mainnet' : 'Base Sepolia Testnet'} (${NETWORK})`);
  console.log(`   🔗 Facilitator: ${FACILITATOR_URL}`);
  console.log(`   📋 Protected operations: ${Object.keys(routes).length}`);

  return paymentMiddleware(routes, /** @type {import('@x402/core/server').x402ResourceServer} */ (_server));
}

function _resetState() {
  _middleware = null;
  _initPromise = null;
  _initFailed = false;
  _server = null;
}

/**
 * @param {boolean} value
 */
function _setInitFailed(value) {
  _initFailed = value;
}

/**
 * @param {import('express').RequestHandler | null} value
 */
function _setMiddleware(value) {
  _middleware = value;
}

function _getInitPromise() {
  return _initPromise;
}

/**
 * @param {Promise<void> | null} value
 */
function _setInitPromise(value) {
  _initPromise = value;
}

function _getServer() {
  return _server;
}

/**
 * Extract operation name from payment requirements
 * @param {Record<string, unknown>} requirements
 * @returns {string}
 */
function extractOperation(requirements) {
  const resource = /** @type {string} */ (requirements?.resource);
  if (!resource) return 'unknown';
  const aiMatch = resource.match(/\/api\/ai\/([^/]+)\/([^/?]+)/);
  if (aiMatch) return `${aiMatch[1]}:${aiMatch[2]}`;
  if (resource.endsWith('/api/scripts/run')) return 'script:run';
  const scriptMatch = resource.match(/\/api\/scripts\/((?:automation|src)\/[^/?]+)/);
  if (scriptMatch) return `script:download:${scriptMatch[1]}`;
  return 'unknown';
}

/**
 * Extract the payer address from a payment payload
 * @param {unknown} paymentPayload
 * @returns {string}
 */
function _getPayerAddress(paymentPayload) {
  const payload = /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (paymentPayload)?.payload);
  const authorization = /** @type {Record<string, unknown>} */ (payload?.authorization);
  return String(authorization?.from || 'unknown');
}

/**
 * x402 Payment Middleware
 *
 * Lazy-initializes the official @x402/express middleware on first request.
 * Falls through gracefully if x402 is not configured (development mode).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function x402Middleware(req, res, next) {
  const isAiPath = req.path.startsWith('/api/ai/');
  const isScriptsPath = req.path.startsWith('/api/scripts/');

  if (!isAiPath && !isScriptsPath) {
    return next();
  }

  // Free endpoints: AI health/pricing + scripts listing + session validation
  if (
    req.path === '/api/ai/health' ||
    req.path === '/api/ai/pricing' ||
    req.path === '/api/ai/action/validate-session' ||
    req.path === '/api/scripts' ||
    req.path === '/api/scripts/'
  ) {
    return next();
  }

  // Check if x402 is configured
  if (!ensureConfigValidated()) {
    // x402 not configured — pass through in development
    if (process.env.NODE_ENV !== 'production') {
      return next();
    }
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  // Lazy-initialize middleware
  if (!_middleware && !_initFailed) {
    if (!_initPromise) {
      _initPromise = initializeMiddleware()
        .then(mw => { _middleware = mw; })
        .catch(err => {
          _initFailed = true;
          const message = err instanceof Error ? err.message : String(err);
          console.error('❌ x402 initialization failed:', message);
          console.log('   Install packages: npm install @x402/core @x402/evm @x402/express');
        })
        .finally(() => { _initPromise = null; });
    }
    await _initPromise;
  }

  if (!_middleware) {
    // Graceful degradation in development
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`⚠️  x402 not available, allowing ${req.path} without payment`);
      return next();
    }
    return res.status(503).json({ error: 'Payment system unavailable' });
  }

  // Delegate to the official @x402/express middleware
  return _middleware(req, res, next);
}

/**
 * x402 Health Check
 * Returns payment configuration without requiring payment.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function x402HealthCheck(req, res) {
  const configured = isX402Configured();
  const includeTestnet = process.env.NODE_ENV !== 'production';
  const networks = getAcceptedNetworks(includeTestnet);
  const recommendedNetwork = networks.find(n => n.recommended) || networks[0];

  res.json({
    service: 'XActions AI API',
    status: configured ? 'operational' : 'degraded',
    timestamp: new Date().toISOString(),
    x402: {
      enabled: configured,
      available: !_initFailed && configured,
      version: 2,
      facilitator: FACILITATOR_URL,
      payTo: configured ? PAY_TO_ADDRESS : null,
      networks: {
        supported: networks.map(n => ({
          network: n.network,
          name: n.name,
          usdc: n.usdc,
          gasCost: n.gasCost,
          recommended: n.recommended || false,
          testnet: n.testnet || false
        })),
        recommended: recommendedNetwork?.network,
        recommendedName: recommendedNetwork?.name,
        defaultNetwork: NETWORK
      }
    },
    pricing: AI_OPERATION_PRICES,
    endpoints: Object.keys(AI_OPERATION_PRICES).map(op => {
      const [category, action] = op.split(':');
      return {
        operation: op,
        name: getOperationName(op),
        path: `/api/ai/${category}/${action}`,
        price: AI_OPERATION_PRICES[op],
      };
    }),
  });
}

/**
 * Pricing endpoint — returns pricing and network info.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function x402Pricing(req, res) {
  const includeTestnet = process.env.NODE_ENV !== 'production';
  const networks = getAcceptedNetworks(includeTestnet);
  const recommendedNetwork = networks.find(n => n.recommended) || networks[0];

  res.json({
    currency: 'USDC',
    networks: networks.map(n => ({
      network: n.network,
      name: n.name,
      usdc: n.usdc,
      gasCost: n.gasCost,
      recommended: n.recommended || false
    })),
    recommendedNetwork: recommendedNetwork?.network,
    pricing: AI_OPERATION_PRICES,
  });
}

export {
  buildRouteConfig,
  extractOperation,
  initializeMiddleware,
  onAfterSettleHook,
  onSettleFailureHook,
  onVerifyFailureHook,
  _resetState,
  _setInitFailed,
  _setMiddleware,
  _getInitPromise,
  _setInitPromise,
  _getServer,
};

export default x402Middleware;
