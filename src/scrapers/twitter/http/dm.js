// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter/X Direct Message Operations via HTTP
 *
 * Send messages, read conversations, list inbox, delete messages,
 * and mark conversations as read - all over HTTP without Puppeteer
 * or the official paid API.
 *
 * Every function requires an authenticated {@link TwitterHttpClient}.
 *
 * Depends on: client.js (TwitterHttpClient), endpoints.js, errors.js
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { GRAPHQL, REST, REST_BASE } from './endpoints.js';

/** @typedef {import('./types.js').Raw} Raw */
import {
  AuthError,
  NotFoundError,
  TwitterApiError,
} from './errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max DMs per 24-hour window (shared with other DM actions). */
const DM_DAILY_LIMIT = 1000;

/** Default limit for inbox conversations. */
const DEFAULT_INBOX_LIMIT = 50;

/** Default limit for messages in a conversation. */
const DEFAULT_CONVERSATION_LIMIT = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Assert the client is authenticated; throw AuthError otherwise.
 * @param {import('./client.js').TwitterHttpClient} client
 */
function requireAuth(client) {
  if (!client.isAuthenticated()) {
    throw new AuthError('Authentication required for DM operations');
  }
}

/**
 * Resolve a Twitter username (screen name) to a user ID via GraphQL.
 *
 * @param {import('./client.js').TwitterHttpClient} client
 * @param {string} username - screen name without `@`
 * @returns {Promise<string>} user rest_id
 */
async function resolveUserId(client, username) {
  const { queryId, operationName } = GRAPHQL.UserByScreenName;
  const response = await client.graphql(queryId, operationName, {
    screen_name: username.replace(/^@/, ''),
    withSafetyModeUserFields: true,
  });

  const userId = response?.data?.user?.result?.rest_id;
  if (!userId) {
    throw new NotFoundError(`User @${username} not found`);
  }
  return userId;
}

/**
 * Build the JSON body for the DM send endpoint.
 *
 * @param {string} recipientId
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.mediaId] - media ID for image/video attachment
 * @returns {Raw}
 */
function buildDMBody(recipientId, text, options = {}) {
  /** @type {Record<string, unknown>} */
  const messageData = { text };

  if (options.mediaId) {
    messageData.attachment = {
      type: 'media',
      media: { id: options.mediaId },
    };
  }

  return /** @type {Raw} */ ({
    event: {
      type: 'message_create',
      message_create: {
        target: { recipient_id: String(recipientId) },
        message_data: messageData,
      },
    },
  });
}

/**
 * Parse a single DM event from the API response into a normalized message.
 *
 * @param {Raw} event - raw DM event object
 * @returns {{ id: string, text: string, senderId: string, createdAt: string, media: Raw[]|null, reactions: Array<{ emoji: string, senderId: string }> }}
 */
function parseMessageEvent(event) {
  const msgCreate = /** @type {Raw} */ (event?.message_create ?? {});
  const msgData = /** @type {Raw} */ (msgCreate?.message_data ?? {});

  /** @type {Raw[]} */
  const media = [];
  const attachment = /** @type {Raw} */ (msgData.attachment);
  if (attachment?.media) {
    const mediaObj = /** @type {Raw} */ (/** @type {unknown} */ (attachment.media));
    media.push(/** @type {Raw} */ ({
      type: mediaObj.type || 'photo',
      url: mediaObj.media_url_https || mediaObj.url || '',
    }));
  }

  return {
    id: event.id || '',
    text: msgData.text || '',
    senderId: msgCreate.sender_id || '',
    createdAt: event.created_timestamp
      ? new Date(Number(event.created_timestamp)).toISOString()
      : '',
    media: media.length > 0 ? media : null,
    reactions: [], // Reactions are not exposed in the v1.1 DM events API
  };
}

/**
 * Parse inbox state into normalized conversation list.
 *
 * @param {Raw} inboxState - raw inbox_initial_state object
 * @param {object} [options]
 * @param {number} [options.limit]
 * @returns {{ conversations: object[], cursor: string|null }}
 */
