// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * YouTube Normalizers — transforms raw YouTube Data API v3 payloads
 * to standardized PostItem, CommentItem, and ProfileItem domain models.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import {
  namespacedYouTubeId,
  namespacedCommentId,
  parseIsoDuration,
  extractBestThumbnail,
  parseYouTubeDate,
} from './schema.js';

/**
 * @typedef {import('../../../core/types.js').PostItem} PostItem
 * @typedef {import('../../../core/types.js').CommentItem} CommentItem
 * @typedef {import('../../../core/types.js').ProfileItem} ProfileItem
 */

/**
 * Normalize YouTube video (from search or videos.list) to PostItem.
 * @param {Record<string, any>} video
 * @param {Record<string, any>} [context={}]
 * @returns {PostItem}
 */
export function normalizeYouTubeVideo(video, context = {}) {
  const rawId =
    video.id?.videoId ||
    video.videoId ||
    (typeof video.id === 'string' ? video.id : video.id?.id || '');
  const videoId = String(rawId || '').trim();
  const id = namespacedYouTubeId(videoId);
  const snippet = video.snippet || {};
  const contentDetails = video.contentDetails || {};
  const statistics = video.statistics || {};

  const title = typeof snippet.title === 'string' ? snippet.title.trim() : '';
  const content = typeof snippet.description === 'string' && snippet.description.trim()
    ? snippet.description.trim()
    : title;

  const thumbnail = extractBestThumbnail(snippet.thumbnails);
  const mediaUrls = thumbnail ? [thumbnail] : [];

  const channelId = String(snippet.channelId || context.channelId || '');
  const channelTitle = String(snippet.channelTitle || context.channelTitle || 'YouTube Channel');

  const durationStr = contentDetails.duration || null;
  const durationSeconds = durationStr ? parseIsoDuration(durationStr) : null;

  const viewsCount = statistics.viewCount ? parseInt(statistics.viewCount, 10) : undefined;
  const likesCount = statistics.likeCount ? parseInt(statistics.likeCount, 10) : undefined;
  const repliesCount = statistics.commentCount ? parseInt(statistics.commentCount, 10) : undefined;

  return {
    id,
    platform: 'youtube',
    externalId: videoId,
    title: title || undefined,
    category: 'video',
    authorId: channelId,
    authorName: channelTitle,
    authorUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : undefined,
    postUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined,
    content,
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
    viewsCount,
    likesCount,
    repliesCount,
    metadata: {
      channelTitle,
      channelId,
      duration: durationStr || undefined,
      durationSeconds: durationSeconds !== null ? durationSeconds : undefined,
      tags: Array.isArray(snippet.tags) ? snippet.tags : undefined,
      regionCode: context.regionCode || snippet.regionCode || 'VN',
      categoryId: snippet.categoryId || undefined,
      sourcePlatform: 'youtube',
    },
    publishedAt: parseYouTubeDate(snippet.publishedAt) || null,
    crawledAt: new Date(),
  };
}

/**
 * Normalize YouTube Channel to ProfileItem.
 * @param {Record<string, any>} channel
 * @param {Record<string, any>} [context={}]
 * @returns {ProfileItem}
 */
export function normalizeYouTubeChannel(channel, context = {}) {
  const channelId = String(channel.id || context.channelId || '');
  const id = namespacedYouTubeId(channelId);
  const snippet = channel.snippet || {};
  const statistics = channel.statistics || {};
  const branding = channel.brandingSettings?.channel || {};

  const name = typeof snippet.title === 'string' ? snippet.title.trim() : `Channel ${channelId}`;
  const bio = typeof snippet.description === 'string' ? snippet.description.trim() : '';
  const avatar = extractBestThumbnail(snippet.thumbnails);
  const followersCount = statistics.subscriberCount ? parseInt(statistics.subscriberCount, 10) : 0;
  const customUrl = snippet.customUrl || branding.customUrl || null;
  const profileUrl = customUrl ? `https://www.youtube.com/${customUrl.replace(/^@/, '')}` : `https://www.youtube.com/channel/${channelId}`;

  return {
    id,
    platform: 'youtube',
    externalId: channelId,
    name,
    authorName: name,
    bio,
    avatar: avatar || undefined,
    profileUrl,
    followersCount,
    metadata: {
      videoCount: statistics.videoCount ? parseInt(statistics.videoCount, 10) : 0,
      viewCount: statistics.viewCount ? parseInt(statistics.viewCount, 10) : 0,
      country: snippet.country || 'VN',
      customUrl: customUrl || undefined,
      sourcePlatform: 'youtube',
    },
    crawledAt: new Date(),
  };
}

