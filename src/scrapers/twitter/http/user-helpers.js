// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter/X GraphQL user object helpers
 *
 * Twitter migrated the user object from a flat `legacy` blob to a modular
 * structure (`core`, `profile_bio`, `relationship_counts`, `avatar`,
 * `website`, `privacy`). These helpers read the new fields while keeping a
 * fallback to `legacy` so older responses keep working.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

/** @typedef {import('./types.js').Raw} Raw */

/**
 * Upgrade the `_normal` avatar suffix to a higher-resolution version.
 *
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
export function upgradeAvatarUrl(url) {
  if (!url) return null;
  return url.replace(/_normal(\.\w+)$/, '_400x400$1');
}

/**
 * Expand t.co URLs in a text block using the entity list provided by Twitter.
 *
 * @param {string} text
 * @param {Raw[]} urlEntities
 * @returns {string}
 */
export function expandTcoUrls(text, urlEntities = []) {
  if (!text || !urlEntities.length) return text || '';
  let expanded = text;
  for (const entity of urlEntities) {
    const shortUrl = typeof entity.url === 'string' ? entity.url : '';
    const longUrl = typeof entity.expanded_url === 'string' ? entity.expanded_url : '';
    if (shortUrl && longUrl) {
      expanded = expanded.replace(shortUrl, longUrl);
    }
  }
  return expanded;
}

/**
 * Parse a `legacy.created_at` / `core.created_at` string into ISO-8601.
 *
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function toISODate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

/**
 * Extract the website / URL field from a user object.
 *
 * Prefers the expanded URL when entities are available, then the `website`
 * object from the new schema, then `legacy.url`.
 *
 * @param {Raw} rawUser
 * @returns {string|null}
 */
export function extractWebsiteUrl(rawUser) {
  const legacy = rawUser?.legacy || {};
  const urlEntities = /** @type {Raw} */ (/** @type {unknown} */ (legacy?.entities?.url))?.urls;
  if (urlEntities && urlEntities.length) {
    const first = urlEntities[0];
    return typeof first.expanded_url === 'string'
      ? first.expanded_url
      : typeof first.url === 'string'
        ? first.url
        : null;
  }

  const website = rawUser?.website;
  if (website && typeof website === 'object') {
    return (
      typeof website.expanded_url === 'string'
        ? website.expanded_url
        : typeof website.url === 'string'
          ? website.url
          : typeof website.display_url === 'string'
            ? website.display_url
            : null
    );
  }

  return typeof legacy.url === 'string' ? legacy.url : null;
}

/**
 * Build bio-entity metadata (URLs, hashtags, mentions) from legacy description
 * entities.
 *
 * @param {Raw} legacy
 * @returns {Raw}
 */
export function extractBioEntities(legacy) {
  const desc = /** @type {Raw} */ (/** @type {unknown} */ (legacy?.entities?.description || {}));
  return /** @type {Raw} */ ({
    urls: /** @type {Raw[]} */ ((desc.urls || []).map((u) => ({
      display: u.display_url,
      expanded: u.expanded_url,
      url: u.url,
      start: u.indices?.[0] ?? null,
      end: u.indices?.[1] ?? null,
    }))),
    hashtags: /** @type {Raw[]} */ ((desc.hashtags || [])
      .filter((h) => typeof h === 'object' && h !== null)
      .map((h) => ({
        text: h.text,
        start: h.indices?.[0] ?? null,
        end: h.indices?.[1] ?? null,
      }))),
    mentions: /** @type {Raw[]} */ ((desc.user_mentions || [])
      .filter((m) => typeof m === 'object' && m !== null)
      .map((m) => ({
        username: m.screen_name,
        start: m.indices?.[0] ?? null,
        end: m.indices?.[1] ?? null,
      }))),
  });
}

/**
 * Extract the plain-text bio from a user object.
 *
 * The new schema puts the bio in `profile_bio.description` (sometimes with
 * entities). The legacy schema put it in `legacy.description`.
 *
 * @param {Raw} rawUser
 * @returns {string|null}
 */
function extractBio(rawUser) {
  const profileBio = rawUser?.profile_bio;
  if (profileBio && typeof profileBio === 'object') {
    const entities = /** @type {Raw[]} */ (/** @type {unknown} */ (profileBio?.entities?.description))?.urls || [];
    const description = typeof profileBio.description === 'string' ? profileBio.description : '';
    return expandTcoUrls(description, entities) || null;
  }

  const legacy = rawUser?.legacy || {};
  const descriptionUrls = /** @type {Raw[]} */ (/** @type {unknown} */ (legacy?.entities?.description))?.urls || [];
  if (typeof legacy.description === 'string' && legacy.description) {
    return expandTcoUrls(legacy.description, descriptionUrls);
  }

  return null;
}

