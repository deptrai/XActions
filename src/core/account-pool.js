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

  /** @type {Map<string, Object>} */
  #accountRecords = new Map();

  /** @type {Map<string, number>} */
  #roundRobinIndex = new Map();

  /** @type {Set<string>} */
  #unavailableAccounts = new Set();

  /** @type {Map<string, number[]>} */
  #localVelocityTimestamps = new Map();

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
   * Register accounts for a platform with optional credentials/metadata.
   * @param {string} platform
   * @param {string[]} accountIds
   * @param {Object} [options]
   * @param {Record<string, any>} [options.credentials]
   */
  registerAccounts(platform, accountIds, options = {}) {
    const set = this.#accountsByPlatform.get(platform) || new Set();
    const credentials = options?.credentials || {};

    for (const id of (accountIds || [])) {
      set.add(id);
      const prev = this.#accountRecords.get(id);
      this.#accountRecords.set(id, {
        platform,
        accountId: id,
        credentials: credentials[id] || prev?.credentials || null,
        assignedProxy: prev?.assignedProxy || null,
        hibernatingUntil: prev?.hibernatingUntil || null,
        velocity: 0,
      });
    }

    this.#accountsByPlatform.set(platform, set);
    if (!this.#roundRobinIndex.has(platform)) {
      this.#roundRobinIndex.set(platform, 0);
    }
  }

  /**
   * Get the next available account for a platform and advance the round-robin pointer.
   * @param {string} platform
   * @returns {string | null}
   */
  getNextAvailable(platform) {
    return this.#findNextAvailable(platform, true);
  }

  /**
   * Mark an account as temporarily unavailable (e.g., rate-limited or hibernating).
   * @param {string} accountId
   * @param {string} [reason='unavailable']
   * @param {number} [durationMs=0]
   */
  markUnavailable(accountId, reason = 'unavailable', durationMs = 0) {
    this.#unavailableAccounts.add(accountId);
    const record = this.#accountRecords.get(accountId);
    if (record) {
      record.hibernatingUntil = durationMs > 0 ? Date.now() + durationMs : null;
    }
    if (this.#governor && durationMs > 0) {
      this.#governor.hibernateAccount(accountId, reason, durationMs);
    }
  }

  /**
   * Mark an account as available again (e.g., after manual wake or hibernation ended).
   * @param {string} accountId
   */
  markAvailable(accountId) {
    this.#unavailableAccounts.delete(accountId);
    const record = this.#accountRecords.get(accountId);
    if (record) {
      record.hibernatingUntil = null;
    }
    if (this.#governor) {
      this.#governor.wakeAccount(accountId);
    }
  }

  /**
   * Get account request velocity in the last 60-second sliding window.
   * @param {string} accountId
   * @returns {number}
   */
  getAccountVelocity(accountId) {
    if (this.#governor) {
      return this.#governor.getAccountVelocity(accountId);
    }
    const timestamps = this.#localVelocityTimestamps.get(accountId) || [];
    const now = Date.now();
    const active = timestamps.filter((t) => now - t < 60_000);
    this.#localVelocityTimestamps.set(accountId, active);
    return active.length;
  }

  /**
   * Record a request for account velocity tracking.
   * @param {string} accountId
   */
  recordRequest(accountId) {
    if (this.#governor) {
      this.#governor.recordRequest(accountId);
    }
    const timestamps = this.#localVelocityTimestamps.get(accountId) || [];
    const now = Date.now();
    const active = timestamps.filter((t) => now - t < 60_000);
    active.push(now);
    this.#localVelocityTimestamps.set(accountId, active);
  }

  /**
   * Assign a proxy to an account.
   * @param {string} accountId
   * @param {any} proxy
   */
  setAssignedProxy(accountId, proxy) {
    const record = this.#accountRecords.get(accountId);
    if (record) {
      record.assignedProxy = proxy;
    }
  }

  /**
   * Check if a platform has any available account without mutating the round-robin pointer.
   * @param {string} platform
   * @returns {boolean}
   */
  hasAvailable(platform) {
    return this.#findNextAvailable(platform, false) !== null;
  }

  /**
   * @param {string} platform
   * @param {boolean} advance
   * @returns {string | null}
   */
  #findNextAvailable(platform, advance) {
    const accounts = this.#accountsByPlatform.get(platform);
    if (!accounts || accounts.size === 0) return null;

    const list = Array.from(accounts);
    let startIndex = this.#roundRobinIndex.get(platform) || 0;
    const now = Date.now();

    for (let i = 0; i < list.length; i++) {
      const index = (startIndex + i) % list.length;
      const accountId = list[index];
      const record = this.#accountRecords.get(accountId);

      if (this.#unavailableAccounts.has(accountId)) {
        if (record?.hibernatingUntil && now >= record.hibernatingUntil) {
          this.markAvailable(accountId);
        } else {
          continue;
        }
      }

      if (this.#governor?.isHibernating(accountId)) continue;
      if (this.#governor && !this.#governor.canAccountRequest(accountId, platform)) continue;

      if (advance) {
        this.#roundRobinIndex.set(platform, (index + 1) % list.length);
      }
      return accountId;
    }
    return null;
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

  /**
   * @param {string} accountId
   * @returns {Object | null}
   */
  getAccount(accountId) {
    const record = this.#accountRecords.get(accountId);
    if (!record) return null;
    return {
      ...record,
      velocity: this.getAccountVelocity(accountId),
    };
  }
}

export const globalAccountPool = new AccountPool();
