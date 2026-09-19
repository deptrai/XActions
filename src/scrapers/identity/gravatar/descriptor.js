// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * Gravatar scrape() descriptor — Story 41.1 (Epic 41).
 * Zero-auth public-profile lookup via the Gravatar v3 Profiles API (email).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { GravatarCrawler } from './crawler.js';
import { GravatarClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const GRAVATAR_ACTION_MAP = {
  profile: 'profile',
  user: 'profile',
};

export default {
  aliases: ['gravatar'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mapped = GRAVATAR_ACTION_MAP[ctx.action];
    if (!mapped) {
      const available = [...new Set(Object.values(GRAVATAR_ACTION_MAP))];
      throw actionNotAvailable(ctx.platform, ctx.action, available);
    }
    return mapped;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  mapArgs(options) {
    /** @type {Record<string, any>} */
    const args = { ...options };
    const email = options.email || options.query || options.q;
    if (email) args.email = String(email).trim().toLowerCase();
    return args;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {GravatarClient}
   */
  createClient(options) {
    return new GravatarClient({
      baseUrl: options.baseUrl,
      timeout: options.timeout,
      userAgent: options.userAgent,
      governor: options.governor,
      responseValidator: options.responseValidator,
    });
  },

  /**
   * @param {{ client: GravatarClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {GravatarCrawler}
   */
  createCrawler({ client, store, options }) {
    return new GravatarCrawler({
      client,
      store,
      governor: options.governor,
    });
  },
};
