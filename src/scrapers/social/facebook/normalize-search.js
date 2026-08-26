// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { generatePostId } from '../../../core/types.js';
import { namespacedProfileId, profileItemToPostItem } from './normalize-profile.js';

/**
 * Normalize a Facebook search post item from GraphQL / SSR node into PostItem.
 * @param {Record<string, any>} raw
 * @param {string} [query='']
 * @returns {import('../../../core/types.js').PostItem | null}
 */
export function normalizeFacebookSearchPost(raw, query = '') {
  if (!raw || typeof raw !== 'object') return null;
  const node = raw.comet_sections?.content_story?.story ||
               raw.node?.comet_sections?.content_story?.story ||
               raw.node?.story ||
               raw.story ||
               raw.node ||
               raw;
  const rawId = node.post_id || node.id || node.postId || raw.id;
  const postId = rawId ? String(rawId).trim() : '';
  if (!postId) return null;

  const actor = (Array.isArray(node.actors) && node.actors[0] && typeof node.actors[0] === 'object')
    ? node.actors[0]
    : (node.actor && typeof node.actor === 'object' ? node.actor : {});
  const authorId = String(actor.id || actor.profile_id || '');
  const authorName = String(actor.name || actor.text || 'Facebook User');
  const authorAvatar = actor.profile_picture?.uri || actor.avatar || undefined;

  const content = (typeof node.message === 'string' ? node.message : node.message?.text) ||
                  (typeof node.text === 'string' ? node.text : node.text?.text) ||
                  (typeof node.content === 'string' ? node.content : node.content?.text) || '';

  const parseCount = (/** @type {any} */ val) => {
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const feedback = node.feedback || {};
  const likesCount = parseCount(feedback.reaction_count?.count ?? feedback.reaction_count ?? feedback.like_count ?? node.likesCount);
  const repostsCount = parseCount(feedback.share_count?.count ?? feedback.share_count ?? node.repostsCount);
  const repliesCount = parseCount(feedback.comment_count?.total_count ?? feedback.comment_count?.count ?? feedback.comment_count ?? node.repliesCount);
  const viewsCount = parseCount(node.viewsCount);

  const mediaUrls = [];
  if (Array.isArray(node.attachments)) {
    for (const att of node.attachments) {
      if (!att || typeof att !== 'object') continue;
      const media = att.media?.image?.uri || att.media?.uri || att.url;
      if (media && typeof media === 'string') mediaUrls.push(media);
    }
  }

  const rawTime = node.creation_time || node.creationTime || node.published_time;
  let publishedAt = undefined;
  if (rawTime) {
    if (typeof rawTime === 'number' && Number.isFinite(rawTime) && rawTime > 0) {
      publishedAt = new Date(rawTime > 1e11 ? rawTime : rawTime * 1000);
    } else if (typeof rawTime === 'string') {
      const parsedNum = Number(rawTime);
      if (Number.isFinite(parsedNum) && parsedNum > 0) {
        publishedAt = new Date(parsedNum > 1e11 ? parsedNum : parsedNum * 1000);
      } else {
        const d = new Date(rawTime);
        if (!isNaN(d.getTime())) publishedAt = d;
      }
    }
  }

  return {
    id: generatePostId('facebook', postId),
    externalId: postId,
    platform: 'facebook',
    category: 'social',
    authorId,
    authorName,
    authorAvatar,
    content,
    likesCount,
    repostsCount,
    repliesCount,
    viewsCount,
    mediaUrls,
    postUrl: node.url || (authorId ? `https://www.facebook.com/${authorId}/posts/${postId}` : `https://www.facebook.com/${postId}`),
    publishedAt,
    crawledAt: new Date(),
    metadata: {
      isSearchResult: true,
      searchType: 'posts',
      resultType: 'posts',
      query: String(query || ''),
      sourceMethod: raw.sourceMethod || 'graphql',
      ...(node.metadata || {}),
    },
  };
}

/**
 * Normalize Facebook people search result into ProfileItem.
 * @param {Record<string, any>} raw
 * @param {string} [searchType='people']
 * @param {string} [query='']
 * @returns {import('../../../core/types.js').ProfileItem | null}
 */
export function normalizeFacebookSearchProfile(raw, searchType = 'people', query = '') {
  if (!raw || typeof raw !== 'object') return null;
  const node = raw.node || raw;
  const rawId = node.profile_id || node.id || node.userID || node.pk || raw.id;
  const externalId = rawId ? String(rawId).trim() : '';
  if (!externalId) return null;

  const name = typeof node.name === 'string' ? node.name : (node.name?.text || node.title?.text || (typeof node.title === 'string' ? node.title : ''));
  const username = node.username ? String(node.username).trim() : undefined;
  const bio = (typeof node.bio_text === 'string' ? node.bio_text : node.bio_text?.text) ||
              (typeof node.snippet === 'string' ? node.snippet : node.snippet?.text) ||
              node.bio || undefined;
  const avatar = node.profile_picture?.uri || node.profilePicture?.uri || node.avatar || undefined;
  const profileUrl = node.url || (username ? `https://www.facebook.com/${username}` : `https://www.facebook.com/profile.php?id=${externalId}`);

  const followersCount = Number(node.followers_count ?? node.followersCount ?? node.follower_count);

  return {
    id: namespacedProfileId(externalId),
    platform: 'facebook',
    externalId,
    username,
    name: name || username || 'Facebook User',
    bio,
    avatar,
    profileUrl,
    followersCount: Number.isFinite(followersCount) && followersCount >= 0 ? followersCount : undefined,
    metadata: {
      isSearchResult: true,
      searchType,
      resultType: 'people',
      query: String(query || ''),
      sourceMethod: raw.sourceMethod || 'graphql',
      isProfile: true,
      ...(node.metadata || {}),
    },
    crawledAt: new Date(),
  };
}

/**
 * Normalize Facebook page search result into ProfileItem.
 * @param {Record<string, any>} raw
 * @param {string} [query='']
 * @returns {import('../../../core/types.js').ProfileItem | null}
 */
export function normalizeFacebookPageSearchResult(raw, query = '') {
  if (!raw || typeof raw !== 'object') return null;
  const node = raw.node || raw;
  const rawId = node.page_id || node.id || node.pk || raw.id;
  const externalId = rawId ? String(rawId).trim() : '';
  if (!externalId) return null;

  const name = typeof node.name === 'string' ? node.name : (node.name?.text || node.title?.text || (typeof node.title === 'string' ? node.title : ''));
  const avatar = node.profile_picture?.uri || node.profilePicture?.uri || node.avatar || undefined;
  const pageUrl = node.url || `https://www.facebook.com/${externalId}`;
  const category = node.category_name || node.category || undefined;
  const likesCount = Number(node.likes_count ?? node.likesCount ?? node.followers_count);

  return {
    id: namespacedProfileId(externalId),
    platform: 'facebook',
    externalId,
    name: name || 'Facebook Page',
    avatar,
    profileUrl: pageUrl,
    followersCount: Number.isFinite(likesCount) && likesCount >= 0 ? likesCount : undefined,
    metadata: {
      isSearchResult: true,
      searchType: 'pages',
      resultType: 'pages',
      query: String(query || ''),
      isPage: true,
      category,
      pageUrl,
      sourceMethod: raw.sourceMethod || 'graphql',
      ...(node.metadata || {}),
    },
    crawledAt: new Date(),
  };
}

/**
 * Normalize Facebook group search result into ProfileItem.
 * @param {Record<string, any>} raw
 * @param {string} [query='']
 * @returns {import('../../../core/types.js').ProfileItem | null}
 */
export function normalizeFacebookGroupSearchResult(raw, query = '') {
  if (!raw || typeof raw !== 'object') return null;
  const node = raw.node || raw;
  const rawId = node.group_id || node.id || node.pk || raw.id;
  const externalId = rawId ? String(rawId).trim() : '';
  if (!externalId) return null;

  const name = typeof node.name === 'string' ? node.name : (node.name?.text || node.title?.text || (typeof node.title === 'string' ? node.title : ''));
  const avatar = node.profile_picture?.uri || node.profilePicture?.uri || node.avatar || undefined;
  const groupUrl = node.url || `https://www.facebook.com/groups/${externalId}`;
  const privacy = node.privacy_setting || node.privacy || undefined;
  const membersCount = Number(node.members_count ?? node.membersCount ?? node.member_count);

  return {
    id: namespacedProfileId(externalId),
    platform: 'facebook',
    externalId,
    name: name || 'Facebook Group',
    avatar,
    profileUrl: groupUrl,
    metadata: {
      isSearchResult: true,
      searchType: 'groups',
      resultType: 'groups',
      query: String(query || ''),
      isGroup: true,
      privacy,
      membersCount: Number.isFinite(membersCount) && membersCount >= 0 ? membersCount : undefined,
      groupUrl,
      sourceMethod: raw.sourceMethod || 'graphql',
      ...(node.metadata || {}),
    },
    crawledAt: new Date(),
  };
}

/**
 * Convert any search result (PostItem, ProfileItem) to PostItem for storage.
 * @param {any} item
 * @param {string} [searchType='posts']
 * @param {string} [query='']
 * @returns {import('../../../core/types.js').PostItem}
 */
export function searchResultToPostItem(item, searchType = 'posts', query = '') {
  if (!item || typeof item !== 'object') {
    throw new TypeError('searchResultToPostItem requires an object item');
  }

  if (item.category === 'social' && !item.metadata?.isProfile && !item.metadata?.isPage && !item.metadata?.isGroup) {
    return {
      ...item,
      metadata: {
        ...(item.metadata || {}),
        isSearchResult: true,
        searchType,
        resultType: searchType,
        query: String(query || item.metadata?.query || ''),
      },
    };
  }

  const postItem = profileItemToPostItem(item);
  const metadata = /** @type {Record<string, any>} */ ({
    ...(item.metadata || {}),
    ...(postItem.metadata || {}),
    isSearchResult: true,
    searchType,
    resultType: searchType,
    query: String(query || item.metadata?.query || ''),
    sourceMethod: item.metadata?.sourceMethod || 'graphql',
  });

  if (item.metadata?.isPage) {
    metadata.isPage = true;
    metadata.isProfile = false;
  }
  if (item.metadata?.isGroup) {
    metadata.isGroup = true;
    metadata.isProfile = false;
  }

  postItem.metadata = metadata;
  postItem.publishedAt = null;
  return postItem;
}
