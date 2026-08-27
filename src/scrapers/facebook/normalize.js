// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * XActions Facebook Scrapers
 * Puppeteer-based scrapers for Facebook (facebook.com)
 *
 * Uses the same Puppeteer stealth approach as Twitter and Threads scrapers.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license BSL 1.1
 */

// by nichxbt

// Facebook scraper — normalize.js
import { FACEBOOK_BASE } from './core.js';


// ============================================================================
// Profile Normalizer (pure — testable without Puppeteer)
// ============================================================================

// ============================================================================
// Handle Normalization (shared — used by scrapeProfile and scrapeTweets)
// ============================================================================

/**
 * Normalize a Facebook handle input to a clean handle string.
 * Accepts: handle, @handle, full facebook.com URL.
 * Preserves profile.php?id=<n> identifiers.
 * @param {string} input
 * @returns {string} Normalized handle
 */
export function normalizeHandle(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('❌ Facebook handle is required (handle, @handle, or facebook.com URL)');
  }
  let handle = input;
  if (handle.startsWith('https://') || handle.startsWith('http://')) {
    handle = handle.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').replace(/\/$/, '');
  }
  handle = handle.replace(/^@/, '');
  if (/^profile\.php\?id=\d+/i.test(handle)) {
    // Preserve only the canonical profile.php?id=<digits>, dropping any &trailing params
    const m = handle.match(/^profile\.php\?id=\d+/i);
    if (m) handle = m[0];
  } else {
    handle = handle.split('/')[0].split('?')[0];
  }
  return handle;
}

// ============================================================================
// Post Normalizer (pure — testable without Puppeteer)
// ============================================================================

/**
 * Normalize a raw post object from page.evaluate into the standard post shape.
 * @param {Record<string, unknown>} raw - Raw post fields from page.evaluate
 * @returns {Record<string, unknown>} Normalized post
 */
export function normalizePost(raw) {
  const { id, text, timestamp, likes, comments, postUrl, images, hasVideo, author } = raw;
  return {
    id: id || null,
    author: author || null,
    text: text || null,
    timestamp: timestamp || null,
    likes: likes || '0',
    comments: comments || '0',
    url: postUrl || null,
    media: {
      images: images || [],
      hasVideo: hasVideo || false,
    },
    platform: 'facebook',
  };
}

/**
 * Normalize raw meta/DOM values into the standard profile shape.
 * @param {Record<string, unknown>} raw - Raw values from page.evaluate
 * @param {string} inputHandle - The handle provided by the caller
 * @returns {Record<string, unknown>} Normalized profile
 */
export function normalizeProfile(raw, inputHandle) {
  const { ogTitle, ogDescription, ogImage, domFollowers, pageUrl } = raw;

  // Parse name from og:title: "Name | Facebook" or "Name (username) | Facebook"
  let name = null;
  if (typeof ogTitle === 'string') {
    name = ogTitle.replace(/\s*[\||\-–—]\s*Facebook.*$/i, '').trim() || null;
  }

  // Parse follower count best-effort.
  // ogDescription is free text → regex-extract the count.
  // domFollowers is already the extracted count (e.g. "1.2M") → use directly.
  let followers = null;
  if (typeof ogDescription === 'string') {
    const match = ogDescription.match(/([\d,.]+[KkMmBb]?)\s*(followers?|people follow)/i);
    if (match) followers = match[1];
  }
  if (!followers && typeof domFollowers === 'string') {
    followers = domFollowers;
  }

  // Parse bio from og:description — strip leading follower count line
  let bio = null;
  if (typeof ogDescription === 'string') {
    bio = ogDescription.replace(/^[\d,.]+[KkMmBb]?\s*(followers?|people follow)[^.]*\.\s*/i, '').trim() || null;
  }

  return {
    name,
    username: inputHandle,
    bio,
    avatar: ogImage || null,
    followers,
    url: pageUrl || `${FACEBOOK_BASE}/${inputHandle}`,
    platform: 'facebook',
  };
}

// ============================================================================
// Comments & Group Content Normalizers (pure — testable without Puppeteer)
// ============================================================================

