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
import { globalChallengeSignatureDetector } from './challenge-signature-detector.js';
import { globalSessionHealthOrchestrator } from './session-health-orchestrator.js';
import { globalSchemaDriftGuard } from './schema-drift-guard.js';
import { toIsoDate, isEnvTruthy, defaultRedisStreamPublisher } from '../utils/redis-stream-publisher.js';

/** @typedef {import('./types.js').CrawlerCommand} CrawlerCommand */
/** @typedef {import('./types.js').ActionDescriptor} ActionDescriptor */
/** @typedef {import('./types.js').PostItem} PostItem */
/** @typedef {import('./types.js').CommentItem} CommentItem */
/** @typedef {import('./adaptive-governor.js').AdaptiveRateGovernor} AdaptiveRateGovernor */
/** @typedef {import('./account-pool.js').AccountPool} AccountPool */
/** @typedef {import('./base-client.js').AbstractApiClient} AbstractApiClient */
/** @typedef {import('./base-store.js').AbstractStore} AbstractStore */
/** @typedef {AbstractApiClient} ClientLike */
/** @typedef {AbstractStore} StoreLike */

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

  /** @type {import('./challenge-signature-detector.js').ChallengeSignatureDetector | null} */
  challengeDetector = null;

  /** @type {import('./session-health-orchestrator.js').SessionHealthOrchestrator | null} */
  healthOrchestrator = null;

  /** @type {import('./schema-drift-guard.js').SchemaDriftGuard | null} */
  driftGuard = null;

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

  /** @type {ClientLike | null} */
  client = null;

  /** @type {StoreLike | null} */
  store = null;

  /** @type {Map<string, { handler: Function, descriptor: Partial<ActionDescriptor> }>} */
  #registry = new Map();

  /** @type {boolean} */
  includeBuzzwords = false;

  /**
   * @param {object} [deps]
   * @param {ClientLike} [deps.client]
   * @param {StoreLike} [deps.store]
   * @param {import('./session-manager.js').SessionManager} [deps.sessionManager]
   * @param {AdaptiveRateGovernor} [deps.governor]
   * @param {AccountPool} [deps.accountPool]
   * @param {boolean} [deps.requiresAuth]
   * @param {string} [deps.cdpUrl]
   * @param {string} [deps.scraperId]
   * @param {string} [deps.category]
   * @param {import('./challenge-signature-detector.js').ChallengeSignatureDetector} [deps.challengeDetector]
   * @param {import('./session-health-orchestrator.js').SessionHealthOrchestrator} [deps.healthOrchestrator]
   * @param {import('./schema-drift-guard.js').SchemaDriftGuard} [deps.driftGuard]
   * @param {import('./telemetry-emitter.js').TelemetryEmitter} [deps.telemetryEmitter]
   * @param {boolean} [deps.includeBuzzwords] -- inject `summary.buzzwords` into crawl results (Story 14.4)
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
    this.challengeDetector = deps.challengeDetector || deps.client?.challengeDetector || globalChallengeSignatureDetector;
    this.healthOrchestrator = deps.healthOrchestrator || deps.client?.healthOrchestrator || globalSessionHealthOrchestrator;
    this.driftGuard = deps.driftGuard || globalSchemaDriftGuard;
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
    this.includeBuzzwords = deps.includeBuzzwords === true;
  }

  /**
   * Map a crawled item to a ThinEvent for stream publishing.
   * Per-category field mapping — override in subclass if item type differs.
   * @param {Record<string, unknown>} item
   * @param {Record<string, unknown>} [context]
   * @returns {Record<string, unknown>}
   */
  mapToThinEvent(item, context = {}) {
    // Per-type field mapping — detect item type and map accordingly
    let contentSnippet = '';
    let authorId = '';
    let postUrl = '';
    
    if (item.text || item.content) {
      // PostItem (text) or GenericPostItem (content)
      const content = item.text || item.content;
      contentSnippet = String(content).slice(0, 4000);
      authorId = item.authorId || item.author_id || '';
      postUrl = item.url || item.postUrl || item.post_url || '';
    } else if (item.title && item.description) {
      // ProductItem
      contentSnippet = `${item.title} ${item.description}`.slice(0, 4000);
      authorId = item.shop_id || item.sellerId || item.authorId || '';
      postUrl = item.productUrl || item.url || '';
    } else if (item.name && item.industry) {
      // CompanyItem
      contentSnippet = `${item.name} ${item.industry} ${item.address || ''}`.slice(0, 4000);
      authorId = item.taxCode || item.authorId || '';
      postUrl = item.detailUrl || item.url || '';
    } else if (item.title && item.company) {
      // JobItem
      contentSnippet = `${item.title} ${item.company} ${item.location || ''}`.slice(0, 4000);
      authorId = item.companyId || item.authorId || '';
      postUrl = item.jobUrl || item.url || '';
    } else if (item.title && item.price) {
      // ListingItem
      contentSnippet = `${item.title} ${item.price} ${item.area || ''}`.slice(0, 4000);
      authorId = item.sellerId || item.authorId || '';
      postUrl = item.listingUrl || item.url || '';
    }

    const base = {
      id: item.id || `${this.name}:${item.externalId || item.id}`,
      platform: this.name,
      external_post_id: item.externalId || item.id,
      category: item.category || this.category,
      author_id: authorId,
      author_name: item.authorName || item.author_name || '',
      post_url: postUrl,
      crawled_at: toIsoDate(item.crawledAt || item.crawled_at),
      storage_ref: item.storageRef || item.storage_ref || item.id,
      scraper_id: this.scraperId,
      content_snippet: contentSnippet,
      target_id: context?.targetId,
      workspace_id: context?.workspaceId,
      schema_version: 1,
      // Dual-emit: camelCase fields for backward compatibility
      externalId: item.externalId || item.id,
      authorId,
      crawledAt: toIsoDate(item.crawledAt || item.crawled_at),
      storageRef: item.storageRef || item.storage_ref || item.id,
    };

    return base;
  }

  /**
   * Emit stream events for crawled items after handler completes.
   * @param {unknown} result
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<void>}
   */
  async #emitStreamEvents(result, session = {}, args = {}) {
    if (!isEnvTruthy(process.env.REDIS_STREAM_ENABLED)) return;
    if (session?.dryRun || args?.dryRun) return;
    if (result && typeof result === 'object' && (result.__streamEmitted || result.posts?.__streamEmitted)) return;

    const items = this.extractItems(result);
    if (!items || items.length === 0) return;

    const publisher = this.store?.publisher || this.redisPublisher || defaultRedisStreamPublisher;
    if (!publisher || typeof publisher.publish !== 'function') return;

    // context comes from args.context (x_scrape) or session.context (direct calls)
    const context = args?.context || session?.context || {};
    if (!context?.workspaceId) {
      console.warn(`[StreamPublisher:MissingWorkspaceId] ${this.name} emitting stream events without workspaceId — Nowing consumer will drop events`);
    }
    for (const item of items) {
      const thinEvent = this.mapToThinEvent(item, context);
      if (!thinEvent.content_snippet) {
        console.warn(`[StreamPublisher:MissingContentSnippet] ${this.name} item ${thinEvent.id} missing content_snippet — Nowing consumer will drop`);
      }
      try {
        await publisher.publish(thinEvent);
      } catch (err) {
        console.warn(`[StreamPublisher] ${this.name} failed to publish item ${thinEvent.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Extract flat array of items from crawler result.
   * @param {unknown} result
   * @returns {Array<Record<string, unknown>>}
   */
  extractItems(result) {
    if (!result || typeof result !== 'object') return [];
    // Handle array results directly (e.g., Mastodon returns posts[])
    if (Array.isArray(result)) return result;
    const obj = /** @type {Record<string, unknown>} */ (result);
    // Check for array-valued keys first
    for (const key of ['items', 'posts', 'data', 'listings', 'products', 'jobs', 'comments']) {
      if (Array.isArray(obj[key])) return obj[key];
    }
    // Check for single-item keys (post, item, listing, product, job, company)
    for (const key of ['post', 'item', 'listing', 'product', 'job', 'company']) {
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        return [obj[key]];
      }
    }
    return [obj];
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
   * @param {unknown} result
   * @returns {number}
   */
  extractItemCount(result) {
    if (!result) return 0;
    if (typeof result === 'number') {
      return Number.isFinite(result) && result > 0 ? result : 0;
    }
    if (Array.isArray(result)) return result.length;
    if (typeof result === 'object' && result !== null) {
      const obj = /** @type {Record<string, unknown>} */ (result);
      for (const key of ['items', 'posts', 'data', 'records', 'results']) {
        if (Array.isArray(obj[key])) return obj[key].length;
      }
      if (typeof obj.count === 'number' && Number.isFinite(obj.count)) return obj.count;
      if (typeof obj.total === 'number' && Number.isFinite(obj.total)) return obj.total;
      return Object.keys(obj).length > 0 ? 1 : 0;
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
      checkpointResolver: descriptor.checkpointResolver,
    }));
  }

  /**
   * Hook to determine schema type for an item. Default uses driftGuard inference.
   * Can be overridden by subclasses.
   * @param {unknown} item
   * @returns {string}
   */
  getItemSchemaType(item) {
    if (this.driftGuard && typeof this.driftGuard.inferItemType === 'function') {
      return this.driftGuard.inferItemType(item);
    }
    return 'post-item';
  }

  /**
   * Validate a post/comment item before storage.
   * @param {PostItem | CommentItem | import('./types.js').ProfileItem | any} item
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

    if (this.driftGuard && typeof this.driftGuard.validateOrThrow === 'function') {
      const schemaType = this.getItemSchemaType(item);
      const result = this.driftGuard.validateOrThrow(this.name, item, { schemaType });
      if (result && result.classification === 'degraded' && Object.isExtensible(item)) {
        item.dataQuality = {
          score: result.score,
          missingFields: result.missingFields,
          classification: 'degraded',
        };
      }
    }
  }

  /**
   * Validate a batch of items, dropping corrupted/invalid ones instead of
   * aborting the whole batch. Returns only the items that passed validateItem.
   * Corrupted drops surface a warn log so schema drift is never silent.
   * @template T
   * @param {T[]} items
   * @returns {T[]}
   */
  filterValidItems(items) {
    if (!Array.isArray(items)) return [];
    const valid = [];
    for (const item of items) {
      try {
        this.validateItem(item);
        valid.push(item);
      } catch (err) {
        const type = /** @type {any} */ (err)?.type;
        console.warn(
          `[${this.name}] item dropped by validation (${type || 'unknown'}): ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
    return valid;
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

    // Resolve checkpoint and auto-inject cursor before calling handler (Story 25.5)
    const resolvedArgs = await this.resolveCheckpoint(command.action, command.args);
    const finalArgs = resolvedArgs || command.args;

    const session = {
      ...(command.session || {}),
      requiresAuth: actionRequiresAuth,
      telemetry,
      ...(accountId ? { accountId } : { accountId: null }),
    };

    if (this.client) {
      const baseClient = /** @type {AbstractApiClient} */ (this.client);
      baseClient.telemetryContext = telemetry;
      baseClient.isCanary = isCanary;
    }
    if (this.store) {
      const baseStore = /** @type {AbstractStore} */ (this.store);
      baseStore.telemetryContext = telemetry;
    }

    const startTime = Date.now();
    let result = null;
    /** @type {(Error & { code?: string }) | null} */
    let error = null;

    try {
      // Apply Gaussian jitter between actions when in CDP attach mode.
      if (this.cdpUrl || command.session?.cdpUrl) {
        await this.delayWithJitter();
      }

      result = await entry.handler(finalArgs, session);

      // Emit stream events for crawled items (Story 20.2)
      await this.#emitStreamEvents(result, session, finalArgs);

      // Story 14.4: inject keyword/hashtag frequency summary when opted in
      if (this.includeBuzzwords && result && typeof result === 'object') {
        const items = (/** @type {Record<string, unknown>} */ (result)).posts
          || (/** @type {Record<string, unknown>} */ (result)).comments
          || (/** @type {Record<string, unknown>} */ (result)).items
          || [];
        const capped = Array.isArray(items) ? items.slice(0, 500) : [];
        const { extractKeywordFrequency } = await import('../analytics/word-frequency.js');
        const buzzwords = extractKeywordFrequency(capped);
        const resultObj = /** @type {Record<string, unknown>} */ (result);
        const existingSummary = resultObj.summary && typeof resultObj.summary === 'object'
          ? /** @type {Record<string, unknown>} */ (resultObj.summary)
          : {};
        resultObj.summary = { ...existingSummary, buzzwords };
      }

      return result;
    } catch (err) {
      error = /** @type {Error & { code?: string }} */ (err);
      throw err;
    } finally {
      if (this.client) {
        const baseClient = /** @type {AbstractApiClient} */ (this.client);
        baseClient.telemetryContext = null;
        baseClient.isCanary = false;
      }
      if (this.store) {
        const baseStore = /** @type {AbstractStore} */ (this.store);
        baseStore.telemetryContext = null;
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
        console.error('[TELEMETRY] Failed to emit run telemetry:', emitErr instanceof Error ? emitErr.message : String(emitErr));
      }
    }
  }

  /**
   * Resolve checkpoint for the given action and inject `lastCursor` into args when
   * the caller did not supply a cursor and `args.resume !== false`.
   * @param {string} action
   * @param {Record<string, unknown>} [args]
   * @returns {Promise<Record<string, unknown> | undefined>} Resolved args or undefined if unchanged.
   */
  async resolveCheckpoint(action, args) {
    const normalizedArgs = args || {};
    const resumeValue = normalizedArgs.resume;
    if (resumeValue === false || resumeValue === 'false' || resumeValue === 0 || resumeValue === '0') {
      return undefined;
    }
    if (!this.store || typeof this.store.getCheckpoint !== 'function') {
      return undefined;
    }

    const entry = this.#registry.get(action);
    const resolver = entry?.descriptor?.checkpointResolver;
    if (typeof resolver !== 'function') {
      return undefined;
    }

    let resolution = null;
    try {
      resolution = await resolver(normalizedArgs);
    } catch (err) {
      console.warn(`[CHECKPOINT] resolver for ${this.name}.${action} threw: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
    if (!resolution || !resolution.targetType || !resolution.targetKey) {
      return undefined;
    }

    const cursorField = resolution.cursorField || 'cursor';
    const fallbackFields = Array.isArray(resolution.fallbackCursorFields)
      ? resolution.fallbackCursorFields
      : ['cursor', 'after', 'max_id'];
    const allCursorFields = [...new Set([cursorField, ...fallbackFields])];
    const hasCallerCursor = allCursorFields.some(
      (f) => normalizedArgs[f] !== undefined && normalizedArgs[f] !== null && normalizedArgs[f] !== ''
    );
    if (hasCallerCursor) {
      return undefined;
    }

    try {
      const checkpoint = await this.store.getCheckpoint(this.name, resolution.targetType, resolution.targetKey);
      if (checkpoint && checkpoint.lastCursor !== undefined && checkpoint.lastCursor !== null && checkpoint.lastCursor !== '') {
        return { ...normalizedArgs, [cursorField]: checkpoint.lastCursor };
      }
    } catch (err) {
      // Swallow checkpoint lookup errors to avoid breaking scraping, but surface
      // the degradation so a dead checkpoint store doesn't silently become a
      // full re-crawl every run.
      console.warn(`[CHECKPOINT] getCheckpoint failed for ${this.name}.${action} (${resolution.targetType}:${resolution.targetKey}); starting from scratch: ${err instanceof Error ? err.message : String(err)}`);
    }
    return undefined;
  }

  /**
   * Determine whether pagination should stop early.
   * Accepts either the raw items array or the StoreBatchResult returned by storeBatch().
   * @param {Array<{ id: string }> | { insertedCount: number, totalCount: number }} itemsOrBatch
   * @returns {Promise<boolean>}
   */
  async shouldStopPagination(itemsOrBatch) {
    // Prefer storeBatch metadata: all duplicates means early stop.
    if (
      itemsOrBatch &&
      typeof itemsOrBatch === 'object' &&
      !Array.isArray(itemsOrBatch) &&
      typeof itemsOrBatch.insertedCount === 'number' &&
      typeof itemsOrBatch.totalCount === 'number'
    ) {
      return itemsOrBatch.insertedCount === 0 && itemsOrBatch.totalCount > 0;
    }

    const items = itemsOrBatch;
    if (!Array.isArray(items) || items.length === 0) return false;
    if (!this.store || typeof this.store.findExistingIds !== 'function') return false;

    try {
      const ids = items.map((item) => item.id).filter((id) => typeof id === 'string' && id.length > 0);
      if (ids.length === 0) return false;
      const uniqueIds = [...new Set(ids)];
      const existingIds = await this.store.findExistingIds(uniqueIds);
      return existingIds.length === uniqueIds.length;
    } catch (err) {
      // Fail-open: an ET lookup error must never stop pagination, but log it so a
      // dead store doesn't silently disable early termination on every page.
      console.warn(`[EARLY-TERM] findExistingIds failed for ${this.name}; continuing pagination: ${err instanceof Error ? err.message : String(err)}`);
      return false;
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
   * @param {Record<string, any>} [args]
   * @param {Record<string, any>} [session]
   * @returns {Promise<any>}
   */
  async search(args = {}, session = {}) { throw new Error('Method not implemented: search()'); }

  /**
   * @param {Record<string, any>} [args]
   * @returns {Promise<any>}
   */
  async getPostDetail(args = {}) { throw new Error('Method not implemented: getPostDetail()'); }

  /**
   * @param {Record<string, any>} [args]
   * @returns {Promise<any>}
   */
  async getComments(args = {}) { throw new Error('Method not implemented: getComments()'); }

  /** @returns {Promise<void>} */
  async cleanup() { throw new Error('Method not implemented: cleanup()'); }

  /**
   * Story 27.3 — run `ChallengeSignatureDetector` against a Puppeteer page's
   * rendered DOM. Returns the normalized ChallengeResult; never throws.
   * When `detected`, this crawler's `governor`/`accountPool`/`healthOrchestrator`
   * are notified (mirroring AbstractApiClient behaviour).
   *
   * @param {import('puppeteer').Page} page
   * @param {Object} [opts]
   * @param {string} [opts.accountId]  - account to markUnavailable when detected
   * @returns {Promise<import('./challenge-signature-detector.js').ChallengeResult>}
   */
  async detectChallengeOnPage(page, opts = {}) {
    const fallback = {
      detected: false, type: 'unknown', confidence: 0,
      suggestedHibernationMs: 10 * 60 * 1000,
      signature: null, matchedPatterns: [],
    };
    try {
      if (!page || typeof page.content !== 'function') return fallback;
      const safeOpts = (opts && typeof opts === 'object') ? opts : {};
      const html = await page.content();
      const url = typeof page.url === 'function' ? page.url() : '';
      const detector = this.challengeDetector || globalChallengeSignatureDetector;
      const result = detector.detectFromHtml(html, { url, platform: this.name });
      if (result.detected) {
        const accountId = safeOpts.accountId || null;
        if (accountId && this.accountPool && typeof this.accountPool.markUnavailable === 'function') {
          try { this.accountPool.markUnavailable(accountId, 'bot_challenge', result.suggestedHibernationMs, this.name); } catch {}
        }
        if (accountId && this.governor && typeof this.governor.recordBotChallenge === 'function') {
          try { this.governor.recordBotChallenge(accountId, this.name, result.suggestedHibernationMs); } catch {}
        }
        if (accountId && this.healthOrchestrator && typeof this.healthOrchestrator.recordBotChallenge === 'function') {
          try { this.healthOrchestrator.recordBotChallenge(this.name || 'default', accountId); } catch {}
        }
      }
      return result;
    } catch {
      return fallback;
    }
  }
}
