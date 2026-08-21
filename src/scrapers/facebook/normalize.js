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
    handle = m[0];
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
 * @param {Object} raw - Raw post fields from page.evaluate
 * @returns {Object} Normalized post
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
 * @param {Object} raw - Raw values from page.evaluate
 * @param {string} inputHandle - The handle provided by the caller
 * @returns {Object} Normalized profile
 */
export function normalizeProfile(raw, inputHandle) {
  const { ogTitle, ogDescription, ogImage, domFollowers, pageUrl } = raw;

  // Parse name from og:title: "Name | Facebook" or "Name (username) | Facebook"
  let name = null;
  if (ogTitle) {
    name = ogTitle.replace(/\s*[\||\-–—]\s*Facebook.*$/i, '').trim() || null;
  }

  // Parse follower count best-effort.
  // ogDescription is free text → regex-extract the count.
  // domFollowers is already the extracted count (e.g. "1.2M") → use directly.
  let followers = null;
  if (ogDescription) {
    const match = ogDescription.match(/([\d,.]+[KkMmBb]?)\s*(followers?|people follow)/i);
    if (match) followers = match[1];
  }
  if (!followers && domFollowers) {
    followers = domFollowers;
  }

  // Parse bio from og:description — strip leading follower count line
  let bio = null;
  if (ogDescription) {
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
 * @param {any} input
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
 * @param {Object} raw
 * @param {string|null} [fallbackParentId] - Parent comment id for nested replies
 * @returns {{ id, authorName, authorUrl, text, timestamp, likes, parentId, replies?: Array }}
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

  const resolvedAuthorName =
    authorName ||
    author_name ||
    (typeof author === 'string' ? author : author?.name) ||
    (typeof actor === 'string' ? actor : actor?.name) ||
    name ||
    null;

  const resolvedAuthorUrl =
    authorUrl ||
    url ||
    profileUrl ||
    author?.url ||
    author?.profileUrl ||
    actor?.url ||
    actor?.profileUrl ||
    null;

  const resolvedTimestamp =
    timestamp ||
    published_time ||
    publishedTime ||
    created_time ||
    createdTime ||
    null;

  const resolvedId =
    id ||
    comment_id ||
    legacy_fbid ||
    resolvedAuthorUrl ||
    resolvedText?.slice(0, 60) ||
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
    parent_comment?.id ??
    fallbackParentId ??
    null;

  const result = {
    id: resolvedId,
    authorName: stripPii(resolvedAuthorName),
    authorUrl: resolvedAuthorUrl,
    text: stripPii(resolvedText),
    timestamp: resolvedTimestamp,
    likes: parseEngagementCount(resolvedLikes) ?? 0,
    parentId: resolvedParentId,
  };

  const rawReplies = replies || comment_replies || childComments;
  if (Array.isArray(rawReplies) && rawReplies.length > 0) {
    const nested = rawReplies
      .map((reply) => normalizeComment(reply, result.id))
      .filter((r) => r && (r.id || r.text));
    if (nested.length > 0) {
      result.replies = nested;
    }
  }

  return result;
}

/**
 * Normalize a raw group post. Reuses the standard post shape.
 * @param {Object} raw
 * @returns {Object}
 */
export function normalizeGroupPost(raw) {
  return normalizePost({ ...raw, postUrl: raw?.postUrl || raw?.url });
}

// ============================================================================
// Follower Normalizer (pure — testable without Puppeteer)
// ============================================================================

/**
 * Normalize a raw follower row into the standard follower shape.
 * @param {Object} raw
 * @returns {{ name, username, url, platform }}
 */
export function normalizeFollower(raw) {
  const { name, username, url } = raw;
  return {
    name: name || null,
    username: username || null,
    url: url || null,
    platform: 'facebook',
  };
}

// ============================================================================
// Search Normalizer (pure — testable without Puppeteer)
// ============================================================================

/**
 * Normalize a raw search result into the standard search result shape.
 * @param {Object} raw
 * @returns {{ id, text, author, timestamp, url, platform }}
 */
export function normalizeSearchResult(raw) {
  const { id, text, author, timestamp, url } = raw;
  return {
    id: id || null,
    text: text || null,
    author: author || null,
    timestamp: timestamp || null,
    url: url || null,
    platform: 'facebook',
  };
}

// ============================================================================
// Multi-Type Search Normalizers (pure — testable without Puppeteer)
// ============================================================================

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
    return parts.at(-1);
  } catch {
    return null;
  }
}

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

  const resolvedText = text || message || message_text || messageText || null;
  const resolvedUrl = url || postUrl || null;
  const resolvedId = id || resolvedUrl || resolvedText?.slice(0, 60) || null;

  return {
    id: resolvedId,
    text: resolvedText,
    author: author || actor?.name || actor?.id || null,
    timestamp: timestamp || published_time || publishedTime || null,
    url: resolvedUrl,
    platform: 'facebook',
  };
}

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

  const resolvedUrl = url || profileUrl || (id && /^\d+$/.test(String(id)) ? `${FACEBOOK_BASE}/profile.php?id=${id}` : null);
  const derivedUsername = extractHandleFromUrl(resolvedUrl);
  const resolvedUsername = (
    typeof username === 'string' &&
    username.trim() &&
    !/facebook\.com|[?&#]|^https?:|^\s*$/i.test(username.trim())
  ) ? username.trim() : derivedUsername;
  const resolvedId = id || resolvedUsername || resolvedUrl || null;

  return {
    id: resolvedId,
    name: name || null,
    username: resolvedUsername,
    profileUrl: resolvedUrl,
    image: profile_picture || image || null,
    platform: 'facebook',
  };
}

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

  const resolvedUrl = url || pageUrl || (id && /^\d+$/.test(String(id)) ? `${FACEBOOK_BASE}/pages/${id}` : null);
  const resolvedId = id || resolvedUrl || null;

  return {
    id: resolvedId,
    name: name || null,
    category: category || category_name || categoryName || null,
    likes: likes || fan_count || fanCount || null,
    pageUrl: resolvedUrl,
    image: profile_picture || image || null,
    platform: 'facebook',
  };
}

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

  const resolvedUrl = url || groupUrl || (id && /^\d+$/.test(String(id)) ? `${FACEBOOK_BASE}/groups/${id}` : null);
  const resolvedId = id || resolvedUrl || null;

  return {
    id: resolvedId,
    name: name || null,
    members: members || member_count || memberCount || null,
    privacy: privacy || null,
    groupUrl: resolvedUrl,
    image: profile_picture || image || null,
    platform: 'facebook',
  };
}

