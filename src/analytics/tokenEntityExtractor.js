// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Token Entity Extractor - cashtag, contract & bare-name -> canonical token id.
 *
 * Pure-JS, zero-I/O core (`extractTokenEntities`) plus an injectable
 * Dexscreener enrichment seam (`createDexscreenerTokenResolver`,
 * `enrichTokenEntities`, `resolveWithEnrichment`).
 *
 * Canonical ID grammar (epic-54 AD-1):
 *   - contract-address mention -> `token:{chain}:{contract}` (unique, mergeable)
 *   - symbol/name mention       -> `token:sym:{SYMBOL}`   (ambiguous, NEVER merge
 *                                 into a canonical contract identity)
 *
 * Confidence tiers:
 *   - 1.0  contract address + adjacent token context (Solana) / any valid EVM addr
 *   - 0.8  cashtag `$SYM`, or alias-map entry resolving to a valid contract
 *   - 0.7  bare Solana-like base58 without adjacent context
 *   - 0.6  bare name resolved via alias map (symbol-only)
 *
 * False-positive guards:
 *   - Solana candidates: base58 charset (no 0/O/I/l), length 32–44, and NOT
 *     all-digit (tweet IDs / numeric hashes). Only upgraded to 1.0 when a
 *     cashtag or token-context keyword sits within ±CONTEXT_WINDOW chars -
 *     never tweet-global.
 *   - `$TOKEN_...` is not a cashtag: an underscore right after the symbol
 *     kills the match entirely.
 *   - Bare names are only extracted when present in the caller-provided
 *     alias map (longest-key-first, whole-word, case-insensitive).
 *
 * Dexscreener enrichment (verified spike 54.0):
 *   `scrape('dexscreener','token_lookup',{ chainId, tokenAddress })` ->
 *   `res.data.pairs[]` with FLAT fields `liquidity_usd`, `volume_24h`,
 *   `base_symbol`, `pair_address` (NOT nested `liquidity.usd`). Anchor =
 *   max-liquidity pair. Socials are an opt-in seam: `withSocials: true`
 *   additionally calls `token_socials` and merges `result.socials` (default
 *   OFF to save poll budget). Resolver misses return null, never throw.
 *   Resolver cache (optional injectable Map) stores HITS only - misses are
 *   not cached.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

// ============================================================================
// Constants
// ============================================================================

/** Characters allowed in a Solana base58 address (excludes 0, O, I, l). */
const BASE58_CHARS = '1-9A-HJ-NP-Za-km-z';

/**
 * Single canonical cashtag definition (settled decision #12 - every helper
 * must reuse this shape, no weaker ad-hoc regexes).
 * - symbol charset: [A-Za-z][A-Za-z0-9]{1,9} (min 2 chars, max 10)
 * - not preceded by a word char or `$` (`foo$BAR` is NOT a cashtag)
 * - not followed by any word char including `_` (`$PEPE_ARMY` is NOT one)
 */
const CASHTAG_SOURCE = `(?<![\\w$])\\$([A-Za-z][A-Za-z0-9]{1,9})(?![\\w])`;
const CASHTAG_REGEX = new RegExp(CASHTAG_SOURCE, 'g');
const CASHTAG_TEST_REGEX = new RegExp(CASHTAG_SOURCE);

/** Solana base58 candidate: 32–44 chars, standalone token. */
const SOLANA_CANDIDATE_REGEX = new RegExp(
  `(?<![${BASE58_CHARS}])([${BASE58_CHARS}]{32,44})(?![${BASE58_CHARS}])`,
  'g'
);

/** EVM candidate: `0x`/`0X` + exactly 40 hex chars. */
const EVM_CANDIDATE_REGEX = /(?<![\w])(0[xX][0-9a-fA-F]{40})(?!\w)/g;

/** Malformed EVM-ish runs (`0x` + >=32 hex chars) — forbidden zone so their
 * hex body is not re-parsed as a Solana contract (INVALID_ADDR). */
const EVM_FORBIDDEN_REGEX = /(?<![\w])0[xX][0-9a-fA-F]{32,}(?!\w)/g;

/**
 * Token-context keywords - presence within ±CONTEXT_WINDOW chars of a bare
 * base58 candidate upgrades it to a confident contract mention. Also feeds
 * EVM chain inference (settled decision #3).
 */
const TOKEN_CONTEXT_REGEX =
  /\b(contract|token|mint|address|pump|launch|launchpad|airdrop|dex|screener|liquidity|mcap|solana|bsc|bnb|binance|polygon|matic|arbitrum|avalanche|ethereum)\b|\bca\s*[:=]|\bsol\s*[:=]|\bbase\s+chain\b/i;

