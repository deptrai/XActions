// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook scrape() descriptor (Story 25.1).
 * Verbatim extraction of the facebook block + `dispatchFacebookHybrid` from the
 * unified dispatcher (Story 13.10).
 *
 * `dispatchFacebookHybrid` remains a named export — re-exported by
 * `src/scrapers/index.js` because `api/services/facebookScrape.js` imports it
 * directly (lines 18, 89, 126, 157).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { FacebookCrawler, resolveTargetKey, resolveGroupId } from './crawler.js';
import { FacebookClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

// Local copies of the index.js factory helpers so the moved
// `dispatchFacebookHybrid` body stays verbatim.
/**
 * @param {Record<string, any>} [options]
 * @returns {FacebookClient}
 */
function createFacebookClient(options = {}) {
  return new FacebookClient(options);
}

/**
 * @param {FacebookClient} client
 * @param {Record<string, any>} [options]
 * @returns {FacebookCrawler}
 */
function createFacebookCrawler(client, options = {}) {
  return new FacebookCrawler({ client, ...options });
}

/**
 * Dispatch to FacebookCrawler hybrid engine (Story 13.10)
 * @param {string} action
 * @param {import('../../../types/xactions.d.ts').XActionsOptions & Record<string, any>} options
 * @returns {Promise<Record<string, any>>}
 */
export async function dispatchFacebookHybrid(action, options = {}) {
  // Facebook uses a cookie-object ({ c_user, xs }) via authCookie, not a string authToken.
  if (options.authToken) {
    throw new Error(
      '❌ Facebook uses options.authCookie ({ c_user, xs }), not options.authToken'
    );
  }

  // 1. Map action names (AC-2)
  const normalizedAction = String(action || '').trim().toLowerCase();
  /** @type {Record<string, string>} */
  const ACTION_MAPPING = {
    profile: 'profile',
    followers: 'followers',
    following: 'following',
    search: 'search',
    marketplace: 'marketplace',
    post_comments: 'post_comments',
    group_posts: 'group_posts',
    group_comments: 'group_comments',
    group_search: 'group_search',
    'group-members': 'group_members',
    group_members: 'group_members',
    like: 'like',
    comment: 'comment',
    post: 'post',
    share: 'share',
    messenger: 'messenger_share',
    messenger_share: 'messenger_share',
    'messenger-share': 'messenger_share',
    share_link_uid: 'share_link_uid',
    'share-link-uid': 'share_link_uid',
    join_group: 'join_group',
    join_groups: 'join_group',
    'join-group': 'join_group',
    'join-groups': 'join_group',
    'batch-post-groups': 'post',
    batch_post_groups: 'post',
    send_friend_request: 'send_friend_request',
    send_friend_requests: 'send_friend_request',
    'send-friend-request': 'send_friend_request',
    'send-friend-requests': 'send_friend_request',
    warmup_scroll: 'warmup_scroll',
    'warmup-scroll': 'warmup_scroll',
    'warmup-scroll-feed': 'warmup_scroll',
    warmup_account: 'warmup_account',
    'warmup-account': 'warmup_account',
    cancel_friend_requests: 'cancel_friend_requests',
    'cancel-friend-requests': 'cancel_friend_requests',
  };

  let mappedAction = ACTION_MAPPING[normalizedAction];
  if (normalizedAction === 'posts' || normalizedAction === 'tweets' || normalizedAction === 'feed') {
    const rawUrl = options.url || options.targetUrl || '';
    if (typeof rawUrl === 'string' && (rawUrl.includes('/groups/') || rawUrl.includes('/group/'))) {
      mappedAction = 'group_posts';
    } else {
      mappedAction = 'page_posts';
    }
  }

  if (!mappedAction) {
    mappedAction = normalizedAction;
  }

  // 2. Build or obtain crawler instance
  let crawler = /** @type {FacebookCrawler | undefined} */ (options.crawler);
  let ownsCrawler = false;
  if (!crawler) {
    ownsCrawler = true;
    const browserOpts = /** @type {Record<string, any>} */ (options.browserOptions || {});
    const client = /** @type {FacebookClient | undefined} */ (options.client) || createFacebookClient(browserOpts);
    crawler = createFacebookCrawler(client, browserOpts);
  }

  // 3. Build session & args under resource-safe try/finally
  try {
    const validActions = typeof crawler.listActions === 'function'
      ? crawler.listActions().map((a) => a.action)
      : Object.keys(ACTION_MAPPING);

    if (!validActions.includes(mappedAction)) {
      throw actionNotAvailable('facebook', action, validActions);
    }

    let accountId = options.authCookie?.accountId || (Array.isArray(options.accountIds) && options.accountIds.length > 0 ? options.accountIds[0] : null);
    let cookies = options.authCookie;
    if (!accountId && typeof options.authCookie === 'object' && options.authCookie?.c_user) {
      accountId = String(options.authCookie.c_user);
    } else if (!accountId && typeof options.authCookie === 'string') {
      // authCookie is typed Record<string,string> but callers may pass a raw
      // cookie string — defensive branch preserved verbatim from the monolith.
      const match = /** @type {string} */ (/** @type {unknown} */ (options.authCookie)).match(/(?:^|;\s*)c_user=([^;]+)/);
      if (match) accountId = match[1];
    }

    const session = {
      ...(accountId ? { accountId } : {}),
      ...(cookies ? { cookies } : {}),
      cdpUrl: options.browserOptions?.cdpUrl || process.env.FACEBOOK_CDP_URL,
      page: options.page,
    };

    const args = { ...options };
    delete args.page;
    delete args.autoClose;
    delete args.authCookie;
    delete args.browserOptions;
    delete args.client;
    delete args.crawler;
    delete args.authToken;

    // Resolve page/group identifiers from URL aliases (AC-2)
    if (mappedAction === 'page_posts' && !args.pageId) {
      const raw = args.url || args.username || args.targetUrl;
      if (typeof raw === 'string' && raw.trim()) {
        args.pageId = resolveTargetKey(raw.trim());
      }
    }
    if (mappedAction === 'group_posts' && !args.groupId) {
      const raw = args.url || args.groupUrl || args.groupId;
      if (typeof raw === 'string' && raw.trim()) {
        args.groupId = resolveGroupId(raw.trim());
      }
    }
    if ((mappedAction === 'group_search' || mappedAction === 'group_members') && !args.groupUrl && !args.groupId) {
      const raw = args.url || args.groupUrl;
      if (typeof raw === 'string' && raw.trim()) {
        args.groupUrl = raw.trim();
      }
    }

    // Normalize legacy arg shapes to FacebookCrawler canonical args
    if (['like', 'comment', 'share'].includes(mappedAction)) {
      const rawUrls = args.urls || args.postUrl || args.postUrls;
      const postUrls = Array.isArray(rawUrls) ? rawUrls : (typeof rawUrls === 'string' ? rawUrls.split(',').map((u) => u.trim()).filter(Boolean) : []);
      if (postUrls.length) {
        args.postUrls = postUrls;
        args.postUrl = postUrls[0];
      }
      delete args.urls;
      if (mappedAction === 'post' || mappedAction === 'comment') {
        args.text = typeof args.text === 'string' ? args.text : (typeof args.content === 'string' ? args.content : args.text);
      }
    }
    if (mappedAction === 'post') {
      const rawText = args.text || args.content;
      if (typeof rawText === 'string') args.text = rawText;
      const rawGroups = args.groupUrls || args.groupUrl || args.groups;
      if (rawGroups) {
        args.groupUrls = Array.isArray(rawGroups) ? rawGroups : (typeof rawGroups === 'string' ? rawGroups.split(',').map((u) => u.trim()).filter(Boolean) : []);
      }
    }
    if (mappedAction === 'join_group') {
      const rawGroups = args.groupUrls || args.groupUrl || args.groups;
      if (rawGroups) {
        args.groupUrls = Array.isArray(rawGroups) ? rawGroups : (typeof rawGroups === 'string' ? rawGroups.split(',').map((u) => u.trim()).filter(Boolean) : []);
      }
      if (typeof args.keyword === 'string') args.keyword = args.keyword.trim();
      if (args.limit != null) args.limit = Number(args.limit);
    }
    if (mappedAction === 'send_friend_request') {
      const rawTargets = args.targets || args.target;
      if (rawTargets) {
        args.targets = Array.isArray(rawTargets) ? rawTargets : (typeof rawTargets === 'string' ? rawTargets.split(',').map((u) => u.trim()).filter(Boolean) : []);
      }
      if (args.limit != null) args.limit = Number(args.limit);
    }
    if (mappedAction === 'messenger_share' || mappedAction === 'share_link_uid') {
      const rawMessage = args.message || args.content;
      if (typeof rawMessage === 'string') args.message = rawMessage;
      const rawRecipients = args.recipientUids || args.recipients;
      if (rawRecipients) {
        const arr = Array.isArray(rawRecipients) ? rawRecipients : (typeof rawRecipients === 'string' ? rawRecipients.split(',').map((u) => u.trim()).filter(Boolean) : []);
        args.recipientUids = arr;
      }
      const rawPostUrl = args.postUrl || (Array.isArray(args.postUrls) ? args.postUrls[0] : args.postUrl);
      if (typeof rawPostUrl === 'string') args.postUrl = rawPostUrl;
      if (mappedAction === 'share_link_uid' && Array.isArray(args.recipientUids) && args.recipientUids.length) {
        args.recipientUid = args.recipientUids[0];
      }
    }

    const result = await crawler.start({
      action: mappedAction,
      args,
      session,
    });
    return result;
  } finally {
    if (ownsCrawler && options.autoClose !== false && typeof crawler.cleanup === 'function') {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  aliases: ['facebook', 'fb'],

  /**
   * Facebook Hybrid Dispatch (Story 13.10, AC-1).
   * When the caller provides a Puppeteer page, keep the legacy page-based path
   * so existing unit tests and browser-bridged callers still work.
   * @param {string} platformName - Caller platform key (already lowercased by scrape()).
   * @param {string} action
   * @param {Record<string, any>} options
   * @param {Record<string, any>} [ctx] - Dispatch context ({ platform } = raw caller arg).
   * @returns {Promise<Record<string, any>>}
   */
  async dispatch(platformName, action, options, ctx = {}) {
    // Legacy page-based dispatch removed in Story 26.2 — all actions route to
    // the hybrid FacebookCrawler. The legacy module functions were deleted.
    return await dispatchFacebookHybrid(action, options);
  },
};