function parseInboxState(inboxState, options = {}) {
  const entries = /** @type {Raw} */ (inboxState?.inbox_initial_state ?? inboxState ?? {});
  const conversations = /** @type {Record<string, Raw>} */ (entries.conversations ?? {});
  const entries_data = /** @type {Raw[]} */ (entries.entries ?? []);
  const users = /** @type {Record<string, Raw>} */ (entries.users ?? {});
  const limit = options.limit || DEFAULT_INBOX_LIMIT;

  const result = [];

  for (const [convId, conv] of Object.entries(conversations)) {
    if (result.length >= limit) break;

    // Participants
    const rawParticipants = /** @type {Raw[]} */ (conv.participants ?? []);
    const participantIds = rawParticipants.map((p) => {
      if (typeof p === 'string') return p;
      return String(p.user_id ?? '');
    });
    const participants = participantIds.map((uid) => {
      const u = /** @type {Raw} */ (users[uid] ?? {});
      return {
        id: String(uid),
        username: u.screen_name || '',
        name: u.name || '',
        avatar: u.profile_image_url_https || '',
      };
    });

    // Last message from the entries matching this conversation
    const convEntries = entries_data.filter(
      (e) => {
        const msg = /** @type {Raw} */ (e.message ?? {});
        return msg.conversation_id === convId || e.conversation_id === convId;
      },
    );
    const lastEntry = /** @type {Raw} */ (convEntries[0] ?? {});
    const lastMsg = /** @type {Raw} */ (lastEntry.message ?? {});
    const lastMsgData = /** @type {Raw} */ (lastMsg.message_data ?? {});

    result.push({
      conversationId: convId,
      participants,
      lastMessage: {
        text: lastMsgData.text || '',
        createdAt: lastMsg.time
          ? new Date(Number(lastMsg.time)).toISOString()
          : '',
        senderId: lastMsgData.sender_id || lastMsg.sender_id || '',
      },
      unreadCount: Number(conv.unread_count ?? 0),
      type: conv.type === 'GROUP_DM' ? 'group' : 'one_to_one',
    });
  }

  const cursor = entries.cursor || null;

  return { conversations: result, cursor };
}

/**
 * Parse a conversation response into normalized message array.
 *
 * @param {Raw} convData - raw conversation data
 * @param {object} [options]
 * @param {number} [options.limit]
 * @returns {{ messages: object[], cursor: string|null }}
 */
function parseConversationData(convData, options = {}) {
  const limit = options.limit || DEFAULT_CONVERSATION_LIMIT;
  const state = /** @type {Raw} */ (convData?.conversation_timeline ?? convData ?? {});
  const entries = /** @type {Raw[]} */ (state?.entries ?? []);
  /** @type {Array<{ id: string, text: string, senderId: string, createdAt: string, media: Raw[]|null, reactions: Array<{ emoji: string, senderId: string }> }>} */
  const messages = [];

  for (const rawEntry of entries) {
    if (messages.length >= limit) break;

    const entry = /** @type {Raw} */ (rawEntry);
    const rawMsg = entry?.message ?? entry;
    const msg = /** @type {Raw} */ (rawMsg);
    if (!msg?.id && !msg?.message_data) continue;

    const msgData = /** @type {Raw} */ (msg.message_data ?? {});
    /** @type {Raw[]} */
    const media = [];
    const attachment = /** @type {Raw} */ (msgData.attachment);
    if (attachment?.media) {
      const mediaObj = /** @type {Raw} */ (/** @type {unknown} */ (attachment.media));
      media.push(/** @type {Raw} */ ({
        type: mediaObj.type || 'photo',
        url: mediaObj.media_url_https || mediaObj.url || '',
      }));
    }

    messages.push({
      id: /** @type {string} */ (msg.id || entry.id || ''),
      text: /** @type {string} */ (msgData.text || msg.text || ''),
      senderId: /** @type {string} */ (msgData.sender_id || msg.sender_id || ''),
      createdAt: msg.time
        ? new Date(Number(msg.time)).toISOString()
        : msg.created_timestamp
          ? new Date(Number(msg.created_timestamp)).toISOString()
          : '',
      media: media.length > 0 ? media : null,
      reactions: parseReactions(/** @type {Raw[]} */ (msg.reactions ?? entry.reactions)),
    });
  }

  const cursor = state.min_entry_id || state.cursor || null;

  return { messages, cursor };
}

/**
 * Parse reaction data from a message.
 *
 * @param {Raw[]} reactions - raw reaction data
 * @returns {Array<{ emoji: string, senderId: string }>}
 */
