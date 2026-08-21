// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Cookie-Based Authentication
 *
 * Manages authentication via browser cookies (ct0, auth_token, twid).
 * This is the primary auth method: export cookies from a logged-in browser session,
 * then load them for programmatic access.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { CookieJar } from './CookieJar.js';
import { extractCsrfToken, extractUserId, extractAuthToken, updateJarFromResponse } from './CookieParser.js';
import { AuthenticationError } from '../errors.js';
import { TokenManager } from './TokenManager.js';

/**
 * Cookie-based authentication manager.
 * Loads cookies from file or array, validates them, and provides auth headers.
 */
export class CookieAuth {
  /**
   * @param {import('./TokenManager.js').TokenManager} [tokenManager]
   */
  constructor(tokenManager) {
    /** @private */
    this._tokenManager = tokenManager || new TokenManager();
    /** @type {CookieJar} */
    this.jar = new CookieJar();
    /** @private */
    this._authenticated = false;
    /** @type {string|undefined} */
    this._username = undefined;
  }

  /**
   * Create a CookieAuth from a plain cookie object.
   *
   * @param {Record<string, string>} obj
   * @param {import('./TokenManager.js').TokenManager} [tokenManager]
   * @returns {CookieAuth}
   */
  static fromObject(obj, tokenManager) {
    const auth = new CookieAuth(tokenManager);
    if (obj && typeof obj === 'object') {
      const cookies = Object.entries(obj).map(([name, value]) => ({ name, value: String(value) }));
      auth.setCookies(cookies);
    }
    return auth;
  }

  /**
   * Parse a cookie header string into a CookieAuth.
   *
   * @param {string} cookieString
   * @param {import('./TokenManager.js').TokenManager} [tokenManager]
   * @returns {CookieAuth}
   */
  static parse(cookieString, tokenManager) {
    const auth = new CookieAuth(tokenManager);
    auth.setCookies(cookieString);
    return auth;
  }

  /**
   * Load cookies from a JSON file.
   *
   * @param {string} filePath
   * @param {import('./TokenManager.js').TokenManager} [tokenManager]
   * @returns {Promise<CookieAuth>}
   */
  static async load(filePath, tokenManager) {
    const auth = new CookieAuth(tokenManager);
    await auth.loadCookies(filePath);
    return auth;
  }

  /**
   * Create CookieAuth from the XACTIONS_SESSION_COOKIE environment variable.
   *
   * @param {import('./TokenManager.js').TokenManager} [tokenManager]
   * @returns {CookieAuth}
   */
  static fromEnv(tokenManager) {
    const cookieString = typeof process !== 'undefined' ? process.env.XACTIONS_SESSION_COOKIE || '' : '';
    return CookieAuth.parse(cookieString, tokenManager);
  }

  /**
   * Check if the auth state is valid (has both ct0 and auth_token).
   *
   * @returns {boolean}
   */
  isAuthenticated() {
    const ct0 = this.jar.getValue('ct0');
    const authToken = this.jar.getValue('auth_token');
    return !!(ct0 && authToken);
  }

  /**
   * Get the authenticated user ID from the twid cookie.
   *
   * @returns {string|null}
   */
  getAuthenticatedUserId() {
    return extractUserId(this.jar);
  }

  /**
   * Set a single cookie by name and value.
   *
   * @param {string} name
   * @param {string} value
   */
  set(name, value) {
    this.jar.set({ name, value });
    this._syncTokens();
  }

  /**
   * Store the Twitter username for this session.
   *
   * @param {string} username
   */
  setUsername(username) {
    this._username = username;
  }

  /**
   * Get the stored username.
   *
   * @returns {string|undefined}
   */
  getUsername() {
    return this._username;
  }

  /**
   * Set cookies from an array of {name, value} objects or a cookie string.
   *
   * @param {Array<{name: string, value: string}>|string} cookies
   */
  setCookies(cookies) {
    if (typeof cookies === 'string') {
      // Parse "name=value; name2=value2" format
      const pairs = cookies.split(';').map((pair) => {
        const [name, ...rest] = pair.trim().split('=');
        return { name: name.trim(), value: rest.join('=').trim() };
      }).filter((c) => c.name);
      for (const c of pairs) {
        this.jar.set(c);
      }
    } else if (Array.isArray(cookies)) {
      for (const c of cookies) {
        if (c && c.name) this.jar.set(c);
      }
    }

    this._syncTokens();
  }

  /**
   * Get cookies as a flat array of {name, value} for the SimpleHttpClient.
   *
   * @returns {Array<{name: string, value: string}>}
   */
  getCookies() {
    return this.jar.getAll().map((c) => ({ name: c.name, value: c.value }));
  }

  /**
   * Get the Cookie header string for HTTP requests.
   *
   * @returns {string}
   */
  getCookieString() {
    return this.jar.toCookieString();
  }

  /**
   * Save cookies to a JSON file.
   *
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  async saveCookies(filePath) {
    await this.jar.saveToFile(filePath);
  }

  /**
   * Load cookies from a JSON file.
   *
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  async loadCookies(filePath) {
    this.jar = await CookieJar.loadFromFile(filePath);
    this._syncTokens();
  }

  /**
   * Update the jar from a fetch response's Set-Cookie headers.
   *
   * @param {Response} response
   */
  updateFromResponse(response) {
    updateJarFromResponse(this.jar, response);
    this._syncTokens();
  }

  /**
   * Clear all cookies and reset auth state.
   */
  clear() {
    this.jar.clear();
    this._authenticated = false;
    this._tokenManager.setCsrfToken(undefined);
  }

  /**
   * Sync token manager with current cookie state.
   * @private
   */
  _syncTokens() {
    const ct0 = extractCsrfToken(this.jar);
    if (ct0) {
      this._tokenManager.setCsrfToken(ct0);
    }
    this._authenticated = this.isAuthenticated();
  }
}