/**
 * Parse a human-readable like/comment count (e.g. "1.2K", "3M", "1,234") to a number.
 * Returns null for unparseable or empty values.
 * @param {unknown} input
 * @returns {number|null}
 */
function parseEngagementCount(input) {
  if (input == null) return null;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  const str = String(input).trim();
  if (!str) return null;
  const m = str.match(/^([\d,.]+)\s*([KkMmBb])?$/);
  if (!m) return null;
  let value = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(value)) return null;
  const suffix = m[2]?.toUpperCase();
  if (suffix === 'K') value *= 1_000;
  if (suffix === 'M') value *= 1_000_000;
  if (suffix === 'B') value *= 1_000_000_000;
  return Math.floor(value);
}

/**
 * Normalize a raw comment from hydration JSON or DOM.
 * NFR-11: PII is stripped from all text and author fields.
 *
 * @param {Record<string, unknown>} raw
 * @param {string|null} [fallbackParentId] - Parent comment id for nested replies
 * @returns {FacebookComment}
 */
export function normalizeComment(raw, fallbackParentId = null) {
  const {
    id,
    comment_id,
    legacy_fbid,
    text,
    message,
    body,
    renderedText,
    message_text,
    messageText,
    author,
    actor,
    author_name,
    authorName,
    name,
    url,
    authorUrl,
    profileUrl,
    timestamp,
    published_time,
    publishedTime,
    created_time,
    createdTime,
    likes,
    like_count,
    likeCount,
    reaction_count,
    reactionCount,
    reactions,
    replies,
    comment_replies,
    reply_count,
    replyCount,
    childComments,
    parentId,
    parent_comment_id,
    parentCommentId,
    parent_comment,
  } = raw || {};

  const resolvedText =
    text ||
    message ||
    body ||
    renderedText ||
    message_text ||
    messageText ||
    null;

  const authorObj = typeof author === 'object' && author !== null
    ? /** @type {Record<string, unknown>} */ (author)
    : undefined;
  const actorObj = typeof actor === 'object' && actor !== null
    ? /** @type {Record<string, unknown>} */ (actor)
    : undefined;

  const resolvedAuthorName =
    authorName ||
    author_name ||
    (typeof author === 'string' ? author : authorObj?.name) ||
    (typeof actor === 'string' ? actor : actorObj?.name) ||
    name ||
    null;

  const resolvedAuthorUrl =
    authorUrl ||
    url ||
    profileUrl ||
    authorObj?.url ||
    authorObj?.profileUrl ||
    actorObj?.url ||
    actorObj?.profileUrl ||
    null;

  const resolvedTimestamp =
    timestamp ||
    published_time ||
    publishedTime ||
    created_time ||
    createdTime ||
    null;

  const resolvedTextStr = typeof resolvedText === 'string' ? resolvedText : null;

  const resolvedId =
    id ||
    comment_id ||
    legacy_fbid ||
    resolvedAuthorUrl ||
    resolvedTextStr?.slice(0, 60) ||
    null;

  const resolvedLikes =
    likes ??
    like_count ??
    likeCount ??
    reaction_count ??
    reactionCount ??
    (reactions && typeof reactions === 'object'
      ? Object.values(reactions).reduce((sum, v) => sum + (typeof v === 'number' ? v : parseEngagementCount(v) || 0), 0)
      : null) ??
    0;

  const resolvedParentId =
    parentId ??
    parentCommentId ??
    parent_comment_id ??
    (typeof parent_comment === 'object' && parent_comment !== null
      ? /** @type {Record<string, unknown>} */ (parent_comment).id
      : null) ??
    fallbackParentId ??
    null;

  /** @type {FacebookComment} */
  const result = {
    id: typeof resolvedId === 'string' ? resolvedId : null,
    authorName: stripPii(resolvedAuthorName),
    authorUrl: typeof resolvedAuthorUrl === 'string' ? resolvedAuthorUrl : null,
    text: stripPii(resolvedText),
    timestamp: typeof resolvedTimestamp === 'string' ? resolvedTimestamp : null,
    likes: parseEngagementCount(resolvedLikes) ?? 0,
    parentId: typeof resolvedParentId === 'string' ? resolvedParentId : null,
  };

  const rawReplies = replies || comment_replies || childComments;
  if (Array.isArray(rawReplies) && rawReplies.length > 0) {
    const nested = rawReplies
      .map((reply) => normalizeComment(/** @type {Record<string, unknown>} */ (reply), result.id))
      .filter((r) => r && (r.id || r.text));
    if (nested.length > 0) {
      result.replies = nested;
    }
  }

  return result;
}

