// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Cookie Storage Integration
 *
 * Integrates cookie persistence with the XActions CLI config system.
 * Stores sessions in ~/.xactions/config.json and provides multi-session management.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { CookieAuth } from './CookieAuth.js';

/** @typedef {import('../api/parsers.js').Raw} Raw */

const CONFIG_DIR = join(homedir(), '.xactions');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const DEFAULT_COOKIE_FILE = join(CONFIG_DIR, 'cookies.json');

// ============================================================================
// Config Helpers
// ============================================================================

/**
 * Read the config file, returning an empty object if it doesn't exist.
 * @private
 * @returns {Promise<Raw>}
 */
async function readConfig() {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    return /** @type {Raw} */ (JSON.parse(content));
  } catch (err) {
    if (err instanceof Error && 'code' in err && /** @type {Error & {code?: string}} */ (err).code === 'ENOENT') {
      return /** @type {Raw} */ ({});
    }
    throw err;
  }
}

/**
 * Write config to file, preserving existing fields.
 * @private
 * @param {Raw} config
 */
async function writeConfig(config) {
  await fs.mkdir(dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Get the default cookie file path.
 *
 * @returns {Promise<string>} ~/.xactions/cookies.json
 */
export async function getDefaultCookiePath() {
  return DEFAULT_COOKIE_FILE;
}

/**
 * Save cookies into ~/.xactions/config.json under a sessions key.
 *
 * @param {CookieAuth} cookieAuth - The cookie auth instance to save
 * @param {string} username - The Twitter username to save under
 * @returns {Promise<void>}
 */
export async function saveCookiesToConfig(cookieAuth, username) {
  const config = await readConfig();

  if (!config.sessions) {
    config.sessions = {};
  }

  const cookieRecord = Object.fromEntries(cookieAuth.getCookies().map((c) => [c.name, c.value]));
  config.sessions[username] = {
    cookies: cookieRecord,
    created: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
  };

  config.activeSession = username;

  await writeConfig(config);
}

/**
 * Load cookies from ~/.xactions/config.json for a specific username.
 *
 * @param {string} username - The Twitter username
 * @returns {Promise<CookieAuth>} CookieAuth instance with loaded cookies
 */
export async function loadCookiesFromConfig(username) {
  const config = await readConfig();

  const session = /** @type {Raw|undefined} */ (/** @type {Raw} */ (config.sessions)?.[username]);
  if (!session || !session.cookies) {
    return new CookieAuth();
  }

  // Update lastUsed
  session.lastUsed = new Date().toISOString();
  config.activeSession = username;
  await writeConfig(config);

  const cookies = /** @type {Record<string, string>} */ (session.cookies);
  const auth = CookieAuth.fromObject(cookies);
  auth.setUsername(username);
  return auth;
}

/**
 * List all saved sessions with metadata.
 *
 * @returns {Promise<Array<{ username: string, createdAt: string, lastUsed: string, isValid: boolean }>>}
 */
export async function listSessions() {
  const config = await readConfig();
  const sessions = /** @type {Record<string, Raw>} */ (config.sessions || {});

  return Object.entries(sessions).map(([username, data]) => ({
    username,
    createdAt: /** @type {string} */ (data.created || 'unknown'),
    lastUsed: /** @type {string} */ (data.lastUsed || 'unknown'),
    isValid: !!(data.cookies && /** @type {Record<string, string>} */ (data.cookies).auth_token && /** @type {Record<string, string>} */ (data.cookies).ct0),
  }));
}

/**
 * Delete a saved session.
 *
 * @param {string} username - The Twitter username to remove
 * @returns {Promise<boolean>} True if the session existed and was removed
 */
export async function deleteSession(username) {
  const config = await readConfig();

  const sessions = /** @type {Record<string, Raw>} */ (config.sessions || {});
  if (!sessions[username]) {
    return false;
  }

  delete sessions[username];

  // Clear activeSession if it was the deleted one
  if (config.activeSession === username) {
    const remaining = Object.keys(sessions);
    config.activeSession = remaining.length > 0 ? remaining[0] : null;
  }

  await writeConfig(config);
  return true;
}

/**
 * Get the active (most recently used) session.
 *
 * @returns {Promise<{ username: string, cookieAuth: CookieAuth }|null>}
 */
export async function getActiveSession() {
  const config = await readConfig();

  const activeUsername = /** @type {string|undefined} */ (config.activeSession);
  const sessions = /** @type {Record<string, Raw>} */ (config.sessions || {});
  if (!activeUsername || !sessions[activeUsername]) {
    return null;
  }

  const cookieAuth = await loadCookiesFromConfig(activeUsername);
  return {
    username: activeUsername,
    cookieAuth,
  };
}
