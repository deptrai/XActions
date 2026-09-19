// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * GravatarCrawler — zero-auth public-profile crawler for Gravatar.
 *
 * Single action `profile` (queryType `email`): resolves an email to its public
 * Gravatar profile via `GET /v3/profiles/{sha256(email)}` and normalizes it
 * into the ProfileItem-friendly shape `x_social_find_profiles` consumes.
 *
 * Story 41.1 — Epic 41.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { GravatarClient } from './client.js';

/**
 * @param {GravatarClient | Record<string, unknown>} [client]
 * @param {Record<string, unknown>} [options]
 * @returns {GravatarCrawler}
 */
export function createGravatarCrawler(client = {}, options = {}) {
  const resolvedClient = client instanceof GravatarClient ? client : new GravatarClient(client || options || {});
  const resolvedOptions = client instanceof GravatarClient ? options : (options || {});
  return new GravatarCrawler({ client: resolvedClient, ...resolvedOptions });
}

export class GravatarCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'gravatar';

  /** @type {string} */
  platform = 'gravatar';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {GravatarClient} */
  client;

  /**
   * @param {Record<string, any>} [deps={}]
   */
  constructor(deps = {}) {
    const client = deps.client || new GravatarClient(deps);
    super({ ...deps, client, requiresAuth: false });
    this.client = client;

    this.registerAction({
      action: 'profile',
      description: 'Resolve an email address to its public Gravatar profile',
      category: 'profile',
      requiresAuth: false,
      requiredArgs: ['email'],
      optionalArgs: ['query'],
      outputType: '{ profile: ProfileItem | null }',
      example: { email: 'someone@example.com' },
      handler: (/** @type {Record<string, unknown>} */ args) => this.getProfile(args),
    });
  }

  /**
   * Normalize a Gravatar v3 profile object into the field names the OSINT
   * `normalizeToProfileItems` mapper reads. Gravatar v3 returns
   * `display_name`, `avatar_url`, `profile_url`, `hash`, `location`,
   * `description`, `accounts[]` (verified linked accounts).
   * @param {Record<string, any>} p
   * @returns {Record<string, any> | null}
   */
  #toProfile(p) {
    if (!p || typeof p !== 'object') return null;
    const accounts = Array.isArray(p.accounts) ? p.accounts : [];
    return {
      username: p.display_name || p.hash,
      name: p.display_name || undefined,
      bio: p.description || undefined,
      avatar: p.avatar_url,
      profileUrl: p.profile_url,
      externalId: p.hash != null ? String(p.hash) : (p.display_name || p.profile_url),
      metadata: {
        location: p.location,
        pronouns: p.pronouns,
        verifiedAccounts: accounts.map((a) => ({
          service: a?.service_type || a?.service,
          url: a?.url,
          username: a?.username,
        })).filter((a) => a.url || a.username),
        raw: p,
      },
    };
  }

  /**
   * @param {Record<string, unknown>} args
   * @returns {Promise<{ profile: Record<string, any> | null }>}
   */
  async getProfile(args = {}) {
    const email = args.email || args.query;
    const raw = await this.client.getProfileByEmail(email);
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

export default GravatarCrawler;