/**
 * Extract the core user fields from any Twitter GraphQL user result.
 *
 * This unifies the new modular schema and the legacy flat schema so callers
 * do not need to know which one the response contains.
 *
 * @param {Raw} rawUser
 * @returns {{
 *   id: string | null,
 *   restId: string | null,
 *   name: string,
 *   username: string,
 *   bio: string | null,
 *   location: string | null,
 *   website: string | null,
 *   joined: string | null,
 *   birthday: string | null,
 *   following: number,
 *   followers: number,
 *   tweets: number,
 *   likes: number,
 *   media: number,
 *   avatar: string | null,
 *   header: string | null,
 *   verified: boolean,
 *   protected: boolean,
 *   pinnedTweetId: string | null,
 *   bioEntities: Raw,
 * }}
 */
export function extractUserCoreFields(rawUser) {
  if (!rawUser || typeof rawUser !== 'object') {
    return {
      id: null,
      restId: null,
      name: '',
      username: '',
      bio: null,
      location: null,
      website: null,
      joined: null,
      birthday: null,
      following: 0,
      followers: 0,
      tweets: 0,
      likes: 0,
      media: 0,
      avatar: null,
      header: null,
      verified: false,
      protected: false,
      pinnedTweetId: null,
      bioEntities: { urls: [], hashtags: [], mentions: [] },
    };
  }

  const legacy = /** @type {Raw} */ (rawUser.legacy || {});
  const core = /** @type {Raw} */ (rawUser.core || {});
  const relationshipCounts = /** @type {Raw} */ (rawUser.relationship_counts || {});
  const avatar = /** @type {Raw} */ (rawUser.avatar || {});
  const privacy = /** @type {Raw} */ (rawUser.privacy || {});

  const name = typeof core.name === 'string' ? core.name : (typeof legacy.name === 'string' ? legacy.name : '');
  const username = typeof core.screen_name === 'string'
    ? core.screen_name
    : (typeof legacy.screen_name === 'string' ? legacy.screen_name : '');

  const bio = extractBio(rawUser);

  const avatarUrl = typeof avatar.image_url === 'string'
    ? avatar.image_url
    : (typeof legacy.profile_image_url_https === 'string' ? legacy.profile_image_url_https : null);

  const headerUrl = typeof rawUser.header_image_url === 'string'
    ? rawUser.header_image_url
    : (typeof legacy.profile_banner_url === 'string' ? legacy.profile_banner_url : null);

  const followers = typeof relationshipCounts.followers_count === 'number'
    ? relationshipCounts.followers_count
    : (typeof legacy.followers_count === 'number' ? legacy.followers_count : 0);

  const following = typeof relationshipCounts.following_count === 'number'
    ? relationshipCounts.following_count
    : (typeof legacy.friends_count === 'number' ? legacy.friends_count : 0);

  const protected_ = typeof privacy.protected === 'boolean'
    ? privacy.protected
    : Boolean(legacy.protected);

  const verified = Boolean(
    rawUser.is_blue_verified ||
    rawUser.verification?.verified ||
    legacy.verified,
  );

  const location = typeof core.location === 'string'
    ? core.location
    : (typeof legacy.location === 'string' ? legacy.location : null);

  const joined = toISODate(
    typeof core.created_at === 'string'
      ? core.created_at
      : (typeof legacy.created_at === 'string' ? legacy.created_at : null),
  );

  const website = extractWebsiteUrl(rawUser);

  const pinnedTweetId = Array.isArray(legacy.pinned_tweet_ids_str)
    ? legacy.pinned_tweet_ids_str[0] || null
    : null;

  const birthday = legacy.birthdate
    ? `${legacy.birthdate.year || ''}${legacy.birthdate.month ? '-' + String(legacy.birthdate.month).padStart(2, '0') : ''}${legacy.birthdate.day ? '-' + String(legacy.birthdate.day).padStart(2, '0') : ''}`.trim() || null
    : null;

  return {
    id: rawUser.rest_id || null,
    restId: rawUser.rest_id || null,
    name,
    username,
    bio,
    location,
    website,
    joined,
    birthday,
    following,
    followers,
    tweets: typeof legacy.statuses_count === 'number' ? legacy.statuses_count : 0,
    likes: typeof legacy.favourites_count === 'number' ? legacy.favourites_count : 0,
    media: typeof legacy.media_count === 'number' ? legacy.media_count : 0,
    avatar: upgradeAvatarUrl(avatarUrl),
    header: headerUrl,
    verified,
    protected: protected_,
    pinnedTweetId,
    bioEntities: extractBioEntities(legacy),
  };
}