/** Positional context radius for confidence boost / chain inference. */
const CONTEXT_WINDOW = 100;

/**
 * EVM chain inference from context keywords (settled decision #3).
 * Evaluated on the ±CONTEXT_WINDOW slice around the address; first hit wins.
 * @type {Array<[RegExp, string]>}
 */
const EVM_CHAIN_KEYWORDS = [
  [/\b(bsc|bnb|binance)\b/i, 'bsc'],
  [/\b(polygon|matic)\b/i, 'polygon'],
  [/\b(arbitrum|arb)\b/i, 'arbitrum'],
  [/\bbase\b/i, 'base'],
  [/\b(avax|avalanche)\b/i, 'avalanche'],
  [/\b(eth|ethereum)\b/i, 'ethereum'],
];

// ============================================================================
// Address validators
// ============================================================================

/**
 * Check whether a string is a valid Solana base58 address.
 * Rejects all-digit strings (tweet IDs, numeric hashes).
 * @param {string} value
 * @returns {boolean}
 */
export function isValidSolanaAddress(value) {
  if (typeof value !== 'string') return false;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  if (/^\d+$/.test(value)) return false; // settled decision #2
  return true;
}

/**
 * Check whether a string is a valid EVM address (`0x`/`0X` + 40 hex).
 * @param {string} value
 * @returns {boolean}
 */
export function isValidEvmAddress(value) {
  return typeof value === 'string' && /^0[xX][0-9a-fA-F]{40}$/.test(value);
}

// ============================================================================
// Text helpers
// ============================================================================

/**
 * Slice the positional context window around an index (settled decision #1 -
 * boosts are positional ±100 chars, never tweet-global).
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function contextSlice(text, index) {
  const start = Math.max(0, index - CONTEXT_WINDOW);
  const end = Math.min(text.length, index + CONTEXT_WINDOW);
  return text.slice(start, end);
}

/**
 * Does this window contain token context (keyword or a real cashtag)?
 * @param {string} window
 * @returns {boolean}
 */
function hasTokenContext(window) {
  return TOKEN_CONTEXT_REGEX.test(window) || CASHTAG_TEST_REGEX.test(window);
}

/**
 * Collect index ranges that must never yield a Solana candidate: valid EVM
 * matches plus malformed `0x<32+ hex>` runs (their hex body is pure base58).
 * @param {string} text
 * @returns {Array<[number, number]>}
 */
