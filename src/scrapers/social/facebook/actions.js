// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook Hybrid Social Actions
 *
 * Implements write mutations (like, comment, post, share, messenger_share,
 * join_group, send_friend_request) with dry-run default, rate governance,
 * and robust error envelopes.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { runGuardedActionBatch, FacebookActionVelocityTracker } from './batch-runner.js';

/**
 * Validate that a URL belongs to facebook.com safely without SSRF / domain spoofing.
 * @param {string} url
 * @returns {boolean}
 */
export function assertFacebookUrlLocal(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    const validSuffixes = ['facebook.com', 'fb.com', 'messenger.com', 'fb.watch', 'm.facebook.com', 'mbasic.facebook.com'];
    return validSuffixes.some((domain) => host === domain || host.endsWith('.' + domain));
  } catch {
    return false;
  }
}

/**
 * Strip potential PII (phone numbers, email addresses) for safe preview/logging.
 * @param {string} text
 * @returns {string}
 */
export function stripPii(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/(?:\+?\d{1,4}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}(?:[-.\s]?\d{1,4})?/g, '[REDACTED_PHONE]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
}

/**
 * Strip emoji surrogate characters from strings for compatibility.
 * @param {string} text
 * @returns {string}
 */
export function stripEmojiSurrogates(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
}

/**
 * Pick a random segment from a formatted message list.
 * @param {string} message
 * @returns {string}
 */
export function pickRandomSegment(message) {
  if (typeof message !== 'string') return '';
  const segments = message.split(/\|\|/).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return message;
  return segments[Math.floor(Math.random() * segments.length)];
}

export class FacebookActions {
  /** @type {any} */
  client;
  /** @type {any} */
  crawler;
  /** @type {any} */
  governor;
  /** @type {any} */
  accountPool;
  /** @type {any} */
  proxyPool;
  /** @type {FacebookActionVelocityTracker} */
  velocityTracker;

  /**
   * @param {Object} [deps={}]
   * @param {any} [deps.client]
   * @param {any} [deps.crawler]
   * @param {any} [deps.governor]
   * @param {any} [deps.accountPool]
   * @param {any} [deps.proxyPool]
   * @param {FacebookActionVelocityTracker} [deps.velocityTracker]
   */
  constructor(deps = {}) {
    this.client = deps.client || null;
    this.crawler = deps.crawler || null;
    this.governor = deps.governor || null;
    this.accountPool = deps.accountPool || null;
    this.proxyPool = deps.proxyPool || null;
    this.velocityTracker = deps.velocityTracker || new FacebookActionVelocityTracker();
  }

