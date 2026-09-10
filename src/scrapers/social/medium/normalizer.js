// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizer & Type Adapter for Medium Scraper (Story 35.2).
 * Normalizes Medium RSS items, `?format=json` payloads, and GraphQL results
 * into the universal PostItem schema.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { generatePostId } from '../../../core/types.js';

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
 * Extract a string value that may be stored as a CDATA or plain text node.
 * @param {unknown} value
 * @returns {string}
 */
function extractText(value) {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (typeof record.__cdata === 'string') return record.__cdata;
  if (typeof record['#text'] === 'string') return record['#text'];
  if (typeof record['#cdata-section'] === 'string') return record['#cdata-section'];
  return '';
}

/**
 * Normalize an array or single value into an array of string tags.
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeCategories(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .map((item) => {
      const s = extractText(item);
      return s.trim();
    })
    .filter(Boolean);
}

/**
 * Generate a namespaced Medium identifier.
 * @param {string | number} externalId
 * @returns {string}
 */
export function namespacedMediumId(externalId) {
  return `medium:${String(externalId ?? '').trim()}`;
}

/**
 * Strip Medium tracking parameters (e.g. `?source=rss-...`) from a URL.
 * @param {string} url
 * @returns {string}
 */
export function stripTrackingParams(url) {
  if (typeof url !== 'string' || !url) return '';
  try {
    const parsed = new URL(url);
    const source = parsed.searchParams.get('source');
    if (source && (source.startsWith('rss') || source.startsWith('email') || source.startsWith('twi') || source.startsWith('fb_'))) {
      parsed.searchParams.delete('source');
    }
    parsed.searchParams.delete('sk');
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');
    return parsed.toString();
  } catch {
    return url.replace(/\?(source=[^&]*|.*&source=[^&]*).*$/i, '');
  }
}

/**
 * Extract a 12-character Medium post id from a GUID or URL.
 * @param {string} guidOrUrl
 * @returns {string | null}
 */