function forbiddenEvmSpans(text) {
  /** @type {Array<[number, number]>} */
  const spans = [];
  EVM_FORBIDDEN_REGEX.lastIndex = 0;
  for (const m of text.matchAll(EVM_FORBIDDEN_REGEX)) {
    spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

/**
 * Infer EVM chain from context keywords near the address (decision #3).
 * @param {string} window
 * @param {string} fallback
 * @returns {string}
 */
function inferEvmChain(window, fallback) {
  for (const [regex, chain] of EVM_CHAIN_KEYWORDS) {
    if (regex.test(window)) return chain;
  }
  return fallback;
}

/**
 * Escape a string for safe interpolation into a RegExp.
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// Alias map handling
// ============================================================================

/**
 * Normalize an alias-map value into { symbol?, chain?, contract? }.
 * Accepts a bare string (`'WIF'` -> symbol) or an object.
 * @param {string|object} value
 * @param {string} key - used as symbol fallback when the object lacks one
 * @returns {{ symbol?: string, chain?: string, contract?: string }}
 */
function normalizeAliasValue(value, key) {
  if (typeof value === 'string') return { symbol: value };
  if (value && typeof value === 'object') {
    return {
      symbol: value.symbol || value.ticker || key,
      chain: value.chain || value.chainId,
      contract: value.contract || value.tokenAddress || value.address,
    };
  }
  return { symbol: key };
}

/**
 * Partition an alias map into name aliases (bare-name -> token) and
 * contract aliases (contract-keyed -> symbol). EVM contract keys are stored
 * lowercase for case-insensitive lookup; Solana keys keep exact casing
 * (base58 is case-sensitive) - settled decision #11.
 * @param {object} aliasMap
 * @returns {{ nameAliases: Array<{key:string,regex:RegExp,value:object}>,
 *             solanaContracts: Map<string,object>,
 *             evmContracts: Map<string,object> }}
 */
function partitionAliasMap(aliasMap) {
  const nameAliases = [];
  const solanaContracts = new Map();
  const evmContracts = new Map();
  if (!aliasMap || typeof aliasMap !== 'object') {
    return { nameAliases, solanaContracts, evmContracts };
  }
  // Longest-key-first so 'dogwifhat' wins over 'wif'.
  const keys = Object.keys(aliasMap).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (!key || !key.trim()) continue; // empty key regex would match everywhere
    const value = normalizeAliasValue(aliasMap[key], key);
    if (isValidSolanaAddress(key)) {
      solanaContracts.set(key, value);
      continue;
    }
    if (isValidEvmAddress(key)) {
      evmContracts.set(key.toLowerCase(), value);
      continue;
    }
    const regex = new RegExp(`(?<![\\w$])${escapeRegExp(key)}(?!\\w)`, 'gi');
    nameAliases.push({ key, regex, value });
  }
  return { nameAliases, solanaContracts, evmContracts };
}

/**
 * Build the canonical identity for an alias-map contract value.
 * Validates the contract first (settled decision #8): invalid -> degrade to
 * symbol-only `token:sym:{SYMBOL}`; never emit `token:{chain}:<garbage>`.
 * @param {{ symbol?: string, chain?: string, contract?: string }} value
 * @returns {{ canonicalId: string, chain?: string, contract?: string, confidence: number, symbol?: string }}
 */
function aliasIdentity(value) {
  if (value.contract) {
    if (isValidSolanaAddress(value.contract)) {
      return {
        canonicalId: `token:solana:${value.contract}`,
        chain: 'solana',
        contract: value.contract,
        confidence: 0.8,
        symbol: value.symbol,
      };
    }
    if (isValidEvmAddress(value.contract)) {
      const contract = value.contract.toLowerCase();
      return {
        canonicalId: `token:${value.chain || 'ethereum'}:${contract}`,
        chain: value.chain || 'ethereum',
        contract,
        confidence: 0.8,
        symbol: value.symbol,
      };
    }
    // invalid contract -> fall through to symbol-only
  }
  const symbol = String(value.symbol ?? '').toUpperCase();
  return {
    canonicalId: `token:sym:${symbol}`,
    confidence: 0.6,
    symbol: value.symbol,
  };
}

// ============================================================================
// Entity assembly + dedup
// ============================================================================

/**
 * Add an entity to the canonicalId-keyed map, merging on duplicates
 * (settled decision #7): upgrade confidence to the max AND fill any missing
 * fields (symbol, rawMention, mentionType, chain, contract) - never drop
 * caller-supplied data.
 * @param {Map<string, object>} map
 * @param {object} entity
 */
function addEntity(map, entity) {
  const existing = map.get(entity.canonicalId);
  if (!existing) {
    map.set(entity.canonicalId, entity);
    return;
  }
  if (entity.confidence > existing.confidence) {
    existing.confidence = entity.confidence;
  }
  for (const field of ['symbol', 'rawMention', 'mentionType', 'chain', 'contract']) {
    if (existing[field] === undefined && entity[field] !== undefined) {
      existing[field] = entity[field];
    }
  }
}

// ============================================================================
// Core extractor (pure, zero I/O)
// ============================================================================

/**
 * Options accepted by `extractTokenEntities` (and forwarded by
 * `resolveWithEnrichment`).
 * @typedef {object} ExtractOptions
 * @property {object} [aliasMap] - bare-name/contract -> symbol or
 *   `{ symbol, chain, contract }`. Name keys match whole-word,
 *   case-insensitive, longest-first. Contract keys: Solana exact-match,
 *   EVM case-insensitive.
 * @property {boolean} [requireSolanaContext] - when true, bare base58
 *   candidates without adjacent token context are skipped entirely.
 * @property {string} [defaultEvmChain] - fallback chain for EVM addresses
 *   when no chain keyword is nearby.
 * @property {Function} [resolver] - (resolveWithEnrichment only) injectable
 *   `resolveToken` function.
 * @property {Function} [scrape] - (resolveWithEnrichment only) shorthand to
 *   build a Dexscreener resolver when no explicit `resolver` is given.
 * @property {Map} [cache] - (resolveWithEnrichment only) resolver cache.
 * @property {boolean} [withSocials] - (resolveWithEnrichment only) opt-in
 *   socials seam forwarded to the resolver factory.
 */

/**
 * Extract token mentions from text into canonical entities.
 * Pure function - no I/O, no network, deterministic.
 *
 * @param {string} text - tweet/post text (null/undefined/non-string -> [])
 * @param {ExtractOptions} [options]
 * @returns {Array<{canonicalId:string, chain?:string, contract?:string,
 *   symbol?:string, confidence:number, mentionType:string, rawMention:string}>}
 */
export function extractTokenEntities(text, options) {
  // settled decision #6 - options=null tolerated like undefined
  const opts = options || {};
  if (typeof text !== 'string' || text.length === 0) return [];

  const entities = new Map();
  const requireSolanaContext = opts.requireSolanaContext === true;
  const defaultEvmChain = typeof opts.defaultEvmChain === 'string' && opts.defaultEvmChain
    ? opts.defaultEvmChain
    : 'ethereum';
  const { nameAliases, solanaContracts, evmContracts } = partitionAliasMap(opts.aliasMap);

  // ---- EVM contract addresses -------------------------------------------------
  /** Forbidden spans: valid EVM matches + malformed `0x<32+hex>` runs whose
   * hex body would otherwise re-parse as a Solana contract (INVALID_ADDR). */
  const evmSpans = forbiddenEvmSpans(text);
  EVM_CANDIDATE_REGEX.lastIndex = 0;
  for (const match of text.matchAll(EVM_CANDIDATE_REGEX)) {
    const raw = match[0];
    const index = match.index ?? 0;
    evmSpans.push([index, index + raw.length]);
    const contract = `0x${raw.slice(2).toLowerCase()}`; // normalize 0X -> 0x lowercase
    const window = contextSlice(text, index);
    const chain = inferEvmChain(window, defaultEvmChain);
    const alias = evmContracts.get(contract);
    addEntity(entities, {
      canonicalId: `token:${chain}:${contract}`,
      chain,
      contract,
      symbol: alias?.symbol,
      confidence: 1.0,
      mentionType: 'contract',
      rawMention: raw,
    });
  }

  // ---- Solana contract addresses ----------------------------------------------
  SOLANA_CANDIDATE_REGEX.lastIndex = 0;
  for (const match of text.matchAll(SOLANA_CANDIDATE_REGEX)) {
    const raw = match[0];
    if (!isValidSolanaAddress(raw)) continue; // digit-only reject (#2) etc.
    const index = match.index ?? 0;
    // 'x'/'X' and hex letters are valid base58 — the 40-hex body of an EVM
    // address (`0x`/`0X…`) would otherwise be double-counted as Solana.
    if (evmSpans.some(([s, e]) => index >= s && index < e)) continue;
    const window = contextSlice(text, index);
    const contextual = hasTokenContext(window);
    if (!contextual && requireSolanaContext) continue;
    const alias = solanaContracts.get(raw);
    addEntity(entities, {
      canonicalId: `token:solana:${raw}`,
      chain: 'solana',
      contract: raw,
      symbol: alias?.symbol,
      confidence: contextual ? 1.0 : 0.7,
      mentionType: 'contract',
      rawMention: raw,
    });
  }

  // ---- Cashtags ---------------------------------------------------------------
  CASHTAG_REGEX.lastIndex = 0;
  for (const match of text.matchAll(CASHTAG_REGEX)) {
    const symbol = match[1];
    addEntity(entities, {
      canonicalId: `token:sym:${symbol.toUpperCase()}`,
      symbol: symbol.toUpperCase(),
      confidence: 0.8,
      mentionType: 'cashtag',
      rawMention: match[0],
    });
  }

  // ---- Bare names via alias map ------------------------------------------------
  for (const { regex, value } of nameAliases) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const identity = aliasIdentity(value);
      addEntity(entities, {
        canonicalId: identity.canonicalId,
        chain: identity.chain,
        contract: identity.contract,
        symbol: identity.symbol,
        confidence: identity.confidence,
        mentionType: 'alias',
        rawMention: match[0],
      });
    }
  }

  return [...entities.values()];
}

