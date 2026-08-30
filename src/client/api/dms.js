// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — DM API
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { Message } from '../models/Message.js';

/** @typedef {import('./parsers.js').Raw} Raw */
/** @typedef {import('./parsers.js').HttpClient} HttpClient */

/**
 * Send a DM in an existing conversation.
 *
 * @deprecated sendDm — use TwitterCrawler.start({ action: 'send_dm', args: { conversationId, text, dryRun: false } }) instead.
 * @param {HttpClient} http
 * @param {string} conversationId
 * @param {string} text
 * @returns {Promise<{id: string, text: string, createdAt: string}>}
 */
export async function sendDm(http, conversationId, text) {
  const body = new URLSearchParams({
    conversation_id: conversationId,
    text,
    cards_platform: 'Web-12',
    include_cards: '1',
    include_quote_count: 'true',
    dm_users: 'false',
  });

  const data = await http.post('https://x.com/i/api/1.1/dm/new2.json', body.toString(), {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  const entries = /** @type {Raw[]} */ (data.entries || []);
  const msg = /** @type {Raw} */ (/** @type {unknown} */ (entries[0]?.message));
  return {
    id: msg?.id?.toString() || '',
    text: /** @type {string} */ (msg?.message_data?.text || text),
    createdAt: msg?.time ? new Date(Number(msg.time)).toISOString() : new Date().toISOString(),
  };
}

/**
 * Send a DM to a user by their ID (creates a new conversation if needed).
 *
 * @deprecated sendDmToUser — use TwitterCrawler.start({ action: 'send_dm', args: { userId, text, dryRun: false } }) instead.
 * @param {HttpClient} http
 * @param {string} userId
 * @param {string} text
 * @returns {Promise<{id: string, text: string, createdAt: string}>}
 */
export async function sendDmToUser(http, userId, text) {
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  // Twitter expects comma-separated IDs in a specific JSON format
  const payload = JSON.stringify({
    conversation_id: `${userId}`,
    recipient_ids: [userId],
    text,
    cards_platform: 'Web-12',
    include_cards: 1,
    include_quote_count: true,
    dm_users: false,
    request_id: requestId,
  });

  const data = await http.post('https://x.com/i/api/1.1/dm/new2.json', payload, {
    'Content-Type': 'application/json',
  });

  const entries = /** @type {Raw[]} */ (data.entries || []);
  const msg = /** @type {Raw} */ (/** @type {unknown} */ (entries[0]?.message));
  return {
    id: msg?.id?.toString() || '',
    text: /** @type {string} */ (msg?.message_data?.text || text),
    createdAt: msg?.time ? new Date(Number(msg.time)).toISOString() : new Date().toISOString(),
  };
}

/**
 * Get DM conversations.
 *
 * @deprecated getDmConversations — use TwitterCrawler.start({ action: 'dm_conversations', args: { limit: count } }) instead.
 * @param {HttpClient} http
 * @param {number} [count=50]
 * @returns {AsyncGenerator<{id: string, type: string, participants: string[], lastMessage: string, updatedAt: string}>}
 */
export async function* getDmConversations(http, count = 50) {
  const params = new URLSearchParams({
    nsfw_filtering_enabled: 'false',
    filter_low_quality: 'false',
    include_quality: 'all',
    dm_secret_conversations_enabled: 'false',
    krs_registration_enabled: 'true',
    cards_platform: 'Web-12',
    include_cards: '1',
    include_ext_alt_text: 'true',
    include_quote_count: 'true',
    include_reply_count: '1',
    tweet_mode: 'extended',
    dm_users: 'true',
    include_groups: 'true',
    include_inbox_timelines: 'true',
    include_ext_media_color: 'true',
    supports_reactions: 'true',
    ext: 'mediaColor,altText,mediaStats,highlightedLabel,voiceInfo',
  });

  const data = await http.get(
    `https://x.com/i/api/1.1/dm/inbox_initial_state.json?${params.toString()}`,
  );

  const inbox = /** @type {Raw|undefined} */ (data.inbox_initial_state);
  const conversations = /** @type {Record<string, Raw>} */ (inbox?.conversations || {});
  let yielded = 0;

  for (const [convId, conv] of Object.entries(conversations)) {
    if (yielded >= count) return;

    const conversation = /** @type {Raw} */ (conv);
    const participants = Object.keys(/** @type {Record<string, boolean>} */ (conversation.participants || {}));
    const lastMsgData = /** @type {Raw} */ (conversation.last_message)?.message_data;
    const lastMsg = /** @type {string} */ (lastMsgData?.text || '');
    const updatedAt = conversation.sort_timestamp
      ? new Date(Number(conversation.sort_timestamp)).toISOString()
      : '';

    yield {
      id: convId,
      type: /** @type {string} */ (conversation.type || 'ONE_TO_ONE'),
      participants,
      lastMessage: lastMsg,
      updatedAt,
    };
    yielded++;
  }
}

/**
 * Get messages in a DM conversation.
 *
 * @deprecated getDmMessages — use TwitterCrawler.start({ action: 'dm_messages', args: { conversationId, limit: count } }) instead.
 * @param {HttpClient} http
 * @param {string} conversationId
 * @param {number} [count=50]
 * @returns {AsyncGenerator<Message>}
 */
export async function* getDmMessages(http, conversationId, count = 50) {
  const params = new URLSearchParams({
    include_profile_interstitial_type: '1',
    include_blocking: '1',
    include_blocked_by: '1',
    include_followed_by: '1',
    include_want_retweets: '1',
    include_mute_edge: '1',
    include_can_dm: '1',
    include_can_media_tag: '1',
    include_ext_has_nft_avatar: '1',
    skip_status: '1',
    cards_platform: 'Web-12',
    include_cards: '1',
    include_ext_alt_text: 'true',
    include_quote_count: 'true',
    include_reply_count: '1',
    tweet_mode: 'extended',
    include_ext_media_color: 'true',
    supports_reactions: 'true',
    count: String(Math.min(count, 50)),
    ext: 'mediaColor,altText,mediaStats,highlightedLabel,voiceInfo',
  });

  const data = await http.get(
    `https://x.com/i/api/1.1/dm/conversation/${conversationId}.json?${params.toString()}`,
  );

  const timeline = /** @type {Raw|undefined} */ (data.conversation_timeline);
  const entries = /** @type {Raw[]} */ (timeline?.entries || []);
  let yielded = 0;

  for (const entry of entries) {
    if (yielded >= count) return;
    const message = /** @type {Raw} */ (/** @type {unknown} */ (entry.message));
    const msgData = /** @type {Raw|undefined} */ (message?.message_data);
    if (!msgData) continue;

    const msg = Message.fromRaw(message, conversationId);
    if (msg) {
      yield msg;
      yielded++;
    }
  }
}
