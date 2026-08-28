// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalization helpers for Threads posts and comments.
 * Transforms raw GraphQL nodes / SSR objects into universal PostItem and CommentItem schemas.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generatePostId, generateCommentId, CATEGORIES } from '../../../core/types.js';

/**
 * Extract candidate media URLs from Threads post media objects.
 * @param {Record<string, any>} post
 * @returns {string[]}
 */
export function extractMediaUrls(post) {
  /** @type {string[]} */
  const urls = [];
  if (!post || typeof post !== 'object') return urls;

  // 1. Single image (media_type === 1) or candidate images
  if (Array.isArray(post.image_versions2?.candidates) && post.image_versions2.candidates.length > 0) {
    const candidates = [...post.image_versions2.candidates].sort((a, b) => {
      const areaA = (a.width || 0) * (a.height || 0);
      const areaB = (b.width || 0) * (b.height || 0);
      return areaB - areaA;
    });
    if (candidates[0]?.url) {
      urls.push(candidates[0].url);
    }
  }

  // 2. Video versions (media_type === 2)
  if (Array.isArray(post.video_versions) && post.video_versions.length > 0) {
    const videoVersions = [...post.video_versions].sort((a, b) => {
      const widthA = a.width || 0;
      const widthB = b.width || 0;
      return widthB - widthA;
    });
    if (videoVersions[0]?.url) {
      urls.push(videoVersions[0].url);
    }
  }

  // 3. Carousel media (media_type === 8)
  if (Array.isArray(post.carousel_media)) {
    for (const item of post.carousel_media) {
      if (Array.isArray(item.image_versions2?.candidates) && item.image_versions2.candidates.length > 0) {
        const sorted = [...item.image_versions2.candidates].sort((a, b) => {
          const areaA = (a.width || 0) * (a.height || 0);
          const areaB = (b.width || 0) * (b.height || 0);
          return areaB - areaA;
        });
        if (sorted[0]?.url) {
          urls.push(sorted[0].url);
        }
      }
      if (Array.isArray(item.video_versions) && item.video_versions.length > 0) {
        if (item.video_versions[0]?.url) {
          urls.push(item.video_versions[0].url);
        }
      }
    }
  }

  return [...new Set(urls)];
}

/**
 * Normalize raw Threads post node into PostItem schema.
 * @param {Record<string, any>} rawPost
 * @param {string} [sourceMethod='graphql']
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function normalizePost(rawPost, sourceMethod = 'graphql') {
  if (!rawPost || typeof rawPost !== 'object') return null;

  const post = rawPost.post || rawPost.node?.thread_items?.[0]?.post || rawPost.node || rawPost;
  const pk = post.pk || post.id;
  if (!pk) return null;

  const externalId = String(pk);
  const user = post.user || {};
  const authorId = String(user.pk || user.id || '');
  const authorName = String(user.username || user.full_name || '');
  const authorAvatar = user.profile_pic_url ? String(user.profile_pic_url) : undefined;
  const authorUrl = authorName ? `https://www.threads.net/@${authorName}` : undefined;

  const code = post.code || externalId;
  const postUrl = authorName
    ? `https://www.threads.net/@${authorName}/post/${code}`
    : `https://www.threads.net/t/${code}`;

  const content = post.caption?.text || (typeof post.caption === 'string' ? post.caption : '') || '';
  const mediaUrls = extractMediaUrls(post);

  const likesCount = Number(post.like_count || 0);
  const repliesCount = Number(post.text_post_app_info?.direct_reply_count || post.comment_count || 0);
  const repostsCount = Number(post.media_repost_count || post.reshare_count || 0);
  const viewsCount = Number(post.play_count || post.view_count || 0);

  const takenAt = post.taken_at;
  const publishedAt = takenAt ? new Date(Number(takenAt) * (takenAt > 1e11 ? 1 : 1000)) : undefined;

  const isReply = Boolean(post.text_post_app_info?.is_reply || post.is_reply || false);
  const mediaType = String(post.media_type || (mediaUrls.length > 1 ? 'carousel' : (mediaUrls.length === 1 ? 'image' : 'text')));
  const replyControl = post.text_post_app_info?.reply_control ? String(post.text_post_app_info.reply_control) : undefined;

  /** @type {import('../../../core/types.js').PostItem} */
  return {
    id: generatePostId('threads', externalId),
    platform: 'threads',
    externalId,
    category: CATEGORIES.SOCIAL,
    authorId,
    authorName,
    authorAvatar,
    authorUrl,
    postUrl,
    content,
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
    likesCount,
    repostsCount,
    repliesCount,
    viewsCount,
    publishedAt,
    crawledAt: new Date(),
    metadata: {
      postCode: String(code),
      mediaType,
      isReply,
      carousel: mediaUrls.length > 1 ? mediaUrls : undefined,
      replyControl,
      sourceMethod,
    },
  };
}

/**
 * Normalize raw Threads comment / reply node into CommentItem schema.
 * @param {Record<string, any>} rawComment
 * @param {string} postId
 * @param {string} [sourceMethod='graphql']
 * @returns {import('../../../core/types.js').CommentItem | null}
 */
export function normalizeComment(rawComment, postId, sourceMethod = 'graphql') {
  if (!rawComment || typeof rawComment !== 'object') return null;

  const node = rawComment.node || rawComment.post || rawComment;
  const pk = node.pk || node.id;
  if (!pk) return null;

  const externalId = String(pk);
  const cleanPostId = postId.startsWith('threads:') ? postId.slice('threads:'.length) : postId;

  const user = node.user || {};
  const authorId = String(user.pk || user.id || '');
  const authorName = String(user.username || user.full_name || '');
  const authorAvatar = user.profile_pic_url ? String(user.profile_pic_url) : undefined;

  const content = node.caption?.text || (typeof node.caption === 'string' ? node.caption : '') || node.text || '';
  const likesCount = Number(node.like_count || 0);
  const subCommentsCount = Number(node.text_post_app_info?.direct_reply_count || node.comment_count || 0);

  const takenAt = node.taken_at;
  const publishedAt = takenAt ? new Date(Number(takenAt) * (takenAt > 1e11 ? 1 : 1000)) : undefined;

  const parentId = node.parentId || node.parent_id || undefined;
  const parentCommentId = parentId ? generateCommentId('threads', cleanPostId, String(parentId)) : undefined;

  const isReply = Boolean(node.text_post_app_info?.is_reply || parentId || false);
  const mediaType = String(node.media_type || 'text');

  /** @type {import('../../../core/types.js').CommentItem} */
  return {
    id: generateCommentId('threads', cleanPostId, externalId),
    platform: 'threads',
    externalId,
    postId: generatePostId('threads', cleanPostId),
    parentCommentId,
    depth: typeof node.depth === 'number' ? node.depth : 0,
    authorId,
    authorName,
    authorAvatar,
    content,
    likesCount,
    subCommentsCount,
    publishedAt,
    crawledAt: new Date(),
    metadata: {
      postCode: node.code ? String(node.code) : externalId,
      mediaType,
      isReply,
      sourceMethod,
      parentId: parentId ? String(parentId) : undefined,
    },
  };
}
