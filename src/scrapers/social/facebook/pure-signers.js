// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook pure-algorithm (Tier 0 / zero-browser) signers.
 *
 * These signers run entirely in Node.js via `node:crypto` — no headless browser.
 * They are registered into `PureCryptoSignerRegistry` and dispatched by
 * `AbstractApiClient.requestWithSign` when `signType: 'pure_algorithm'` or when
 * `payload.algorithm` matches a registered name.
 *
 * Scope note (Story 13.1.2, decision 2A): Facebook's session tokens
 * (`lsd`, `fb_dtsg`, `jazoest`, `spin`, `hsi`) are extracted from the live DOM
 * via `FacebookBrowserBridge` — they are NOT pure-computable and stay on
 * Tier 1 (PreSignedTokenRing) / Tier 2. The only pure signer here is a
 * deterministic session fingerprint used for traceability / cache-keying.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { createHmac } from 'node:crypto';
import { PureCryptoSignerRegistry } from '../../../core/signer-pool.js';

/**
 * Deterministic Facebook session fingerprint signer.
 *
 * Produces a stable HMAC-SHA256 hex digest of `accountId` keyed by the raw
 * cookie header (`payload.cookie` / `payload.cookies`). Mirrors the cache-key
 * scheme already used in `client.js` (`#cacheKey` = sha256(cookie)) but upgraded
 * to a keyed HMAC so the fingerprint is account-scoped and non-reversible.
 *
 * Returns `null` (→ Tier 2 fallback) when there is no accountId or cookie to
 * key against — a fingerprint with no stable inputs would be meaningless.
 *
 * @param {object} payload - request payload
 * @param {string} [payload.accountId] - account identifier
 * @param {string} [payload.cookie] - raw cookie header
 * @param {Record<string, string>} [payload.cookies] - cookie record (joined if `cookie` absent)
 * @param {string} [payload.name='x-session-fingerprint'] - target header name
 * @returns {{ headers: Record<string, string> } | null}
 */
export function signSessionFingerprint(payload) {
  const accountId = payload && typeof payload.accountId === 'string' && payload.accountId ? payload.accountId : null;
  let cookie = payload && typeof payload.cookie === 'string' ? payload.cookie : '';
  if (!cookie && payload && payload.cookies && typeof payload.cookies === 'object') {
    cookie = Object.entries(payload.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
  if (!accountId || !cookie) return null;

  const digest = createHmac('sha256', cookie).update(String(accountId)).digest('hex');
  const name = typeof payload.name === 'string' && payload.name ? payload.name : 'x-session-fingerprint';
  return { headers: { [name]: digest } };
}

/**
 * Build a `PureCryptoSignerRegistry` pre-populated with Facebook's pure signers.
 * @param {Object} [options]
 * @param {import('../../../core/signer-pool.js').PureCryptoSignerRegistry} [options.registry] - existing registry to extend
 * @returns {import('../../../core/signer-pool.js').PureCryptoSignerRegistry}
 */
export function createFacebookPureSigners(options = {}) {
  const registry = options.registry instanceof PureCryptoSignerRegistry ? options.registry : new PureCryptoSignerRegistry();
  registry.register('x-session-fingerprint', signSessionFingerprint);
  return registry;
}

export default createFacebookPureSigners;
