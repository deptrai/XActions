// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractCrawler — platform-agnostic crawler contract.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';
import { globalActionRegistry } from './action-registry.js';
import { isValidCategory, CATEGORY_VALUES } from './types.js';
import { launchBrowserWithCdp } from './cdp-launcher.js';
import { gaussianDelay } from '../utils/gaussian-delay.js';
import { defaultTelemetryEmitter } from './telemetry-emitter.js';
import { TelemetryContext } from './telemetry-context.js';

/** @typedef {import('./types.js').CrawlerCommand} CrawlerCommand */
/** @typedef {import('./types.js').ActionDescriptor} ActionDescriptor */
/** @typedef {import('./types.js').PostItem} PostItem */
/** @typedef {import('./types.js').CommentItem} CommentItem */
/** @typedef {import('./adaptive-governor.js').AdaptiveRateGovernor} AdaptiveRateGovernor */
/** @typedef {import('./account-pool.js').AccountPool} AccountPool */

export class AbstractCrawler {
  /** @type {string} */
  name = 'base';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {string | null} */
  cdpUrl = null;

  /** @type {AdaptiveRateGovernor | null} */
  governor = null;

  /** @type {AccountPool | null} */
  accountPool = null;

  /** @type {string | null} */
  #scraperId = null;

  /** @type {string | null} */
  #category = null;

  /** @returns {string} */
  get category() {
    return this.#category || 'social';
  }

