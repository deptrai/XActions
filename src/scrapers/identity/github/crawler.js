// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * GitHubCrawler — zero-auth public-profile crawler for GitHub.
 *
 * Single action `profile` (queryType `username`): fetches
 * `GET /users/{username}` and normalizes the response into the
 * ProfileItem-friendly shape that `x_social_find_profiles` consumes.
 *
 * Story 41.1 — Epic 41.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { GitHubClient } from './client.js';

/**
 * @param {GitHubClient | Record<string, unknown>} [client]
 * @param {Record<string, unknown>} [options]
 * @returns {GitHubCrawler}
 */
export function createGitHubCrawler(client = {}, options = {}) {
  const resolvedClient = client instanceof GitHubClient ? client : new GitHubClient(client || options || {});
  const resolvedOptions = client instanceof GitHubClient ? options : (options || {});
  return new GitHubCrawler({ client: resolvedClient, ...resolvedOptions });
}

export class GitHubCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'github';

  /** @type {string} */
  platform = 'github';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {GitHubClient} */
  client;

  /**
   * @param {Record<string, any>} [deps={}]
   */
  constructor(deps = {}) {
    const client = deps.client || new GitHubClient(deps);
    super({ ...deps, client, requiresAuth: false });
    this.client = client;

    this.registerAction({
      action: 'profile',
      description: 'Fetch a public GitHub user profile by username',
      category: 'profile',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['handle', 'target'],
      outputType: '{ profile: ProfileItem | null }',
      example: { username: 'nichxbt' },
      handler: (/** @type {Record<string, unknown>} */ args) => this.getProfile(args),
    });
  }

  /**
   * Normalize a raw GitHub `/users/{u}` object into the field names the OSINT
   * `normalizeToProfileItems` mapper reads (username/name/avatar/profileUrl/
   * followers). GitHub uses `login`, `avatar_url`, `html_url`, `followers`.
   * @param {Record<string, any>} u
   * @returns {Record<string, any>}
   */
  #toProfile(u) {
    if (!u || typeof u !== 'object') return null;
    return {
      username: u.login,
      name: u.name || u.login,
      bio: u.bio || undefined,
      avatar: u.avatar_url,
      profileUrl: u.html_url || (u.login ? `https://github.com/${u.login}` : undefined),
      externalId: u.id != null ? String(u.id) : u.login,
      followersCount: typeof u.followers === 'number' ? u.followers : undefined,
      followingCount: typeof u.following === 'number' ? u.following : undefined,
      metadata: {
        company: u.company,
        location: u.location,
        blog: u.blog,
        twitterUsername: u.twitter_username,
        publicRepos: u.public_repos,
        publicGists: u.public_gists,
        createdAt: u.created_at,
        raw: u,
      },
    };
  }

  /**
   * @param {Record<string, unknown>} args
   * @returns {Promise<{ profile: Record<string, any> | null }>}
   */
  async getProfile(args = {}) {
    const username = args.username || args.handle || args.target;
    const raw = await this.client.getUser(username);
    return { profile: this.#toProfile(raw) };
  }

  /** @returns {Promise<void>} */
  async cleanup() {
    const client = /** @type {any} */ (this.client);
    if (client && typeof client.cleanup === 'function') {
      await client.cleanup().catch(() => {});
    }
  }
}

export default GitHubCrawler;
