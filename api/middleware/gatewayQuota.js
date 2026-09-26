// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Gateway Quota Middleware — Story 50.4 (Epic 50 — Public Scrape Gateway).
 *
 * Implements per-consumer rate-limit token bucket isolation and anonymous free
 * tier gating for `POST /api/platform/:platform/scrape`.
 *
 * - Key format: `{consumer_id}:{platform}:{action}` for authenticated consumers.
 * - Anonymous callers: `anonymous:{client_ip}:{platform}:{action}` (default 10 req/min).
 * - Consumer identity is strictly derived from `req.consumer.consumerId` (crypto-bound).
 *   `X-Consumer-Id` header is ignored for quota (anti-spoofing).
 * - `internal` consumer is unmetered.
 * - Quota exhaustion returns 429 ErrorEnvelope (`kind: 'consumer_quota'`) with Retry-After.
 * - Escalates to x402 payment gate when anonymous quota is exhausted.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { globalDistributedTokenBucket } from '../../src/core/distributed-token-bucket.js';
import { errorBody } from '../services/gatewayEnvelope.js';
import { recordGatewayCall } from '../services/gatewayMetrics.js';

/** Default rate limit for anonymous callers: 10 requests per minute */
export const DEFAULT_ANONYMOUS_RPM = 10;

/** Default rate limit for named consumers when not specified in env: 60 req/min */
export const DEFAULT_CONSUMER_RPM = 60;

/**
 * Parse rate string like '100/min' or '10/s' into { capacity, refillRate }.
 * @param {string} rateStr
 * @returns {{ capacity: number, refillRate: number }}
 */
export function parseRateString(rateStr) {
  if (typeof rateStr !== 'string') {
    return { capacity: DEFAULT_CONSUMER_RPM, refillRate: DEFAULT_CONSUMER_RPM / 60 };
  }
  const match = rateStr.trim().match(/^(\d+)\s*\/\s*(min|sec|s|h|hour)?$/i);
  if (!match) {
    return { capacity: DEFAULT_CONSUMER_RPM, refillRate: DEFAULT_CONSUMER_RPM / 60 };
  }
  const count = parseInt(match[1], 10);
  const unit = (match[2] || 'min').toLowerCase();
  let seconds = 60;
  if (unit === 's' || unit === 'sec') seconds = 1;
  else if (unit === 'h' || unit === 'hour') seconds = 3600;

  return {
    capacity: count,
    refillRate: count / seconds,
  };
}

/**
 * Load per-consumer quota configuration from `XACTIONS_CONSUMER_QUOTAS`.
 * Expected format: JSON string, e.g.:
 *   {"jev": {"reddit:search": "100/min", "default": "60/min"}, "default": "60/min"}
 * @returns {Record<string, any>}
 */