  /** @param {string} val */
  set category(val) {
    if (val && !isValidCategory(val)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid category "${val}". Allowed: ${CATEGORY_VALUES.join(', ')}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    this.#category = val;
  }

  /** @type {import('./telemetry-emitter.js').TelemetryEmitter | null} */
  telemetryEmitter = null;

  /** @returns {string} */
  get scraperId() {
    return this.#scraperId || `${this.name}-hybrid`;
  }

  /** @param {string} val */
  set scraperId(val) {
    this.#scraperId = val;
  }

  /** @type {Map<string, { handler: Function, descriptor: Partial<ActionDescriptor> }>} */
  #registry = new Map();

  /**
   * @param {Object} [deps]
   * @param {import('./base-client.js').AbstractApiClient} [deps.client]
   * @param {import('./base-store.js').AbstractStore} [deps.store]
   * @param {import('./session-manager.js').SessionManager} [deps.sessionManager]
   * @param {AdaptiveRateGovernor} [deps.governor]
   * @param {AccountPool} [deps.accountPool]
   * @param {boolean} [deps.requiresAuth]
   * @param {string} [deps.cdpUrl]
   */
  constructor(deps = {}) {
    if (new.target === AbstractCrawler) {
      throw new TypeError('AbstractCrawler is abstract; extend it.');
    }
    this.client = deps.client || null;
    this.store = deps.store || null;
    this.sessionManager = deps.sessionManager || deps.client?.sessionManager || null;
    this.governor = deps.governor || deps.client?.governor || null;
    this.accountPool = deps.accountPool || deps.client?.accountPool || null;
    this.cdpUrl = deps.cdpUrl || null;
    if (deps.requiresAuth !== undefined) {
      this.requiresAuth = deps.requiresAuth;
    }
    if (deps.scraperId) {
      this.#scraperId = deps.scraperId;
    }
    if (deps.category) {
      this.category = deps.category;
    }
    this.telemetryEmitter = deps.telemetryEmitter || defaultTelemetryEmitter;
  }

  /**
   * Register an action for this crawler.
   * Supports both registerAction('name', fn, desc) and registerAction({ action, handler, ...desc }).
   * @param {string | (Partial<ActionDescriptor> & { action: string, handler: Function })} action
   * @param {Function} [handler]
   * @param {Omit<ActionDescriptor, 'action'>} [descriptor]
   */
  registerAction(action, handler, descriptor = {}) {
    let actionName = action;
    let actionHandler = handler;
    let actionDesc = descriptor;

    if (typeof action === 'object' && action !== null) {
      actionName = action.action;
      actionHandler = action.handler;
      const { action: _a, handler: _h, ...rest } = action;
      actionDesc = rest;
    }

    if (typeof actionName !== 'string' || !/^[a-z0-9_]+$/.test(actionName)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        message: `Action "${actionName}" must be snake_case`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    if (typeof actionHandler !== 'function') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        message: `Action handler for "${actionName}" must be a function`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const resolvedRequiresAuth = actionDesc.requiresAuth !== undefined ? actionDesc.requiresAuth : this.requiresAuth;
    const fullDescriptor = { ...actionDesc, action: actionName, requiresAuth: resolvedRequiresAuth };
    this.#registry.set(actionName, { handler: actionHandler.bind(this), descriptor: fullDescriptor });
    globalActionRegistry.registerPlatformActions(this.name, [fullDescriptor]);
  }

  /**
   * Intelligently extract item count from varied action result shapes (AD-33).
   * @param {any} result
   * @returns {number}
   */
  extractItemCount(result) {
    if (!result) return 0;
    if (typeof result === 'number') {
      return Number.isFinite(result) && result > 0 ? result : 0;
    }
    if (Array.isArray(result)) return result.length;
    if (typeof result === 'object') {
      for (const key of ['items', 'posts', 'data', 'records', 'results']) {
        if (Array.isArray(result[key])) return result[key].length;
      }
      if (typeof result.count === 'number' && Number.isFinite(result.count)) return result.count;
      if (typeof result.total === 'number' && Number.isFinite(result.total)) return result.total;
      return Object.keys(result).length > 0 ? 1 : 0;
    }
    return 0;
  }

  /** @returns {ActionDescriptor[]} */
  listActions() {
    return Array.from(this.#registry.entries()).map(([action, { descriptor }]) => ({
      action,
      category: descriptor.category || 'social',
      description: descriptor.description || `${action} for ${this.name}`,
      requiredArgs: descriptor.requiredArgs || [],
      optionalArgs: descriptor.optionalArgs || [],
      example: descriptor.example || {},
      outputType: descriptor.outputType || 'PostItem[]',
      requiresAuth: descriptor.requiresAuth !== undefined ? descriptor.requiresAuth : this.requiresAuth,
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
        code: 'XACT_4001',
        message: 'CrawlerCommand must have a string action',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.name,
      });
    }
    const entry = this.#registry.get(command.action);
    if (!entry) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Unknown action "${command.action}" for ${this.name}`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.name,
      });
    }

    const actionRequiresAuth = entry.descriptor.requiresAuth !== undefined ? entry.descriptor.requiresAuth : this.requiresAuth;

    // Resolve account ID
    let accountId = command.session?.accountId || command.args?.accountId || null;
    if (actionRequiresAuth && !accountId && this.accountPool) {
      const account = this.accountPool.getNextAvailable(this.name);
      if (account) {
        accountId = account;
      }
    }

    if (actionRequiresAuth && !accountId) {
      throw new PlatformError({
        type: ErrorTypes.AUTH_EXPIRED,
        code: 'XACT_4010',
        message: `No available account for authenticated crawler on platform ${this.name}`,
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: this.name,
      });
    }

    const isCanary = Boolean(command.session?.isCanary);

    // Consult governor (bypassed for canary probes per AD-33)
    if (this.governor && !isCanary) {
      if (accountId) {
        if (!this.governor.canAccountRequest(accountId, this.name)) {
          throw new PlatformError({
            type: ErrorTypes.HIBERNATION,
            code: 'XACT_4291',
            message: `Account "${accountId}" is hibernating or exceeded rate velocity on ${this.name}`,
            statusCode: 429,
            suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
            accountId,
            platform: this.name,
          });
        }
      }

      if (typeof this.governor.getMaxThroughput === 'function') {
        const throughput = this.governor.getMaxThroughput(this.name);
        const status = typeof this.governor.getStatus === 'function' ? this.governor.getStatus() : null;
        const totalProxies = status?.totalProxyCount ?? 0;

        if (totalProxies > 0 && throughput === 0) {
          throw new PlatformError({
            type: ErrorTypes.PROXY_EXHAUSTED,
            code: 'XACT_5030',
            message: `No healthy proxies available for platform ${this.name}`,
            statusCode: 503,
            suggestedAction: SuggestedActions.WAIT,
            retryAfterMs: 30000,
            accountId,
            platform: this.name,
          });
        }
      }

      // Record the action attempt, unless the wrapped AbstractApiClient already records with the same governor.
      if (typeof this.governor.recordRequest === 'function') {
        const clientRecordsInSameGovernor = this.client && this.client.governor === this.governor;
        if (!clientRecordsInSameGovernor) {
          this.governor.recordRequest(accountId || 'noauth', this.name);
        }
      }
    }

    const effectiveCategory = entry.descriptor.category || this.#category || 'social';
    const telemetry = TelemetryContext.create({
      scraperId: this.scraperId,
      platform: this.name,
      category: effectiveCategory,
      action: command.action,
      source: isCanary ? 'canary' : 'production',
    });

    const session = {
      ...(command.session || {}),
      requiresAuth: actionRequiresAuth,
      telemetry,
      ...(accountId ? { accountId } : { accountId: null }),
    };

    if (this.client) {
      this.client.telemetryContext = telemetry;
      this.client.isCanary = isCanary;
    }
    if (this.store) {
      this.store.telemetryContext = telemetry;
    }

    const startTime = Date.now();
    let result = null;
    let error = null;

    try {
      // Apply Gaussian jitter between actions when running in CDP attach mode.
      if (this.cdpUrl || command.session?.cdpUrl) {
        await this.delayWithJitter();
      }

      result = await entry.handler(command.args, session);
      return result;
    } catch (err) {
      error = err;
      throw err;
    } finally {
      if (this.client) {
        this.client.telemetryContext = null;
        this.client.isCanary = false;
      }
      if (this.store) {
        this.store.telemetryContext = null;
      }

      const durationMs = Date.now() - startTime;
      const itemCount = this.extractItemCount(result);

      const runPayload = telemetry.toRunPayload({
        isSuccess: !error,
        durationMs,
        itemCount,
        errorName: error ? (error.code || (error.name !== 'Error' ? error.name : '') || error.name || 'Error') : '',
      });

      try {
        if (this.telemetryEmitter) {
          this.telemetryEmitter.emitRun(runPayload);
          for (const req of telemetry.getRequestPayloads()) {
            this.telemetryEmitter.emitRequest(req);
          }
        }
      } catch (emitErr) {
        console.error('[TELEMETRY] Failed to emit run telemetry:', emitErr.message);
      }
    }
  }

  /**
   * Launch or connect browser using CDP mode.
   * @param {string | null} [cdpUrl=this.cdpUrl]
   * @param {Object} [options={}]
   * @returns {Promise<any>}
   */
  async launchBrowserWithCdp(cdpUrl = this.cdpUrl, options = {}) {
    if (!cdpUrl) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `[CDP ERROR] cdpUrl must be provided to launchBrowserWithCdp for crawler ${this.name}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    return launchBrowserWithCdp(cdpUrl, options);
  }

  /**
   * Apply Gaussian Jitter delay between actions.
   * @param {number} [min=3000]
   * @param {number} [max=7000]
   * @returns {Promise<number>}
   */
  async delayWithJitter(min = 3000, max = 7000) {
    return gaussianDelay(min, max);
  }

  /** @returns {Promise<void>} */
  async init() { throw new Error('Method not implemented: init()'); }

  /**
   * @param {Object} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<PostItem[] | { posts: PostItem[], pageInfo: Record<string, any> }>}
   */
  async search(args, session) { throw new Error('Method not implemented: search()'); }

  /**
   * @param {Object} args
   * @returns {Promise<any>}
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
