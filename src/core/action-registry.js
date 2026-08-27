// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Global action registry for CLI/MCP discovery.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';

/** @typedef {import('./types.js').ActionDescriptor} ActionDescriptor */

export class ActionRegistry {
  /** @type {Map<string, { platform: string, descriptor: ActionDescriptor }>} */
  #actions = new Map();

  /** @returns {void} */
  clear() {
    this.#actions.clear();
  }

  /**
   * @param {string} platform
   * @param {ActionDescriptor[]} descriptors
   */
  registerPlatformActions(platform, descriptors) {
    for (const descriptor of descriptors) {
      const key = `${platform}:${descriptor.action}`;
      if (this.#actions.has(key)) {
        const entry = this.#actions.get(key);
        if (!entry) continue;
        const existing = entry.descriptor;
        if (
          existing.description !== descriptor.description ||
          existing.outputType !== descriptor.outputType ||
          Boolean(existing.requiresAuth) !== Boolean(descriptor.requiresAuth) ||
          JSON.stringify(existing.requiredArgs) !== JSON.stringify(descriptor.requiredArgs) ||
          JSON.stringify(existing.optionalArgs) !== JSON.stringify(descriptor.optionalArgs) ||
          JSON.stringify(existing.example) !== JSON.stringify(descriptor.example)
        ) {
          throw new PlatformError({
            type: ErrorTypes.INVALID_ARGS,
            message: `Action "${descriptor.action}" is already registered for platform "${platform}" with a different descriptor`,
            platform,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          });
        }
        continue;
      }
      this.#actions.set(key, { platform, descriptor });
    }
  }

  /** @returns {ActionDescriptor[]} */
  listAll() {
    return Array.from(this.#actions.values()).map(({ descriptor }) => descriptor);
  }

  /**
   * @param {string} [platform]
   * @returns {ActionDescriptor[]}
   */
  listByPlatform(platform) {
    if (!platform) return this.listAll();
    return Array.from(this.#actions.values())
      .filter(({ platform: p }) => p === platform)
      .map(({ descriptor }) => descriptor);
  }

  /**
   * @param {string} platform
   * @param {string} action
   * @returns {ActionDescriptor | undefined}
   */
  get(platform, action) {
    return this.#actions.get(`${platform}:${action}`)?.descriptor;
  }
}

export const globalActionRegistry = new ActionRegistry();
