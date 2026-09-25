// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Reply/comment normalization for pump.fun. Normalizes raw reply records into
 * the shape used for velocity sampling and downstream CommentItem mapping.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { namespacedPumpfunId } from './normalizer.js';

/**
 * Normalize a raw pump.fun reply into a comment record.
 * @param {Record<string, unknown>} raw
 * @param {string} mint
 * @returns {Record<string, unknown>}
 */
export function normalizePumpfunReply(raw, mint) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = r.id || r.replyId || r.commentId || r._id || null;
  const wallet = r.walletAddress || r.wallet || r.userAddress || r.user || r.author || null;
  const text = r.text || r.content || r.body || r.comment || r.message || '';
  const ts = r.timestamp || r.created_at || r.createdAt || r.created_timestamp || null;
  return {
    id: id != null ? namespacedPumpfunId(String(id)) : namespacedPumpfunId(`${mint}:${wallet ?? 'anon'}`),
    platform: 'pumpfun',
    externalId: id != null ? String(id) : null,
    mint,
    walletAddress: wallet,
    authorName: r.userName || r.username || r.authorName || null,
    profileImage: r.profileImage || r.profile_image || null,
    text,
    timestamp: ts,
    likes: Number(r.likes) || 0,
    raw: r,
  };
}

/**
 * Normalize a list of raw replies.
 * @param {Array<Record<string, unknown>>} replies
 * @param {string} mint
 * @returns {Array<Record<string, unknown>>}
 */
export function normalizePumpfunReplies(replies, mint) {
  return (Array.isArray(replies) ? replies : []).map((r) => normalizePumpfunReply(r, mint));
}

export default normalizePumpfunReply;