export function loadConsumerQuotas() {
  const envVal = process.env.XACTIONS_CONSUMER_QUOTAS;
  if (!envVal || typeof envVal !== 'string') return {};
  try {
    const parsed = JSON.parse(envVal);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Resolve capacity and refillRate for a given consumer, platform, and action.
 * @param {string} consumerId
 * @param {string} platform
 * @param {string} action
 * @returns {{ capacity: number, refillRate: number }}
 */
export function resolveQuotaConfig(consumerId, platform, action) {
  const quotas = loadConsumerQuotas();

  if (consumerId === 'anonymous') {
    // Env override first (`XACTIONS_CONSUMER_QUOTAS.anonymous`, else
    // `XACTIONS_CONSUMER_QUOTAS.default`), else the tight 10/min free tier
    // per IP+platform+action.
    const anonConf = quotas['anonymous'] ?? quotas['default'];
    if (anonConf) {
      return typeof anonConf === 'string' ? parseRateString(anonConf) : parseRateString(anonConf['default']);
    }
    return { capacity: DEFAULT_ANONYMOUS_RPM, refillRate: DEFAULT_ANONYMOUS_RPM / 60 };
  }

  const consumerConf = quotas[consumerId] || quotas['default'];
  if (!consumerConf) {
    return { capacity: DEFAULT_CONSUMER_RPM, refillRate: DEFAULT_CONSUMER_RPM / 60 };
  }

  if (typeof consumerConf === 'string') {
    return parseRateString(consumerConf);
  }

  if (typeof consumerConf === 'object' && consumerConf !== null) {
    const specificKey = `${platform}:${action}`;
    const rateStr = consumerConf[specificKey] || consumerConf['default'];
    return parseRateString(rateStr);
  }

  return { capacity: DEFAULT_CONSUMER_RPM, refillRate: DEFAULT_CONSUMER_RPM / 60 };
}

/**
 * Injected seam for tests.
 * @type {null | { consume(key: string, tokens: number, opts: any): Promise<{ allowed: boolean, remaining: number, retryAfterMs: number }> }}
 */
let _tokenBucketInstance = null;

export function _setTokenBucket(tb) {
  _tokenBucketInstance = tb;
}

export function _resetTokenBucket() {
  _tokenBucketInstance = null;
}

/**
 * Extract caller IP safely from Express req.
 * @param {import('express').Request} req
 * @returns {string}
 */
function getClientIp(req) {
  return (
    req.ip ||
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    '127.0.0.1'
  );
}

/**
 * Gateway Quota Enforcement Middleware.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function gatewayQuota(req, res, next) {
  const consumer = req.consumer;
  // Anti-spoofing: identity derives from the auth lane, never the
  // X-Consumer-Id header. `source` discriminates the lane:
  //   userJWT     → dashboard user  → internal (unmetered, trusted)
  //   serviceAuth → Bearer-derived  → named consumer quota
  //   anonymous   → no credentials  → IP-bucketed free tier
  const source = consumer && typeof consumer.source === 'string' ? consumer.source : 'anonymous';
  const consumerId = source === 'userJWT'
    ? 'internal'
    : (consumer && typeof consumer.consumerId === 'string' ? consumer.consumerId : 'anonymous');
  const platform = String(req.platform || req.params.platform || req.body?.platform || 'unknown').toLowerCase();
  const action = String(req.body?.action || 'unknown');
  const reqId = req.requestId;

  // 1. Internal consumers (dashboard users / internal services) are unmetered.
  if (source === 'userJWT' || consumerId === 'internal') {
    return next();
  }

  // 2. Derive rate-limit bucket key (anti-spoofing: never trust X-Consumer-Id header).
  let bucketKey;
  if (consumerId === 'anonymous') {
    const ip = getClientIp(req);
    bucketKey = `anonymous:${ip}:${platform}:${action}`;
  } else {
    bucketKey = `${consumerId}:${platform}:${action}`;
  }

  const { capacity, refillRate } = resolveQuotaConfig(consumerId, platform, action);
  const bucket = _tokenBucketInstance || globalDistributedTokenBucket;

  try {
    const result = await bucket.consume(bucketKey, 1, { capacity, refillRate, ttlSeconds: 3600 });

    if (result.allowed) {
      return next();
    }

    // 3. Quota exhausted -> check if x402 payment header is present
    const hasPaymentHeader = Boolean(req.headers['x-payment'] || req.headers['authorization']?.startsWith('X402 '));
    if (hasPaymentHeader) {
      // Delegate to x402 payment lane if caller is ready to pay
      return next();
    }

    // 4. Return 429 with C-10 ErrorEnvelope
    const retryAfterMs = result.retryAfterMs > 0 ? result.retryAfterMs : 2000;
    const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));

    res.setHeader('Retry-After', String(retryAfterSec));

    const err = errorBody({
      code: 'XACT_4029',
      kind: 'consumer_quota',
      type: 'rate_limit',
      message: `Quota exceeded for ${consumerId}. Retry after ${retryAfterSec}s or pay with x402`,
      status: 429,
      requestId: reqId,
      retryable: true,
      retryAfterMs,
    });

    recordGatewayCall({
      timestamp: Date.now(),
      requestId: reqId || 'unknown',
      consumerId,
      platform,
      action,
      mode: req.body?.mode === 'sync' ? 'sync' : 'async',
      durationMs: 0,
      status: 429,
      errorKind: 'consumer_quota',
    });

    return res.status(429).json(err);
  } catch (err) {
    console.warn(`[gatewayQuota] Error checking rate limit for ${bucketKey}:`, err);
    // Failure in rate limiter must not fail the request - fail open for availability
    return next();
  }
}
