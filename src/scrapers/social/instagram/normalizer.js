// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizer & Type Adapter for the Instagram Scraper.
 * Normalizes Instagram GraphQL / `?__a=1` / embedded-JSON media, profiles,
 * and comments into the universal PostItem / ProfileItem / CommentItem schema.
 * Plain exported functions — mirrors the Medium normalizer (no base class).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generatePostId, generateCommentId } from '../../../core/types.js';

/**
 * Safely cast an unknown value to a record for typed property access.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asRecord(value) {
  return typeof value === 'object' && value !== null
    ? /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (value))
    : {};
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  const record = asRecord(value);
  if (typeof record.count === 'number' && Number.isFinite(record.count)) return record.count;
  return undefined;
}

/**
 * Generate a namespaced Instagram identifier.
 * @param {string | number} externalId
 * @returns {string}
 */
export function namespacedInstagramId(externalId) {
  return `instagram:${String(externalId ?? '').trim()}`;
}

/**
 * Extract the external id from a raw media object.
 * Instagram `pk` is a 64-bit int — as a JS number it loses precision past
 * 2^53, so prefer the string `id`/`code` when `pk` is not a safe integer.
 * @param {Record<string, unknown>} media
 * @returns {string}
 */
export function extractMediaId(media) {
  const record = asRecord(media);
  const pk = record.pk;
  // String pk is exact. Number pk is only safe if it round-trips as a safe integer.
  if (typeof pk === 'string' && pk.trim() !== '') return pk.trim();
  if (typeof pk === 'number' && Number.isSafeInteger(pk)) return String(pk);
  // Prefer the string id; when it is `pk_owner` form (numeric_numeric) keep the leading pk part.
  const id = record.id ?? record.code ?? record.shortcode;
  if (id !== undefined && id !== null && String(id).trim() !== '') {
    const s = String(id).trim();
    const m = s.match(/^(\d+)_\d+$/);
    return m ? m[1] : s;
  }
  // Fall back to pk even if it lost precision — better than empty.
  return pk !== undefined && pk !== null ? String(pk) : '';
}

/**
 * Pull the best-available image URL out of `image_versions2.candidates`.
 * @param {Record<string, unknown>} media
 * @returns {string | undefined}
 */
function bestImageUrl(media) {
  const iv2 = asRecord(media.image_versions2);
  const candidates = Array.isArray(iv2.candidates) ? iv2.candidates : [];
  let best;
  for (const c of candidates) {
    const r = asRecord(c);
    if (typeof r.url === 'string' && r.url) { best = r.url; break; }
  }
  if (!best && typeof media.image_url === 'string') best = media.image_url;
  if (!best && typeof media.thumbnail_url === 'string') best = media.thumbnail_url;
  if (!best && typeof media.display_url === 'string') best = media.display_url;
  // Polaris/Comet timeline nodes carry `display_uri` instead of image_versions2.
  if (!best && typeof media.display_uri === 'string') best = media.display_uri;
  return best;
}

/**
 * Collect all media URLs (image candidates + video versions + carousel children).
 * @param {Record<string, unknown>} media
 * @returns {string[]}
 */
function collectMediaUrls(media) {
  /** @type {string[]} */
  const urls = [];
  const push = (/** @type {unknown} */ u) => { if (typeof u === 'string' && u && !urls.includes(u)) urls.push(u); };

  const iv2 = asRecord(media.image_versions2);
  for (const c of Array.isArray(iv2.candidates) ? iv2.candidates : []) {
    push(asRecord(c).url);
  }
  for (const v of Array.isArray(media.video_versions) ? media.video_versions : []) {
    push(asRecord(v).url);
  }
  // Carousel / sidecar children
  for (const child of Array.isArray(media.carousel_media) ? media.carousel_media : []) {
    const cr = asRecord(child);
    const civ2 = asRecord(cr.image_versions2);
    for (const c of Array.isArray(civ2.candidates) ? civ2.candidates : []) push(asRecord(c).url);
    for (const v of Array.isArray(cr.video_versions) ? cr.video_versions : []) push(asRecord(v).url);
  }
  push(media.display_url);
  push(media.thumbnail_url);
  push(media.display_uri);
  return urls;
}

/**
 * Caption can be a string, an object with `text`, or absent (media without caption).
 * @param {Record<string, unknown>} media
 * @returns {string}
 */
function extractCaption(media) {
  const cap = media.caption;
  if (typeof cap === 'string') return cap;
  const record = asRecord(cap);
  return asString(record.text);
}

