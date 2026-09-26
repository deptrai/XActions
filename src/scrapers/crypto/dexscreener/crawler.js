// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * DexscreenerCrawler — crypto crawler for dexscreener.com public REST.
 * Extends AbstractCrawler; registers 5 read-only actions covering token
 * socials, legitimacy signals, pair lookup, and latest boosts/profiles.
 * Keyless upstream — no auth, no headless browser, no websocket.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { DexscreenerClient } from './client.js';
import {
  normalizeTokenSocials,
  normalizeTokenLegitimacy,
  normalizeTokenLookup,
  normalizeBoostedToken,
  normalizeTokenProfile,
} from './normalizer.js';
import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

/**
 * @param {DexscreenerClient | Record<string, unknown>} [client]
 * @param {Record<string, unknown>} [options]
 * @returns {DexscreenerCrawler}
 */
export function createDexscreenerCrawler(client = {}, options = {}) {
  const resolvedClient = client instanceof DexscreenerClient ? client : new DexscreenerClient(client || options || {});
  const resolvedOptions = client instanceof DexscreenerClient ? options : (options || {});
  return new DexscreenerCrawler({ client: resolvedClient, ...resolvedOptions });
}

export class DexscreenerCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'dexscreener';

  /** @type {string} */
  platform = 'dexscreener';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {DexscreenerClient} */
  client;

  constructor(deps = {}) {
    const { client: explicitClient, ...rest } = deps;
    const client = explicitClient instanceof DexscreenerClient
      ? explicitClient
      : new DexscreenerClient({ ...rest, transport: deps.transport });
    super({ ...deps, client });

    this.category = 'crypto';
    this.client = client;
    this.proxyPool = deps.proxyPool || deps.client?.proxyPool || null;

    // ── Action: token_socials ────────────────────────────────────────────
    this.registerAction({
      action: 'token_socials',
      description: 'Fetch dexscreener token social links + websites for a chain/address pair',
      category: 'crypto',
      requiresAuth: false,
      requiredArgs: ['chainId', 'tokenAddress'],
      optionalArgs: ['chain', 'token', 'address', 'mint'],
      outputType: '{ platform, category, type, data: { chain_id, token_address, name, symbol, description, image, url, socials[], websites[] } }',
      example: { chainId: 'solana', tokenAddress: '5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump' },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) =>
        this.fetchTokenSocials(args, session),
    });

    // ── Action: token_legitimacy ─────────────────────────────────────────
    this.registerAction({
      action: 'token_legitimacy',
      description: 'Fetch dexscreener dev-paid orders + boost status for a chain/address pair',
      category: 'crypto',
      requiresAuth: false,
      requiredArgs: ['chainId', 'tokenAddress'],
      optionalArgs: ['chain', 'token', 'address', 'mint'],
      outputType: '{ platform, category, type, data: { chain_id, token_address, orders[], boosted, boosts_active } }',
      example: { chainId: 'solana', tokenAddress: '5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump' },
      handler: (args, session) => this.fetchTokenLegitimacy(args, session),
    });

    // ── Action: token_lookup ─────────────────────────────────────────────
    this.registerAction({
      action: 'token_lookup',
      description: 'Fetch dexscreener pair data (dex_id, price_usd, liquidity) for a chain/address pair',
      category: 'crypto',
      requiresAuth: false,
      requiredArgs: ['chainId', 'tokenAddress'],
      optionalArgs: ['chain', 'token', 'address', 'mint'],
      outputType: '{ platform, category, type, data: { chain_id, token_address, pair_count, pairs[] } }',
      example: { chainId: 'solana', tokenAddress: '5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump' },
      handler: (args, session) => this.fetchTokenLookup(args, session),
    });

    // ── Action: latest_boosted ───────────────────────────────────────────
    this.registerAction({
      action: 'latest_boosted',
      description: 'Fetch dexscreener trending boosted tokens (platform-wide, no chain filter)',
      category: 'crypto',
      requiresAuth: false,
      requiredArgs: [],
      optionalArgs: ['limit'],
      outputType: 'BoostedToken[]',
      example: { limit: 25 },
      handler: (args, session) => this.fetchLatestBoosted(args, session),
    });

    // ── Action: latest_profiles ──────────────────────────────────────────
    this.registerAction({
      action: 'latest_profiles',
      description: 'Fetch dexscreener newly updated token profiles (platform-wide)',
      category: 'crypto',
      requiresAuth: false,
      requiredArgs: [],
      optionalArgs: ['limit'],
      outputType: 'TokenProfile[]',
      example: { limit: 25 },
      handler: (args, session) => this.fetchLatestProfiles(args, session),
    });
  }

  /**
   * Resolve chainId + tokenAddress from args, honoring aliases. Throws
   * XACT_4001 when either is missing.
   * @param {Record<string, unknown>} args
   * @returns {{ chainId: string, tokenAddress: string }}
   */
  #resolveChainToken(args = {}) {
    const chainId = args.chainId || args.chain || args.chain_id || args.network;
    const tokenAddress = args.tokenAddress || args.token || args.token_address || args.address || args.mint;
    if (typeof chainId !== 'string' || !chainId.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'dexscreener action requires chainId (e.g. "solana")',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    if (typeof tokenAddress !== 'string' || !tokenAddress.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'dexscreener action requires tokenAddress',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    return { chainId: chainId.trim(), tokenAddress: tokenAddress.trim() };
  }

  /**
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Record<string, unknown>>}
   */
  async fetchTokenSocials(args, session = {}) {
    const { chainId, tokenAddress } = this.#resolveChainToken(args || {});
    const proxy = this.proxyPool && typeof this.proxyPool.getStickyProxy === 'function'
      ? this.proxyPool.getStickyProxy(tokenAddress, false, { pool: 'realtime' })
      : null;
    const raw = await this.client.getTokenProfiles(chainId, tokenAddress, {
      proxy,
      accountId: session?.accountId || null,
      session,
    });
    return normalizeTokenSocials(chainId.toLowerCase(), tokenAddress, raw);
  }

  /**
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Record<string, unknown>>}
   */
  async fetchTokenLegitimacy(args, session = {}) {
    const { chainId, tokenAddress } = this.#resolveChainToken(args || {});
    const proxy = this.proxyPool && typeof this.proxyPool.getStickyProxy === 'function'
      ? this.proxyPool.getStickyProxy(tokenAddress, false, { pool: 'realtime' })
      : null;
    const raw = await this.client.getTokenOrders(chainId, tokenAddress, {
      proxy,
      accountId: session?.accountId || null,
      session,
    });
    return normalizeTokenLegitimacy(chainId.toLowerCase(), tokenAddress, raw);
  }

  /**
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Record<string, unknown>>}
   */
  async fetchTokenLookup(args, session = {}) {
    const { chainId, tokenAddress } = this.#resolveChainToken(args || {});
    const proxy = this.proxyPool && typeof this.proxyPool.getStickyProxy === 'function'
      ? this.proxyPool.getStickyProxy(tokenAddress, false, { pool: 'realtime' })
      : null;
    const raw = await this.client.getTokenPairs(chainId, tokenAddress, {
      proxy,
      accountId: session?.accountId || null,
      session,
    });
    return normalizeTokenLookup(chainId.toLowerCase(), tokenAddress, raw);
  }

  /**
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async fetchLatestBoosted(args = {}, session = {}) {
    const raw = await this.client.getLatestBoosted({
      accountId: session?.accountId || null,
      session,
    });
    const limit = Number.isFinite(Number(args?.limit)) && Number(args.limit) > 0
      ? Math.min(Number(args.limit), 500)
      : null;
    const items = raw.map(normalizeBoostedToken);
    return limit ? items.slice(0, limit) : items;
  }

  /**
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async fetchLatestProfiles(args = {}, session = {}) {
    const raw = await this.client.getLatestProfiles({
      accountId: session?.accountId || null,
      session,
    });
    const limit = Number.isFinite(Number(args?.limit)) && Number(args.limit) > 0
      ? Math.min(Number(args.limit), 500)
      : null;
    const items = raw.map(normalizeTokenProfile);
    return limit ? items.slice(0, limit) : items;
  }

  /**
   * Stateless HTTP client — nothing to release.
   */
  async cleanup() {}
}

export default DexscreenerCrawler;
