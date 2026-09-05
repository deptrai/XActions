// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizer & Type Adapter for Mastodon Hybrid Scraper (Story 23.4).
 * Handles target parsing (webfinger/URL/handle), HTML entity decoding to plain text,
 * Link header pagination parsing, and mapping Mastodon REST payloads into standard
 * ProfileItem and PostItem schemas.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { CATEGORIES } from '../../../core/types.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

export const DEFAULT_MASTODON_INSTANCE = 'https://mastodon.social';

/**
 * Normalize instance URL ensuring standard scheme and no trailing slash.
 * @param {string | null | undefined} input
 * @param {string} [fallback=DEFAULT_MASTODON_INSTANCE]
 * @returns {string}
 */
export function normalizeInstanceUrl(input, fallback = DEFAULT_MASTODON_INSTANCE) {
  const raw = String(input || fallback || DEFAULT_MASTODON_INSTANCE).trim();
  if (!raw) return DEFAULT_MASTODON_INSTANCE;

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `Invalid Mastodon instance URL: "${input}"`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'mastodon',
    });
  }
}

/**
 * Extract clean host string from instance URL for namespacing.
 * @param {string} instanceUrl
 * @returns {string}
 */
export function extractInstanceHost(instanceUrl) {
  try {
    const u = new URL(normalizeInstanceUrl(instanceUrl));
    return u.host.toLowerCase();
  } catch {
    return 'mastodon.social';
  }
}

/**
 * Generate namespaced identifier for Mastodon.
 * format: `mastodon:${cleanInstanceHost}:${id}`
 * @param {string} instance
 * @param {string | number} id
 * @returns {string}
 */
export function namespacedMastodonId(instance, id) {
  const host = extractInstanceHost(instance);
  const cleanId = String(id || '').trim();
  return `mastodon:${host}:${cleanId}`;
}

/**
 * Strip HTML tags and decode HTML entities to plain text.
 * @param {string | null | undefined} html
 * @returns {string | null}
 */
