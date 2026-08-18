// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AccountPool — manages multiple accounts per platform for auth-required scraping.
 * Rotates to the next healthy account when the current one is rate-limited or hibernating.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError } from './error-envelope.js';

export class AccountPool {
  /** @type {Map<string, Set<string>>} */
  #accountsByPlatform = new Map();

  /** @type {Map<string, number>} */
  #roundRobinIndex = new Map();

  /** @type {Set<string>} */
  #unavailableAccounts = new Set();

  /** @type {import('./adaptive-governor.js').AdaptiveRateGovernor | null} */
  #governor = null;

  /**
   * @param {Object} [deps]
   * @param {import('./adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   */
  constructor(deps = {}) {
    this.#governor = deps.governor || null;
  }

  /**
   * Register accounts for a platform.
   * @param {string} platform
   * @param {string[]} accountIds
   */
  registerAccounts(platform, accountIds) {
    const set = this.#accountsByPlatform.get(platform) || new Set();
    for (const id of accountIds) {
      set.add(id);
    }
    this.#accountsByPlatform.set(platform, set);
    if (!this.#roundRobinIndex.has(platform)) {
      this.#roundRobinIndex.set(platform, 0);
    }
  }

  /**
   * Get the next available account for a platform.
   * @param {string} platform
   * @returns {string | null}
   */
  getNextAvailable(platform) {
    const accounts = this.#accountsByPlatform.get(platform);
    if (!accounts || accounts.size === 0) return null;

    const list = Array.from(accounts);
    let startIndex = this.#roundRobinIndex.get(platform) || 0;
    for (let i = 0; i < list.length; i++) {
      const index = (startIndex + i) % list.length;
      const accountId = list[index];
      if (this.#unavailableAccounts.has(accountId)) continue;
      if (this.#governor?.isHibernating(accountId)) continue;
      if (this.#governor && !this.#governor.canAccountRequest(accountId, platform)) continue;
      this.#roundRobinIndex.set(platform, (index + 1) % list.length);
      return accountId;
    }
    return null;
  }

  /**
   * Mark an account as temporarily unavailable (e.g., rate-limited or hibernating).
   * @param {string} accountId
   */
  markUnavailable(accountId) {
    this.#unavailableAccounts.add(accountId);
  }

  /**
   * Mark an account as available again (e.g., after manual wake or hibernation ended).
   * @param {string} accountId
   */
  markAvailable(accountId) {
    this.#unavailableAccounts.delete(accountId);
  }

  /**
   * Check if a platform has any available account.
   * @param {string} platform
   * @returns {boolean}
   */
  hasAvailable(platform) {
    return this.getNextAvailable(platform) !== null;
  }

  /**
   * @returns {string[]}
   */
  listPlatforms() {
    return Array.from(this.#accountsByPlatform.keys());
  }

  /**
   * @param {string} platform
   * @returns {string[]}
   */
  listAccounts(platform) {
    return Array.from(this.#accountsByPlatform.get(platform) || []);
  }
}

export const globalAccountPool = new AccountPool();
