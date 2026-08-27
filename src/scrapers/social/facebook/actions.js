// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook Hybrid Social Actions (write path).
 *
 * Implements like, comment, post, share, messengerShare, joinGroup,
 * and sendFriendRequest using a single browser page per batch, with
 * per-item governor checks and action velocity tracking.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { runGuardedActionBatch, FacebookActionVelocityTracker, getActionLimit } from './batch-runner.js';
import { assertFacebookUrlLocal } from '../../facebook/core.js';
import { stripPii } from './pii.js';

export { assertFacebookUrlLocal } from '../../facebook/core.js';
export { stripPii } from './pii.js';

/**
 * Maximum batch size for a single write action batch.
 * @type {number}
 */
export const MAX_BATCH_SIZE = 20;

/**
 * Strip emoji presentation / extended pictographic characters from text.
 * The raw message is still sent to Facebook unchanged; this is only used for
 * previews and logs.
 * @param {string} text
 * @returns {string}
 */
export function stripEmojiSurrogates(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, '').trim();
}

/**
 * Pick a random segment from a message that uses `||` or `**` as separators.
 * @param {string} message
 * @returns {string}
 */
export function pickRandomSegment(message) {
  if (typeof message !== 'string') return '';
  const segments = message
    .split(/\|\||\*\*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return message;
  return segments[Math.floor(Math.random() * segments.length)];
}

/**
 * Compose a final message from a template, optionally picking a random segment
 * and stripping emoji for preview/logging.
 * @param {string} rawContent
 * @param {{ stripEmoji?: boolean, segmentPicker?: (msg: string) => string }} [options={}]
 * @returns {string}
 */
export function composeMessage(rawContent, options = {}) {
  const { stripEmoji = true, segmentPicker = pickRandomSegment } = options;
  const picked = segmentPicker(rawContent);
  const message = typeof picked === 'string' ? picked : String(picked == null ? '' : picked);
  const clean = stripEmoji ? stripEmojiSurrogates(message) : message;
  return clean.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Validate a Facebook URL and throw a typed PlatformError on failure.
 * @param {string} url
 * @param {string} [label]
 */
function assertFacebookUrl(url, label = 'URL') {
  try {
    assertFacebookUrlLocal(url, label);
  } catch (err) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: err instanceof Error ? err.message : `Invalid ${label}`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'facebook',
    });
  }
}

/**
 * Wrap a single value or array into a non-empty array.
 * @param {string | string[] | undefined} value
 * @returns {string[]}
 */
function toStringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim());
  if (typeof value === 'string') return value.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * @param {Record<string, any>} session
 * @returns {string}
 */
function resolveAccountId(session) {
  return session?.accountId || 'default';
}

/**
 * @param {Record<string, any>} session
 */
function requireAuthSession(session) {
  const accountId = session?.accountId;
  if (!accountId || accountId === 'default' || accountId === 'guest') {
    throw new PlatformError({
      code: 'XACT_4010',
      type: ErrorTypes.AUTH_EXPIRED,
      message: 'Authenticated Facebook write action requires a valid account session.',
      suggestedAction: SuggestedActions.RELOGIN,
      platform: 'facebook',
    });
  }
}

/**
 * @param {Record<string, any>} session
 * @returns {string | Record<string, string> | Array<{ name: string, value: string }>}
 */
function resolveCookies(session) {
  if (session?.cookies) return session.cookies;
  if (session?.account?.credentials?.cookies) return session.account.credentials.cookies;
  return '';
}

/**
 * @param {string | string[] | undefined} urls
 * @param {string} label
 * @returns {string[]}
 */
function assertUrlList(urls, label = 'URL') {
  const list = toStringArray(urls);
  if (list.length === 0) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: `${label} is required`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'facebook',
    });
  }
  for (const url of list) {
    assertFacebookUrl(url, label);
  }
  return list;
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isGroupUrl(value) {
  return typeof value === 'string' && /\/groups\//i.test(value);
}

/**
 * Clamp a numeric argument between a min and max.
 * @param {unknown} value
 * @param {number} [defaultValue]
 * @param {number} [min]
 * @param {number} [max]
 * @returns {number}
 */
function clampNumber(value, defaultValue, min, max) {
  const n = Number(value);
  const effective = Number.isFinite(n) ? n : (defaultValue ?? 0);
  return Math.max(min ?? Number.MIN_SAFE_INTEGER, Math.min(max ?? Number.MAX_SAFE_INTEGER, effective));
}

/**
 * Facebook write action orchestrator.
 */
