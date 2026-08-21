// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AccountPool — manages multiple accounts per platform for auth-required scraping.
 * Rotates to the next healthy account when the current one is rate-limited or hibernating.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';

/** @typedef {import('./types.js').AccountRecord} AccountRecord */

const DEFAULT_HIBERNATION_MS = 15 * 60 * 1000;

export class AccountPool {
  /** @type {Map<string, Set<string>>} */
  #accountsByPlatform = new Map();

  /** @type {Map<string, AccountRecord>} */
  #accountRecords = new Map();

  /** @type {Map<string, string>} */
  #accountPlatformIndex = new Map();

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

  /** @returns {import('./adaptive-governor.js').AdaptiveRateGovernor | null} */
  get governor() {
    return this.#governor;
  }

  /**
   * Internal records are keyed by `platform:accountId`.
   * @param {string} platform
   * @param {string} accountId
   * @returns {string}
   */
  #compositeKey(platform, accountId) {
    return `${platform}:${accountId}`;
  }

  /**
   * Resolve a bare or composite account id to the composite key.
   * @param {string} accountId
   * @param {string} [platform]
   * @returns {string | null}
   */
  #resolveKey(accountId, platform) {
    if (platform) {
      return this.#compositeKey(platform, accountId);
    }
    if (typeof accountId === 'string' && accountId.includes(':')) {
      return accountId;
    }
    const resolvedPlatform = this.#accountPlatformIndex.get(accountId);
    if (!resolvedPlatform) return null;
    return this.#compositeKey(resolvedPlatform, accountId);
  }

  /**
   * Resolve a bare or composite account id to the stored record.
   * @param {string} accountId
   * @param {string} [platform]
   * @returns {AccountRecord | null}
   */
  #resolveRecord(accountId, platform) {
    const key = this.#resolveKey(accountId, platform);
    if (!key) return null;
    return this.#accountRecords.get(key) || null;
  }

  /**
   * Register accounts for a platform with optional credentials/metadata.
   *
   * Account records are keyed internally by `platform:accountId`. Re-registering
   * the same bare `accountId` under a different platform is rejected to prevent
   * cross-platform collisions.
   *
   * @param {string} platform
   * @param {string[]} accountIds
   * @param {{ credentials?: Record<string, Record<string, unknown>> }} [options]
   */
  registerAccounts(platform, accountIds, options = {}) {
    if (typeof platform !== 'string' || !platform) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'platform must be a non-empty string',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    if (!Array.isArray(accountIds)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'accountIds must be an array',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const set = this.#accountsByPlatform.get(platform) || new Set();
    const credentials = options?.credentials || {};

    for (const id of accountIds) {
      if (typeof id !== 'string' || !id) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: 'accountIds must contain non-empty strings',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }

      const existingPlatform = this.#accountPlatformIndex.get(id);
      if (existingPlatform && existingPlatform !== platform) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: `Account "${id}" is already registered under platform "${existingPlatform}"; cross-platform collision is not allowed`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }

      const key = this.#compositeKey(platform, id);
      const prev = this.#accountRecords.get(key);

      const newCredentials = credentials[id] !== undefined
        ? credentials[id]
        : (prev?.credentials ?? null);

      set.add(id);
      this.#accountPlatformIndex.set(id, platform);
      this.#accountRecords.set(key, {
        platform,
        accountId: id,
        credentials: newCredentials,
        assignedProxy: prev?.assignedProxy ?? null,
        hibernatingUntil: prev?.hibernatingUntil ?? null,
      });
    }

    this.#accountsByPlatform.set(platform, set);
    if (!this.#roundRobinIndex.has(platform)) {
      this.#roundRobinIndex.set(platform, 0);
    }
  }

  /**
   * Get the next available account for a platform and advance the round-robin pointer.
   *
   * **Note:** This method does NOT automatically record a request. Callers are
   * responsible for invoking `recordRequest(accountId, platform)` once the
   * account is actually used.
   *
   * @param {string} platform
   * @returns {string | null}
   */
  getNextAvailable(platform) {
    return this.#findNextAvailable(platform, true, true);
  }

  /**
   * Mark an account as temporarily unavailable (e.g., rate-limited or hibernating).
   * @param {string} accountId
   * @param {string} [reason='unavailable']
   * @param {number} [durationMs=DEFAULT_HIBERNATION_MS]
   * @param {string} [platform]
   */
  markUnavailable(accountId, reason = 'unavailable', durationMs = DEFAULT_HIBERNATION_MS, platform) {
    if (durationMs <= 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'durationMs must be positive',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const record = this.#resolveRecord(accountId, platform);
    if (!record) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Account "${accountId}" is not registered`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const key = this.#compositeKey(record.platform, record.accountId);
    this.#unavailableAccounts.add(key);
    record.hibernatingUntil = Date.now() + durationMs;

    if (this.#governor) {
      this.#governor.hibernateAccount(key, reason, durationMs);
    }
  }

  /**
   * Mark an account as available again (e.g., after manual wake or hibernation ended).
   * @param {string} accountId
   * @param {string} [platform]
   */
  markAvailable(accountId, platform) {
    const record = this.#resolveRecord(accountId, platform);
    if (!record) return;

    const key = this.#compositeKey(record.platform, record.accountId);
    this.#unavailableAccounts.delete(key);
    record.hibernatingUntil = null;

    if (this.#governor) {
      this.#governor.wakeAccount(key);
    }
  }

  /**
   * Get account request velocity in the last 60-second sliding window.
   * @param {string} accountId
   * @param {string} [platform]
   * @returns {number}
   */
  getAccountVelocity(accountId, platform) {
    const key = this.#resolveKey(accountId, platform);
    if (!key) return 0;

    if (this.#governor) {
      return this.#governor.getAccountVelocity(key);
    }

    const timestamps = this.#localVelocityTimestamps.get(key) || [];
    const now = Date.now();
    const active = timestamps.filter((t) => now - t < 60_000);
    this.#localVelocityTimestamps.set(key, active);
    return active.length;
  }

  /**
   * Record a request for account velocity tracking.
   * @param {string} accountId
   * @param {string} [platform]
   */
  recordRequest(accountId, platform) {
    const key = this.#resolveKey(accountId, platform);
    if (!key) return;

    if (this.#governor) {
      this.#governor.recordRequest(key);
    }

    const timestamps = this.#localVelocityTimestamps.get(key) || [];
    const now = Date.now();
    const active = timestamps.filter((t) => now - t < 60_000);
    active.push(now);
    this.#localVelocityTimestamps.set(key, active);
  }

  /**
   * Assign a proxy to an account.
   * @param {string} accountId
   * @param {unknown} proxy
   * @param {string} [platform]
   */
  setAssignedProxy(accountId, proxy, platform) {
    const record = this.#resolveRecord(accountId, platform);
    if (!record) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Account "${accountId}" is not registered`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    record.assignedProxy = proxy;
  }

  /**
   * Check if a platform has any available account without mutating state.
   * @param {string} platform
   * @returns {boolean}
   */
  hasAvailable(platform) {
    return this.#findNextAvailable(platform, false, false) !== null;
  }

  /**
   * @param {string} platform
   * @param {boolean} advance
   * @param {boolean} autoWake
   * @returns {string | null}
   */
  #findNextAvailable(platform, advance, autoWake) {
    const accounts = this.#accountsByPlatform.get(platform);
    if (!accounts || accounts.size === 0) return null;

    const list = Array.from(accounts);
    let startIndex = this.#roundRobinIndex.get(platform) || 0;
    const now = Date.now();

    for (let i = 0; i < list.length; i++) {
      const index = (startIndex + i) % list.length;
      const accountId = list[index];
      const key = this.#compositeKey(platform, accountId);
      const record = this.#accountRecords.get(key);

      if (this.#unavailableAccounts.has(key)) {
        if (record?.hibernatingUntil && now >= record.hibernatingUntil) {
          if (autoWake) {
            this.markAvailable(accountId, platform);
          }
          // If not autoWake, still consider the account available below.
        } else {
          continue;
        }
      }

      if (this.#governor?.isHibernating(key)) continue;
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
   * Return a redacted view of the account record.
   *
   * Credentials are always omitted. Proxy credentials are stripped from the
   * assigned proxy before returning.
   *
   * @param {string} accountId
   * @param {string} [platform]
   * @returns {Record<string, unknown> | null}
   */
  getAccount(accountId, platform) {
    const record = this.#resolveRecord(accountId, platform);
    if (!record) return null;

    return {
      platform: record.platform,
      accountId: record.accountId,
      assignedProxy: this.#redactProxy(record.assignedProxy),
      hibernatingUntil: record.hibernatingUntil,
      velocity: this.getAccountVelocity(accountId, platform),
    };
  }

  /**
   * @param {unknown} proxy
   * @returns {unknown}
   */
  #redactProxy(proxy) {
    if (!proxy) return null;

    if (typeof proxy === 'object' && proxy !== null) {
      const record = /** @type {Record<string, unknown>} */ (proxy);
      const redacted = { ...record };
      delete redacted.username;
      delete redacted.password;
      return redacted;
    }

    if (typeof proxy === 'string') {
      try {
        const url = new URL(proxy);
        const scheme = url.protocol.replace(/:$/, '').toLowerCase();
        return {
          scheme,
          host: url.hostname,
          port: parseInt(url.port, 10),
          server: `${scheme}://${url.host}`,
        };
      } catch {
        return null;
      }
    }

    return proxy;
  }
}

export const globalAccountPool = new AccountPool();
