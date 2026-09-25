// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizers for pump.fun social data → XActions canonical shapes.
 *
 * Theses come from `mint-positions` position.callout (withThesis=true), NOT a
 * separate replies endpoint. Position fields observed live (2026-09-25):
 *   coinMint, userId, userName, profileImage, walletAddress, isVerified,
 *   accountKind, amountHeld, pnlUsd, pnlPercentage, realizedPnlUsd,
 *   costBasisUsd, callout{calloutId,calledOutAtMcap,multiple,thesis,mediaUrl,
 *   calloutTimestamp,likes,hasLiked,updates[]}
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { globalSchemaDriftGuard } from '../../../core/schema-drift-guard.js';

/**
 * Namespaced external id `pumpfun:{externalId}`.
 * @param {string} externalId
 * @returns {string}
 */
export function namespacedPumpfunId(externalId) {
  return `pumpfun:${externalId}`;
}

/**
 * Normalize a raw position's embedded callout into a thesis record.
 * Returns null when the position carries no thesis text.
 *
 * @param {Record<string, unknown>} position
 * @param {Set<string>} [kolWallets] - set of known KOL wallet addresses.
 * @returns {Record<string, unknown> | null}
 */
export function normalizeThesis(position, kolWallets) {
  const p = position && typeof position === 'object' ? position : {};
  const callout = p.callout && typeof p.callout === 'object' ? p.callout : null;
  const content = callout && typeof callout.thesis === 'string' ? callout.thesis.trim() : '';
  if (!content) return null;

  const wallet = p.walletAddress || p.user || null;
  const isKol = wallet != null && kolWallets instanceof Set ? kolWallets.has(wallet) : false;

  const thesis = {
    user: p.userName || p.username || null,
    wallet,
    content,
    // Prefer a real timestamp; `calledOutAtMcap` is market-cap data, not a time.
    timestamp: callout.calloutTimestamp
      ? Date.parse(callout.calloutTimestamp)
      : (callout.calledOutAt ?? callout.createdAt ?? callout.timestamp
          ? Date.parse(callout.calledOutAt ?? callout.createdAt ?? callout.timestamp)
          : null),
    holdings: Number(p.amountHeld) || 0,
    // Live API exposes USD PnL only — keep `pnlUsd` canonical and leave `pnlSol`
    // unset rather than expose a USD value under a SOL-denominated field name.
    pnlSol: null,
    pnlUsd: p.pnlUsd != null ? Number(p.pnlUsd) : undefined,
    pnlPercentage: p.pnlPercentage != null ? Number(p.pnlPercentage) : undefined,
    likes: Number(callout.likes) || 0,
    mediaUrl: callout.mediaUrl || null,
    isKol,
    isVerified: Boolean(p.isVerified),
  };

  // Normalize thesis metadata drift (field classification, missing keys).
  try {
    if (globalSchemaDriftGuard && typeof globalSchemaDriftGuard.validate === 'function') {
      thesis._drift = globalSchemaDriftGuard.validate('pumpfun', thesis, { schemaType: 'thesis' });
    }
  } catch {
    /* drift guard is advisory only */
  }

  return thesis;
}

/**
 * Normalize a raw position into a top-holder record.
 * @param {Record<string, unknown>} position
 * @param {Set<string>} [kolWallets]
 * @returns {Record<string, unknown>}
 */
export function normalizeHolder(position, kolWallets) {
  const p = position && typeof position === 'object' ? position : {};
  const wallet = p.walletAddress || p.user || null;
  return {
    wallet,
    userName: p.userName || null,
    profileImage: p.profileImage || null,
    balance: Number(p.amountHeld) || 0,
    amountHeld: Number(p.amountHeld) || 0,
    pnlUsd: p.pnlUsd != null ? Number(p.pnlUsd) : undefined,
    pnlPercentage: p.pnlPercentage != null ? Number(p.pnlPercentage) : undefined,
    realizedPnlUsd: p.realizedPnlUsd != null ? Number(p.realizedPnlUsd) : undefined,
    costBasisUsd: p.costBasisUsd != null ? Number(p.costBasisUsd) : undefined,
    isVerified: Boolean(p.isVerified),
    accountKind: p.accountKind || null,
    isKol: wallet != null && kolWallets instanceof Set ? kolWallets.has(wallet) : false,
  };
}

