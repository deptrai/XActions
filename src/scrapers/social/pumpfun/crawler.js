// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFunCrawler — native social crawler for pump.fun mint tokens.
 * Extends AbstractCrawler; registers `fetch_mint_social` returning theses,
 * comment velocity, top holders, KOL activity, and livestream status over
 * unauthenticated HTTP/2 REST (no headless browser).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { PumpFunClient } from './client.js';
import { computeCommentVelocity } from './velocity.js';
import { KolscanResolver } from './kolscan.js';
import { LivestreamPoller } from './livestream.js';
import {
  namespacedPumpfunId,
  extractTheses,
  extractTopHolders,
} from './normalizer.js';
import { normalizePumpfunReplies } from './comments.js';
import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

/**
 * @param {PumpFunClient | Record<string, unknown>} [client]
 * @param {Record<string, unknown>} [options]
 * @returns {PumpFunCrawler}
 */
export function createPumpFunCrawler(client = {}, options = {}) {
  const resolvedClient = client instanceof PumpFunClient ? client : new PumpFunClient(client || options || {});
  const resolvedOptions = client instanceof PumpFunClient ? options : (options || {});
  return new PumpFunCrawler({ client: resolvedClient, ...resolvedOptions });
}

export class PumpFunCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'pumpfun';

  /** @type {string} */
  platform = 'pumpfun';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {PumpFunClient} */
  client;

  /** @type {KolscanResolver} */
  kolResolver;

  /** @type {LivestreamPoller | null} */
  livestreamPoller;

  /**
   * @param {Object} [deps]
   * @param {PumpFunClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../utils/redis-stream-publisher.js').RedisStreamPublisher} [deps.redisPublisher]
   * @param {KolscanResolver} [deps.kolResolver]
   * @param {LivestreamPoller | null} [deps.livestreamPoller]
   * @param {boolean} [deps.startLivestreamPoller] - default true.
   * @param {number} [deps.livestreamIntervalMs]
   * @param {number} [deps.dedupWindowMs]
   * @param {boolean} [deps.requiresAuth]
   */
  constructor(deps = {}) {
    const { client: explicitClient, ...rest } = deps;
    const client = explicitClient instanceof PumpFunClient
      ? explicitClient
      : new PumpFunClient({ ...rest, transport: deps.transport });
    super({ ...deps, client });

    this.category = 'social';
    this.client = client;
    this.redisPublisher = deps.redisPublisher || null;
    // proxyPool is not an AbstractCrawler constructor dep — wire explicitly so
    // fetchMintSocial can resolve a sticky proxy per mint.
    this.proxyPool = deps.proxyPool || deps.client?.proxyPool || null;
    this.kolResolver = deps.kolResolver instanceof KolscanResolver
      ? deps.kolResolver
      : new KolscanResolver({ redis: deps.redis, fetchFn: deps.fetchFn });

    // Don't auto-start the poller here — constructing a crawler for
    // discovery (`listActions` via actions-list loaders) shouldn't spawn a
    // background interval + upstream poll. The poller lazy-starts on first
    // `fetchMintSocial`. Pass `livestreamPoller` to inject a managed instance.
    this._autoPoller = deps.livestreamPoller === undefined && deps.startLivestreamPoller !== false;
    this.livestreamPoller = deps.livestreamPoller !== undefined
      ? deps.livestreamPoller
      : (this._autoPoller
          ? new LivestreamPoller({ client, intervalMs: deps.livestreamIntervalMs, autoStart: false })
          : null);

    // ── Action: fetch_mint_social ──
    this.registerAction({
      action: 'fetch_mint_social',
      description: 'Fetch pump.fun mint social signals (theses, comment velocity, top holders, KOL activity, livestream status)',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['mintAddress'],
      optionalArgs: ['mint', 'address', 'limit'],
      outputType: '{ mint, theses: Thesis[], commentVelocity: {last1m,last5m}, kolActivity, livestream, topHolders[] }',
      example: { mintAddress: '5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump' },
      checkpointResolver: (args) => {
        const mint = args?.mintAddress || args?.mint || args?.address;
        if (!mint || typeof mint !== 'string') return null;
        return {
          targetType: 'mint',
          targetKey: mint.trim(),
          cursorField: 'offset',
          fallbackCursorFields: ['cursor'],
        };
      },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) =>
        this.fetchMintSocial(args, session),
    });
  }

  /**
   * Resolve the mint address from args (accepts mintAddress|mint|address).
   * Throws XACT_4002 before any upstream request when invalid.
   * @param {Record<string, unknown>} args
   * @returns {string}
   */
  #resolveMint(args) {
    const raw = args?.mintAddress || args?.mint || args?.address;
    return this.client.assertValidMint(raw);
  }

  /**
   * Fetch all social signals for a mint in one orchestrated round-trip.
   * mint-positions + replies run in parallel on the same sticky proxy; KOL
   * matching and livestream status resolve from caches (0ms per-request).
   *
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Record<string, unknown>>} PumpFunMintSocialResult
   */
  async fetchMintSocial(args, session = {}) {
    const mint = this.#resolveMint(args || {});

    return this.client.dedup(mint, async () => {
      // Sticky proxy per mint — both upstream calls share the same egress IP.
      const proxy = this.proxyPool && typeof this.proxyPool.getStickyProxy === 'function'
        ? this.proxyPool.getStickyProxy(mint, this.client.requiresResidential, { pool: 'realtime' })
        : null;
      const reqOpts = { proxy, accountId: session?.accountId || null, session };
      const replyLimit = Number.isFinite(args?.limit) ? Number(args.limit) : undefined;
      if (replyLimit) reqOpts.limit = replyLimit;

      const [positionsRes, repliesRes] = await Promise.allSettled([
        this.client.getMintPositions(mint, reqOpts),
        this.client.getReplies(mint, reqOpts),
      ]);

      // mint-positions 404 → mint not found is a hard error.
      if (positionsRes.status === 'rejected') {
        throw positionsRes.reason;
      }
      const positions = positionsRes.value?.positions || [];

      // replies: REST 404 → livechat fallback already applied inside
      // client.getReplies; a rejection here means livechat also failed.
      const replies = repliesRes.status === 'fulfilled' ? (repliesRes.value || []) : [];
      const comments = normalizePumpfunReplies(replies, mint);

      // Theses + holders come from mint-positions callout.
      const kolWallets = await this.#kolWalletSet();
      const theses = extractTheses(positions, kolWallets);
      const topHolders = extractTopHolders(positions, kolWallets);

      // KOL activity: match holder + thesis wallets against KOL set.
      const walletsToCheck = new Set();
      for (const t of theses) if (t.wallet) walletsToCheck.add(t.wallet);
      for (const h of topHolders) if (h.wallet) walletsToCheck.add(h.wallet);
      const kolActivity = await this.kolResolver.matchKols(walletsToCheck);

      const commentVelocity = computeCommentVelocity(replies);
      // Lazy-start the poller on first fetch, then wait for its first tick so
      // we don't report a false isActive:false on a mint that is live but not
      // yet populated.
      if (this.livestreamPoller && this._autoPoller && !this.livestreamPoller._running) {
        this.livestreamPoller.start();
      }
      if (this.livestreamPoller && this.livestreamPoller.ready) {
        try { await this.livestreamPoller.ready; } catch { /* non-fatal */ }
      }
      const livestream = this.livestreamPoller
        ? this.livestreamPoller.isLive(mint)
        : { isActive: false, viewers: 0 };

      return {
        mint,
        id: namespacedPumpfunId(mint),
        platform: this.platform,
        theses,
        comments,
        commentVelocity,
        kolActivity,
        livestream,
        topHolders,
        items: theses, // extractRecords/stream hook picks up `items`
      };
    });
  }

  /**
   * Resolve the KOL wallet set for `isKol` flagging during normalization.
   * @returns {Promise<Set<string>>}
   */
  async #kolWalletSet() {
    try {
      const map = await this.kolResolver.resolve();
      return new Set(map.keys());
    } catch {
      return new Set();
    }
  }

  /**
   * Stop the livestream poller and release resources.
   * AbstractCrawler.cleanup() is abstract (throws) — this is the concrete impl.
   */
  async cleanup() {
    try {
      this.livestreamPoller?.stop?.();
    } catch {
      /* non-fatal */
    }
    try {
      await this.client?.livechat?.close?.();
    } catch {
      /* non-fatal */
    }
  }
}

export default PumpFunCrawler;
