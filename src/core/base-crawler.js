// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractCrawler — platform-agnostic crawler contract.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';
import { globalActionRegistry } from './action-registry.js';
import { isValidCategory, CATEGORY_VALUES } from './types.js';

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
   * @param {Omit<ActionDescriptor, 'action'>} [descriptor]
   */
  registerAction(action, handler, descriptor = {}) {
    if (!/^[a-z0-9_]+$/.test(action)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        message: `Action "${action}" must be snake_case`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    const fullDescriptor = { action, ...descriptor };
    this.#registry.set(action, { handler: handler.bind(this), descriptor: fullDescriptor });
    globalActionRegistry.registerPlatformActions(this.name, [fullDescriptor]);
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
   * Validate a post/comment item before storage.
   * @param {PostItem | CommentItem} item
   */
  validateItem(item) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      item.id.length === 0 ||
      typeof item.platform !== 'string' ||
      item.platform.length === 0
    ) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        message: 'Item must have a non-empty id and platform',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    if ('category' in item && !isValidCategory(item.category)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        message: `Invalid category "${item.category}". Allowed: ${CATEGORY_VALUES.join(', ')}`,
        platform: this.name,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
  }

  /**
   * @param {CrawlerCommand} command
   * @returns {Promise<PostItem[] | CommentItem[] | PostItem | any>}
   */
  async start(command) {
    if (!command || typeof command.action !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        message: 'CrawlerCommand must have a string action',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    const entry = this.#registry.get(command.action);
    if (!entry) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        message: `Unknown action "${command.action}" for ${this.name}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
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
