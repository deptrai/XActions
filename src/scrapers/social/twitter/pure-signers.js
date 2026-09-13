// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter pure-algorithm (Tier 0 / zero-browser) signers.
 *
 * These signers run entirely in Node.js via `node:crypto` — no headless browser.
 * They are registered into `PureCryptoSignerRegistry` and dispatched by
 * `AbstractApiClient.requestWithSign` when `signType: 'pure_algorithm'` or when
 * `payload.algorithm` matches a registered name.
 *
 * Scope note (Story 13.1.2, decision 1A): the real `x-client-transaction-id`
 * algorithm requires fetching the `ondemand.s` chunk and reading SVG/animation
 * key bytes from the x.com DOM — that stays on Tier 2 (SignerWorkerPagePool).
 * The signers here are deterministic, pure-computable utilities only.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { createHmac } from 'node:crypto';
import { PureCryptoSignerRegistry } from '../../../core/signer-pool.js';

/**
 * Deterministic request fingerprint signer.
 *
 * Produces a stable HMAC-SHA256 hex digest of `METHOD|path` keyed by a
 * caller-supplied seed (`payload.seed`). Useful as a traceability /
 * idempotency header (e.g. `x-request-fingerprint`) — it is deterministic for
 * a given (seed, method, path) triple and costs well under 0.1ms.
 *
 * Returns `null` (→ Tier 2 fallback) when no usable seed is provided, because a
 * fingerprint without a stable key would not be deterministic across callers.
 *
 * @param {object} payload - request payload
 * @param {string} payload.method - HTTP method
 * @param {string} payload.url - request URL (only the path+query is signed)
 * @param {string} [payload.seed] - HMAC secret / account seed supplied by caller
 * @param {string} [payload.name='x-request-fingerprint'] - target header name
 * @returns {{ headers: Record<string, string> } | null}
 */
export function signRequestFingerprint(payload) {
  const seed = payload && typeof payload.seed === 'string' && payload.seed.length > 0 ? payload.seed : null;
  if (!seed) return null;

  const method = String(payload.method || 'GET').toUpperCase();
  let path = '/';
  try {
    const u = new URL(String(payload.url || ''), 'http://localhost');
    path = `${u.pathname}${u.search}`;
  } catch {
    path = String(payload.url || '/');
  }

  const digest = createHmac('sha256', seed).update(`${method}|${path}`).digest('hex');
  const name = typeof payload.name === 'string' && payload.name ? payload.name : 'x-request-fingerprint';
  return { headers: { [name]: digest } };
}

/**
 * Build a `PureCryptoSignerRegistry` pre-populated with Twitter's pure signers.
 * @param {Object} [options]
 * @param {import('../../../core/signer-pool.js').PureCryptoSignerRegistry} [options.registry] - existing registry to extend
 * @returns {import('../../../core/signer-pool.js').PureCryptoSignerRegistry}
 */
export function createTwitterPureSigners(options = {}) {
  const registry = options.registry instanceof PureCryptoSignerRegistry ? options.registry : new PureCryptoSignerRegistry();
  registry.register('x-request-fingerprint', signRequestFingerprint);
  return registry;
}

export default createTwitterPureSigners;