export function toPlainText(html) {
  if (!html || typeof html !== 'string') return null;

  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Parse a Mastodon target handle/URL into username and instance.
 * Supports:
 * - Clean username: "Gargron" (uses defaultInstance)
 * - Leading @: "@Gargron" (uses defaultInstance)
 * - WebFinger handle: "@user@mastodon.social" or "user@mastodon.social"
 * - Profile URL: "https://mastodon.social/@Gargron" or "https://mastodon.social/users/Gargron"
 *
 * @param {string} input
 * @param {string} [defaultInstance=DEFAULT_MASTODON_INSTANCE]
 * @returns {{ username: string, instance: string, acct: string }}
 */
export function resolveMastodonTarget(input, defaultInstance = DEFAULT_MASTODON_INSTANCE) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Invalid Mastodon username/target: must be a non-empty string',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'mastodon',
    });
  }

  let clean = input.trim();
  let instance = normalizeInstanceUrl(defaultInstance);

  // Full URL matching (e.g. https://mastodon.social/@username or https://mastodon.social/users/username)
  if (/^https?:\/\//i.test(clean)) {
    try {
      const parsed = new URL(clean);
      instance = `${parsed.protocol}//${parsed.host}`;
      const userMatch = parsed.pathname.match(/\/(?:@|users\/)([^/?#]+)/i);
      if (userMatch) {
        clean = decodeURIComponent(userMatch[1]);
      } else {
        throw new Error('No user path in URL');
      }
    } catch {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid Mastodon profile URL format: "${input}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }
  }

  // Strip leading @
  clean = clean.replace(/^@/, '');

  // WebFinger pattern: user@host
  if (clean.includes('@')) {
    const parts = clean.split('@');
    if (parts.length === 2 && parts[0] && parts[1]) {
      clean = parts[0];
      instance = normalizeInstanceUrl(parts[1]);
    } else {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid Mastodon webfinger format: "${input}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }
  }

  // Validate username characters
  if (!/^[a-zA-Z0-9_.-]+$/.test(clean)) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `Invalid Mastodon username format: "${input}"`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'mastodon',
    });
  }

  const host = extractInstanceHost(instance);
  return {
    username: clean,
    instance,
    acct: `${clean}@${host}`,
  };
}

/**
 * Parse pagination max_id from HTTP Link header.
 * Header format example:
 * `<https://mastodon.social/api/v1/accounts/1/statuses?max_id=10923>; rel="next", <...>; rel="prev"`
 *
 * @param {string | null | undefined} linkHeader
 * @returns {string | null}
 */
export function parseLinkHeader(linkHeader) {
  if (!linkHeader || typeof linkHeader !== 'string') return null;

  const parts = linkHeader.split(',');
  for (const part of parts) {
    const section = part.split(';');
    if (section.length >= 2) {
      const urlMatch = section[0].trim().match(/<([^>]+)>/);
      const relMatch = section[1].trim().match(/rel=["']?next["']?/i);
      if (urlMatch && relMatch) {
        try {
          const parsedUrl = new URL(urlMatch[1]);
          const maxId = parsedUrl.searchParams.get('max_id');
          if (maxId) return maxId;
        } catch {}
      }
    }
  }
  return null;
}

/**
 * Normalize raw Mastodon account object to standard ProfileItem.
 * @param {Record<string, any>} raw
 * @param {string} instance
 * @param {Object} [meta={}]
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeMastodonAccount(raw, instance, meta = {}) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid raw account payload: expected object');
  }

  const cleanInstance = normalizeInstanceUrl(instance);
  const id = String(raw.id || '').trim();
  const username = String(raw.username || raw.acct || '').replace(/^@/, '').trim();
  const acct = String(raw.acct || username);
  const name = String(raw.display_name || raw.name || username || id).trim();
  const bio = toPlainText(raw.note) || '';
  const avatar = raw.avatar ? String(raw.avatar).trim() : undefined;
  const profileUrl = raw.url ? String(raw.url).trim() : `${cleanInstance}/@${username}`;

  const followersCount = typeof raw.followers_count === 'number' ? raw.followers_count : undefined;
  const followingCount = typeof raw.following_count === 'number' ? raw.following_count : undefined;
  const postsCount = typeof raw.statuses_count === 'number' ? raw.statuses_count : undefined;

  /** @type {import('../../../core/types.js').ProfileItem} */
  return {
    id: namespacedMastodonId(cleanInstance, id || username),
    platform: 'mastodon',
    externalId: id || username,
    username,
    name,
    authorName: name,
    bio,
    avatar,
    profileUrl,
    followersCount,
    followingCount,
    metadata: {
      instance: cleanInstance,
      acct,
      postsCount,
      header: raw.header || null,
      bot: Boolean(raw.bot),
      locked: Boolean(raw.locked),
      group: Boolean(raw.group),
      discoverable: Boolean(raw.discoverable),
      joined: raw.created_at || null,
      fields: Array.isArray(raw.fields)
        ? raw.fields.map((f) => ({
            name: String(f.name || ''),
            value: toPlainText(f.value) || '',
            verifiedAt: f.verified_at || null,
          }))
        : [],
      emojis: Array.isArray(raw.emojis) ? raw.emojis : [],
      isProfile: true,
      ...meta,
    },
    crawledAt: new Date(),
  };
}

/**
 * Convert a ProfileItem to PostItem schema for storage / crawler compatibility.
 * @param {import('../../../core/types.js').ProfileItem} profile
 * @returns {import('../../../core/types.js').PostItem}
 */
export function profileItemToPostItem(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Invalid profile item: expected object');
  }

  const id = profile.id;
  const externalId = String(profile.externalId || profile.username || '');
  const authorId = externalId;
  const authorName = String(profile.name || profile.username || 'Mastodon User');
  const authorAvatar = profile.avatar || null;
  const authorUrl = profile.profileUrl;
  const postUrl = authorUrl;
  const content = profile.bio || authorName || 'Mastodon Profile';
  const mediaUrls = profile.avatar ? [profile.avatar] : [];
  const likesCount = typeof profile.followersCount === 'number' ? profile.followersCount : 0;
  const repostsCount = typeof profile.followingCount === 'number' ? profile.followingCount : 0;

  return {
    id,
    platform: 'mastodon',
    externalId,
    category: CATEGORIES.SOCIAL,
    authorId,
    authorName,
    authorAvatar,
    authorUrl,
    postUrl,
    content,
    mediaUrls,
    likesCount,
    repostsCount,
    repliesCount: 0,
    metadata: {
      isProfile: true,
      ...(profile.metadata || {}),
    },
    crawledAt: profile.crawledAt || new Date(),
  };
}

/**
 * Normalize raw Mastodon status object into standard PostItem.
 * @param {Record<string, any>} raw
 * @param {string} instance
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeMastodonStatus(raw, instance) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid status payload: expected object');
  }

  const cleanInstance = normalizeInstanceUrl(instance);
  const statusId = String(raw.id || '').trim();
  const account = (typeof raw.account === 'object' && raw.account !== null) ? raw.account : {};

  const authorId = String(account.id || account.username || 'unknown');
  const authorName = String(account.display_name || account.username || 'Mastodon User');
  const authorAvatar = account.avatar ? String(account.avatar).trim() : null;
  const authorUrl = account.url ? String(account.url).trim() : `${cleanInstance}/@${account.username || authorId}`;
  const postUrl = raw.url ? String(raw.url).trim() : `${cleanInstance}/@${account.username || 'users'}/${statusId}`;

  const plainContent = toPlainText(raw.content) || '';
  const spoilerText = toPlainText(raw.spoiler_text) || '';
  const finalContent = spoilerText ? `[CW: ${spoilerText}] ${plainContent}`.trim() : plainContent;

  /** @type {string[]} */
  const mediaUrls = [];
  if (Array.isArray(raw.media_attachments)) {
    for (const m of raw.media_attachments) {
      if (m?.url) mediaUrls.push(String(m.url));
      else if (m?.preview_url) mediaUrls.push(String(m.preview_url));
    }
  }

  const likesCount = typeof raw.favourites_count === 'number' ? raw.favourites_count : 0;
  const repostsCount = typeof raw.reblogs_count === 'number' ? raw.reblogs_count : 0;
  const repliesCount = typeof raw.replies_count === 'number' ? raw.replies_count : 0;
  const publishedAt = raw.created_at ? new Date(raw.created_at) : null;

  return {
    id: namespacedMastodonId(cleanInstance, statusId),
    platform: 'mastodon',
    externalId: statusId,
    category: CATEGORIES.SOCIAL,
    authorId,
    authorName,
    authorAvatar,
    authorUrl,
    postUrl,
    content: finalContent,
    mediaUrls,
    likesCount,
    repostsCount,
    repliesCount,
    metadata: {
      instance: cleanInstance,
      acct: account.acct || null,
      spoilerText: spoilerText || null,
      sensitive: Boolean(raw.sensitive),
      visibility: raw.visibility || 'public',
      language: raw.language || null,
      isReblog: Boolean(raw.reblog),
      rebloggedStatusId: raw.reblog?.id ? String(raw.reblog.id) : null,
      tags: Array.isArray(raw.tags) ? raw.tags.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean) : [],
      emojis: Array.isArray(raw.emojis) ? raw.emojis : [],
    },
    publishedAt,
    crawledAt: new Date(),
  };
}