/**
 * Normalize a raw group post. Reuses the standard post shape.
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeGroupPost(raw) {
  return normalizePost({ ...raw, postUrl: raw?.postUrl || raw?.url });
}

// ============================================================================
// Follower Normalizer (pure — testable without Puppeteer)
// ============================================================================

/**
 * Normalize a raw follower row into the standard follower shape.
 * @param {Record<string, unknown>} raw
 * @returns {FacebookFollower}
 */
export function normalizeFollower(raw) {
  const { name, username, url } = raw;
  return {
    name: typeof name === 'string' && name.trim() ? name : null,
    username: typeof username === 'string' && username.trim() ? username : null,
    url: typeof url === 'string' && url.trim() ? url : null,
    platform: 'facebook',
  };
}

// ============================================================================
// Search Normalizer (pure — testable without Puppeteer)
// ============================================================================

/**
 * Normalize a raw search result into the standard search result shape.
 * @param {Record<string, unknown>} raw
 * @returns {FacebookSearchResult}
 */
export function normalizeSearchResult(raw) {
  const { id, text, author, timestamp, url } = raw;
  return {
    id: typeof id === 'string' && id.trim() ? id : null,
    text: typeof text === 'string' && text.trim() ? text : null,
    author: typeof author === 'string' && author.trim()
      ? author
      : (typeof author === 'object' && author !== null
        ? /** @type {Record<string, unknown>} */ (author)
        : null),
    timestamp: (typeof timestamp === 'string' && timestamp.trim()) || typeof timestamp === 'number' ? timestamp : null,
    url: typeof url === 'string' && url.trim() ? url : null,
    platform: 'facebook',
  };
}

// ============================================================================
// Multi-Type Search Normalizers (pure — testable without Puppeteer)
// ============================================================================

/**
 * @param {unknown} input
 * @returns {string|null}
 */
function extractHandleFromUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  try {
    const u = new URL(input);

    // Numeric profile URLs: facebook.com/profile.php?id=123
    const idMatch = u.search.match(/[?&]id=(\d+)/);
    if (idMatch) return idMatch[1];

    const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0) return null;

    // For pages that use the /pages/<name>/<id> path, the last segment is the id.
    // For groups /groups/<id>, the last segment is the id.
    // For people /people/<name>/<id> or /<username>, the last usable segment is the id/handle.
    return parts.at(-1) || null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {FacebookPostSearchResult}
 */