/**
 * Normalize a single comment thread (including nested replies) to CommentItem[].
 * @param {Record<string, any>} thread
 * @param {Record<string, any>} [context={}]
 * @returns {CommentItem[]}
 */
export function normalizeYouTubeCommentThread(thread, context = {}) {
  const result = [];
  const snippet = thread.snippet || {};
  const videoId = String(snippet.videoId || context.videoId || '');
  const topComment = snippet.topLevelComment?.snippet || {};
  const topCommentId = String(snippet.topLevelComment?.id || thread.id || '');

  if (topCommentId) {
    const commentAuthorId = String(topComment.authorChannelId?.value || '');
    const topItem = {
      id: namespacedCommentId(videoId, topCommentId),
      platform: 'youtube',
      externalId: topCommentId,
      postId: namespacedYouTubeId(videoId),
      depth: 0,
      parentCommentId: undefined,
      authorId: commentAuthorId,
      authorName: topComment.authorDisplayName || 'YouTube User',
      authorAvatar: topComment.authorProfileImageUrl || null,
      content: topComment.textDisplay || topComment.textOriginal || '',
      likesCount: typeof topComment.likeCount === 'number' ? topComment.likeCount : 0,
      subCommentsCount: typeof snippet.totalReplyCount === 'number' ? snippet.totalReplyCount : 0,
      metadata: {
        videoId,
        sourcePlatform: 'youtube',
      },
      publishedAt: parseYouTubeDate(topComment.publishedAt) || null,
      crawledAt: new Date(),
    };
    result.push(topItem);
  }

  // Nested replies
  const replies = Array.isArray(thread.replies?.comments) ? thread.replies.comments : [];
  for (const reply of replies) {
    const replySnippet = reply.snippet || {};
    const replyId = String(reply.id || '');
    if (!replyId) continue;

    const replyAuthorId = String(replySnippet.authorChannelId?.value || '');
    result.push({
      id: namespacedCommentId(videoId, replyId),
      platform: 'youtube',
      externalId: replyId,
      postId: namespacedYouTubeId(videoId),
      depth: 1,
      parentCommentId: namespacedCommentId(videoId, topCommentId),
      authorId: replyAuthorId,
      authorName: replySnippet.authorDisplayName || 'YouTube User',
      authorAvatar: replySnippet.authorProfileImageUrl || null,
      content: replySnippet.textDisplay || replySnippet.textOriginal || '',
      likesCount: typeof replySnippet.likeCount === 'number' ? replySnippet.likeCount : 0,
      metadata: {
        videoId,
        parentCommentId: topCommentId,
        sourcePlatform: 'youtube',
      },
      publishedAt: parseYouTubeDate(replySnippet.publishedAt) || null,
      crawledAt: new Date(),
    });
  }

  return result;
}

/**
 * Main transformation entrypoint for YouTube responses.
 * @param {Record<string, any>} rawPayload
 * @param {string} action
 * @param {Record<string, any>} [context={}]
 * @returns {Record<string, any>}
 */
export function normalizeYouTubeResults(rawPayload, action, context = {}) {
  const items = Array.isArray(rawPayload?.items) ? rawPayload.items : [];
  const nextPageToken = rawPayload?.nextPageToken || null;
  const prevPageToken = rawPayload?.prevPageToken || null;
  const total = rawPayload?.pageInfo?.totalResults ?? items.length;

  switch (action) {
    case 'search':
    case 'channel_videos':
    case 'trending':
    case 'trending_vn': {
      const posts = items.map((item) => normalizeYouTubeVideo(item, context));
      return {
        posts,
        pageInfo: {
          total,
          nextPageToken,
          prevPageToken,
          has_next_page: Boolean(nextPageToken),
        },
      };
    }

    case 'video':
    case 'detail':
    case 'video_detail': {
      const first = items[0] || (rawPayload.snippet ? rawPayload : null);
      if (!first) {
        return { post: null };
      }
      return { post: normalizeYouTubeVideo(first, context) };
    }

    case 'channel':
    case 'profile':
    case 'channel_detail': {
      const first = items[0] || (rawPayload.snippet ? rawPayload : null);
      if (!first) {
        return { profile: null };
      }
      return { profile: normalizeYouTubeChannel(first, context) };
    }

    case 'comments':
    case 'video_comments': {
      if (rawPayload?.commentsDisabled) {
        return {
          comments: [],
          pageInfo: {
            commentsDisabled: true,
            has_next_page: false,
          },
        };
      }
      const comments = items.flatMap((thread) => normalizeYouTubeCommentThread(thread, context));
      return {
        comments,
        pageInfo: {
          total: comments.length,
          nextPageToken,
          has_next_page: Boolean(nextPageToken),
        },
      };
    }

    default:
      return { data: rawPayload };
  }
}
