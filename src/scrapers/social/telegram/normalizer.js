// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizers for telegram → XActions canonical shapes (Story 50.8 skeleton).
 * Stubs only — land the real impl when the D4 spec picks a transport. Until
 * then these document the ThinEvent data-payload shape consumers should
 * expect from each action.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * Namespaced external id `telegram:{externalId}`.
 * @param {string} externalId
 * @returns {string}
 */
export function namespacedTelegramId(externalId) {
  return `telegram:${externalId}`;
}

/**
 * @param {unknown} v
 * @returns {Record<string, unknown>}
 */
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {});

/**
 * Normalize one channel message → thin record.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeChannelMessage(raw) {
  const m = asObj(raw);
  return {
    platform: 'telegram',
    category: 'social',
    type: 'channel_message',
    data: {
      channel: typeof m.channel === 'string' ? m.channel : null,
      message_id: m.messageId != null ? String(m.messageId) : null,
      text: typeof m.text === 'string' ? m.text : null,
      posted_at: m.postedAt != null ? Number(m.postedAt) : null,
      views: m.views != null ? Number(m.views) : null,
      forwards: m.forwards != null ? Number(m.forwards) : null,
    },
  };
}

/**
 * Normalize channel metadata → thin record.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeChannelInfo(raw) {
  const c = asObj(raw);
  return {
    platform: 'telegram',
    category: 'social',
    type: 'channel_info',
    data: {
      channel: typeof c.channel === 'string' ? c.channel : null,
      title: typeof c.title === 'string' ? c.title : null,
      member_count: c.memberCount != null ? Number(c.memberCount) : null,
      description: typeof c.description === 'string' ? c.description : null,
      linked_chat_id: c.linkedChatId != null ? String(c.linkedChatId) : null,
    },
  };
}

/**
 * Normalize a search_channels result row.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeChannelSearchResult(raw) {
  const c = asObj(raw);
  return {
    platform: 'telegram',
    category: 'social',
    type: 'channel_search_result',
    data: {
      channel: typeof c.channel === 'string' ? c.channel : null,
      title: typeof c.title === 'string' ? c.title : null,
      member_count: c.memberCount != null ? Number(c.memberCount) : null,
      description: typeof c.description === 'string' ? c.description : null,
    },
  };
}

/**
 * Normalize a resolved user profile.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeTelegramUser(raw) {
  const u = asObj(raw);
  return {
    platform: 'telegram',
    category: 'social',
    type: 'telegram_user',
    data: {
      username: typeof u.username === 'string' ? u.username : null,
      user_id: u.userId != null ? String(u.userId) : null,
      display_name: typeof u.displayName === 'string' ? u.displayName : null,
      bio: typeof u.bio === 'string' ? u.bio : null,
      is_bot: Boolean(u.isBot),
    },
  };
}
