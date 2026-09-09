// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizer & Type Adapter for Reddit Scraper (Story 35.1).
 * Normalizes Reddit Listing/Thing objects (t3 posts, t1 comments, t5 subreddits, t2 users)
 * into standard PostItem, CommentItem, and ProfileItem schemas.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generateCommentId } from '../../../core/types.js';

/**
 * Generate namespaced identifier for Reddit.
 * format: `reddit:${externalId}`
 * @param {string | number} externalId
 * @returns {string}
 */
export function namespacedRedditId(externalId) {
  return `reddit:${String(externalId || '').trim()}`;
}

/**
 * Parse Reddit fullname into kind + id.
 * e.g. "t3_1a2b3c" -> { kind: "t3", id: "1a2b3c" }
 * @param {string} fullname
 * @returns {{ kind: string, id: string }}
 */
export function parseFullname(fullname) {
  if (typeof fullname !== 'string' || !fullname) {
    return { kind: 'unknown', id: '' };
  }
  const [kind, id] = fullname.split('_');
  return { kind: kind || 'unknown', id: id || fullname };
}

/**
 * Normalize raw Reddit post (t3 / kind 't3' object) into PostItem.
 * @param {Record<string, any>} raw
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeRedditPost(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid Reddit post payload: expected object');
  }

  // Support both { kind: 't3', data: { ... } } and raw data object
  const post = raw.data || raw;

  const fullname = String(post.name || '');
  const { kind, id: postId } = parseFullname(fullname);
  const externalId = fullname || post.id || postId;

  const subreddit = String(post.subreddit || '').toLowerCase();
  const authorName = String(post.author || '[deleted]');
  const authorId = authorName;
  const title = String(post.title || '');
  const selftext = String(post.selftext || '');
  const content = selftext ? `${title} ${selftext}` : title;

  const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : '';
  const postUrl = post.url ? String(post.url) : permalink;
  const authorUrl = authorName !== '[deleted]' ? `https://www.reddit.com/user/${authorName}` : '';

  const mediaUrls = [];
  if (post.url && /^https?:\/\//i.test(post.url) && !post.url.includes('reddit.com')) {
    mediaUrls.push(String(post.url));
  }
  if (post.thumbnail && /^https?:\/\//i.test(post.thumbnail)) {
    mediaUrls.push(String(post.thumbnail));
  }

  const publishedAt = post.created_utc ? new Date(post.created_utc * 1000) : null;
  const likesCount = typeof post.score === 'number' ? post.score : 0;
  const repliesCount = typeof post.num_comments === 'number' ? post.num_comments : 0;
  const repostsCount = 0;

  return {
    id: namespacedRedditId(externalId),
    platform: 'reddit',
    externalId,
    category: "social",
    authorId,
    authorName,
    authorAvatar: null,
    authorUrl,
    postUrl,
    content,
    mediaUrls,
    likesCount,
    repostsCount,
    repliesCount,
    metadata: {
      kind,
      postId,
      subreddit,
      subredditId: post.subreddit_id ? String(post.subreddit_id) : null,
      title,
      selftext,
      permalink,
      isSelf: Boolean(post.is_self),
      isVideo: Boolean(post.is_video),
      isNsfw: Boolean(post.over_18),
      isSpoiler: Boolean(post.spoiler),
      isPinned: Boolean(post.pinned),
      isStickied: Boolean(post.stickied),
      upvoteRatio: typeof post.upvote_ratio === 'number' ? post.upvote_ratio : null,
      gilded: typeof post.gilded === 'number' ? post.gilded : 0,
      totalAwards: typeof post.total_awards_received === 'number' ? post.total_awards_received : 0,
    },
    publishedAt,
    crawledAt: new Date(),
  };
}

/**
 * Normalize raw Reddit comment (t1 / kind 't1' object) into CommentItem.
 * @param {Record<string, any>} raw
 * @returns {import('../../../core/types.js').CommentItem}
 */
export function normalizeRedditComment(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid Reddit comment payload: expected object');
  }

  const comment = raw.data || raw;

  const fullname = String(comment.name || '');
  const { kind, id: commentId } = parseFullname(fullname);
  const externalId = fullname || comment.id || commentId;

  const postFullname = String(comment.link_id || '');
  const { kind: postKind, id: postId } = parseFullname(postFullname);
  const postNamespacedId = postFullname ? namespacedRedditId(postFullname) : '';

  const parentId = comment.parent_id ? String(comment.parent_id) : '';
  const { kind: parentKind, id: parentExternalId } = parentId ? parseFullname(parentId) : { kind: '', id: null };

  const authorName = String(comment.author || '[deleted]');
  const authorId = authorName;
  const content = String(comment.body || '');
  const likesCount = typeof comment.score === 'number' ? comment.score : 0;
  const subCommentsCount = typeof comment.replies?.data?.children?.length === 'number'
    ? comment.replies.data.children.length
    : 0;

  const publishedAt = comment.created_utc ? new Date(comment.created_utc * 1000) : null;
  const permalink = comment.permalink ? `https://www.reddit.com${comment.permalink}` : '';

  // Top-level comments have parent_id equal to the post fullname (t3_...).
  // Replies to other comments have parent_id as a comment fullname (t1_...).
  const parentCommentId = parentKind === 't1' && parentExternalId
    ? namespacedRedditId(parentId)
    : undefined;

  return {
    id: generateCommentId('reddit', postFullname || postId, externalId),
    platform: 'reddit',
    externalId,
    postId: postNamespacedId,
    parentCommentId,
    depth: typeof comment.depth === 'number' ? comment.depth : 0,
    authorId,
    authorName,
    authorAvatar: null,
    content,
    likesCount,
    subCommentsCount,
    metadata: {
      kind,
      commentId,
      postFullname,
      parentId,
      subreddit: String(comment.subreddit || '').toLowerCase(),
      isSubmitter: Boolean(comment.is_submitter),
      isMod: Boolean(comment.is_mod),
      isAdmin: Boolean(comment.is_admin),
      permalink,
      gilded: typeof comment.gilded === 'number' ? comment.gilded : 0,
      totalAwards: typeof comment.total_awards_received === 'number' ? comment.total_awards_received : 0,
    },
    publishedAt,
    crawledAt: new Date(),
  };
}

