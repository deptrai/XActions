// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * SessionManager — single source of truth for auth sessions.
 * @author nich (@nichxbt)
 * @license MIT
 */

/** @typedef {import('./types.js').LoginResult} LoginResult */

export class SessionManager {
  /** @type {Map<string, LoginResult>} */
  #sessions = new Map();

  /**
   * @param {string} accountId
   * @param {LoginResult} session
   */
  set(accountId, session) {
    this.#sessions.set(accountId, session);
  }

  /**
   * @param {string} accountId
   * @returns {LoginResult | undefined}
   */
  get(accountId) {
    return this.#sessions.get(accountId);
  }

  /**
   * @param {string} accountId
   * @returns {boolean}
   */
  has(accountId) {
    return this.#sessions.has(accountId);
  }

  /**
   * @param {string} accountId
   */
  delete(accountId) {
    this.#sessions.delete(accountId);
  }

  /** @returns {IterableIterator<string>} */
  accountIds() {
    return this.#sessions.keys();
  }
}

export const globalSessionManager = new SessionManager();
