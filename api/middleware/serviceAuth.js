// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Service-Auth Lane — Bearer→Consumer Derivation (Epic 50, Story 50.1).
 *
 * Authenticates machine consumers (jev-trading, Nowing, ChainLens, third-party)
 * via Bearer token and derives `consumer_id` SERVER-SIDE from the credential —
 * never from the `X-Consumer-Id` header (which is captured only as an
 * observability hint on `req.consumerHint`).
 *
 * Lane ordering: `eitherAuth` tries `authenticate` (user JWT) first — on failure
 * it falls back to `serviceAuth`. Mutually exclusive per request; only one lane
 * populates `req.consumer`.
 *
 * Key resolution order:
 *   1. `XACTIONS_SERVICE_KEYS` env JSON map: {"<token>":{"consumer_id":"jev","tier":"internal"}}
 *   2. Legacy single-token check: `XACTIONS_MCP_API_KEY` / `XACTIONS_API_TOKEN` → 'internal'
 *   3. `NODE_ENV === 'production'` + empty map + no legacy → apiKeyValid:false (fail-closed)
 *   4. `NODE_ENV === 'development'` + empty map + no legacy → apiKeyValid:true, apiKeyRequired:false (dev parity)
 *   5. No match → apiKeyValid:false
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import crypto from 'node:crypto';
import { ApiError } from './envelope.js';
import { authenticate } from './auth.js';
import {
  extractBearerToken,
  getExpectedApiKey,
  normalizeConsumerId,
} from '../../src/mcp/consumer-context.js';

/**
 * Lazily parsed + cached `XACTIONS_SERVICE_KEYS` env map.
 * Shape: `{ "<token>": { consumer_id: string, tier?: string } }`.
 * On malformed JSON → `{}` + one-shot WARN (fail-closed on named keys).
 * @type {Record<string, { consumer_id: string, tier?: string }> | null}
 */
let _serviceKeyMap = null;
let _serviceKeyWarned = false;

/**
 * Parse `XACTIONS_SERVICE_KEYS` env into a token→consumer map.
 * Returns `{}` on malformed env or unset (fail-closed for named keys,
 * legacy `XACTIONS_MCP_API_KEY` check still applies downstream).
 *
 * @returns {Record<string, { consumer_id: string, tier?: string }>}
 */
export function loadServiceKeyMap() {
  if (_serviceKeyMap !== null) return _serviceKeyMap;
  const raw = process.env.XACTIONS_SERVICE_KEYS;
  if (!raw || typeof raw !== 'string') {
    _serviceKeyMap = {};
    return _serviceKeyMap;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed !== null) {
      _serviceKeyMap = /** @type {Record<string, { consumer_id: string, tier?: string }>} */ (parsed);
    } else {
      if (!_serviceKeyWarned) {
        console.warn('⚠️  serviceAuth: XACTIONS_SERVICE_KEYS is not a valid JSON object — treating as empty map.');
        _serviceKeyWarned = true;
      }
      _serviceKeyMap = {};
    }
  } catch (err) {
    if (!_serviceKeyWarned) {
      console.warn('⚠️  serviceAuth: XACTIONS_SERVICE_KEYS malformed JSON — treating as empty map (fail-closed on named keys).', err instanceof Error ? err.message : err);
      _serviceKeyWarned = true;
    }
    _serviceKeyMap = {};
  }
  return _serviceKeyMap;
}

/**
 * Reset cached map — for tests.
 * @internal
 */
export function _resetServiceKeyMap() {
  _serviceKeyMap = null;
  _serviceKeyWarned = false;
}

/**
 * Timing-safe Bearer comparison — length equality first (timingSafeEqual throws
 * on length mismatch), then constant-time compare.
 *
 * @param {string} expected
 * @param {string} candidate
 * @returns {boolean}
 */
function timingSafeTokenEqual(expected, candidate) {
  if (typeof expected !== 'string' || typeof candidate !== 'string') return false;
  if (expected.length !== candidate.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate));
  } catch {
    return false;
  }
}

/**
 * Resolve Bearer token → consumer record.
 *
 * @param {string | null} token
 * @returns {{ consumerId: string, tier?: string, apiKeyValid: boolean, apiKeyRequired: boolean }}
 */
