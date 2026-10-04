// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFunBrowserBridge — Browser-as-Signer session bridge for pump.fun.
 * Extracts live authentication tokens (auth_token cookie, Privy JWT, user ID, wallet)
 * from an active browser session via CDP or Chrome MCP.
 *
 * Pump.fun auth uses a dual-token system:
 *   - auth_token cookie — long-lived JWT (~30 days) for API auth (Bearer + livechat)
 *   - privy:token (localStorage) — short-lived Privy JWT (~1 hour) for wallet ops
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { globalSessionManager } from '../../../core/session-manager.js';

/**
 * Script executed inside the browser page context to extract pump.fun security tokens.
 * Can be run via Chrome DevTools Protocol (CDP) or evaluated in Chrome extension / MCP.
 * @returns {Record<string, any>}
 */
export function extractPumpFunTokensScript() {
  const win = typeof window !== 'undefined' ? window : {};
  const doc = typeof document !== 'undefined' ? document : {};
  const storage = win.localStorage || {};

  // Parse cookies into map
  const cookieMap = {};
  (doc.cookie || '').split(';').forEach(c => {
    const idx = c.indexOf('=');
    if (idx > 0) cookieMap[c.slice(0, idx).trim()] = decodeURIComponent(c.slice(idx + 1).trim());
  });

  const authToken = cookieMap['auth_token'] || null;
  const privyJwt = (storage.getItem ? storage.getItem('privy:token') : null)?.replace(/^"|"$/g, '') || null;
  const idToken = (storage.getItem ? storage.getItem('privy:id_token') : null)?.replace(/^"|"$/g, '') || null;
  const decodedJwtStr = storage.getItem ? storage.getItem('decoded-jwt') : null;
  const deviceId = cookieMap['pump_device_id'] || null;

  let decoded = null;
  try {
    if (decodedJwtStr) decoded = JSON.parse(decodedJwtStr);
  } catch {
    /* ignore malformed */
  }

  // Decode auth_token payload for userId/walletAddress
  let authPayload = null;
  if (authToken) {
    try {
      const parts = authToken.split('.');
      if (parts.length >= 2) {
        authPayload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      }
    } catch { /* ignore */ }
  }

  return {
    authToken,           // long-lived auth JWT (from auth_token cookie)
    jwt: privyJwt,       // short-lived privy JWT
    idToken,
    userId: authPayload?.userId || decoded?.userId || null,
    walletAddress: authPayload?.address || decoded?.address || null,
    deviceId,
    cookie: doc.cookie || '',
    userAgent: win.navigator?.userAgent || '',
    extractedAt: Date.now(),
  };
}

/**
 * PumpFunBrowserBridge — manages extraction and registration of browser sessions into SessionManager.
 */
export class PumpFunBrowserBridge {
  /**
   * Register extracted tokens into global SessionManager.
   * Accepts either auth_token (long-lived) or privy jwt (short-lived).
   * @param {string} accountId
   * @param {ReturnType<typeof extractPumpFunTokensScript>} tokens
   */
  static registerSession(accountId = 'default', tokens) {
    // Prefer auth_token (30-day expiry) over privy jwt (1-hour expiry)
    const effectiveToken = tokens?.authToken || tokens?.jwt;
    if (!effectiveToken) {
      throw new Error('Invalid pump.fun token bundle: missing auth_token or privy:token');
    }
    const sessionData = {
      accountId: `pumpfun:${accountId}`,
      platform: 'pumpfun',
      jwt: effectiveToken,          // use auth_token as primary JWT
      privyJwt: tokens.jwt || null, // keep privy jwt for reference
      idToken: tokens.idToken,
      userId: tokens.userId,
      walletAddress: tokens.walletAddress,
      deviceId: tokens.deviceId || null,
      cookies: tokens.cookie || '',
      userAgent: tokens.userAgent,
      headers: {
        authorization: `Bearer ${effectiveToken}`,
        cookie: tokens.cookie || '',
        'user-agent': tokens.userAgent,
      },
      updatedAt: Date.now(),
    };
    globalSessionManager.set(
      sessionData.accountId,
      /** @type {import('../../../core/types.js').LoginResult} */ (
        /** @type {unknown} */ (sessionData)
      )
    );
    return sessionData;
  }
}

export default PumpFunBrowserBridge;