export class FacebookActions {
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
   * Resolve a usable browser bridge or throw a platform error.
   * @returns {any}
   */
  #resolveBridge() {
    const bridge = this.client?.browserBridge || (typeof this.client?.ensureBrowserBridge === 'function' ? this.client.ensureBrowserBridge() : null);
    if (!bridge) {
      throw new PlatformError({
        code: 'XACT_5030',
        type: ErrorTypes.PROXY_EXHAUSTED,
        message: 'No browser bridge available for Facebook write action.',
        suggestedAction: SuggestedActions.WAIT,
        platform: 'facebook',
      });
    }
    return bridge;
  }

  /**
   * Execute a batch function inside a single bridge page.
   * @template T
   * @param {(page: any) => Promise<T>} fn
   * @param {Record<string, any>} session
   * @returns {Promise<T>}
   */
  async #withSharedPage(fn, session) {
    const bridge = this.#resolveBridge();
    const accountId = resolveAccountId(session);
    requireAuthSession(session);
    const cookies = resolveCookies(session);
    return bridge.withPage(fn, { accountId, cookies, requiresResidential: true });
  }

  /**
   * Build base options for runGuardedActionBatch.
   * @param {string} actionName
   * @param {Record<string, any>} session
   * @param {Record<string, any>} args
   * @returns {Record<string, any>}
   */
  #batchOptions(actionName, session, args) {
    return {
      actionName,
      accountId: resolveAccountId(session),
      governor: this.governor,
      velocityTracker: this.velocityTracker,
      delayMin: args?.delayMin,
      delayMax: args?.delayMax,
      dryRun: args?.dryRun !== false,
      maxBatch: clampNumber(args?.maxBatch, getActionLimit(actionName).perHour, 1, MAX_BATCH_SIZE),
    };
  }

  /**
   * Resolve feedback context for a post URL.
   * @param {string} postUrl
   * @param {Record<string, any>} session
   * @returns {Promise<{ feedbackId: string } | null>}
   */
  async #resolveFeedbackContext(postUrl, session) {
    if (!this.crawler?.resolvePostFeedbackContext) return null;
    try {
      const accountId = resolveAccountId(session);
      const cookies = resolveCookies(session);
      return await this.crawler.resolvePostFeedbackContext(postUrl, cookies, accountId, session);
    } catch {
      return null;
    }
  }

  /**
   * Return the GraphQL doc_id for a write action, or null if it is a placeholder.
   * @param {string} actionKey
   * @returns {string | null}
   */
  #resolveDocId(actionKey) {
    const id = this.client?.docIds?.[actionKey] || this.crawler?.docIds?.[actionKey] || null;
    if (typeof id !== 'string') return null;
    if (id.startsWith('fb_') || id === 'null') return null;
    return id;
  }

  /**
   * Like one or more posts via DOM, falling back to GraphQL if the like
   * button cannot be located.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ results: { postUrl: string, liked: boolean, alreadyLiked?: boolean, dryRun?: boolean, error?: string }[], dryRun: boolean }>}
   */
  async like(args = {}, session = {}) {
    const dryRun = args?.dryRun !== false;
    const postUrls = assertUrlList(args?.postUrl || args?.postUrls, 'postUrl');
    const maxBatch = clampNumber(args?.maxBatch, 30, 1, 30);

    if (dryRun) {
      return {
        results: postUrls.map((postUrl) => ({ postUrl, liked: false, alreadyLiked: false, dryRun: true })),
        dryRun: true,
      };
    }

    const actionName = 'like';
    const batchOptions = this.#batchOptions(actionName, session, args);
    batchOptions.maxBatch = maxBatch;

    const results = await this.#withSharedPage(async (page) => {
      return runGuardedActionBatch(postUrls, async (postUrl, _i, { page: p }) => {
        if (dryRun) {
          return { postUrl, liked: false, alreadyLiked: false, dryRun: true };
        }

        const feedbackCtx = await this.#resolveFeedbackContext(postUrl, session);

        await p.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise((r) => setTimeout(r, 500 + Math.floor(Math.random() * 1000)));

        const state = await p.evaluate(() => {
          const likeSelectors = [
            '[aria-label*="Thích" i]',
            '[aria-label*="Like" i]',
            '[aria-label*="Thích" i]',
          ];
          const unlikeSelectors = [
            '[aria-label*="Bỏ thích" i]',
            '[aria-label*="Unlike" i]',
            '[aria-label*="Remove Like" i]',
            '[aria-label*="Bỏ thích" i]',
          ];
          const all = [...unlikeSelectors, ...likeSelectors].join(', ');
          const btn = document.querySelector(all);
          if (!btn) return { found: false };

          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          const alreadyLiked = unlikeSelectors.some((sel) => {
            const exact = document.querySelector(sel);
            return exact && (exact === btn || exact.contains(btn));
          });

          if (alreadyLiked) return { found: true, alreadyLiked: true };

          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return { found: true, alreadyLiked: false };
        });

        if (!state.found) {
          return this.#likeViaGraphQL(postUrl, feedbackCtx, session);
        }

        if (state.alreadyLiked) {
          return { postUrl, liked: false, alreadyLiked: true };
        }

        await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 1000)));

        const verified = await p.evaluate(() => {
          const unlike = document.querySelector(
            '[aria-label*="Unlike" i], [aria-label*="Bỏ thích" i], [aria-label*="Remove Like" i]'
          );
          return !!unlike;
        });

        return { postUrl, liked: verified, alreadyLiked: false };
      }, { ...batchOptions, page });
    }, session);

    return { results, dryRun };
  }

  /**
   * Fallback like via GraphQL persisted query.
   * @param {string} postUrl
   * @param {{ feedbackId: string } | null} feedbackCtx
   * @param {Record<string, any>} session
   * @returns {Promise<{ postUrl: string, liked: boolean, method?: string, error?: string }>}
   */
  async #likeViaGraphQL(postUrl, feedbackCtx, session) {
    const docId = this.#resolveDocId('LIKE_MUTATION');
    if (!docId || !feedbackCtx?.feedbackId) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Like button not found and no valid GraphQL context/doc_id available.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    const variables = {
      feedback_id: feedbackCtx.feedbackId,
      action: 1,
    };

    await this.client.requestGraphQl(docId, variables, {
      accountId: resolveAccountId(session),
      cookies: resolveCookies(session),
      requiresAuth: true,
      requiresResidential: true,
      fallbackDocIds: [this.client?.docIds?.LIKE_MUTATION, this.crawler?.docIds?.LIKE_MUTATION].filter((d) => typeof d === 'string' && !d.startsWith('fb_')),
    });

    return { postUrl, liked: true, method: 'graphql-like' };
  }

  /**
   * Comment on one or more posts.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ results: { postUrl: string, commentId?: string, commented: boolean, dryRun?: boolean, error?: string }[], dryRun: boolean }>}
   */
  async comment(args = {}, session = {}) {
    const dryRun = args?.dryRun !== false;
    const rawText = typeof args?.text === 'string' ? args.text.trim() : '';
    if (!rawText) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'comment text is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    const postUrls = assertUrlList(args?.postUrl || args?.postUrls, 'postUrl');
    const maxBatch = clampNumber(args?.maxBatch, 10, 1, 10);

    if (dryRun) {
      const previewText = stripPii(composeMessage(rawText, { stripEmoji: true }));
      return {
        results: postUrls.map((postUrl) => ({ postUrl, commented: false, previewText, dryRun: true })),
        dryRun: true,
      };
    }

    // Split posts by group vs timeline for correct action/delay floor.
    const groupUrls = postUrls.filter((u) => isGroupUrl(u));
    const timelineUrls = postUrls.filter((u) => !isGroupUrl(u));

    const previewText = stripPii(composeMessage(rawText, { stripEmoji: true }));

    const runBatch = async (/** @type {string[]} */ urls, /** @type {string} */ actionName) => {
      const batchOptions = this.#batchOptions(actionName, session, args);
      batchOptions.maxBatch = maxBatch;

      return this.#withSharedPage(async (page) => {
        return runGuardedActionBatch(urls, async (postUrl, _i, { page: p }) => {
          if (dryRun) {
            return { postUrl, commented: false, previewText, dryRun: true };
          }

          const feedbackCtx = await this.#resolveFeedbackContext(postUrl, session);

          await p.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 700)));

          const input = await p.evaluate((/** @type {string} */ msg) => {
            const selectors = [
              '[aria-label*="Write a public comment" i]',
              '[aria-label*="Write a comment" i]',
              '[placeholder*="Write a comment" i]',
              '[aria-label*="Viết bình luận" i]',
              '[role="textbox"][contenteditable="true"]',
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                el.focus();
                el.textContent = msg;
                el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                return true;
              }
            }
            return false;
          }, rawText);

          if (!input) {
            return this.#commentViaGraphQL(postUrl, rawText, feedbackCtx, session);
          }

          await new Promise((r) => setTimeout(r, 500 + Math.floor(Math.random() * 300)));

          if (typeof p.keyboard?.press === 'function') {
            await p.keyboard.press('Enter');
          } else {
            await p.evaluate(() => {
              const el = document.querySelector('[role="textbox"][contenteditable="true"]');
              if (el) {
                el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
              }
            });
          }

          await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 1000)));

          const commentId = await p.evaluate(() => {
            const commentLinks = document.querySelectorAll('a[href*="/story.php"], a[href*="/comment/"]');
            for (const a of commentLinks) {
              const href = a.getAttribute('href') || '';
              const match = href.match(/[?&]comment_id=(\d+)/) || href.match(/\/comment\/([0-9]+)/);
              if (match) return match[1];
            }
            return null;
          });

          return { postUrl, commentId: typeof commentId === 'string' ? commentId : null, commented: true };
        }, { ...batchOptions, page });
      }, session);
    };

    const results = [];
    if (timelineUrls.length) results.push(...(await runBatch(timelineUrls, 'comment')));
    if (groupUrls.length) results.push(...(await runBatch(groupUrls, 'group_comment')));

    return { results, dryRun };
  }

  /**
   * Fallback comment via GraphQL persisted query.
   * @param {string} postUrl
   * @param {string} text
   * @param {{ feedbackId: string } | null} feedbackCtx
   * @param {Record<string, any>} session
   * @returns {Promise<{ postUrl: string, commentId?: string, commented: boolean, method?: string }>}
   */
  async #commentViaGraphQL(postUrl, text, feedbackCtx, session) {
    const docId = this.#resolveDocId('COMMENT_MUTATION');
    if (!docId || !feedbackCtx?.feedbackId) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Comment input not found and no valid GraphQL context/doc_id available.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    const variables = {
      feedback_id: feedbackCtx.feedbackId,
      body: text,
      client_mutation_id: '1',
    };

    const res = await this.client.requestGraphQl(docId, variables, {
      accountId: resolveAccountId(session),
      cookies: resolveCookies(session),
      requiresAuth: true,
      requiresResidential: true,
      fallbackDocIds: [this.client?.docIds?.COMMENT_MUTATION, this.crawler?.docIds?.COMMENT_MUTATION].filter((d) => typeof d === 'string' && !d.startsWith('fb_')),
    });

    return { postUrl, commentId: typeof res?.comment_id === 'string' ? res.comment_id : null, commented: true, method: 'graphql-comment' };
  }

  /**
   * Post to one or more profiles or groups.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ results: { targetUrl: string, postId?: string, posted: boolean, note?: string, dryRun?: boolean, error?: string }[], dryRun: boolean }>}
   */
  async post(args = {}, session = {}) {
    const dryRun = args?.dryRun !== false;
    const rawText = typeof args?.text === 'string' ? args.text.trim() : '';
    if (!rawText) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'post text is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    const groupUrls = toStringArray(args?.groupUrl || args?.groupUrls || args?.groups || args?.groupIds);
    for (const url of groupUrls) assertFacebookUrl(url, 'groupUrl');
    const profileUrls = toStringArray(args?.profileUrl || args?.profileUrls || args?.profiles);
    for (const url of profileUrls) assertFacebookUrl(url, 'profileUrl');
    const targets = [];
    if (groupUrls.length) targets.push(...groupUrls);
    if (profileUrls.length) targets.push(...profileUrls);
    if (targets.length === 0) {
      // Default to the user's own timeline
      targets.push('https://www.facebook.com/me');
    }

    const maxBatch = clampNumber(args?.maxBatch, 10, 1, args?.force ? 20 : 10);
    const mediaUrls = toStringArray(args?.mediaUrls);

    if (dryRun) {
      const note = mediaUrls.length ? 'mediaUrls reserved - not uploaded' : undefined;
      const previewText = stripPii(composeMessage(rawText, { stripEmoji: true }));
      return {
        results: targets.map((targetUrl) => ({ targetUrl, posted: false, previewText, note, dryRun: true })),
        dryRun: true,
      };
    }

    const note = mediaUrls.length ? 'mediaUrls reserved - not uploaded' : undefined;
    const previewText = stripPii(composeMessage(rawText, { stripEmoji: true }));

    const profileTargets = targets.filter((u) => !isGroupUrl(u));
    const groupTargets = targets.filter((u) => isGroupUrl(u));

    const runBatch = async (/** @type {string[]} */ urls, /** @type {string} */ actionName) => {
      const batchOptions = this.#batchOptions(actionName, session, args);
      batchOptions.maxBatch = maxBatch;

      return this.#withSharedPage(async (page) => {
        return runGuardedActionBatch(urls, async (targetUrl, _i, { page: p }) => {
          if (dryRun) {
            return { targetUrl, posted: false, previewText, note, dryRun: true };
          }

          if (mediaUrls.length) {
            return { targetUrl, posted: false, note: 'mediaUrls upload is reserved in MVP', error: 'mediaUrls not supported' };
          }

          return this.#createPost(targetUrl, rawText, p);
        }, { ...batchOptions, page });
      }, session);
    };

    const results = [];
    if (profileTargets.length) results.push(...(await runBatch(profileTargets, 'post')));
    if (groupTargets.length) results.push(...(await runBatch(groupTargets, 'group_post')));

    return { results, dryRun };
  }

  /**
   * Open composer and submit a post.
   * @param {string} targetUrl
   * @param {string} text
   * @param {any} page
   * @returns {Promise<{ targetUrl: string, postId?: string, posted: boolean }>}
   */
  async #createPost(targetUrl, text, page) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 500)));

    const opened = await page.evaluate(() => {
      const selectors = [
        '[role="button"][aria-label*="Tạo bài viết" i]',
        '[role="button"][aria-label*="Create post" i]',
        '[role="button"][aria-label*="Viết bài..." i]',
        '[role="button"][aria-label*="What\'s on your mind?" i]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          el.click();
          return true;
        }
      }
      return false;
    });

    if (!opened) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Post composer trigger not found.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    await new Promise((r) => setTimeout(r, 1200 + Math.floor(Math.random() * 500)));

    const typed = await page.evaluate((/** @type {string} */ msg) => {
      const selectors = [
        '[role="textbox"][contenteditable="true"][aria-label*="Bạn đang nghĩ gì?" i]',
        '[role="textbox"][contenteditable="true"][aria-label*="What\'s on your mind?" i]',
        '[role="textbox"][contenteditable="true"][aria-label*="Viết gì đó..." i]',
        '[role="textbox"][contenteditable="true"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.focus();
          el.textContent = msg;
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, text);

    if (!typed) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Post composer input not found.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    await new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 300)));

    const posted = await page.evaluate(() => {
      const selectors = [
        '[role="button"][aria-label*="Đăng" i]',
        '[role="button"][aria-label*="Post" i]',
        '[role="button"][aria-label*="Đăng bài" i]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          el.click();
          return true;
        }
      }
      return false;
    });

    if (!posted) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Post submit button not found.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    await new Promise((r) => setTimeout(r, 2000 + Math.floor(Math.random() * 1000)));

    const postId = await page.evaluate(() => {
      const url = window.location.href;
      const match = url.match(/\/posts\/(\d+)/) ||
        url.match(/[?&]story_fbid=(\d+)/) ||
        url.match(/[?&]story\.php.*?id=(\d+)/);
      return match ? match[1] : null;
    });

    return { targetUrl, postId: typeof postId === 'string' ? postId : undefined, posted: true };
  }

  /**
   * Share one or more posts to the user's own timeline.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ results: { postUrl: string, shared: boolean, message?: string, method?: string, dryRun?: boolean, error?: string }[], dryRun: boolean }>}
   */
  async share(args = {}, session = {}) {
    const dryRun = args?.dryRun !== false;
    const postUrls = assertUrlList(args?.postUrl || args?.postUrls, 'postUrl');
    const message = typeof args?.message === 'string' ? args.message.trim() : '';
    const maxBatch = clampNumber(args?.maxBatch, 10, 1, 10);

    if (dryRun) {
      const previewMessage = stripPii(composeMessage(message, { stripEmoji: true }));
      return {
        results: postUrls.map((postUrl) => ({ postUrl, shared: false, method: 'share-dialog-timeline', previewMessage, dryRun: true })),
        dryRun: true,
      };
    }

    const actionName = 'share';
    const batchOptions = this.#batchOptions(actionName, session, args);
    batchOptions.maxBatch = maxBatch;

    const previewMessage = stripPii(composeMessage(message, { stripEmoji: true }));

    const results = await this.#withSharedPage(async (page) => {
      return runGuardedActionBatch(postUrls, async (postUrl, _i, { page: p }) => {
        if (dryRun) {
          return { postUrl, shared: false, method: 'share-dialog-timeline', previewMessage, dryRun: true };
        }

        const feedbackCtx = await this.#resolveFeedbackContext(postUrl, session);

        await p.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 700)));

        const state = await p.evaluate(() => {
          const shareBtn =
            document.querySelector('div[data-ad-rendering-role="share_button"]') ||
            document.querySelector('[data-ad-renderingrole="share_button"]');
          if (!shareBtn) return { ok: false, error: 'Share button not found' };

          const btn = shareBtn.closest('[role="button"]') || shareBtn;
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return { ok: true };
        });

        if (!state.ok) {
          return this.#shareViaGraphQL(postUrl, message, feedbackCtx, session);
        }

        await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 500)));

        // Optionally type a message into the share dialog composer
        if (message) {
          await p.evaluate((/** @type {string} */ msg) => {
            const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
            if (editor) {
              editor.focus();
              editor.textContent = msg;
              editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
            }
          }, message);
          await new Promise((r) => setTimeout(r, 500));
        }

        const shared = await p.evaluate(() => {
          const options = [...document.querySelectorAll('[role="button"]')];
          const target = options.find((b) => {
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            return /share to your own timeline|chia sẻ lên dòng thời gian của bạn|share now|chia sẻ ngay|share post|chia sẻ bài viết/i.test(label);
          });
          if (target) {
            target.scrollIntoView({ block: 'center' });
            target.click();
            return true;
          }
          return false;
        });

        if (!shared) {
          return this.#shareViaGraphQL(postUrl, message, feedbackCtx, session);
        }

        await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 500)));

        return { postUrl, shared: true, method: 'share-dialog-timeline' };
      }, { ...batchOptions, page });
    }, session);

    return { results, dryRun };
  }

  /**
   * Fallback share via GraphQL persisted query.
   * @param {string} postUrl
   * @param {string} message
   * @param {{ feedbackId: string } | null} feedbackCtx
   * @param {Record<string, any>} session
   * @returns {Promise<{ postUrl: string, shared: boolean, method?: string }>}
   */
  async #shareViaGraphQL(postUrl, message, feedbackCtx, session) {
    const docId = this.#resolveDocId('SHARE_MUTATION');
    if (!docId || !feedbackCtx?.feedbackId) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Share dialog not found and no valid GraphQL context/doc_id available.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    const variables = {
      feedback_id: feedbackCtx.feedbackId,
      message: message || '',
      client_mutation_id: '1',
    };

    await this.client.requestGraphQl(docId, variables, {
      accountId: resolveAccountId(session),
      cookies: resolveCookies(session),
      requiresAuth: true,
      requiresResidential: true,
      fallbackDocIds: [this.client?.docIds?.SHARE_MUTATION, this.crawler?.docIds?.SHARE_MUTATION].filter((d) => typeof d === 'string' && !d.startsWith('fb_')),
    });

    return { postUrl, shared: true, method: 'graphql-share' };
  }

  /**
   * Share a post or link to one or more Messenger recipients.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ results: { recipientUid: string, ok: boolean, method?: string, dryRun?: boolean, error?: string }[], postUrl: string, dryRun: boolean }>}
   */
  async messengerShare(args = {}, session = {}) {
    const dryRun = args?.dryRun !== false;
    const postUrl = typeof args?.postUrl === 'string' ? args.postUrl.trim() : '';
    if (!postUrl) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'messengerShare postUrl is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }
    assertFacebookUrl(postUrl, 'postUrl');

    const recipientUids = toStringArray(args?.recipientUid || args?.recipientUids);
    if (recipientUids.length === 0) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'messengerShare requires at least one recipientUid',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    const message = typeof args?.message === 'string' ? args.message.trim() : '';
    const recipientNames = Array.isArray(args?.recipientNames) ? args.recipientNames : [];
    const maxBatch = clampNumber(args?.maxBatch, 20, 1, 20);

    if (dryRun) {
      return {
        results: recipientUids.map((recipientUid) => ({ recipientUid, ok: true, method: 'direct-messenger-url', dryRun: true })),
        postUrl,
        dryRun: true,
      };
    }

    const actionName = 'messenger_share';
    const batchOptions = this.#batchOptions(actionName, session, args);
    batchOptions.maxBatch = maxBatch;

    const results = await this.#withSharedPage(async (page) => {
      return runGuardedActionBatch(recipientUids, async (recipientUid, i, { page: p }) => {
        if (dryRun) {
          return { recipientUid, ok: true, method: 'direct-messenger-url', dryRun: true };
        }

        const recipientName = typeof recipientNames[i] === 'string' ? recipientNames[i] : '';
        return this.#messengerShareToUid(p, recipientUid, recipientName, postUrl, message, session);
      }, { ...batchOptions, page });
    }, session);

    return { results, postUrl, dryRun };
  }

  /**
   * Alias for sharing a link to a single recipient UID.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ ok: boolean, postUrl: string, recipientUid: string, method?: string, error?: string, dryRun: boolean }>}
   */
  async shareLinkByUid(args = {}, session = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const recipientUid = typeof safeArgs.recipientUid === 'string' ? safeArgs.recipientUid.trim() : '';
    if (!recipientUid) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'shareLinkByUid requires recipientUid',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    const res = await this.messengerShare(
      { ...safeArgs, recipientUids: [recipientUid] },
      session
    );

    const first = res?.results?.[0];
    return {
      ok: first?.ok ?? false,
      postUrl: res.postUrl,
      recipientUid,
      method: first?.method,
      error: first?.error,
      dryRun: res.dryRun,
    };
  }

  /**
   * Send a post/message to a single Messenger recipient, falling back through
   * share dialog and GraphQL CTA mutation.
   * @param {any} page
   * @param {string} recipientUid
   * @param {string} recipientName
   * @param {string} postUrl
   * @param {string} message
   * @param {Record<string, any>} session
   * @returns {Promise<{ recipientUid: string, ok: boolean, method?: string }>}
   */
  async #messengerShareToUid(page, recipientUid, recipientName, postUrl, message, session) {
    // Path 1: direct Messenger conversation URL
    await page.goto(`https://www.facebook.com/messages/t/${recipientUid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 1000)));

    const hasEditor = await page.evaluate(() => {
      const editor = document.querySelector('[contenteditable="true"]');
      return !!editor;
    });

    if (hasEditor) {
      const textToSend = message ? `${postUrl}\n\n${message}` : postUrl;

      await page.evaluate((/** @type {string} */ url) => {
        const editor = document.querySelector('[contenteditable="true"]');
        if (!editor) return;
        editor.focus();

        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', url);

        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        });
        editor.dispatchEvent(pasteEvent);
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }, textToSend);

      await new Promise((r) => setTimeout(r, 800));

      if (typeof page.keyboard?.press === 'function') {
        await page.keyboard.press('Enter');
      } else {
        await page.evaluate(() => {
          const editor = document.querySelector('[contenteditable="true"]');
          if (editor) {
            editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          }
        });
      }

      await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 500)));
      return { recipientUid, ok: true, method: 'direct-messenger-url' };
    }

    // Path 2: share dialog on the post, pick recipient by name
    try {
      return await this.#messengerShareViaDialog(page, recipientUid, recipientName, postUrl);
    } catch {
      // fall through to GraphQL
    }

    // Path 3: GraphQL CTA / message send mutation
    return this.#messengerShareViaGraphQL(recipientUid, postUrl, message, session);
  }

  /**
   * Use the post's share dialog and select the Messenger recipient.
   * @param {any} page
   * @param {string} recipientUid
   * @param {string} recipientName
   * @param {string} postUrl
   * @returns {Promise<{ recipientUid: string, ok: boolean, method?: string }>}
   */
  async #messengerShareViaDialog(page, recipientUid, recipientName, postUrl) {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1000));

    const state = await page.evaluate(() => {
      const shareBtn =
        document.querySelector('div[data-ad-rendering-role="share_button"]') ||
        document.querySelector('[data-ad-renderingrole="share_button"]');
      if (!shareBtn) return { ok: false, error: 'Share button not found' };

      const btn = shareBtn.closest('[role="button"]') || shareBtn;
      btn.click();
      return { ok: true };
    });

    if (!state.ok) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: state.error || 'Messenger share dialog unavailable.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    await new Promise((r) => setTimeout(r, 1500));

    const clicked = await page.evaluate((/** @type {string} */ name) => {
      const needle = (name || '').trim().toLowerCase();
      const re = /qua Messenger|via Messenger|gửi qua Messenger/i;
      const buttons = [...document.querySelectorAll('[role="button"][aria-label]')];
      const target = buttons.find((b) => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        return re.test(label) && (needle === '' || label.includes(needle));
      });
      if (target) {
        target.click();
        return true;
      }
      return false;
    }, recipientName);

    if (!clicked) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Messenger recipient option not found in share dialog.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    await new Promise((r) => setTimeout(r, 1500));
    return { recipientUid, ok: true, method: 'share-dialog-messenger' };
  }

  /**
   * GraphQL CTA message fallback for Messenger share.
   * @param {string} recipientUid
   * @param {string} postUrl
   * @param {string} message
   * @param {Record<string, any>} session
   * @returns {Promise<{ recipientUid: string, ok: boolean, method?: string }>}
   */
  async #messengerShareViaGraphQL(recipientUid, postUrl, message, session) {
    const docId = this.#resolveDocId('MESSENGER_SHARE_MUTATION');
    if (!docId) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Messenger share failed and no valid GraphQL doc_id available.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    const variables = {
      input: {
        page_id: String(recipientUid),
        actor_id: String(recipientUid),
        client_mutation_id: '1',
        message: { text: message ? `${postUrl}\n\n${message}` : postUrl },
      },
    };

    await this.client.requestGraphQl(docId, variables, {
      accountId: resolveAccountId(session),
      cookies: resolveCookies(session),
      requiresAuth: true,
      requiresResidential: true,
      fallbackDocIds: [this.client?.docIds?.MESSENGER_SHARE_MUTATION, this.crawler?.docIds?.MESSENGER_SHARE_MUTATION].filter((d) => typeof d === 'string' && !d.startsWith('fb_')),
    });

    return { recipientUid, ok: true, method: 'graphql-messenger-cta' };
  }

  /**
   * Join one or more Facebook groups.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ results: { groupUrl: string, joined: boolean, pending?: boolean, dryRun?: boolean, error?: string }[], dryRun: boolean }>}
   */
  async joinGroup(args = {}, session = {}) {
    const dryRun = args?.dryRun !== false;
    const groupUrls = toStringArray(args?.groupUrl || args?.groupUrls || args?.groups);
    const groupIds = toStringArray(args?.groupId || args?.groupIds);
    const keyword = typeof args?.keyword === 'string' ? args.keyword.trim() : '';

    if (groupUrls.length === 0 && groupIds.length === 0 && !keyword) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'joinGroup requires groupUrl(s), groupId(s), or keyword',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'facebook',
      });
    }

    for (const url of groupUrls) {
      if (!isGroupUrl(url)) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `joinGroup groupUrl must contain /groups/: ${url}`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'facebook',
        });
      }
    }

    const resolvedUrls = [...groupUrls];
    for (const id of groupIds) {
      resolvedUrls.push(`https://www.facebook.com/groups/${id}`);
    }

    const limit = clampNumber(args?.limit || args?.maxBatch, 20, 1, 20);

    if (dryRun) {
      if (keyword) {
        return {
          results: [{ groupUrl: `https://www.facebook.com/search/groups/?q=${encodeURIComponent(keyword)}`, joined: false, pending: false, dryRun: true }],
          dryRun: true,
        };
      }
      return {
        results: resolvedUrls.slice(0, limit).map((groupUrl) => ({ groupUrl, joined: false, pending: false, dryRun: true })),
        dryRun: true,
      };
    }

    const actionName = 'join_group';
    const batchOptions = this.#batchOptions(actionName, session, args);
    batchOptions.maxBatch = limit;

    const results = await this.#withSharedPage(async (page) => {
      let targetUrls = resolvedUrls.slice(0, limit);

      if (keyword) {
        const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(keyword)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise((r) => setTimeout(r, 2000));

        if (dryRun) {
          return [{ groupUrl: searchUrl, joined: false, dryRun: true }];
        }

        const foundUrls = await page.evaluate((/** @type {number} */ max) => {
          /** @type {string[]} */
          const urls = [];
          const seen = new Set();
          const links = [...document.querySelectorAll('a[href*="/groups/"]')];
          for (const a of links) {
            const href = a.getAttribute('href') || '';
            const match = href.match(/\/groups\/([^/?#]+)/);
            if (match) {
              const url = `https://www.facebook.com/groups/${match[1]}`;
              if (!seen.has(url)) {
                seen.add(url);
                urls.push(url);
                if (urls.length >= max) break;
              }
            }
          }
          return urls;
        }, limit);

        targetUrls = foundUrls.slice(0, limit);
      }

      return runGuardedActionBatch(targetUrls, async (groupUrl, _i, { page: p }) => {
        if (dryRun) {
          return { groupUrl, joined: false, pending: false, dryRun: true };
        }
        return this.#joinGroup(groupUrl, p);
      }, { ...batchOptions, page });
    }, session);

    return { results, dryRun };
  }

  /**
   * Click Join Group on a group page and verify pending/joined state.
   * @param {string} groupUrl
   * @param {any} page
   * @returns {Promise<{ groupUrl: string, joined: boolean, pending?: boolean }>}
   */
  async #joinGroup(groupUrl, page) {
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1000));

    const state = await page.evaluate(() => {
      const selectors = [
        '[role="button"][aria-label*="Join Group" i]',
        '[role="button"][aria-label*="Tham gia nhóm" i]',
        '[role="button"][aria-label*="Join" i]',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return { found: true, label: btn.getAttribute('aria-label') };
        }
      }
      return { found: false };
    });

    if (!state.found) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Join Group button not found.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 500)));

    const joined = await page.evaluate(() => {
      const pending = document.querySelector(
        '[role="button"][aria-label*="Pending" i], [role="button"][aria-label*="Đang chờ" i], [role="button"][aria-label*="Cancel Request" i]'
      );
      const joined = document.querySelector(
        '[role="button"][aria-label*="Joined" i], [role="button"][aria-label*="Đã tham gia" i]'
      );
      return !!(pending || joined);
    });

    return { groupUrl, joined: true, pending: joined };
  }

  /**
   * Send friend request(s) to target profiles.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ results: { target: string, ok: boolean, dryRun?: boolean, error?: string }[], dryRun: boolean }>}
   */
  async sendFriendRequest(args = {}, session = {}) {
    const dryRun = args?.dryRun !== false;
    const mode = typeof args?.mode === 'string' ? args.mode.trim().toLowerCase() : '';
    const location = typeof args?.location === 'string' ? args.location.trim() : '';
    const rawTargets = toStringArray(args?.targets);
    const limit = clampNumber(args?.limit || args?.maxBatch, 20, 1, 20);

    const isSpecialMode =
      (mode === 'suggestions' && rawTargets.length === 0) ||
      (mode === 'location' && location && rawTargets.length === 0);

    /** @type {string[]} */
    const targets = [];
    if (!isSpecialMode) {
      for (const t of rawTargets.slice(0, limit)) {
        const normalized = this.#normalizeFriendTarget(t);
        if (!normalized) {
          throw new PlatformError({
            code: 'XACT_4001',
            type: ErrorTypes.INVALID_ARGS,
            message: `Invalid friend request target: ${t}`,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
            platform: 'facebook',
          });
        }
        targets.push(normalized);
      }
    }

    if (dryRun) {
      if (mode === 'suggestions' && rawTargets.length === 0) {
        return { results: [{ target: `suggestion:1`, ok: true, dryRun: true }], dryRun: true };
      }
      if (mode === 'location' && location && rawTargets.length === 0) {
        return { results: [{ target: `https://www.facebook.com/people/search?q=${encodeURIComponent(location)}`, ok: true, dryRun: true }], dryRun: true };
      }
      return {
        results: targets.map((target) => ({ target, ok: true, dryRun: true })),
        dryRun: true,
      };
    }

    const actionName = 'send_friend_request';
    const batchOptions = this.#batchOptions(actionName, session, args);
    batchOptions.maxBatch = limit;

    const results = await this.#withSharedPage(async (page) => {
      if (mode === 'suggestions' && rawTargets.length === 0) {
        return this.#sendFriendRequestsFromSuggestions(page, limit, dryRun);
      }

      if (mode === 'location' && location && rawTargets.length === 0) {
        return this.#sendFriendRequestsFromLocation(page, location, limit, dryRun, session, batchOptions);
      }

      return runGuardedActionBatch(targets, async (target, _i, { page: p }) => {
        if (dryRun) {
          return { target, ok: true, dryRun: true };
        }
        return this.#sendFriendRequest(target, p);
      }, { ...batchOptions, page });
    }, session);

    return { results, dryRun };
  }

  /**
   * Normalize a friend request target into a canonical profile URL or UID.
   * @param {string} target
   * @returns {string | null}
   */
  #normalizeFriendTarget(target) {
    const t = typeof target === 'string' ? target.trim() : '';
    if (!t) return null;

    // Numeric UID
    if (/^\d{5,}$/.test(t)) {
      return `https://www.facebook.com/profile.php?id=${t}`;
    }

    // Explicit facebook URL
    if (/^https?:\/\//i.test(t)) {
      try {
        assertFacebookUrl(t, 'friend target URL');
        return t;
      } catch {
        return null;
      }
    }

    // Username / vanity path (reject trailing dots and ellipsis)
    if (/^[a-zA-Z0-9_.\-]{1,100}$/.test(t) && !t.endsWith('.') && !t.endsWith('...')) {
      return `https://www.facebook.com/${t}`;
    }

    return null;
  }

  /**
   * Visit a profile and click Add Friend.
   * @param {string} target
   * @param {any} page
   * @returns {Promise<{ target: string, ok: boolean }>}
   */
  async #sendFriendRequest(target, page) {
    const targetUrl = target.startsWith('http') ? target : `https://www.facebook.com/${target}`;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1000));

    const clicked = await page.evaluate(() => {
      const selectors = [
        '[role="button"][aria-label*="Add Friend" i]',
        '[role="button"][aria-label*="Thêm bạn bè" i]',
        '[role="button"][aria-label*="Kết bạn" i]',
        '[role="button"][aria-label*="Add" i]',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return { found: true };
        }
      }
      return { found: false };
    });

    if (!clicked.found) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Add Friend button not found.',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }

    await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 500)));

    const sent = await page.evaluate(() => {
      const pending = document.querySelector(
        '[role="button"][aria-label*="Cancel Request" i], [role="button"][aria-label*="Hủy lời mời" i]'
      );
      return !!pending;
    });

    return { target, ok: sent };
  }

  /**
   * Send friend requests from the "People You May Know" suggestions page.
   * @param {any} page
   * @param {number} limit
   * @param {boolean} dryRun
   * @returns {Promise<{ target: string, ok: boolean, dryRun?: boolean }[]>}
   */
  async #sendFriendRequestsFromSuggestions(page, limit, dryRun) {
    await page.goto('https://www.facebook.com/friends/suggestions', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));

    if (dryRun) {
      return Array.from({ length: Math.min(limit, 1) }, (_, i) => ({ target: `suggestion:${i + 1}`, ok: true, dryRun: true }));
    }

    /** @type {{ target: string, ok: boolean }[]} */
    const results = [];
    let clicked = 0;

    while (clicked < limit) {
      const found = await page.evaluate(() => {
        const btn = document.querySelector(
          '[role="button"][aria-label*="Add Friend" i], [role="button"][aria-label*="Thêm bạn bè" i]'
        );
        if (btn) {
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return true;
        }
        return false;
      });

      if (!found) break;

      clicked++;
      results.push({ target: `suggestion:${clicked}`, ok: true });
      await new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 400)));
      await page.evaluate(() => window.scrollBy(0, 200));
    }

    return results;
  }

  /**
   * Send friend requests by searching people near a location.
   * @param {any} page
   * @param {string} location
   * @param {number} limit
   * @param {boolean} dryRun
   * @param {Record<string, any>} session
   * @param {Object} batchOptions
   * @returns {Promise<{ target: string, ok: boolean, dryRun?: boolean }[]>}
   */
  async #sendFriendRequestsFromLocation(page, location, limit, dryRun, session, batchOptions) {
    const searchUrl = `https://www.facebook.com/people/search?q=${encodeURIComponent(location)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    if (dryRun) {
      return [{ target: searchUrl, ok: true, dryRun: true }];
    }

    const profileUrls = await page.evaluate((/** @type {number} */ max) => {
      /** @type {string[]} */
      const urls = [];
      const seen = new Set();
      const links = [...document.querySelectorAll('a[href^="/"], a[href*="facebook.com/"]')];
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        const match = href.match(/^\/?([a-zA-Z0-9_.\-]{3,100})$/) ||
          href.match(/^https?:\/\/www\.facebook\.com\/([a-zA-Z0-9_.\-]{3,100})$/);
        if (match) {
          const url = `https://www.facebook.com/${match[1]}`;
          if (!seen.has(url) && !/\.(jpg|png|gif|js|css)$/i.test(match[1])) {
            seen.add(url);
            urls.push(url);
            if (urls.length >= max) break;
          }
        }
      }
      return urls;
    }, limit);

    return runGuardedActionBatch(profileUrls.slice(0, limit), async (target, _i, { page: p }) => {
      return this.#sendFriendRequest(target, p);
    }, { ...batchOptions, page });
  }
}
