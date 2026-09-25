// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFunBrowserBridge — Browser-as-Signer session bridge for pump.fun.
 * Extracts live authentication tokens (Privy JWT, user ID, wallet address, Cloudflare cookies)
 * from an active Chrome browser session via CDP or Chrome MCP.
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

  const jwt = (storage.getItem ? storage.getItem('privy:token') : null)?.replace(/^"|"$/g, '') || null;
  const idToken = (storage.getItem ? storage.getItem('privy:id_token') : null)?.replace(/^"|"$/g, '') || null;
  const decodedJwtStr = storage.getItem ? storage.getItem('decoded-jwt') : null;

  let decoded = null;
  try {
    if (decodedJwtStr) decoded = JSON.parse(decodedJwtStr);
  } catch {
    /* ignore malformed */
  }

  return {
    jwt,
    idToken,
    userId: decoded?.userId || null,
    walletAddress: decoded?.address || null,
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
   * @param {string} accountId
   * @param {ReturnType<typeof extractPumpFunTokensScript>} tokens
   */
  static registerSession(accountId = 'default', tokens) {
    if (!tokens || !tokens.jwt) {
      throw new Error('Invalid pump.fun token bundle: missing JWT (privy:token)');
    }
    const sessionData = {
      accountId: `pumpfun:${accountId}`,
      platform: 'pumpfun',
      jwt: tokens.jwt,
      idToken: tokens.idToken,
      userId: tokens.userId,
      walletAddress: tokens.walletAddress,
      cookies: tokens.cookie,
      userAgent: tokens.userAgent,
      headers: {
        authorization: `Bearer ${tokens.jwt}`,
        cookie: tokens.cookie,
        'user-agent': tokens.userAgent,
      },
      updatedAt: Date.now(),
    };
    globalSessionManager.set(sessionData.accountId, sessionData);
    return sessionData;
  }
}

export default PumpFunBrowserBridge;
