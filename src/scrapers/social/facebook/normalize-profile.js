// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook Profile & Member Normalizer
 * Standardizes raw Facebook GraphQL user, follower, and group member payloads into ProfileItem & PostItem.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * Generate namespaced profile id.
 * @param {string | number} externalId
 * @returns {string}
 */
export function namespacedProfileId(externalId) {
  const cleanId = String(externalId || '').trim();
  if (cleanId.startsWith('facebook:')) {
    return cleanId;
  }
  return `facebook:${cleanId}`;
}

/**
 * @param {unknown} [val]
 * @returns {string | undefined}
 */
function safeTimestampToIso(val) {
  if (!val) return undefined;
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  const d = new Date(num * 1000);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Normalize raw Facebook profile GraphQL payload into ProfileItem.
 * @param {Record<string, any>} raw
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeFacebookProfile(raw = {}) {
  const user = raw.user || raw;
  const externalId = String(user.id || user.userID || user.username || user.actor_id || 'unknown');
  const username = user.username || user.vanity || '';
  const name = user.name || user.title || username || 'Facebook User';
  const bio = user.bio_text?.text || user.bio || user.about || '';
  const avatar = user.profile_picture?.uri || user.profilePicture?.uri || user.profile_pic_url || '';
  const profileUrl = user.profile_url || user.url || (username ? `https://www.facebook.com/${username}` : '');

  const followersCount = typeof user.follower_count === 'number'
    ? user.follower_count
    : (typeof user.followers_count === 'number' ? user.followers_count : (user.subscriber_count || 0));

  const followingCount = typeof user.following_count === 'number' ? user.following_count : 0;

  return {
    id: namespacedProfileId(externalId),
    platform: 'facebook',
    externalId,
    username,
    name,
    bio,
    avatar,
    profileUrl,
    followersCount,
    followingCount,
    metadata: {
      isProfile: true,
      isVerified: Boolean(user.is_verified || user.verified),
      joinDate: safeTimestampToIso(user.join_time),
      coverPhoto: user.cover_photo?.uri || user.coverPhoto?.photo?.image?.uri,
      location: user.location?.name || user.current_city?.name,
      rawMetadata: user.metadata,
    },
    crawledAt: new Date(),
  };
}

/**
 * Normalize raw Facebook follower edge or node into ProfileItem.
 * @param {Record<string, any>} raw
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeFacebookFollower(raw = {}) {
  const node = raw.node || raw;
  const externalId = String(node.id || node.userID || node.username || 'unknown');
  const username = node.username || '';
  const name = node.name || username || 'Facebook User';
  const avatar = node.profile_picture?.uri || node.profilePicture?.uri || node.profile_pic_url || '';
  const profileUrl = node.profile_url || node.url || (username ? `https://www.facebook.com/${username}` : '');

  return {
    id: namespacedProfileId(externalId),
    platform: 'facebook',
    externalId,
    username,
    name,
    bio: node.bio_text?.text || node.bio || '',
    avatar,
    profileUrl,
    followersCount: node.follower_count || 0,
    followingCount: node.following_count || 0,
    metadata: {
      isFollower: true,
      isVerified: Boolean(node.is_verified || node.verified),
      mutualCount: node.mutual_friends_count || 0,
    },
    crawledAt: new Date(),
  };
}

/**
 * Normalize raw Facebook group member edge or node into ProfileItem.
 * @param {Record<string, any>} raw
 * @param {string} [groupId]
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeFacebookGroupMember(raw = {}, groupId = '') {
  const node = raw.node || raw;
  const externalId = String(node.id || node.userID || node.username || 'unknown');
  const username = node.username || '';
  const name = node.name || username || 'Group Member';
  const avatar = node.profile_picture?.uri || node.profilePicture?.uri || node.profile_pic_url || '';
  const profileUrl = node.profile_url || node.url || (username ? `https://www.facebook.com/${username}` : '');

  return {
    id: namespacedProfileId(externalId),
    platform: 'facebook',
    externalId,
    username,
    name,
    bio: node.bio_text?.text || node.bio || '',
    avatar,
    profileUrl,
    followersCount: node.follower_count || 0,
    followingCount: node.following_count || 0,
    metadata: {
      isGroupMember: true,
      groupId: groupId ? String(groupId) : undefined,
      memberType: node.member_type || node.role || 'MEMBER',
      joinedGroupTime: safeTimestampToIso(node.join_time),
    },
    crawledAt: new Date(),
  };
}

/**
 * Convert ProfileItem into standard PostItem for storage in PrismaStore.
 * (Sets publishedAt: null as per AC-8).
 * @param {import('../../../core/types.js').ProfileItem} profile
 * @returns {import('../../../core/types.js').PostItem}
 */
export function profileItemToPostItem(profile) {
  const meta = /** @type {Record<string, any>} */ (profile.metadata || {});
  const isFollower = Boolean(meta.isFollower);
  const isGroupMember = Boolean(meta.isGroupMember);
  const isFollowing = Boolean(meta.isFollowing);
  const isProfile = Boolean(meta.isProfile ?? (!isFollower && !isGroupMember && !isFollowing));

  return {
    id: profile.id,
    platform: 'facebook',
    externalId: profile.externalId,
    category: 'social',
    authorId: profile.externalId,
    authorName: profile.name || profile.username || 'Facebook User',
    authorAvatar: profile.avatar || undefined,
    authorUrl: profile.profileUrl || undefined,
    postUrl: profile.profileUrl || undefined,
    content: profile.bio || profile.name || '',
    mediaUrls: profile.avatar ? [profile.avatar] : [],
    likesCount: profile.followersCount || 0,
    repostsCount: 0,
    repliesCount: profile.followingCount || 0,
    viewsCount: 0,
    metadata: {
      ...meta,
      isProfile,
      isFollower,
      isGroupMember,
      isFollowing,
      username: profile.username || undefined,
      followersCount: profile.followersCount || 0,
      followingCount: profile.followingCount || 0,
    },
    publishedAt: null,
    crawledAt: profile.crawledAt || new Date(),
  };
}