function resolveConsumerFromBearer(token) {
  const keyMap = loadServiceKeyMap();
  const legacyKey = getExpectedApiKey();
  const apiKeyRequired = Object.keys(keyMap).length > 0 || legacyKey !== null;

  // No token provided
  if (!token) {
    // Production fail-closed: no token + keys configured → invalid.
    // Dev parity: no keys configured + NODE_ENV=development → anonymous ok.
    if (!apiKeyRequired) {
      const isProd = process.env.NODE_ENV === 'production';
      if (isProd) {
        return { consumerId: 'internal', apiKeyValid: false, apiKeyRequired: true };
      }
      return { consumerId: 'internal', apiKeyValid: true, apiKeyRequired: false };
    }
    return { consumerId: 'internal', apiKeyValid: false, apiKeyRequired: true };
  }

  // 1. Service key map lookup via constant-time comparison across all keys
  // to avoid timing side-channels on key values.
  for (const [configuredToken, mapped] of Object.entries(keyMap)) {
    if (timingSafeTokenEqual(configuredToken, token)) {
      if (mapped && typeof mapped === 'object' && typeof mapped.consumer_id === 'string' && mapped.consumer_id.length > 0) {
        const rawId = String(mapped.consumer_id).trim().toLowerCase();
        const allowed = ['nowing', 'chainlens', 'jev', 'internal'];
        const resolvedId = allowed.includes(rawId) ? rawId : 'internal';
        return {
          consumerId: resolvedId,
          tier: typeof mapped.tier === 'string' ? mapped.tier : undefined,
          apiKeyValid: true,
          apiKeyRequired: true,
        };
      }
    }
  }

  // 2. Legacy single-token check (timing-safe)
  if (legacyKey && timingSafeTokenEqual(legacyKey, token)) {
    return { consumerId: 'internal', apiKeyValid: true, apiKeyRequired: true };
  }

  // 3. No match
  return { consumerId: 'internal', apiKeyValid: false, apiKeyRequired: true };
}

let _hintMismatchWarned = false;

/**
 * serviceAuth — Bearer → server-derived consumer_id.
 * Sets `req.consumer = {consumerId, apiKeyValid, source:'serviceAuth'|'anonymous', tier?}`.
 * Sets `req.consumerHint` to normalized `X-Consumer-Id` header value (observability only).
 * On apiKeyValid:false → next(ApiError('XACT_4001', 401, 'Invalid Bearer token', undefined, 'auth')).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function serviceAuth(req, res, next) {
  let resolved;
  const rawHeader = req?.headers?.['x-consumer-id'];
  const hasExplicitHint = typeof rawHeader === 'string' && rawHeader.trim().length > 0;
  const hint = normalizeConsumerId(rawHeader);
  req.consumerHint = hint;

  try {
    const token = extractBearerToken(req);
    resolved = resolveConsumerFromBearer(token);

    if (!resolved.apiKeyValid) {
      return next(new ApiError('XACT_4001', 401, 'Invalid or missing Bearer token for XActions service API', undefined, 'auth'));
    }

    const source = token ? 'serviceAuth' : 'anonymous';
    req.consumer = {
      consumerId: resolved.consumerId,
      apiKeyValid: true,
      source,
      ...(resolved.tier !== undefined ? { tier: resolved.tier } : {}),
    };

    // UX-5: warn once ONLY when caller explicitly sent an X-Consumer-Id header that mismatches
    if (hasExplicitHint && hint !== resolved.consumerId && !_hintMismatchWarned) {
      console.warn(
        `⚠️  serviceAuth: X-Consumer-Id hint '${hint}' differs from Bearer-derived consumer '${resolved.consumerId}' — Bearer is authoritative (hint is observability only).`,
      );
      _hintMismatchWarned = true;
    }
  } catch (err) {
    console.error('❌ serviceAuth error:', err);
    return next(new ApiError('XACT_5001', 500, 'serviceAuth internal error', undefined, 'internal'));
  }

  // Invoke downstream next() OUTSIDE the try/catch block so downstream synchronous throws
  // are not mistakenly caught as serviceAuth internal errors, preventing double-next dispatch.
  return next();
}

/**
 * eitherAuth — try `authenticate` (user JWT) first; on failure fall back to
 * `serviceAuth` (Bearer→consumer). Mutually exclusive per request.
 *
 * Implemented via Promise wrap so tests and Express async pipelines can await it.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function eitherAuth(req, res, next) {
  return new Promise((resolve) => {
    let settled = false;

    const handleServiceFallback = (thrownErr) => {
      if (settled) return;
      settled = true;
      serviceAuth(req, res, (serviceErr) => {
        if (serviceErr) {
          next(serviceErr);
        } else {
          next();
        }
        resolve();
      });
    };

    // Intercept next() from authenticate
    const authNext = (err) => {
      if (settled) return;
      if (!err && req.user) {
        settled = true;
        // User-JWT lane succeeded
        req.consumer = { consumerId: 'internal', apiKeyValid: true, source: 'userJWT' };
        next();
        return resolve();
      }
      // JWT lane failed or no user attached — fall back to serviceAuth
      handleServiceFallback(err);
    };

    try {
      const maybePromise = authenticate(req, res, authNext);
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch((thrown) => {
          handleServiceFallback(thrown);
        });
      }
    } catch (thrown) {
      handleServiceFallback(thrown);
    }
  });
}
