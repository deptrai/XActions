// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractCrawler — platform-agnostic crawler contract.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError } from './error-envelope.js';

/** @typedef {import('./types.js').CrawlerCommand} CrawlerCommand */
/** @typedef {import('./types.js').ActionDescriptor} ActionDescriptor */
/** @typedef {import('./types.js').PostItem} PostItem */
/** @typedef {import('./types.js').CommentItem} CommentItem */

export class AbstractCrawler {
  /** @type {string} */
  name = 'base';

  /** @type {Map<string, { handler: Function, descriptor: Partial<ActionDescriptor> }>} */
  #registry = new Map();

  /**
   * @param {Object} [deps]
   * @param {import('./base-client.js').AbstractApiClient} [deps.client]
   * @param {import('./base-store.js').AbstractStore} [deps.store]
   * @param {import('./session-manager.js').SessionManager} [deps.sessionManager]
   */
  constructor(deps = {}) {
    if (new.target === AbstractCrawler) {
      throw new TypeError('AbstractCrawler is abstract; extend it.');
    }
    this.client = deps.client;
    this.store = deps.store;
    this.sessionManager = deps.sessionManager;
  }

  /**
   * Register an action for this crawler.
   * @param {string} action
   * @param {Function} handler
   * @param {Partial<ActionDescriptor>} [descriptor]
   */
  registerAction(action, handler, descriptor = {}) {
    this.#registry.set(action, { handler: handler.bind(this), descriptor });
  }

  /** @returns {ActionDescriptor[]} */
  listActions() {
    return Array.from(this.#registry.entries()).map(([action, { descriptor }]) => ({
      action,
      description: descriptor.description || `${action} for ${this.name}`,
      requiredArgs: descriptor.requiredArgs || [],
      optionalArgs: descriptor.optionalArgs || [],
      example: descriptor.example || {},
      outputType: descriptor.outputType || 'PostItem[]',
    }));
  }

  /**
   * @param {CrawlerCommand} command
   * @returns {Promise<PostItem[] | CommentItem[] | PostItem | any>}
   */
  async start(command) {
    if (!command || typeof command.action !== 'string') {
      throw new PlatformError({
        type: 'invalid_args',
        message: 'CrawlerCommand must have a string action',
        suggestedAction: 'use_x_actions_list',
      });
    }
    const entry = this.#registry.get(command.action);
    if (!entry) {
      throw new PlatformError({
        type: 'invalid_args',
        message: `Unknown action "${command.action}" for ${this.name}`,
        suggestedAction: 'use_x_actions_list',
      });
    }
    return entry.handler(command.args, command.session);
  }

  /** @returns {Promise<void>} */
  async init() { throw new Error('Method not implemented: init()'); }

  /**
   * @param {Object} args
   * @returns {Promise<PostItem[]>}
   */
  async search(args) { throw new Error('Method not implemented: search()'); }

  /**
   * @param {Object} args
   * @returns {Promise<PostItem>}
   */
  async getPostDetail(args) { throw new Error('Method not implemented: getPostDetail()'); }

  /**
   * @param {Object} args
   * @returns {Promise<CommentItem[]>}
   */
  async getComments(args) { throw new Error('Method not implemented: getComments()'); }

  /** @returns {Promise<void>} */
  async cleanup() { throw new Error('Method not implemented: cleanup()'); }
}
