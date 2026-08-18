// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Global action registry for CLI/MCP discovery.
 * @author nich (@nichxbt)
 * @license MIT
 */

/** @typedef {import('./types.js').ActionDescriptor} ActionDescriptor */

export class ActionRegistry {
  /** @type {Map<string, { platform: string, descriptor: ActionDescriptor }>} */
  #actions = new Map();

  /**
   * @param {string} platform
   * @param {ActionDescriptor[]} descriptors
   */
  registerPlatformActions(platform, descriptors) {
    for (const descriptor of descriptors) {
      this.#actions.set(`${platform}:${descriptor.action}`, { platform, descriptor });
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