function parseReactions(reactions) {
  if (!Array.isArray(reactions)) return [];
  return reactions.map((r) => ({
    emoji: /** @type {string} */ (r.key || r.emoji || ''),
    senderId: r.sender_id || '',
  }));
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Send a direct message to a user by their user ID.
 *
 * REST: POST /1.1/direct_messages/events/new.json
 *
 * @deprecated sendDM — use TwitterCrawler.start({ action: 'send_dm', args: { userId: recipientId, text, dryRun: false } }) instead.
 * @param {import('./client.js').TwitterHttpClient} client - authenticated client
 * @param {string} recipientId - recipient user ID
 * @param {string} text - message text
 * @param {object} [options]
 * @param {string} [options.mediaId] - media ID for image/video attachment
 * @returns {Promise<{ messageId: string, createdAt: string }>}
 */
export async function sendDM(client, recipientId, text, options = {}) {
  requireAuth(client);

  if (!recipientId) {
    throw new TwitterApiError('recipientId is required');
  }
  if (!text || typeof text !== 'string') {
    throw new TwitterApiError('DM text must be a non-empty string');
  }

  const body = buildDMBody(recipientId, text, options);
  const url = `${REST_BASE}${REST.dmNew}`;

  const response = await client.request(url, {
    method: 'POST',
    body,
  });

  // Parse the created event
  const event = /** @type {Raw} */ (response?.event ?? {});
  return {
    messageId: event.id || '',
    createdAt: event.created_timestamp
      ? new Date(Number(event.created_timestamp)).toISOString()
      : new Date().toISOString(),
  };
}

/**
 * Send a direct message to a user by their username (screen name).
 * Resolves the username to a user ID first, then sends.
 *
 * @param {import('./client.js').TwitterHttpClient} client - authenticated client
 * @param {string} username - screen name (with or without `@`)
 * @param {string} text - message text
 * @param {object} [options]
 * @param {string} [options.mediaId] - media ID for image/video attachment
 * @returns {Promise<{ messageId: string, createdAt: string }>}
 */
export async function sendDMByUsername(client, username, text, options = {}) {
  requireAuth(client);

  const userId = await resolveUserId(client, username);
  return sendDM(client, userId, text, options);
}

/**
 * Fetch the DM inbox (list of conversations).
 *
 * REST: GET /1.1/dm/inbox_initial_state.json
 *
 * @deprecated getInbox — use TwitterCrawler.start({ action: 'dm_conversations', args: { limit } }) instead.
 * @param {import('./client.js').TwitterHttpClient} client - authenticated client
 * @param {object} [options]
 * @param {number} [options.limit=50] - max conversations to return
 * @param {string} [options.cursor] - pagination cursor
 * @returns {Promise<{ conversations: object[], cursor: string|null }>}
 */
export async function getInbox(client, options = {}) {
  requireAuth(client);

  const params = new URLSearchParams();
  if (options.cursor) {
    params.set('cursor', options.cursor);
  }

  const queryString = params.toString();
  const path = REST.dmInbox + (queryString ? `?${queryString}` : '');
  const url = `${REST_BASE}${path}`;

  const response = await client.request(url, {
    method: 'GET',
  });

  return parseInboxState(response, { limit: options.limit });
}

/**
 * Fetch messages in a specific conversation.
 *
 * REST: GET /1.1/dm/conversation/{conversationId}.json
 *
 * @deprecated getConversation — use TwitterCrawler.start({ action: 'dm_messages', args: { conversationId, limit } }) instead.
 * @param {import('./client.js').TwitterHttpClient} client - authenticated client
 * @param {string} conversationId - conversation ID
 * @param {object} [options]
 * @param {number} [options.limit=100] - max messages to return
 * @param {string} [options.cursor] - pagination cursor (max_id)
 * @returns {Promise<{ messages: object[], cursor: string|null }>}
 */
export async function getConversation(client, conversationId, options = {}) {
  requireAuth(client);

  if (!conversationId) {
    throw new TwitterApiError('conversationId is required');
  }

  const params = new URLSearchParams();
  if (options.cursor) {
    params.set('max_id', options.cursor);
  }

  const queryString = params.toString();
  const path = `${REST.dmConversation}/${conversationId}.json${queryString ? `?${queryString}` : ''}`;
  const url = `${REST_BASE}${path}`;

  const response = await client.request(url, {
    method: 'GET',
  });

  return parseConversationData(response, { limit: options.limit });
}

/**
 * Delete a direct message by its event ID.
 *
 * REST: DELETE /1.1/direct_messages/events/destroy.json?id={messageId}
 *
 * @param {import('./client.js').TwitterHttpClient} client - authenticated client
 * @param {string} messageId - DM event ID
 * @returns {Promise<{ success: boolean }>}
 */
export async function deleteMessage(client, messageId) {
  requireAuth(client);

  if (!messageId) {
    throw new TwitterApiError('messageId is required');
  }

  const url = `${REST_BASE}${REST.dmDestroy}?id=${encodeURIComponent(messageId)}`;

  await client.request(url, {
    method: 'DELETE',
  });

  // Twitter returns 204 No Content on success (parsed as empty)
  return { success: true };
}

/**
 * Mark a conversation as read up to a specific message.
 *
 * REST: POST /1.1/dm/conversation/{conversationId}/mark_read.json
 *
 * @param {import('./client.js').TwitterHttpClient} client - authenticated client
 * @param {string} conversationId - conversation ID
 * @param {string} lastMessageId - ID of the last read message
 * @returns {Promise<{ success: boolean }>}
 */
export async function markRead(client, conversationId, lastMessageId) {
  requireAuth(client);

  if (!conversationId) {
    throw new TwitterApiError('conversationId is required');
  }
  if (!lastMessageId) {
    throw new TwitterApiError('lastMessageId is required');
  }

  const url = `${REST_BASE}${REST.dmMarkRead}/${conversationId}/mark_read.json`;

  await client.request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: `last_read_event_id=${encodeURIComponent(lastMessageId)}`,
  });

  return { success: true };
}
