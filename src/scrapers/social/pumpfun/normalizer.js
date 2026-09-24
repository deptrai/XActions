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
    timestamp: callout.calloutTimestamp ? Date.parse(callout.calloutTimestamp) : (callout.calledOutAtMcap ?? null),
    holdings: Number(p.amountHeld) || 0,
    // Live API exposes USD PnL, not SOL — map to pnlSol slot while keeping the
    // canonical USD fields so consumers see the real upstream values.
    pnlSol: p.pnlUsd != null ? Number(p.pnlUsd) : undefined,
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

export default { namespacedPumpfunId, normalizeThesis, normalizeHolder, extractTheses, extractTopHolders };