export function normalizePostSearchResult(raw) {
  const {
    id,
    text,
    message,
    message_text,
    messageText,
    author,
    actor,
    timestamp,
    published_time,
    publishedTime,
    url,
    postUrl,
  } = raw || {};

  const resolvedTextRaw = text || message || message_text || messageText || null;
  const resolvedText = typeof resolvedTextRaw === 'string' ? resolvedTextRaw : null;
  const resolvedUrlRaw = url || postUrl || null;
  const resolvedUrl = typeof resolvedUrlRaw === 'string' ? resolvedUrlRaw : null;
  const resolvedId = id || resolvedUrl || resolvedText?.slice(0, 60) || null;

  const actorObj = typeof actor === 'object' && actor !== null
    ? /** @type {Record<string, unknown>} */ (actor)
    : undefined;

  return {
    id: typeof resolvedId === 'string' ? resolvedId : null,
    text: resolvedText,
    author: /** @type {string | Record<string, unknown> | null} */ (
      (typeof author === 'string' ? author : null) ||
      actorObj?.name ||
      actorObj?.id ||
      null
    ),
    timestamp: typeof (timestamp || published_time || publishedTime) === 'string'
      ? /** @type {string} */ (timestamp || published_time || publishedTime)
      : null,
    url: resolvedUrl,
    platform: 'facebook',
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {FacebookPeopleSearchResult}
 */
export function normalizePeopleSearchResult(raw) {
  const {
    id,
    name,
    username,
    url,
    profileUrl,
    profile_picture,
    image,
  } = raw || {};

  const idStr = typeof id === 'string' ? id : null;
  const resolvedUrlRaw = url || profileUrl || (idStr && /^\d+$/.test(idStr) ? `${FACEBOOK_BASE}/profile.php?id=${idStr}` : null);
  const resolvedUrl = typeof resolvedUrlRaw === 'string' ? resolvedUrlRaw : null;
  const derivedUsername = extractHandleFromUrl(resolvedUrl);
  const rawUsername = typeof username === 'string' ? username : null;
  const resolvedUsername = (
    rawUsername &&
    rawUsername.trim() &&
    !/facebook\.com|[?&#]|^https?:|^\s*$/i.test(rawUsername.trim())
  ) ? rawUsername.trim() : derivedUsername;
  const resolvedId = id || resolvedUsername || resolvedUrl || null;

  return {
    id: typeof resolvedId === 'string' ? resolvedId : null,
    name: typeof name === 'string' ? name : null,
    username: resolvedUsername,
    profileUrl: resolvedUrl,
    image: typeof (profile_picture || image) === 'string'
      ? /** @type {string} */ (profile_picture || image)
      : null,
    platform: 'facebook',
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {FacebookPageSearchResult}
 */
export function normalizePageSearchResult(raw) {
  const {
    id,
    name,
    category,
    category_name,
    categoryName,
    likes,
    fan_count,
    fanCount,
    url,
    pageUrl,
    profile_picture,
    image,
  } = raw || {};

  const idStr = typeof id === 'string' ? id : null;
  const resolvedUrlRaw = url || pageUrl || (idStr && /^\d+$/.test(idStr) ? `${FACEBOOK_BASE}/pages/${idStr}` : null);
  const resolvedUrl = typeof resolvedUrlRaw === 'string' ? resolvedUrlRaw : null;
  const resolvedId = id || resolvedUrl || null;
  const resolvedLikes = likes || fan_count || fanCount || null;

  return {
    id: typeof resolvedId === 'string' ? resolvedId : null,
    name: typeof name === 'string' ? name : null,
    category: typeof (category || category_name || categoryName) === 'string'
      ? /** @type {string} */ (category || category_name || categoryName)
      : null,
    likes: typeof resolvedLikes === 'string' || typeof resolvedLikes === 'number'
      ? resolvedLikes
      : null,
    pageUrl: resolvedUrl,
    image: typeof (profile_picture || image) === 'string'
      ? /** @type {string} */ (profile_picture || image)
      : null,
    platform: 'facebook',
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {FacebookGroupSearchResult}
 */
export function normalizeGroupSearchResult(raw) {
  const {
    id,
    name,
    members,
    member_count,
    memberCount,
    privacy,
    url,
    groupUrl,
    profile_picture,
    image,
  } = raw || {};

  const idStr = typeof id === 'string' ? id : null;
  const resolvedUrlRaw = url || groupUrl || (idStr && /^\d+$/.test(idStr) ? `${FACEBOOK_BASE}/groups/${idStr}` : null);
  const resolvedUrl = typeof resolvedUrlRaw === 'string' ? resolvedUrlRaw : null;
  const resolvedId = id || resolvedUrl || null;
  const resolvedMembers = members || member_count || memberCount || null;

  return {
    id: typeof resolvedId === 'string' ? resolvedId : null,
    name: typeof name === 'string' ? name : null,
    members: typeof resolvedMembers === 'string' || typeof resolvedMembers === 'number'
      ? resolvedMembers
      : null,
    privacy: typeof privacy === 'string' ? privacy : null,
    groupUrl: resolvedUrl,
    image: typeof (profile_picture || image) === 'string'
      ? /** @type {string} */ (profile_picture || image)
      : null,
    platform: 'facebook',
  };
}

// ============================================================================
// Multi-Type Search
// ============================================================================

export const VALID_SEARCH_TYPES = new Set(['posts', 'people', 'pages', 'groups', 'all']);

export const SEARCH_TYPE_URLS = /** @type {Record<string, string>} */ ({
  posts: '/search/posts/',
  people: '/search/people/',
  pages: '/search/pages/',
  groups: '/search/groups/',
});

export const SEARCH_TYPENAMES = /** @type {Record<string, string[]>} */ ({
  posts: ['Story'],
  people: ['User'],
  pages: ['Page'],
  groups: ['Group'],
});

/**
 * @param {Record<string, unknown>} raw
 * @param {string} type
 * @returns {FacebookPostSearchResult | FacebookPeopleSearchResult | FacebookPageSearchResult | FacebookGroupSearchResult | null}
 */
export function normalizeByType(raw, type) {
  switch (type) {
    case 'posts': return /** @type {FacebookPostSearchResult} */ (normalizePostSearchResult(raw));
    case 'people': return /** @type {FacebookPeopleSearchResult} */ (normalizePeopleSearchResult(raw));
    case 'pages': return /** @type {FacebookPageSearchResult} */ (normalizePageSearchResult(raw));
    case 'groups': return /** @type {FacebookGroupSearchResult} */ (normalizeGroupSearchResult(raw));
    default: return null;
  }
}

/**
 * @param {string} type
 * @returns {void}
 */
export function validateSearchType(type) {
  if (!type || !VALID_SEARCH_TYPES.has(type)) {
    throw new Error(`❌ search type must be one of: ${Array.from(VALID_SEARCH_TYPES).join(', ')}`);
  }
}

/**
 * @param {string} query
 * @returns {void}
 */
export function validateSearchQuery(query) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('❌ search query must be a non-empty string');
  }
}

/**
 * @param {number} limit
 * @returns {void}
 */
export function validateSearchLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error('❌ search limit must be a positive integer');
  }
}

/**
 * @param {string} query
 * @param {unknown} location
 * @returns {string}
 */
export function buildSearchQuery(query, location) {
  let q = query.trim();
  if (typeof location === 'string' && location.trim()) {
    q = `${q} near ${location.trim()}`;
  }
  return q;
}

// NFR-11: strip phone numbers and email addresses from any text field.
// Applied at normalizer level — NOT a caller option.
const PII_PHONE_RE = /(\+?\d[\d\s\-().]{7,}\d)/g;
const PII_EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function stripPii(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(PII_PHONE_RE, '').replace(PII_EMAIL_RE, '').trim();
  return cleaned || null;
}

/**
 * Normalize a raw group member row into the standard member shape.
 * NFR-11: phone/email stripped at this layer before returning to caller.
 *
 * @param {FacebookGroupMember} raw
 * @returns {FacebookGroupMember}
 */
export function normalizeGroupMember(raw) {
  const name = stripPii(raw.name);
  const username = typeof raw.username === 'string' ? (stripPii(raw.username) ?? undefined) : undefined;
  const result = {
    name,
    profileUrl: raw.profileUrl,
    platform: /** @type {'facebook'} */ ('facebook'),
    ...(username ? { username } : {}),
  };
  return result;
}

// ============================================================================
// Marketplace Scraper
// ============================================================================

/**
 * Normalize a raw marketplace listing into the standard shape.
 * NFR-11: phone/email stripped at this layer before returning to caller.
 *
 * @param {Record<string, unknown>} raw - Raw listing fields from page.evaluate
 * @returns {FacebookMarketplaceListing}
 */
export function normalizeMarketplaceListing(raw) {
  const { id, title, price, location, image, listingUrl, seller, sellerUrl, category } = raw;
  return {
    id: typeof id === 'string' ? id : null,
    title: typeof title === 'string' ? title : null,
    price: typeof price === 'string' ? price : null,
    location: typeof location === 'string' ? location : null,
    image: typeof image === 'string' ? image : null,
    listingUrl: typeof listingUrl === 'string' ? listingUrl : null,
    seller: stripPii(seller) || null,
    sellerUrl: typeof sellerUrl === 'string' ? sellerUrl : null,
    category: typeof category === 'string' ? category : null,
    platform: 'facebook',
    source: 'marketplace',
  };
}

// Marketplace location helpers — map free-form city names to Facebook Marketplace slugs or numeric IDs.
// Slugs are discovered from https://www.facebook.com/marketplace/directory/{country}/
const MARKETPLACE_KNOWN_LOCATIONS = new Map([
  ['hochiminhcity', 'hochiminhcity'],
  ['hochiminh', 'hochiminhcity'],
  ['hcm', 'hochiminhcity'],
  ['hcmc', 'hochiminhcity'],
  ['saigon', 'hochiminhcity'],
  ['hanoi', '106388046062960'],
  ['danang', '111711568847056'],
]);

/**
 * @param {unknown} input
 * @returns {string|null}
 */
export function resolveMarketplaceLocation(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const trimmed = input.trim();

  // Accept only full facebook.com/marketplace/<slug> URLs and extract the slug.
  if (/^https?:\/\//i.test(trimmed)) {
    const match = trimmed.match(/^https?:\/\/(?:www\.)?facebook\.com\/marketplace\/([a-zA-Z0-9_-]+)(?:\/?|[/?#].*)$/i);
    if (!match) return null;
    return resolveMarketplaceLocation(match[1]);
  }

  const key = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapped = MARKETPLACE_KNOWN_LOCATIONS.get(key);
  if (mapped) return mapped;
  const lower = trimmed.toLowerCase();
  if (/^[a-z0-9]+$/.test(lower)) return lower;
  return null;
}

/**
 * @param {string} query
 * @param {FacebookOptions} [options]
 * @returns {string}
 */
export function buildMarketplaceSearchUrl(query, options = {}) {
  const {
    location,
    category,
    minPrice,
    maxPrice,
    categoryId,
    radius,
    radiusKm,
    latitude,
    lat,
    longitude,
    lng,
    cursor,
    baseUrl,
  } = options;
  const base = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : FACEBOOK_BASE;
  const locationSlug = resolveMarketplaceLocation(location);
  let basePath = `${base}/marketplace`;
  if (locationSlug) {
    basePath += `/${locationSlug}`;
  }
  if (typeof category === 'string' && category.trim()) {
    basePath += `/category/${encodeURIComponent(category.trim())}`;
  }
  const params = [`query=${encodeURIComponent(query.trim())}`];

  const resolvedRadius = typeof radiusKm === 'number' && Number.isFinite(radiusKm)
    ? radiusKm
    : (typeof radius === 'number' && Number.isFinite(radius) ? radius : null);
  const resolvedLat = typeof latitude === 'number' ? latitude : (typeof lat === 'number' ? lat : null);
  const resolvedLng = typeof longitude === 'number' ? longitude : (typeof lng === 'number' ? lng : null);

  if (typeof minPrice === 'number' && Number.isFinite(minPrice)) params.push(`minPrice=${minPrice}`);
  if (typeof maxPrice === 'number' && Number.isFinite(maxPrice)) params.push(`maxPrice=${maxPrice}`);
  if (typeof location === 'string' && !locationSlug) {
    params.push(`location=${encodeURIComponent(location)}`);
  }
  if (typeof categoryId === 'string' && /^\d+$/.test(categoryId)) params.push(`categoryId=${encodeURIComponent(categoryId)}`);
  if (resolvedLat != null) params.push(`lat=${resolvedLat}`);
  if (resolvedLng != null) params.push(`lng=${resolvedLng}`);
  if (resolvedRadius != null) params.push(`radius=${resolvedRadius}`);
  if (typeof cursor === 'string' && cursor.trim()) params.push(`cursor=${encodeURIComponent(cursor.trim())}`);

  return `${basePath}/search/?${params.join('&')}`;
}
