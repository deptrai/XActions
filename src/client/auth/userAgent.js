// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — User-Agent strings
 *
 * X rejects requests that do not look like they came from a browser. A bare
 * `fetch()` from Node sends `User-Agent: node` (or omits the header), and
 * `POST /1.1/guest/activate.json` answers with HTTP 404
 * `{"errors":[{"message":"Sorry, that page does not exist","code":34}]}` —
 * a misleading status that reads like a removed endpoint rather than a
 * rejected client. Sending a real browser UA makes the same request return
 * 200 with a guest token.
 *
 * Every request the HTTP-only client makes therefore carries one of these.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

/**
 * Browser User-Agent strings, rotated to avoid presenting one fixed
 * fingerprint across a long scraping session.
 * @type {readonly string[]}
 */
export const USER_AGENTS = Object.freeze([
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
]);

/**
 * The UA used when a caller has not asked for rotation.
 * @type {string}
 */
export const DEFAULT_USER_AGENT = USER_AGENTS[1];

/**
 * Pick a random browser User-Agent from the pool.
 * @returns {string}
 */
export function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
