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
 * Normalize a raw Telegram message from relay into standard PostItem shape for TokenMentionPipeline.
 * @param {Record<string, any>} msg
 * @param {string} channelId
 * @returns {Record<string, any>}
 */
export function normalizeTelegramPostItem(msg, channelId) {
  const m = asObj(msg);
  const rawId = m.id != null ? String(m.id) : '';
  const resolvedChannelId = String(channelId || m.channelId || m.channel || 'unknown');
  const externalId = `${resolvedChannelId}:${rawId}`;

  // Date parsing: Telegram timestamps are epoch seconds
  let publishedAt = null;
  let ts = Date.now();
  if (m.date != null) {
    const epochSec = Number(m.date);
    if (Number.isFinite(epochSec) && epochSec > 0) {
      const epochMs = epochSec > 1e11 ? epochSec : epochSec * 1000;
      ts = epochMs;
      publishedAt = new Date(epochMs).toISOString();
    }
  } else if (m.postedAt != null) {
    const epochSec = Number(m.postedAt);
    if (Number.isFinite(epochSec) && epochSec > 0) {
      const epochMs = epochSec > 1e11 ? epochSec : epochSec * 1000;
      ts = epochMs;
      publishedAt = new Date(epochMs).toISOString();
    }
  }

  const text = typeof m.text === 'string' ? m.text : (typeof m.message === 'string' ? m.message : '');
  const authorName = typeof m.postAuthor === 'string' && m.postAuthor.trim()
    ? m.postAuthor.trim()
    : resolvedChannelId;

  return {
    id: externalId,
    externalId,
    platform: 'telegram',
    content: text,
    text,
    channelId: resolvedChannelId,
    author: {
      id: resolvedChannelId,
      username: resolvedChannelId,
      name: authorName,
      followers: null,
      followers_count: null,
    },
    authorName,
    publishedAt,
    ts,
    forwardFrom: m.fwdFrom || null,
    metadata: {
      views: m.views ?? null,
      forwards: m.forwards ?? null,
      groupedId: m.groupedId ?? null,
      channelId: resolvedChannelId,
    },
    engagement: {
      likes: 0,
      views: Number(m.views) || 0,
      retweets: Number(m.forwards) || 0,
      replies: 0,
    },
  };
}