/**
 * Normalize raw Reddit subreddit (t5 / kind 't5' object) into PostItem with community metadata.
 * @param {Record<string, any>} raw
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeRedditSubreddit(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid Reddit subreddit payload: expected object');
  }

  const sub = raw.data || raw;

  const fullname = String(sub.name || '');
  const { kind, id: subId } = parseFullname(fullname);
  const externalId = fullname || sub.id || subId;

  const displayName = String(sub.display_name || '').toLowerCase();
  const publicDescription = String(sub.public_description || '');
  const description = String(sub.description || '');
  const content = publicDescription || description || displayName;

  const postUrl = sub.url ? `https://www.reddit.com${sub.url}` : '';
  const publishedAt = sub.created_utc ? new Date(sub.created_utc * 1000) : null;
  const likesCount = typeof sub.subscribers === 'number' ? sub.subscribers : 0;

  const icon = sub.icon_img || sub.community_icon || null;
  const banner = sub.banner_img || null;

  return {
    id: namespacedRedditId(externalId),
    platform: 'reddit',
    externalId,
    category: "social",
    authorId: 'reddit_system',
    authorName: `r/${displayName}`,
    authorAvatar: typeof icon === 'string' ? icon : null,
    postUrl,
    content,
    mediaUrls: icon ? [icon] : [],
    likesCount,
    repostsCount: 0,
    repliesCount: 0,
    metadata: {
      isCommunity: true,
      kind,
      subId,
      displayName,
      title: String(sub.title || displayName),
      publicDescription,
      description,
      subscribers: likesCount,
      activeAccounts: typeof sub.accounts_active === 'number' ? sub.accounts_active : null,
      lang: String(sub.lang || ''),
      isNsfw: Boolean(sub.over18),
      isQuarantined: Boolean(sub.quarantine),
      isPrivate: Boolean(sub.subreddit_type === 'private'),
      isRestricted: Boolean(sub.subreddit_type === 'restricted'),
      icon,
      banner,
      subscribersGained: typeof sub.subscribers_gained === 'number' ? sub.subscribers_gained : null,
      trafficTotal: typeof sub.traffic_total === 'number' ? sub.traffic_total : null,
    },
    publishedAt,
    crawledAt: new Date(),
  };
}

/**
 * Normalize raw Reddit user (t2 / kind 't2' object) into ProfileItem.
 * @param {Record<string, any>} raw
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeRedditUser(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid Reddit user payload: expected object');
  }

  const user = raw.data || raw;

  // Reddit user about returns `name` as username (e.g. 'spez'); `fullname` may not be present.
  // Prefer real fullname if available, otherwise synthesize `t2:${username}` for stable externalId.
  const username = String(user.name || '');
  const rawFullname = user.fullname ? String(user.fullname) : (user.name && /^t2_/.test(user.name) ? user.name : '');
  const fullname = rawFullname || (username ? `t2_${username}` : '');
  const { kind, id: userId } = parseFullname(fullname);
  const externalId = fullname || user.id || userId || username;

  const name = username;
  const authorName = name;
  const bio = String(user.subreddit?.public_description || '');
  const avatar = user.icon_img || null;
  const profileUrl = `https://www.reddit.com/user/${username}`;

  const linkKarma = typeof user.link_karma === 'number' ? user.link_karma : 0;
  const commentKarma = typeof user.comment_karma === 'number' ? user.comment_karma : 0;
  const followersCount = linkKarma + commentKarma;

  return {
    id: namespacedRedditId(externalId),
    platform: 'reddit',
    externalId,
    username,
    name,
    authorName,
    bio,
    avatar: typeof avatar === 'string' ? avatar : null,
    profileUrl,
    followersCount,
    followingCount: 0,
    metadata: {
      kind,
      userId,
      joined: user.created_utc ? new Date(user.created_utc * 1000) : null,
      linkKarma,
      commentKarma,
      totalKarma: typeof user.total_karma === 'number' ? user.total_karma : 0,
      awardeeKarma: typeof user.awardee_karma === 'number' ? user.awardee_karma : 0,
      awarderKarma: typeof user.awarder_karma === 'number' ? user.awarder_karma : 0,
      isEmployee: Boolean(user.is_employee),
      isMod: Boolean(user.is_mod),
      isGold: Boolean(user.is_gold),
      isSuspended: Boolean(user.is_suspended),
      verified: Boolean(user.verified),
    },
    crawledAt: new Date(),
  };
}
