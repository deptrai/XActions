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
 * Coerce a count value to a non-negative integer.
 * @param {unknown} v
 * @returns {number}
 */
function parseCount(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Determine whether a raw value represents a verified account.
 * Only `true` boolean values count; truthy strings (e.g. "false") are ignored.
 * @param {unknown} v
 * @returns {boolean}
 */
function parseVerified(v) {
  return v === true;
}

/**
 * Normalize raw Facebook profile GraphQL payload into ProfileItem.
 * @param {Record<string, any>} raw
 * @param {string} [sourceMethod='graphql']
 * @returns {import('../../../core/types.js').ProfileItem | null}
 */
export function normalizeFacebookProfile(raw = {}, sourceMethod = 'graphql') {
  const user = raw.user || raw;
  const externalId = String(user.id || user.userID || user.username || user.actor_id || '');
  if (!externalId) return null;

  const username = user.username || user.vanity || '';
  const name = user.name || user.title || username || 'Facebook User';
  const bio = user.bio_text?.text || user.bio || user.about || '';
  const avatar = user.profile_picture?.uri || user.profilePicture?.uri || user.profile_pic_url || '';
  const profileUrl = user.profile_url || user.url || (username ? `https://www.facebook.com/${username}` : '');
  const coverPhoto = user.cover_photo?.uri || user.coverPhoto?.photo?.image?.uri || '';

  return {
    id: namespacedProfileId(externalId),
    platform: 'facebook',
    externalId,
    username,
    name,
    bio,
    avatar,
    profileUrl,
    followersCount: parseCount(user.follower_count ?? user.followers_count ?? user.subscriber_count),
    followingCount: parseCount(user.following_count),
    metadata: {
      isProfile: true,
      sourceMethod,
      profilePic: avatar,
      coverPic: coverPhoto,
      bio,
      isVerified: parseVerified(user.is_verified) || parseVerified(user.verified),
      joinDate: safeTimestampToIso(user.join_time),
      location: user.location?.name || user.current_city?.name,
    },
    crawledAt: new Date(),
  };
}

/**
 * Normalize raw Facebook follower edge or node into ProfileItem.
 * @param {Record<string, any>} raw
 * @param {string} [sourceMethod='graphql']
 * @returns {import('../../../core/types.js').ProfileItem | null}
 */
export function normalizeFacebookFollower(raw = {}, sourceMethod = 'graphql') {
  const node = raw.node || raw;
  const externalId = String(node.id || node.userID || node.username || '');
  if (!externalId) return null;

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
    followersCount: parseCount(node.follower_count),
    followingCount: parseCount(node.following_count),
    metadata: {
      isFollower: true,
      sourceMethod,
      profilePic: avatar,
      isVerified: parseVerified(node.is_verified) || parseVerified(node.verified),
      mutualCount: parseCount(node.mutual_friends_count),
    },
    crawledAt: new Date(),
  };
}

/**
 * Normalize raw Facebook group member edge or node into ProfileItem.
 * @param {Record<string, any>} raw
 * @param {string} [groupId]
 * @param {string} [sourceMethod='graphql']
 * @returns {import('../../../core/types.js').ProfileItem | null}
 */
export function normalizeFacebookGroupMember(raw = {}, groupId = '', sourceMethod = 'graphql') {
  const node = raw.node || raw;
  const externalId = String(node.id || node.userID || node.username || '');
  if (!externalId) return null;

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
    followersCount: parseCount(node.follower_count),
    followingCount: parseCount(node.following_count),
    metadata: {
      isGroupMember: true,
      sourceMethod,
      profilePic: avatar,
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
    likesCount: parseCount(profile.followersCount),
    repostsCount: 0,
    repliesCount: parseCount(profile.followingCount),
    viewsCount: 0,
    metadata: {
      isProfile,
      isFollower,
      isGroupMember,
      isFollowing,
      sourceMethod: meta.sourceMethod || 'graphql',
      username: profile.username || undefined,
      profilePic: meta.profilePic || profile.avatar || undefined,
      coverPic: meta.coverPic || undefined,
      bio: profile.bio || meta.bio || undefined,
      location: meta.location,
      joinDate: meta.joinDate,
      followersCount: parseCount(profile.followersCount),
      followingCount: parseCount(profile.followingCount),
      isVerified: meta.isVerified,
      mutualCount: meta.mutualCount,
      groupId: meta.groupId,
      memberType: meta.memberType,
      joinedGroupTime: meta.joinedGroupTime,
    },
    publishedAt: null,
    crawledAt: profile.crawledAt || new Date(),
  };
}