// ============================================================================
// Multi-Type Search
// ============================================================================

export const VALID_SEARCH_TYPES = new Set(['posts', 'people', 'pages', 'groups', 'all']);

export const SEARCH_TYPE_URLS = {
  posts: '/search/posts/',
  people: '/search/people/',
  pages: '/search/pages/',
  groups: '/search/groups/',
};

export const SEARCH_TYPENAMES = {
  posts: ['Story'],
  people: ['User'],
  pages: ['Page'],
  groups: ['Group'],
};

export function normalizeByType(raw, type) {
  switch (type) {
    case 'posts': return normalizePostSearchResult(raw);
    case 'people': return normalizePeopleSearchResult(raw);
    case 'pages': return normalizePageSearchResult(raw);
    case 'groups': return normalizeGroupSearchResult(raw);
    default: return null;
  }
}

export function validateSearchType(type) {
  if (!type || !VALID_SEARCH_TYPES.has(type)) {
    throw new Error(`❌ search type must be one of: ${Array.from(VALID_SEARCH_TYPES).join(', ')}`);
  }
}

export function validateSearchQuery(query) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('❌ search query must be a non-empty string');
  }
}

export function validateSearchLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error('❌ search limit must be a positive integer');
  }
}

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

function stripPii(value) {
  if (!value || typeof value !== 'string') return value ?? null;
  const cleaned = value.replace(PII_PHONE_RE, '').replace(PII_EMAIL_RE, '').trim();
  return cleaned || null;
}

/**
 * Normalize a raw group member row into the standard member shape.
 * NFR-11: phone/email stripped at this layer before returning to caller.
 *
 * @param {{ name: string|null, username: string|null, profileUrl: string }} raw
 * @returns {{ name: string|null, username?: string, profileUrl: string, platform: 'facebook' }}
 */
export function normalizeGroupMember(raw) {
  const name = stripPii(raw.name);
  const username = raw.username ? stripPii(raw.username) : undefined;
  const result = { name, profileUrl: raw.profileUrl, platform: 'facebook' };
  if (username !== undefined) result.username = username;
  return result;
}

// ============================================================================
// Marketplace Scraper
// ============================================================================

/**
 * Normalize a raw marketplace listing into the standard shape.
 * NFR-11: phone/email stripped at this layer before returning to caller.
 *
 * @param {Object} raw - Raw listing fields from page.evaluate
 * @returns {Object} Normalized marketplace listing
 */
export function normalizeMarketplaceListing(raw) {
  const { id, title, price, location, image, listingUrl, seller, sellerUrl, category } = raw;
  return {
    id: id || null,
    title: title || null,
    price: price || null,
    location: location || null,
    image: image || null,
    listingUrl: listingUrl || null,
    seller: stripPii(seller) || null,
    sellerUrl: sellerUrl || null,
    category: category || null,
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

export function resolveMarketplaceLocation(input) {
  if (!input || typeof input !== 'string') return null;
  const key = input.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapped = MARKETPLACE_KNOWN_LOCATIONS.get(key);
  if (mapped) return mapped;
  const trimmed = input.trim().toLowerCase();
  if (/^[a-z0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

export function buildMarketplaceSearchUrl(query, options = {}) {
  const { location, category, minPrice, maxPrice } = options;
  const locationSlug = resolveMarketplaceLocation(location);
  let basePath = `${FACEBOOK_BASE}/marketplace`;
  if (locationSlug) {
    basePath += `/${locationSlug}`;
  }
  if (category) {
    basePath += `/category/${encodeURIComponent(category)}`;
  }
  const params = [`query=${encodeURIComponent(query.trim())}`];
  if (minPrice != null) params.push(`minPrice=${minPrice}`);
  if (maxPrice != null) params.push(`maxPrice=${maxPrice}`);
  if (location && !locationSlug) {
    params.push(`location=${encodeURIComponent(location)}`);
  }
  return `${basePath}/search/?${params.join('&')}`;
}
