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
import { PumpFunAuth } from './auth.js';
import { LivestreamApiClient } from './livestream-api.js';
import { PumpFunMedia } from './media.js';
import {
  namespacedPumpfunId,
  extractTheses,
  extractTopHolders,
  normalizeCoinMeta,
  normalizeFeedItem,
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

    // Auth & Livestream API client for authenticated actions (Story 20.7)
    this.auth = deps.auth instanceof PumpFunAuth
      ? deps.auth
      : new PumpFunAuth(deps.accountId || 'default');
    this.livestreamApi = deps.livestreamApi instanceof LivestreamApiClient
      ? deps.livestreamApi
      : new LivestreamApiClient(this.auth, { fetchFn: deps.fetchFn });
    this.media = deps.media instanceof PumpFunMedia
      ? deps.media
      : new PumpFunMedia();

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

    // ── Action: resolve_user_wallet ──
    this.registerAction({
      action: 'resolve_user_wallet',
      description: 'Resolve a pump.fun username to a Solana wallet address and pump user status',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: [],
      outputType: '{ username, walletAddress, userId, isPumpUser, profileImage, followers, following }',
      example: { username: 'alice' },
      handler: (args, session) => this.resolveUserWallet(args, session),
    });

    // ── Action: fetch_platform_feed ──
    this.registerAction({
      action: 'fetch_platform_feed',
      description: 'Fetch global discovery feeds across pump.fun coins (koth, graduating, new_creations, last_trade, currently_live)',
      category: 'social',
      requiresAuth: false,
      requiredArgs: [],
      optionalArgs: ['feedType', 'limit', 'offset', 'includeNsfw'],
      outputType: 'PumpFunFeedItem[]',
      example: { feedType: 'koth', limit: 20 },
      handler: (args, session) => this.fetchPlatformFeed(args, session),
    });

    // ── Action: stream_mint_chat ──
    this.registerAction({
      action: 'stream_mint_chat',
      description: 'Stream realtime livechat messages from wss://livechat.pump.fun for a given mint address',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['mintAddress'],
      optionalArgs: ['mint', 'durationMs', 'onMessage', 'onReaction'],
      outputType: '{ messageCount, durationMs }',
      example: { mintAddress: '5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump', durationMs: 15000 },
      handler: (args, session) => this.streamMintChat(args, session),
    });

    // ── Action: fetch_my_profile (Auth) ──
    this.registerAction({
      action: 'fetch_my_profile',
      description: 'Fetch the authenticated pump.fun user profile (wallet, followers, following)',
      category: 'social',
      requiresAuth: true,
      requiredArgs: [],
      optionalArgs: [],
      outputType: '{ username, walletAddress, userId, isPumpUser, followers, following }',
      example: {},
      handler: (args, session) => this.fetchMyProfile(args, session),
    });

    // ── Action: fetch_user_following (Auth) ──
    this.registerAction({
      action: 'fetch_user_following',
      description: 'Fetch the list of accounts a specific userId is following on pump.fun',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['userId'],
      optionalArgs: [],
      outputType: 'Array<Record<string, unknown>>',
      example: { userId: '4e6186fa-df15-44b5-aa56-b3a7657be44a' },
      handler: (args, session) => this.fetchUserFollowing(args, session),
    });

    // ── Action: fetch_livestream_clips ──
    this.registerAction({
      action: 'fetch_livestream_clips',
      description: 'Fetch HLS video clips metadata for a pump.fun livestreamer or coin',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['mintOrWallet'],
      optionalArgs: [],
      outputType: 'PumpFunLivestreamClip[]',
      example: { mintOrWallet: '5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump' },
      handler: (args, session) => this.fetchLivestreamClips(args, session),
    });

    // ── Action: post_mint_reply (Auth) ──
    this.registerAction({
      action: 'post_mint_reply',
      description: 'Post a reply/comment to a pump.fun mint coin page using an authenticated session',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['mintAddress', 'text'],
      optionalArgs: ['replyToId', 'mediaUrl'],
      outputType: '{ commentId, timestamp, success }',
      example: { mintAddress: '5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump', text: 'Greetings!' },
      handler: (args, session) => this.postMintReply(args, session),
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

      const [positionsRes, repliesRes, coinRes] = await Promise.allSettled([
        this.client.getMintPositions(mint, reqOpts),
        this.client.getReplies(mint, reqOpts),
        this.client.getCoin(mint, reqOpts),
      ]);

      // mint-positions or coins 404 → mint not found is a hard error.
      if (positionsRes.status === 'rejected') {
        throw positionsRes.reason;
      }
      if (coinRes.status === 'rejected') {
        // If coin endpoint returned 404 or rate limit, propagate immediately
        if (coinRes.reason?.statusCode === 404 || coinRes.reason?.code === 'XACT_4004') {
          throw coinRes.reason;
        }
        if (coinRes.reason?.statusCode === 429 || coinRes.reason?.code === 'XACT_4029') {
          throw coinRes.reason;
        }
      }
      const positions = positionsRes.value?.positions || [];
      const coinRaw = coinRes.status === 'fulfilled' ? coinRes.value : null;
      const coinMeta = coinRaw ? normalizeCoinMeta(coinRaw) : null;

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
        coinMeta,
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
   * Resolve a pump.fun username to public wallet address and user profile info.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async resolveUserWallet(args, session = {}) {
    const username = typeof args?.username === 'string' ? args.username.trim() : '';
    if (!username) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4002',
        message: 'Parameter "username" is required for resolve_user_wallet',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    const raw = await this.client.getUser(username, { session });
    if (!raw) return null;
    return {
      username: raw.username || username,
      walletAddress: raw.address || null,
      userId: raw.userId || null,
      isPumpUser: Boolean(raw.is_pump_user),
      profileImage: raw.profile_image || null,
      followers: Number(raw.followers) || 0,
      following: Number(raw.following) || 0,
    };
  }

  /**
   * Fetch discovery feeds across pump.fun coins.
   * @param {Record<string, unknown>} [args]
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async fetchPlatformFeed(args = {}, session = {}) {
    const a = args || {};
    const feedType = String(a.feedType || 'last_trade').toLowerCase();
    const limit = Number.isFinite(a.limit) ? Number(a.limit) : 50;
    const offset = Number.isFinite(a.offset) ? Number(a.offset) : 0;
    const includeNsfw = Boolean(a.includeNsfw);

    if (feedType === 'currently_live') {
      const list = await this.client.getCurrentlyLive({ session });
      return (Array.isArray(list) ? list : []).slice(offset, offset + limit).map(normalizeFeedItem);
    }

    const sortMap = {
      koth: { sort: 'market_cap', order: 'DESC' },
      graduating: { sort: 'market_cap', order: 'DESC' },
      new_creations: { sort: 'created_timestamp', order: 'DESC' },
      last_trade: { sort: 'last_trade_timestamp', order: 'DESC' },
    };
    const params = {
      limit,
      offset,
      includeNsfw,
      ...(sortMap[feedType] || { sort: 'last_trade_timestamp', order: 'DESC' }),
    };

    const rawCoins = await this.client.getCoinsFeed(params, { session });
    let items = (Array.isArray(rawCoins) ? rawCoins : []).map(normalizeFeedItem);

    if (feedType === 'graduating') {
      // Filter coins that are incomplete and close to graduation threshold
      items = items.filter((c) => !c.complete && c.marketCapUsd >= 30_000);
    }

    return items;
  }

  /** @type {number} Active stream connections counter */
  #activeStreams = 0;

  /**
   * Stream livechat messages for a coin room over a bounded duration.
   * Enforces a ceiling of 5 concurrent stream connections per crawler instance.
   *
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ messageCount: number, durationMs: number }>}
   */
  async streamMintChat(args, session = {}) {
    if (this.#activeStreams >= 5) {
      throw new PlatformError({
        type: ErrorTypes.RATE_LIMIT,
        code: 'XACT_4291',
        message: 'Maximum concurrent stream connections (5) exceeded on PumpFunCrawler',
        statusCode: 429,
        suggestedAction: SuggestedActions.WAIT,
        platform: this.platform,
      });
    }

    const a = args || {};
    const mint = this.#resolveMint(a);
    const durationMs = Number.isFinite(a.durationMs) ? Number(a.durationMs) : 30_000;
    const onMessage = typeof a.onMessage === 'function' ? a.onMessage : undefined;
    const onReaction = typeof a.onReaction === 'function' ? a.onReaction : undefined;
    const signal = a.signal || session?.signal;

    // Use dedicated stream instance if available on client, else create one
    let lc = this.client.livechat;
    if (!lc || typeof lc.subscribeRoom !== 'function') {
      const { PumpFunLivechat } = await import('./livechat.js');
      lc = new PumpFunLivechat({
        timeoutMs: 10_000,
        webSocketImpl: this.client.livechat?._WSImpl,
      });
    }

    this.#activeStreams++;
    // Accumulate messages so HTTP callers (dashboard UI) receive the captured
    // batch — subscribeRoom alone only returns { messageCount, durationMs }.
    const collected = [];
    const MAX_COLLECTED = 500;
    try {
      const res = await lc.subscribeRoom(mint, {
        durationMs,
        signal,
        onMessage: (msg) => {
          if (collected.length < MAX_COLLECTED) collected.push(msg);
          onMessage?.(msg);
          // Forward to RedisStreamPublisher if configured
          if (this.redisPublisher && typeof this.redisPublisher.publish === 'function') {
            void this.redisPublisher.publish('stream:social:pumpfun:chat', {
              mint,
              message: msg,
              timestamp: Date.now(),
            }).catch(() => {});
          }
        },
        onReaction,
      });
      const totalCount = Number(res?.messageCount ?? collected.length);
      return {
        ...res,
        mint,
        messages: collected,
        truncated: totalCount > collected.length, // F3
      };
    } finally {
      this.#activeStreams = Math.max(0, this.#activeStreams - 1);
    }
  }

  /**
   * Fetch the authenticated user's own profile from pump.fun.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Record<string, unknown>>}
   */
  async fetchMyProfile(args, session = {}) {
    if (!this.auth.hasSession() || !this.auth.isValid()) {
      throw new PlatformError({
        type: ErrorTypes.AUTH_REQUIRED,
        code: 'XACT_4010',
        message: 'fetch_my_profile requires an active pump.fun session',
        statusCode: 401,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    return this.livestreamApi.getMyProfile();
  }

  /**
   * Fetch following list for a specific user.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Array>}
   */
  async fetchUserFollowing(args, session = {}) {
    if (!this.auth.hasSession() || !this.auth.isValid()) {
      throw new PlatformError({
        type: ErrorTypes.AUTH_REQUIRED,
        code: 'XACT_4010',
        message: 'fetch_user_following requires an active pump.fun session',
        statusCode: 401,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    const userId = String(args?.userId || session?.userId || '');
    if (!userId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4002',
        message: 'Parameter "userId" is required',
        statusCode: 400,
        platform: this.platform,
      });
    }
    return this.livestreamApi.getFollowing(userId);
  }

  /**
   * Fetch livestream clips / video metadata for a mint or wallet.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Array>}
   */
  async fetchLivestreamClips(args, session = {}) {
    if (!this.auth.hasSession() || !this.auth.isValid()) {
      throw new PlatformError({
        type: ErrorTypes.AUTH_REQUIRED,
        code: 'XACT_4010',
        message: 'fetch_livestream_clips requires an active pump.fun session',
        statusCode: 401,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    const mintOrWallet = String(args?.mintOrWallet || args?.mint || args?.wallet || '');
    if (!mintOrWallet) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4002',
        message: 'Parameter "mintOrWallet" is required',
        statusCode: 400,
        platform: this.platform,
      });
    }
    const rawClips = await this.livestreamApi.getLivestreamClips(mintOrWallet);
    return (Array.isArray(rawClips) ? rawClips : [rawClips]).map((c) => this.media.normalizeClip(c));
  }

  /**
   * Post a comment/reply to a pump.fun mint page.
   * Enforces max 5 comments per minute rate limit to prevent shadowban.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<Record<string, unknown>>}
   */
  async postMintReply(args, session = {}) {
    if (!this.auth.hasSession() || !this.auth.isValid()) {
      throw new PlatformError({
        type: ErrorTypes.AUTH_REQUIRED,
        code: 'XACT_4010',
        message: 'post_mint_reply requires an active pump.fun session',
        statusCode: 401,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    const mint = this.#resolveMint(args || {});
    const text = String(args?.text || '').trim();
    if (!text) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4002',
        message: 'Parameter "text" cannot be empty',
        statusCode: 400,
        platform: this.platform,
      });
    }

    // Enforce rate limit: max 5 comments / min / account
    const rateKey = `post_reply:${this.auth.accountId}`;
    // Simple in-memory counter for rate limiting (shared via SessionManager would be better for distributed)
    this._replyTimestamps = this._replyTimestamps || [];
    const now = Date.now();
    this._replyTimestamps = this._replyTimestamps.filter(t => now - t < 60_000);
    if (this._replyTimestamps.length >= 5) {
      throw new PlatformError({
        type: ErrorTypes.RATE_LIMIT,
        code: 'XACT_4291',
        message: 'Comment rate limit exceeded (max 5/min per account)',
        statusCode: 429,
        suggestedAction: SuggestedActions.WAIT,
        platform: this.platform,
      });
    }
    this._replyTimestamps.push(now);

    const result = await this.livestreamApi.postMintReply(mint, text, {
      replyToId: args.replyToId,
      mediaUrl: args.mediaUrl,
    });

    return {
      success: true,
      mint,
      text,
      commentId: result?.id || result?.commentId || null,
      timestamp: result?.timestamp || result?.createdAt || Date.now(),
      raw: result,
    };
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
