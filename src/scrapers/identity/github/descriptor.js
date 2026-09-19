// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * GitHub scrape() descriptor — Story 41.1 (Epic 41).
 * Zero-auth public-profile lookup via the GitHub REST API.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { GitHubCrawler } from './crawler.js';
import { GitHubClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const GITHUB_ACTION_MAP = {
  profile: 'profile',
  user: 'profile',
};

export default {
  aliases: ['github', 'gh'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mapped = GITHUB_ACTION_MAP[ctx.action];
    if (!mapped) {
      const available = [...new Set(Object.values(GITHUB_ACTION_MAP))];
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
    const uname = options.username || options.handle || options.target || options.login;
    if (uname) args.username = String(uname).trim().replace(/^@/, '');
    return args;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {GitHubClient}
   */
  createClient(options) {
    return new GitHubClient({
      baseUrl: options.baseUrl,
      token: options.token,
      tokenBucket: options.tokenBucket,
      timeout: options.timeout,
      userAgent: options.userAgent,
      governor: options.governor,
      responseValidator: options.responseValidator,
    });
  },

  /**
   * @param {{ client: GitHubClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {GitHubCrawler}
   */
  createCrawler({ client, store, options }) {
    return new GitHubCrawler({
      client,
      store,
      governor: options.governor,
    });
  },
};