/**
 * Normalize trending hashtag item to PostItem.
 * @param {Record<string, any>} rawTag
 * @param {string} instance
 * @param {number} [rank=1]
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeMastodonTag(rawTag, instance, rank = 1) {
  if (!rawTag || typeof rawTag !== 'object') {
    throw new Error('Invalid tag payload: expected object');
  }

  const cleanInstance = normalizeInstanceUrl(instance);
  const name = String(rawTag.name || `tag_${rank}`).trim();
  const externalId = `tag:${name}`;
  const postUrl = rawTag.url ? String(rawTag.url) : `${cleanInstance}/tags/${encodeURIComponent(name)}`;
  const content = `#${name}`;

  // History stats: calculate total uses & accounts across recent days
  let totalUses = 0;
  let totalAccounts = 0;
  if (Array.isArray(rawTag.history)) {
    for (const h of rawTag.history) {
      totalUses += Number(h?.uses || 0);
      totalAccounts += Number(h?.accounts || 0);
    }
  }

  return {
    id: namespacedMastodonId(cleanInstance, externalId),
    platform: 'mastodon',
    externalId,
    category: CATEGORIES.SOCIAL,
    authorId: name,
    authorName: `#${name}`,
    postUrl,
    content,
    mediaUrls: [],
    likesCount: totalUses,
    repostsCount: totalAccounts,
    repliesCount: 0,
    metadata: {
      instance: cleanInstance,
      tagName: name,
      rank,
      totalUses,
      totalAccounts,
      history: Array.isArray(rawTag.history) ? rawTag.history : [],
    },
    crawledAt: new Date(),
  };
}
