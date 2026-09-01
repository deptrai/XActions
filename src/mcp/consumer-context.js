// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Consumer identity & context propagation for the MCP daemon (AD-20).
 *
 * Extracts `X-Consumer-Id` (nowing | chainlens | internal) and the Bearer
 * token from HTTP requests, validates the token against XACTIONS_MCP_API_KEY
 * / XACTIONS_API_TOKEN when configured, and propagates the consumer context
 * from the Express layer down to the MCP CallToolRequestSchema handler via
 * AsyncLocalStorage (StreamableHTTPServerTransport does not expose `req`
 * inside request handlers).
 *
 * Stdio transports (Claude Desktop, Cursor, ...) have no HTTP headers, so
 * there is no consumer context — the server falls back to `internal`, which
 * is unmetered and bypasses the quota gate.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

/** Valid consumer identifiers (AD-20). Unknown values normalize to `internal`. */
export const VALID_CONSUMER_IDS = Object.freeze(['nowing', 'chainlens', 'internal']);

/** Module-level AsyncLocalStorage carrying `{ consumerId, apiKeyValid }`. */
export const consumerContextStorage = new AsyncLocalStorage();

/**
 * @typedef {Object} ConsumerContext
 * @property {'nowing' | 'chainlens' | 'internal'} consumerId
 * @property {boolean} apiKeyValid - True when no API key is configured (dev mode) or the Bearer token matched.
 * @property {boolean} apiKeyRequired - True when XACTIONS_MCP_API_KEY / XACTIONS_API_TOKEN is configured.
 */

/**
 * Normalize a raw consumer id. Values outside VALID_CONSUMER_IDS and missing
 * values fall back to `internal` (AD-20 header contract).
 *
 * @param {string | string[] | undefined} raw
 * @returns {'nowing' | 'chainlens' | 'internal'}
 */
export function normalizeConsumerId(raw) {
  const id = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().toLowerCase();
  return VALID_CONSUMER_IDS.includes(id) ? /** @type {any} */ (id) : 'internal';
}

/**
 * Extract the Bearer token from the Authorization header.
 *
 * @param {import('express').Request} req
 * @returns {string | null}
 */
export function extractBearerToken(req) {
  const header = req?.headers?.authorization;
  if (!header || typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * The API key requests must present, or null when auth is disabled (dev mode).
 *
 * @returns {string | null}
 */
export function getExpectedApiKey() {
  return process.env.XACTIONS_MCP_API_KEY || process.env.XACTIONS_API_TOKEN || null;
}

/**
 * Identify the consumer of an incoming HTTP request from its headers.
 * Does not reject — callers decide how to handle `apiKeyValid === false`
 * while `apiKeyRequired === true`.
 *
 * @param {import('express').Request} req
 * @returns {ConsumerContext}
 */
export function identifyConsumer(req) {
  const consumerId = normalizeConsumerId(req?.headers?.['x-consumer-id']);
  const expected = getExpectedApiKey();
  if (expected) {
    const token = extractBearerToken(req);
    const valid = token !== null && expected.length === token.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
    return { consumerId, apiKeyValid: valid, apiKeyRequired: true };
  }
  return { consumerId, apiKeyValid: true, apiKeyRequired: false };
}

/**
 * Read the current consumer context (null on Stdio transports).
 *
 * @returns {ConsumerContext | null}
 */
export function getConsumerContext() {
  return consumerContextStorage.getStore() || null;
}

/**
 * Run a function with a consumer context attached (used by the MCP HTTP
 * transport around StreamableHTTPServerTransport.handleRequest so the
 * CallToolRequestSchema handler can read the consumer id).
 *
 * @template T
 * @param {ConsumerContext} context
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithConsumerContext(context, fn) {
  return consumerContextStorage.run(context, fn);
}