export function extractPostId(guidOrUrl) {
  if (typeof guidOrUrl !== 'string' || !guidOrUrl) return null;
  const clean = stripTrackingParams(guidOrUrl).trim();

  const guidMatch = clean.match(/\/p\/([a-f0-9]{12})(?:\?|$|\/|#)/i);
  if (guidMatch) return guidMatch[1].toLowerCase();

  const slugMatch = clean.match(/-([a-f0-9]{12})(?:\?|$|\/|#)/i);
  if (slugMatch) return slugMatch[1].toLowerCase();

  const plainMatch = clean.match(/^([a-f0-9]{12})$/i);
  if (plainMatch) return plainMatch[1].toLowerCase();

  return null;
}

/**
 * Extract the first meaningful image source from an HTML fragment.
 * Skips tracking pixels, data URIs, and Medium stat pixels.
 * @param {string} html
 * @returns {string | null}
 */
export function extractFirstImage(html) {
  if (typeof html !== 'string' || !html) return null;
  const regex = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(regex)) {
    const src = match[1].trim();
    if (src.startsWith('data:image')) continue;
    if (src.includes('medium.com/_/stat')) continue;
    if (/\/(1x1|1x1\.gif|1\.png|pixel|beacon|tracker)/i.test(src)) continue;
    return src;
  }
  return null;
}

/**
 * Extract all image URLs from an HTML fragment.
 * @param {string} html
 * @returns {string[]}
 */
export function extractImages(html) {
  if (typeof html !== 'string' || !html) return [];
  const regex = /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const out = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const src = match[1].trim();
    if (src.startsWith('data:image')) continue;
    if (src.includes('medium.com/_/stat')) continue;
    if (/\/(1x1|1x1\.gif|1\.png|pixel|beacon|tracker)/i.test(src)) continue;
    if (!src) continue;
    out.push(src);
  }
  return out;
}

/**
 * Detect whether an RSS item represents a paywalled/member-only post.
 * @param {string} content
 * @param {string} link
 * @returns {boolean}
 */
export function isPaywalledRss(content, link) {
  if (typeof content !== 'string') return false;
  const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const short = text.length < 200;
  if (short && text.length === 0 && (!link || link.includes('/p/'))) return true;
  if (short && /(Continue reading on Medium|Get unlimited access|member-only|member only|Medium membership)/i.test(text)) {
    return true;
  }
  if (/(Member-only story|only for members|\*\*\*)/i.test(content)) return true;
  return false;
}

/**
 * Build a plain-text snippet from a Medium JSON post's content model.
 * @param {Record<string, unknown>} [content]
 * @returns {string}
 */
function buildJsonContent(content) {
  const record = asRecord(content);
  const subtitle = typeof record.subtitle === 'string' ? record.subtitle.trim() : '';
  const bodyModel = asRecord(record.bodyModel);
  const paragraphs = Array.isArray(bodyModel.paragraphs) ? bodyModel.paragraphs : [];

  const parts = [];
  if (subtitle) parts.push(subtitle);

  for (const p of paragraphs) {
    const pr = asRecord(p);
    const text = typeof pr.text === 'string' ? pr.text.trim() : '';
    if (text) parts.push(text);
  }

  return parts.join('\n\n');
}

/**
 * Find a preview image id from a Medium JSON post.
 * @param {Record<string, unknown>} post
 * @returns {string | null}
 */
function findJsonPreviewImage(post) {
  const virtuals = asRecord(post.virtuals);
  const previewImage = asRecord(virtuals.previewImage);
  if (typeof previewImage.imageId === 'string') {
    return `https://cdn-images-1.medium.com/max/800/${previewImage.imageId}`;
  }
  const content = asRecord(post.content);
  const bodyModel = asRecord(content.bodyModel);
  const paragraphs = Array.isArray(bodyModel.paragraphs) ? bodyModel.paragraphs : [];
  for (const p of paragraphs) {
    const pr = asRecord(p);
    if (pr.name === 'image' || pr.type === 'IMG' || pr.type === 'image') {
      const meta = asRecord(pr.metadata);
      if (typeof meta.imageId === 'string') {
        return `https://cdn-images-1.medium.com/max/800/${meta.imageId}`;
      }
    }
  }
  return null;
}

/**
 * Resolve a creator name from a Medium post object or reference map.
 * @param {Record<string, unknown>} post
 * @param {Record<string, unknown>} references
 * @returns {{ authorName: string, authorId: string }}
 */
function resolveCreator(post, references = {}) {
  const creator = asRecord(post.creator);
  if (typeof creator.name === 'string' && creator.name.trim()) {
    return { authorName: creator.name.trim(), authorId: String(creator.id || creator.name).trim() };
  }

  const creatorId = typeof post.creatorId === 'string' ? post.creatorId.trim() : '';
  if (creatorId && references[creatorId]) {
    const user = asRecord(references[creatorId]);
    const name = typeof user.name === 'string' ? user.name : (typeof user.username === 'string' ? user.username : '');
    if (name) return { authorName: name.trim(), authorId: creatorId };
  }

  if (typeof creator.id === 'string' && creator.id.trim()) {
    return { authorName: creator.id.trim(), authorId: creator.id.trim() };
  }

  return { authorName: 'unknown', authorId: '' };
}

/**
 * Normalize a Medium RSS <item> into a PostItem.
 * @param {Record<string, unknown>} item
 * @param {string} [feedUrl]
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeMediumRssItem(item, feedUrl) {
  const record = asRecord(item);

  const title = extractText(record.title);
  const link = stripTrackingParams(extractText(record.link));
  const guid = extractText(record.guid) || link;
  const postId = extractPostId(guid) || extractPostId(link);
  const externalId = postId || guid || '';

  const rawCreator = extractText(record['dc:creator']);
  const authorName = rawCreator || 'unknown';
  const authorId = rawCreator || '';

  const rawContent = extractText(record['content:encoded']);
  const content = rawContent || (title ? title : '');
  const mediaUrls = extractImages(rawContent);
  const firstImage = extractFirstImage(rawContent);

  const rawPubDate = extractText(record.pubDate) || extractText(record.pubdate);
  const publishedAt = rawPubDate ? new Date(rawPubDate) : null;
  const parsedPublishedAt = publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null;

  const rawAtomUpdated = extractText(record['atom:updated']);

  const categories = normalizeCategories(record.category);

  const isLocked = isPaywalledRss(rawContent, link);

  return {
    id: namespacedMediumId(externalId),
    platform: 'medium',
    externalId,
    title,
    category: 'social',
    authorId,
    authorName,
    authorAvatar: firstImage ? firstImage : null,
    authorUrl: '',
    postUrl: link,
    content,
    mediaUrls,
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt: parsedPublishedAt,
    crawledAt: new Date(),
    metadata: {
      tags: categories,
      primaryTag: categories[0] || null,
      guid,
      creator: rawCreator,
      atomUpdated: rawAtomUpdated,
      feedUrl: feedUrl || null,
      isLocked,
    },
  };
}

/**
 * Normalize a Medium `?format=json` post object into a PostItem.
 * @param {Record<string, unknown>} raw
 * @param {Record<string, unknown>} [references]
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeMediumJsonPost(raw, references = {}) {
  const post = asRecord(raw);

  const postId = typeof post.id === 'string' ? post.id.trim() : '';
  const externalId = postId || '';

  const title = typeof post.title === 'string' ? post.title.trim() : '';

  const { authorName, authorId } = resolveCreator(post, references);

  const rawUrl = post.mediumUrl || post.canonicalUrl || post.url || '';
  const postUrl = stripTrackingParams(typeof rawUrl === 'string' ? rawUrl : '');

  const content = buildJsonContent(asRecord(post.content));
  const mediaUrls = [];
  const previewImage = findJsonPreviewImage(post);
  if (previewImage) mediaUrls.push(previewImage);

  const virtuals = asRecord(post.virtuals);
  const likesCount = typeof virtuals.totalClapCount === 'number' ? virtuals.totalClapCount : 0;
  const repliesCount = typeof virtuals.responsesCreatedCount === 'number' ? virtuals.responsesCreatedCount : 0;
  const viewsCount = typeof virtuals.reads === 'number' ? virtuals.reads : 0;
  const tags = Array.isArray(virtuals.tags)
    ? virtuals.tags.map((t) => (typeof t === 'string' ? t : String(asRecord(t).name || asRecord(t).slug || '')).trim()).filter(Boolean)
    : [];

  const rawFirst = post.firstPublishedAt;
  const rawLatest = post.latestPublishedAt;
  const timestamp = typeof rawFirst === 'number' ? rawFirst : (typeof rawLatest === 'number' ? rawLatest : 0);
  const publishedAt = timestamp ? new Date(timestamp) : null;
  const parsedPublishedAt = publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null;

  const isLocked = Boolean(post.isSubscriptionLocked) || post.visibility === 2 || String(post.visibility) === '2';

  const wordCount = typeof post.wordCount === 'number' ? post.wordCount : null;
  const readingTime = typeof virtuals.readingTime === 'number' ? virtuals.readingTime : null;

  return {
    id: namespacedMediumId(externalId),
    platform: 'medium',
    externalId,
    title,
    category: 'social',
    authorId,
    authorName,
    authorAvatar: mediaUrls[0] || null,
    authorUrl: '',
    postUrl,
    content: content || title,
    mediaUrls,
    likesCount,
    repostsCount: 0,
    repliesCount,
    viewsCount,
    publishedAt: parsedPublishedAt,
    crawledAt: new Date(),
    metadata: {
      wordCount,
      readingTime,
      isSubscriptionLocked: Boolean(post.isSubscriptionLocked),
      visibility: post.visibility,
      tags,
    },
  };
}

/**
 * Normalize a GraphQL `postResult` object into a PostItem.
 * @param {Record<string, unknown>} raw
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeMediumGraphqlPost(raw) {
  const post = asRecord(raw);
  const postId = typeof post.id === 'string' ? post.id.trim() : '';
  const externalId = postId;

  const title = typeof post.title === 'string' ? post.title.trim() : '';

  const creator = asRecord(post.creator);
  const authorName = typeof creator.name === 'string' ? creator.name.trim() : 'unknown';
  const authorId = typeof creator.id === 'string' ? creator.id.trim() : '';

  const rawUrl = post.mediumUrl || post.canonicalUrl || post.url || '';
  const postUrl = stripTrackingParams(typeof rawUrl === 'string' ? rawUrl : '');

  const firstTs = typeof post.firstPublishedAt === 'number' ? post.firstPublishedAt : 0;
  const latestTs = typeof post.latestPublishedAt === 'number' ? post.latestPublishedAt : 0;
  const timestamp = firstTs || latestTs;
  const publishedAt = timestamp ? new Date(timestamp) : null;
  const parsedPublishedAt = publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null;

  const content = typeof post.previewContent === 'string' ? post.previewContent.trim() : title;
  const isLocked = Boolean(post.isLocked) || post.visibility === 'LOCKED';

  return {
    id: namespacedMediumId(externalId),
    platform: 'medium',
    externalId,
    title,
    category: 'social',
    authorId,
    authorName,
    authorAvatar: null,
    authorUrl: '',
    postUrl,
    content,
    mediaUrls: [],
    likesCount: typeof post.clapCount === 'number' ? post.clapCount : 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt: parsedPublishedAt,
    crawledAt: new Date(),
    metadata: {
      isLocked,
      visibility: post.visibility,
      source: 'graphql',
    },
  };
}