// ============================================================================
// Dexscreener enrichment seam (injectable, async)
// ============================================================================

/**
 * Create an injectable Dexscreener token resolver.
 *
 * Fail-fast: throws immediately when `deps.scrape` is missing or not a
 * function (settled decision #10).
 *
 * @param {object} deps
 * @param {Function} deps.scrape - `scrape(source, action, args)`; called as
 *   `scrape('dexscreener','token_lookup',{ chainId, tokenAddress })` and,
 *   when `withSocials` is on, `scrape('dexscreener','token_socials',...)`.
 * @param {Map} [deps.cache] - optional injectable cache (Map-like with
 *   get/set/has). Only HITS are cached - misses are not cached.
 * @param {boolean} [deps.withSocials=false] - opt-in socials seam
 *   (decision #13): merge `socials` from the `token_socials` action.
 * @returns {(args:{chainId?:string, chain?:string, tokenAddress?:string,
 *   contract?:string}) => Promise<object|null>} resolveToken -
 *   `{contract}` is a valid alias of `tokenAddress`, `{chain}` of
 *   `chainId` (decision #9). Returns null on miss - never throws.
 */
export function createDexscreenerTokenResolver(deps) {
  const { scrape, cache, withSocials } = deps || {};
  if (typeof scrape !== 'function') {
    throw new Error('createDexscreenerTokenResolver: deps.scrape (function) is required');
  }

  return async function resolveToken(args) {
    const tokenAddress = args?.tokenAddress || args?.contract;
    const chainId = args?.chainId || args?.chain;
    if (!tokenAddress) return null;

    const cacheKey = `${chainId || ''}:${/^0x/i.test(String(tokenAddress)) ? String(tokenAddress).toLowerCase() : tokenAddress}`;
    if (cache && typeof cache.has === 'function' && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    try {
      const res = await scrape('dexscreener', 'token_lookup', { chainId, tokenAddress });
      const pairs = res?.data?.pairs ?? res?.pairs ?? [];
      const best = Array.isArray(pairs)
        ? pairs.reduce(
            (a, p) => ((p?.liquidity_usd ?? 0) > (a?.liquidity_usd ?? 0) ? p : a),
            pairs[0] ?? null
          )
        : null;
      if (!best) return null; // miss - not cached

      const result = {
        tokenAddress,
        chainId: best.chain_id ?? chainId,
        symbol: best.base_symbol,
        pairAddress: best.pair_address,
        liquidityUsd: best.liquidity_usd,
        volume24h: best.volume_24h,
        dexscreener: best,
      };

      if (withSocials === true) {
        try {
          const soc = await scrape('dexscreener', 'token_socials', { chainId, tokenAddress });
          const socials = soc?.data?.socials ?? soc?.socials ?? soc?.data ?? null;
          if (socials) result.socials = socials;
        } catch {
          // socials miss is valid - leave unset
        }
      }

      if (cache && typeof cache.set === 'function') {
        cache.set(cacheKey, result);
      }
      return result;
    } catch {
      return null; // resolver throw -> miss, never propagate
    }
  };
}

/**
 * Enrich extracted entities via an injectable resolver (async).
 *
 * Clones entities (never mutates input). Only entities carrying a contract
 * are resolved. On hit: attaches `dexscreener` (raw resolver result),
 * `enriched: true`, and fills `symbol`/`chain` when missing. On miss
 * (null result or resolver throw): entity keeps its original confidence
 * and fields - miss is valid, never throws.
 *
 * @param {Array} entities - non-array input -> `[]` (decision #6)
 * @param {Function} [resolver] - `resolveToken(args)` from
 *   `createDexscreenerTokenResolver` (or any compatible function)
 * @returns {Promise<Array>} enriched entity clones
 */
export async function enrichTokenEntities(entities, resolver) {
  if (!Array.isArray(entities)) return [];
  if (typeof resolver !== 'function') return entities.map((e) => ({ ...e }));

  const out = [];
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object' || !entity.contract) {
      out.push(entity && typeof entity === 'object' ? { ...entity } : entity);
      continue;
    }
    let result;
    try {
      result = await resolver({
        chainId: entity.chain,
        tokenAddress: entity.contract,
        contract: entity.contract,
      });
    } catch {
      result = null; // injected resolver throw = miss, never propagates
    }
    if (!result) {
      out.push({ ...entity });
      continue;
    }
    out.push({
      ...entity,
      symbol: entity.symbol ?? result.symbol,
      chain: entity.chain ?? result.chainId,
      dexscreener: result,
      enriched: true,
    });
  }
  return out;
}

/**
 * Convenience pipeline: extract then enrich in one call.
 *
 * @param {string} text
 * @param {ExtractOptions} [options] - all `extractTokenEntities` options
 *   plus the enrichment seams (`resolver`, `scrape`, `cache`, `withSocials`).
 * @returns {Promise<Array>} enriched entities
 */
export async function resolveWithEnrichment(text, options) {
  const opts = options || {}; // decision #6
  const entities = extractTokenEntities(text, opts);
  let resolver = opts.resolver;
  if (typeof resolver !== 'function' && typeof opts.scrape === 'function') {
    resolver = createDexscreenerTokenResolver({
      scrape: opts.scrape,
      cache: opts.cache,
      withSocials: opts.withSocials,
    });
  }
  return enrichTokenEntities(entities, resolver);
}