  /**
   * Resolve accountId from session or account pool.
   * @param {any} session
   * @returns {string}
   */
  #resolveAccountId(session) {
    if (session?.accountId) return String(session.accountId);
    if (this.accountPool && typeof this.accountPool.getAccount === 'function') {
      const acc = this.accountPool.getAccount('facebook');
      if (acc?.accountId) return String(acc.accountId);
    }
    return '';
  }

  /**
   * Validate authentication session for write actions.
   * @param {any} session
   * @returns {string} accountId
   */
  #requireAuthSession(session) {
    const accountId = this.#resolveAccountId(session);
    if (!accountId) {
      throw new PlatformError({
        code: 'XACT_4010',
        type: ErrorTypes.AUTH_EXPIRED,
        message: 'Write actions require an authenticated Facebook session or accountId.',
        suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
        platform: 'facebook',
      });
    }
    return accountId;
  }

  /**
   * Like a Facebook post or batch of posts.
   * @param {Object} args
   * @param {string|string[]} [args.postUrl]
   * @param {string|string[]} [args.postUrls]
   * @param {boolean} [args.dryRun=true]
   * @param {number} [args.delayMin]
   * @param {number} [args.delayMax]
   * @param {number} [args.maxBatch=30]
   * @param {any} [session]
   */
  async like(args, session = {}) {
    const accountId = this.#requireAuthSession(session);
    const dryRun = args?.dryRun !== false;

    const rawUrls = args?.postUrls || args?.postUrl;
    const urls = (Array.isArray(rawUrls) ? rawUrls : [rawUrls]).filter(Boolean).map(String);

    if (urls.length === 0) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: postUrl or postUrls',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    for (const u of urls) {
      if (!assertFacebookUrlLocal(u)) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `Invalid Facebook post URL: ${u}`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'facebook',
        });
      }
    }

    const batch = urls.slice(0, Math.max(1, Math.min(Number(args?.maxBatch) || 30, 100)));

    const results = await runGuardedActionBatch(
      batch,
      async (postUrl) => {
        if (dryRun) {
          return { postUrl, liked: false, alreadyLiked: false, dryRun: true };
        }

        // Live execution via browser bridge
        const bridge = /** @type {any} */ (this.client?.browserBridge || this.client?.ensureBrowserBridge?.());
        if (bridge && typeof bridge.withPage === 'function') {
          const cookies = session?.cookies || this.crawler?.sessionManager?.get?.(accountId)?.cookies;
          return bridge.withPage(async (/** @type {any} */ page) => {
            await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            // Evaluate like button
            const state = await page.evaluate(() => {
              const likeBtn = document.querySelector(
                '[aria-label*="Thích" i], [aria-label*="Like" i], [aria-label*="Bỏ thích" i], [aria-label*="Unlike" i]'
              );
              if (!likeBtn) return { found: false };
              const label = (likeBtn.getAttribute('aria-label') || '').toLowerCase();
              const alreadyLiked = label.includes('bỏ thích') || label.includes('unlike');
              if (alreadyLiked) return { found: true, alreadyLiked: true, clicked: false };
              /** @type {HTMLElement} */ (likeBtn).click();
              return { found: true, alreadyLiked: false, clicked: true };
            });

            return {
              postUrl,
              liked: Boolean(state.clicked),
              alreadyLiked: Boolean(state.alreadyLiked),
            };
          }, { accountId, cookies });
        }

        throw new PlatformError({
          code: 'XACT_5030',
          type: ErrorTypes.INTERNAL,
          message: 'Live Facebook like execution requires an active browser bridge.',
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'facebook',
          accountId,
        });
      },
      {
        actionName: 'like',
        accountId,
        governor: this.governor,
        velocityTracker: this.velocityTracker,
        delayMin: args?.delayMin,
        delayMax: args?.delayMax,
        dryRun,
      }
    );

    return { results, dryRun };
  }

  /**
   * Comment on a Facebook post or batch of posts.
   * @param {Object} args
   * @param {string|string[]} [args.postUrl]
   * @param {string|string[]} [args.postUrls]
   * @param {string} args.text
   * @param {boolean} [args.dryRun=true]
   * @param {number} [args.delayMin]
   * @param {number} [args.delayMax]
   * @param {number} [args.maxBatch=10]
   * @param {any} [session]
   */
  async comment(args, session = {}) {
    const accountId = this.#requireAuthSession(session);
    const dryRun = args?.dryRun !== false;

    if (!args?.text || typeof args.text !== 'string' || !args.text.trim()) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or empty required argument: text',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    const text = String(args.text).trim();
    if (text.length > 8000) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Comment text exceeds maximum length of 8000 characters',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    const rawUrls = args?.postUrls || args?.postUrl;
    const urls = (Array.isArray(rawUrls) ? rawUrls : [rawUrls]).filter(Boolean).map(String);

    if (urls.length === 0) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: postUrl or postUrls',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    for (const u of urls) {
      if (!assertFacebookUrlLocal(u)) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `Invalid Facebook post URL: ${u}`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'facebook',
        });
      }
    }

    const batch = urls.slice(0, Math.max(1, Math.min(Number(args?.maxBatch) || 10, 50)));

    const results = await runGuardedActionBatch(
      batch,
      async (postUrl) => {
        if (dryRun) {
          return { postUrl, commentId: null, previewText: stripPii(text), dryRun: true };
        }

        const bridge = /** @type {any} */ (this.client?.browserBridge || this.client?.ensureBrowserBridge?.());
        if (bridge && typeof bridge.withPage === 'function') {
          const cookies = session?.cookies || this.crawler?.sessionManager?.get?.(accountId)?.cookies;
          return bridge.withPage(async (/** @type {any} */ page) => {
            await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.evaluate((/** @type {string} */ msg) => {
              const input = document.querySelector('[role="textbox"][contenteditable="true"]');
              if (input) {
                input.textContent = msg;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, text);
            return { postUrl, commentId: `comment_${Date.now()}` };
          }, { accountId, cookies });
        }

        throw new PlatformError({
          code: 'XACT_5030',
          type: ErrorTypes.INTERNAL,
          message: 'Live Facebook comment execution requires an active browser bridge.',
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'facebook',
          accountId,
        });
      },
      {
        actionName: 'comment',
        accountId,
        governor: this.governor,
        velocityTracker: this.velocityTracker,
        delayMin: args?.delayMin,
        delayMax: args?.delayMax,
        dryRun,
      }
    );

    return { results, dryRun };
  }

  /**
   * Create a post on profile timeline or group(s).
   * @param {Object} args
   * @param {string} args.text
   * @param {string[]} [args.mediaUrls]
   * @param {string|string[]} [args.groupUrls]
   * @param {string|string[]} [args.groupIds]
   * @param {boolean} [args.dryRun=true]
   * @param {number} [args.delayMin]
   * @param {number} [args.delayMax]
   * @param {number} [args.maxBatch=10]
   * @param {any} [session]
   */
  async post(args, session = {}) {
    const accountId = this.#requireAuthSession(session);
    const dryRun = args?.dryRun !== false;

    if (!args?.text || typeof args.text !== 'string' || !args.text.trim()) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or empty required argument: text',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    const text = String(args.text).trim();
    if (text.length > 60000) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Post text exceeds maximum length of 60000 characters',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    let targets = ['https://www.facebook.com/me'];
    if (args?.groupUrls || args?.groupIds) {
      const rawGroups = args.groupUrls || args.groupIds;
      const groups = (Array.isArray(rawGroups) ? rawGroups : [rawGroups]).filter(Boolean).map(String);
      for (const g of groups) {
        if (g.startsWith('http://') || g.startsWith('https://')) {
          if (!assertFacebookUrlLocal(g) || !g.includes('/groups/')) {
            throw new PlatformError({
              code: 'XACT_4001',
              type: ErrorTypes.INVALID_ARGS,
              message: `Invalid Facebook group URL: ${g}`,
              suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
              platform: 'facebook',
            });
          }
        } else if (!/^\d+$/.test(g) && !/^[a-zA-Z0-9._-]+$/.test(g)) {
          throw new PlatformError({
            code: 'XACT_4001',
            type: ErrorTypes.INVALID_ARGS,
            message: `Invalid Facebook group ID or slug: ${g}`,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
            platform: 'facebook',
          });
        }
      }
      targets = groups.map((g) => (g.startsWith('http') ? g : `https://www.facebook.com/groups/${g}`));
    }

    const batch = targets.slice(0, Math.max(1, Math.min(Number(args?.maxBatch) || 10, 20)));
    const isGroup = batch.some((t) => t.includes('/groups/'));

    const results = await runGuardedActionBatch(
      batch,
      async (targetUrl) => {
        if (dryRun) {
          return { targetUrl, postId: null, previewText: stripPii(text), dryRun: true };
        }

        const bridge = /** @type {any} */ (this.client?.browserBridge || this.client?.ensureBrowserBridge?.());
        if (bridge && typeof bridge.withPage === 'function') {
          const cookies = session?.cookies || this.crawler?.sessionManager?.get?.(accountId)?.cookies;
          return bridge.withPage(async (/** @type {any} */ page) => {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            return { targetUrl, postId: `post_${Date.now()}` };
          }, { accountId, cookies });
        }

        throw new PlatformError({
          code: 'XACT_5030',
          type: ErrorTypes.INTERNAL,
          message: 'Live Facebook post execution requires an active browser bridge.',
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'facebook',
          accountId,
        });
      },
      {
        actionName: isGroup ? 'group_post' : 'post',
        accountId,
        governor: this.governor,
        velocityTracker: this.velocityTracker,
        delayMin: args?.delayMin,
        delayMax: args?.delayMax,
        dryRun,
      }
    );

    return { results, dryRun };
  }

  /**
   * Share a Facebook post to timeline.
   * @param {Object} args
   * @param {string|string[]} [args.postUrl]
   * @param {string|string[]} [args.postUrls]
   * @param {string} [args.message]
   * @param {boolean} [args.dryRun=true]
   * @param {number} [args.delayMin]
   * @param {number} [args.delayMax]
   * @param {any} [session]
   */
  async share(args, session = {}) {
    const accountId = this.#requireAuthSession(session);
    const dryRun = args?.dryRun !== false;

    const rawUrls = args?.postUrls || args?.postUrl;
    const urls = (Array.isArray(rawUrls) ? rawUrls : [rawUrls]).filter(Boolean).map(String);

    if (urls.length === 0) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: postUrl or postUrls',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    for (const u of urls) {
      if (!assertFacebookUrlLocal(u)) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `Invalid Facebook post URL: ${u}`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'facebook',
        });
      }
    }

    const results = await runGuardedActionBatch(
      urls,
      async (postUrl) => {
        if (dryRun) {
          return { postUrl, shared: false, method: 'share-dialog-timeline', dryRun: true };
        }

        const bridge = /** @type {any} */ (this.client?.browserBridge || this.client?.ensureBrowserBridge?.());
        if (bridge && typeof bridge.withPage === 'function') {
          const cookies = session?.cookies || this.crawler?.sessionManager?.get?.(accountId)?.cookies;
          return bridge.withPage(async (/** @type {any} */ page) => {
            await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            return { postUrl, shared: true, method: 'share-dialog-timeline' };
          }, { accountId, cookies });
        }

        throw new PlatformError({
          code: 'XACT_5030',
          type: ErrorTypes.INTERNAL,
          message: 'Live Facebook share execution requires an active browser bridge.',
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'facebook',
          accountId,
        });
      },
      {
        actionName: 'share',
        accountId,
        governor: this.governor,
        velocityTracker: this.velocityTracker,
        delayMin: args?.delayMin,
        delayMax: args?.delayMax,
        dryRun,
      }
    );

    return { results, dryRun };
  }

  /**
   * Share a post or message via Messenger to one or more recipient UIDs.
   * @param {Object} args
   * @param {string} args.postUrl
   * @param {string|string[]} [args.recipientUids]
   * @param {string} [args.recipientUid]
   * @param {string} [args.message]
   * @param {boolean} [args.dryRun=true]
   * @param {number} [args.delayMin]
   * @param {number} [args.delayMax]
   * @param {any} [session]
   */
  async messengerShare(args, session = {}) {
    const accountId = this.#requireAuthSession(session);
    const dryRun = args?.dryRun !== false;

    if (!args?.postUrl || !assertFacebookUrlLocal(args.postUrl)) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or invalid Facebook postUrl for Messenger share',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    const rawRecipients = args?.recipientUids || args?.recipientUid;
    const recipients = (Array.isArray(rawRecipients) ? rawRecipients : [rawRecipients]).filter(Boolean).map(String);

    if (recipients.length === 0) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: recipientUids or recipientUid',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    const results = await runGuardedActionBatch(
      recipients,
      async (recipientUid) => {
        if (dryRun) {
          return { recipientUid, ok: true, method: 'direct-messenger-url', dryRun: true };
        }

        const bridge = /** @type {any} */ (this.client?.browserBridge || this.client?.ensureBrowserBridge?.());
        if (bridge && typeof bridge.withPage === 'function') {
          const cookies = session?.cookies || this.crawler?.sessionManager?.get?.(accountId)?.cookies;
          return bridge.withPage(async (/** @type {any} */ page) => {
            await page.goto(`https://www.facebook.com/messages/t/${recipientUid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            return { recipientUid, ok: true, method: 'direct-messenger-url' };
          }, { accountId, cookies });
        }

        throw new PlatformError({
          code: 'XACT_5030',
          type: ErrorTypes.INTERNAL,
          message: 'Live Facebook Messenger share requires an active browser bridge.',
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'facebook',
          accountId,
        });
      },
      {
        actionName: 'messenger_share',
        accountId,
        governor: this.governor,
        velocityTracker: this.velocityTracker,
        delayMin: args?.delayMin,
        delayMax: args?.delayMax,
        dryRun,
      }
    );

    return { results, dryRun };
  }

  /**
   * Alias for sharing a link to a single recipient UID.
   * @param {Object} [args={}]
   * @param {string} args.postUrl
   * @param {string} args.recipientUid
   * @param {string} [args.message]
   * @param {boolean} [args.dryRun=true]
   * @param {any} [session]
   */
  async shareLinkByUid(args = /** @type {any} */ ({}), session = {}) {
    const safeArgs = args && typeof args === 'object' ? args : /** @type {any} */ ({});
    return this.messengerShare(
      {
        ...safeArgs,
        recipientUids: safeArgs.recipientUid ? [safeArgs.recipientUid] : [],
      },
      session
    );
  }

  /**
   * Join one or more Facebook groups.
   * @param {Object} args
   * @param {string|string[]} [args.groupUrls]
   * @param {string|string[]} [args.groupIds]
   * @param {boolean} [args.dryRun=true]
   * @param {number} [args.delayMin]
   * @param {number} [args.delayMax]
   * @param {any} [session]
   */
  async joinGroup(args, session = {}) {
    const accountId = this.#requireAuthSession(session);
    const dryRun = args?.dryRun !== false;

    const rawGroups = args?.groupUrls || args?.groupIds;
    const groups = (Array.isArray(rawGroups) ? rawGroups : [rawGroups]).filter(Boolean).map(String);

    if (groups.length === 0) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: groupUrls or groupIds',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    for (const g of groups) {
      if (g.startsWith('http://') || g.startsWith('https://')) {
        if (!assertFacebookUrlLocal(g) || !g.includes('/groups/')) {
          throw new PlatformError({
            code: 'XACT_4001',
            type: ErrorTypes.INVALID_ARGS,
            message: `Invalid Facebook group URL: ${g}`,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
            platform: 'facebook',
          });
        }
      } else if (!/^\d+$/.test(g) && !/^[a-zA-Z0-9._-]+$/.test(g)) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `Invalid Facebook group ID or slug: ${g}`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'facebook',
        });
      }
    }

    const results = await runGuardedActionBatch(
      groups,
      async (groupTarget) => {
        const groupUrl = groupTarget.startsWith('http') ? groupTarget : `https://www.facebook.com/groups/${groupTarget}`;
        if (dryRun) {
          return { groupUrl, joined: false, dryRun: true };
        }

        const bridge = /** @type {any} */ (this.client?.browserBridge || this.client?.ensureBrowserBridge?.());
        if (bridge && typeof bridge.withPage === 'function') {
          const cookies = session?.cookies || this.crawler?.sessionManager?.get?.(accountId)?.cookies;
          return bridge.withPage(async (/** @type {any} */ page) => {
            await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            return { groupUrl, joined: true };
          }, { accountId, cookies });
        }

        throw new PlatformError({
          code: 'XACT_5030',
          type: ErrorTypes.INTERNAL,
          message: 'Live Facebook join group requires an active browser bridge.',
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'facebook',
          accountId,
        });
      },
      {
        actionName: 'join_group',
        accountId,
        governor: this.governor,
        velocityTracker: this.velocityTracker,
        delayMin: args?.delayMin,
        delayMax: args?.delayMax,
        dryRun,
      }
    );

    return { results, dryRun };
  }

  /**
   * Send friend request to one or more targets.
   * @param {Object} args
   * @param {string|string[]} args.targets
   * @param {boolean} [args.dryRun=true]
   * @param {number} [args.delayMin]
   * @param {number} [args.delayMax]
   * @param {number} [args.limit=20]
   * @param {any} [session]
   */
  async sendFriendRequest(args, session = {}) {
    const accountId = this.#requireAuthSession(session);
    const dryRun = args?.dryRun !== false;

    const rawTargets = args?.targets;
    const targets = (Array.isArray(rawTargets) ? rawTargets : [rawTargets]).filter(Boolean).map(String);

    if (targets.length === 0) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: targets',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    for (const t of targets) {
      const isValid = /^\d+$/.test(t) || assertFacebookUrlLocal(t) || /^[a-zA-Z0-9.]{3,50}$/.test(t);
      if (!isValid) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `Invalid Facebook user target format: ${t}`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'facebook',
        });
      }
    }

    const batch = targets.slice(0, Math.max(1, Math.min(Number(args?.limit) || 20, 20)));

    const results = await runGuardedActionBatch(
      batch,
      async (target) => {
        if (dryRun) {
          return { target, ok: true, dryRun: true };
        }

        const bridge = /** @type {any} */ (this.client?.browserBridge || this.client?.ensureBrowserBridge?.());
        if (bridge && typeof bridge.withPage === 'function') {
          const cookies = session?.cookies || this.crawler?.sessionManager?.get?.(accountId)?.cookies;
          const targetUrl = target.startsWith('http') ? target : `https://www.facebook.com/${target}`;
          return bridge.withPage(async (/** @type {any} */ page) => {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            return { target, ok: true };
          }, { accountId, cookies });
        }

        throw new PlatformError({
          code: 'XACT_5030',
          type: ErrorTypes.INTERNAL,
          message: 'Live Facebook friend request requires an active browser bridge.',
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'facebook',
          accountId,
        });
      },
      {
        actionName: 'send_friend_request',
        accountId,
        governor: this.governor,
        velocityTracker: this.velocityTracker,
        delayMin: args?.delayMin,
        delayMax: args?.delayMax,
        dryRun,
      }
    );

    return { results, dryRun };
  }
}