/**
 * Normalize a raw Instagram media object into a PostItem.
 * @param {unknown} raw
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeInstagramMedia(raw) {
  const media = asRecord(raw);
  const externalId = extractMediaId(media);
  const user = asRecord(media.user ?? media.owner);
  const code = asString(media.code || media.shortcode);
  const isVideo = media.media_type === 2 || Array.isArray(media.video_versions) && media.video_versions.length > 0 || media.is_video === true;
  const likes = asNumber(media.like_count ?? media.edge_liked_by);
  const replies = asNumber(media.comment_count ?? media.edge_media_to_comment);

  /** @type {import('../../../core/types.js').PostItem} */
  const post = {
    id: namespacedInstagramId(externalId),
    platform: 'instagram',
    externalId,
    category: 'social',
    authorId: asString(user.pk ?? user.id ?? user.username),
    authorName: asString(user.username ?? user.full_name),
    authorAvatar: asString(user.profile_pic_url_hd ?? user.profile_pic_url) || undefined,
    authorUrl: user.username ? `https://www.instagram.com/${asString(user.username)}/` : undefined,
    postUrl: code ? `https://www.instagram.com/p/${code}/` : undefined,
    content: extractCaption(media),
    mediaUrls: collectMediaUrls(media),
    likesCount: likes,
    repliesCount: replies,
    viewsCount: asNumber(media.view_count ?? media.play_count),
    publishedAt: (media.taken_at ?? media.taken_at_ts) ? new Date(Number(media.taken_at ?? media.taken_at_ts) * 1000) : null,
    crawledAt: new Date(),
    metadata: {
      mediaType: media.media_type,
      isVideo,
      shortcode: code || undefined,
      location: asRecord(media.location).name || undefined,
      productType: asString(media.product_type) || undefined,
    },
  };
  return post;
}

/**
 * Normalize a raw Instagram user object into a ProfileItem.
 * @param {unknown} raw
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeInstagramProfile(raw) {
  const user = asRecord(raw);
  const pk = asString(user.pk ?? user.id ?? user.pk_id);
  const edgeFollowedBy = asRecord(user.edge_followed_by);
  const edgeFollow = asRecord(user.edge_follow);

  /** @type {import('../../../core/types.js').ProfileItem} */
  const profile = {
    id: namespacedInstagramId(pk),
    platform: 'instagram',
    externalId: pk,
    username: asString(user.username),
    name: asString(user.full_name),
    authorName: asString(user.full_name || user.username),
    bio: asString(user.biography),
    avatar: asString(user.profile_pic_url_hd ?? user.profile_pic_url) || undefined,
    profileUrl: user.username ? `https://www.instagram.com/${asString(user.username)}/` : undefined,
    followersCount: asNumber(user.follower_count ?? edgeFollowedBy.count),
    followingCount: asNumber(user.following_count ?? edgeFollow.count),
    crawledAt: new Date(),
    metadata: {
      isVerified: user.is_verified === true,
      isPrivate: user.is_private === true,
      mediaCount: asNumber(user.media_count ?? user.all_media_count ?? asRecord(user.edge_owner_to_timeline_media).count ?? asRecord(user.polaris_ordered_timeline_connection).count),
      isBusiness: user.is_business_account === true,
      externalUrl: asString(user.external_url) || undefined,
    },
  };
  return profile;
}

/**
 * Normalize a raw Instagram comment into a CommentItem.
 * @param {unknown} raw
 * @param {string} postExternalId - externalId of the parent media
 * @returns {import('../../../core/types.js').CommentItem}
 */
export function normalizeInstagramComment(raw, postExternalId) {
  const comment = asRecord(raw);
  const cid = asString(comment.pk ?? comment.id);
  const owner = asRecord(comment.user ?? comment.owner);
  const postId = String(postExternalId ?? '').trim();

  /** @type {import('../../../core/types.js').CommentItem} */
  const item = {
    id: `instagram:${postId}:${cid}`,
    platform: 'instagram',
    externalId: cid,
    postId,
    parentCommentId: asString(comment.parent_comment_id) || undefined,
    authorId: asString(owner.pk ?? owner.id ?? owner.username),
    authorName: asString(owner.username ?? owner.full_name),
    authorAvatar: asString(owner.profile_pic_url) || undefined,
    content: asString(comment.text),
    likesCount: asNumber(comment.like_count ?? comment.comment_like_count),
    publishedAt: comment.created_at ? new Date(Number(comment.created_at) * 1000) : null,
    crawledAt: new Date(),
    metadata: {
      type: asString(comment.type) || undefined,
      hasTranslation: comment.has_translation === true,
    },
  };
  return item;
}