/**
 * Extract theses (callout.thesis non-empty) from a positions list.
 * @param {Array<Record<string, unknown>>} positions
 * @param {Set<string>} [kolWallets]
 * @returns {Array<Record<string, unknown>>}
 */
export function extractTheses(positions, kolWallets) {
  return (Array.isArray(positions) ? positions : [])
    .map((p) => normalizeThesis(p, kolWallets))
    .filter((t) => t !== null);
}

/**
 * Extract top holders from a positions list (already sorted TOP by upstream).
 * @param {Array<Record<string, unknown>>} positions
 * @param {Set<string>} [kolWallets]
 * @returns {Array<Record<string, unknown>>}
 */
export function extractTopHolders(positions, kolWallets) {
  return (Array.isArray(positions) ? positions : []).map((p) => normalizeHolder(p, kolWallets));
}

/**
 * Normalize a raw coin payload from `GET /coins/{mint}` into canonical metadata.
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeCoinMeta(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    mint: c.mint ? String(c.mint) : null,
    name: c.name || null,
    symbol: c.symbol || null,
    description: c.description || '',
    imageUri: c.image_uri || c.imageUri || null,
    metadataUri: c.metadata_uri || c.metadataUri || null,
    socialLinks: {
      twitter: c.twitter || null,
      telegram: c.telegram || null,
      website: c.website || null,
    },
    creator: c.creator ? String(c.creator) : null,
    createdTimestamp: Number(c.created_timestamp) || null,
    bondingCurve: c.bonding_curve || null,
    associatedBondingCurve: c.associated_bonding_curve || null,
    marketCapUsd: c.market_cap_usd != null ? Number(c.market_cap_usd) : (c.market_cap != null ? Number(c.market_cap) : 0),
    marketCapSol: c.market_cap != null ? Number(c.market_cap) : null,
    replyCount: Number(c.reply_count ?? c.replyCount ?? 0) || 0,
    lastTradeTimestamp: Number(c.last_trade_timestamp) || null,
    isCurrentlyLive: Boolean(c.is_currently_live),
    videoUri: c.video_uri || null,
    complete: Boolean(c.complete),
    raydiumPool: c.raydium_pool || c.pump_swap_pool || null,
    athMarketCap: Number(c.ath_market_cap) || null,
  };
}

/**
 * Normalize a coin item from platform feeds (explore, koth, graduating, new, live).
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeFeedItem(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const isLive = c.is_currently_live !== undefined ? Boolean(c.is_currently_live) : (c.viewers !== undefined || c.roomId !== undefined);
  return {
    mint: c.mint ? String(c.mint) : null,
    name: c.name || null,
    symbol: c.symbol || null,
    description: c.description || '',
    imageUri: c.image_uri || c.imageUri || null,
    marketCapUsd: c.market_cap_usd != null ? Number(c.market_cap_usd) : (c.market_cap != null ? Number(c.market_cap) : 0),
    replyCount: Number(c.reply_count ?? c.replyCount ?? 0) || 0,
    creator: c.creator ? String(c.creator) : null,
    createdTimestamp: Number(c.created_timestamp) || null,
    lastTradeTimestamp: Number(c.last_trade_timestamp) || null,
    isCurrentlyLive: isLive,
    viewers: c.viewers != null ? Number(c.viewers) : undefined,
    roomId: c.roomId || undefined,
    complete: Boolean(c.complete),
    bondingCurve: c.bonding_curve || null,
    socialLinks: {
      twitter: c.twitter || null,
      telegram: c.telegram || null,
      website: c.website || null,
    },
  };
}

export default {
  namespacedPumpfunId,
  normalizeThesis,
  normalizeHolder,
  extractTheses,
  extractTopHolders,
  normalizeCoinMeta,
  normalizeFeedItem,
};
