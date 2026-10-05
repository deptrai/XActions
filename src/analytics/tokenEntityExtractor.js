// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * TokenEntityExtractor — cashtag, contract address, and bare-name entity extraction.
 * Resolves mentions in tweet text into canonical token IDs (Story 54.1, Epic 54).
 *
 * Architecture Decision AD-1:
 * - Contract-bound mentions: `token:{chain}:{contract}` (unique, mergeable canonicalId)
 * - Symbol/name-only mentions: `token:sym:{SYMBOL}` (ambiguous: true, never-merge)
 *
 * Core extraction is a pure function (zero I/O, zero network).
 * Dexscreener enrichment is provided as an injectable resolver factory.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

// ---------------------------------------------------------------------------
// Constants & Regex Patterns
// ---------------------------------------------------------------------------

/**
 * Base58 charset used by Solana (excludes 0, O, I, l).
 */
const BASE58_CHARSET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * EVM address: 0x followed by exactly 40 hex characters.
 */
const EVM_ADDRESS_REGEX = /\b(0x[a-fA-F0-9]{40})\b/g;

/**
 * Solana address candidate: 32-44 base58 characters with word boundaries.
 */
const SOLANA_ADDRESS_REGEX = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g;

/**
 * Cashtag regex: $ followed by letter, then 1-9 alphanumeric characters (length 2-10).
 * Excludes standalone $ or digit-led like $100.
 */
const CASHTAG_REGEX = /(?:^|[^a-zA-Z0-9_])\$([a-zA-Z][a-zA-Z0-9]{1,9})(?![a-zA-Z0-9])/g;

/**
 * Precompiled regex for crypto/token/contract intent keywords in prose.
 */
const TOKEN_CONTEXT_REGEX = /\b(contract|ca|mint|token|address|pump|solana|sol|eth|ethereum|bsc|dex|swap|raydium|uniswap|pumping|buy|deployer)\b/i;

// ---------------------------------------------------------------------------
// Address Validators
// ---------------------------------------------------------------------------

/**
 * Validate whether a string is a valid EVM address format.
 * @param {string} address
 * @returns {boolean}
 */
export function isValidEvmAddress(address) {
  if (typeof address !== 'string') return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}

/**
 * Validate whether a string is a valid Solana base58 address format.
 * @param {string} address
 * @returns {boolean}
 */
export function isValidSolanaAddress(address) {
  if (typeof address !== 'string') return false;
  const trimmed = address.trim();
  // Solana addresses are 32-44 base58 chars and must not contain 0, O, I, l
  if (/[0OIl]/.test(trimmed)) return false;
  return BASE58_CHARSET_REGEX.test(trimmed);
}

/**
 * Check if the text contains crypto/token context clues using precompiled regex.
 * @param {string} text
 * @returns {boolean}
 */
function hasTokenContext(text) {
  return TOKEN_CONTEXT_REGEX.test(text);
}

/**
 * Match a whole word in text without dynamic regular expressions to prevent ReDoS.
 * @param {string} text
 * @param {string} word
 * @returns {string|null} The matched substring with original casing, or null.
 */
function matchWholeWord(text, word) {
  if (!text || !word) return null;
  const lowerText = text.toLowerCase();
  const lowerWord = word.toLowerCase();
  const wordLen = lowerWord.length;
  let idx = lowerText.indexOf(lowerWord);

  while (idx !== -1) {
    const charBefore = idx > 0 ? lowerText[idx - 1] : ' ';
    const charAfter = idx + wordLen < lowerText.length ? lowerText[idx + wordLen] : ' ';
    const isBoundaryBefore = !/[a-z0-9_]/i.test(charBefore);
    const isBoundaryAfter = !/[a-z0-9_]/i.test(charAfter);

    if (isBoundaryBefore && isBoundaryAfter) {
      return text.slice(idx, idx + wordLen);
    }
    idx = lowerText.indexOf(lowerWord, idx + 1);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Core Extractor (Pure, Zero I/O)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TokenMentionEntity
 * @property {string} canonicalId - `token:{chain}:{contract}` or `token:sym:{SYMBOL}`
 * @property {string} [chain] - Blockchain identifier (e.g. 'solana', 'ethereum')
 * @property {string} [contract] - Contract address
 * @property {string} [symbol] - Normalized ticker symbol (uppercase)
 * @property {number} confidence - Confidence score in (0, 1]
 * @property {boolean} [ambiguous] - True for symbol-only / non-contract tokens (AD-1)
 * @property {string} [rawMention] - Original string as matched in text
 * @property {'contract'|'cashtag'|'name'} [mentionType] - Type of mention
 * @property {boolean} [enriched] - Whether entity has been enriched via resolver
 * @property {Record<string, any>|null} [dexscreener] - Dexscreener lookup enrichment data
 */

/**
 * @typedef {Object} ExtractTokenOptions
 * @property {Record<string, string|{symbol?: string, contract?: string, chain?: string}>} [aliasMap]
 *   Configurable alias map (bare-name or contract -> symbol/contract info).
 * @property {string} [defaultEvmChain='ethereum'] - Default chain for EVM addresses.
 * @property {boolean} [requireSolanaContext=false] - Only extract Solana addresses if token context exists.
 */

/**
 * Extract token entities from text.
 * Pure function: zero I/O, zero network, deterministic.
 *
 * @param {string} text - Raw tweet or message text.
 * @param {ExtractTokenOptions} [options={}] - Optional extraction configuration.
 * @returns {TokenMentionEntity[]} Array of extracted token entities.
 */
export function extractTokenEntities(text, options = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [];
  }

  const {
    aliasMap = {},
    defaultEvmChain = 'ethereum',
    requireSolanaContext = false,
  } = options;

  /** @type {TokenMentionEntity[]} */
  const entities = [];
  /** @type {Set<string>} */
  const seenCanonicalIds = new Set();

  const textContextPresent = hasTokenContext(text);

  // Helper to add entity with canonicalId dedup
  /**
   * @param {TokenMentionEntity} entity
   */
  const addEntity = (entity) => {
    if (!entity || !entity.canonicalId) return;
    if (seenCanonicalIds.has(entity.canonicalId)) {
      // If we see the same canonical ID again, upgrade confidence if higher
      const existing = entities.find((e) => e.canonicalId === entity.canonicalId);
      if (existing && entity.confidence > existing.confidence) {
        existing.confidence = entity.confidence;
      }
      return;
    }
    seenCanonicalIds.add(entity.canonicalId);
    entities.push(entity);
  };

  // -------------------------------------------------------------------------
  // 1. EVM Contract Addresses (0x[a-fA-F0-9]{40})
  // -------------------------------------------------------------------------
  const evmMatches = text.matchAll(EVM_ADDRESS_REGEX);
  for (const match of evmMatches) {
    const rawContract = match[1];
    if (isValidEvmAddress(rawContract)) {
      const normalizedContract = rawContract.toLowerCase();
      
      // Determine chain (check aliasMap first if mapped, else defaultEvmChain)
      let chain = defaultEvmChain;
      let mappedSymbol = null;

      const aliasVal = aliasMap[rawContract] || aliasMap[normalizedContract];
      if (typeof aliasVal === 'string') {
        mappedSymbol = aliasVal.toUpperCase();
      } else if (aliasVal && typeof aliasVal === 'object') {
        if (aliasVal.chain) chain = aliasVal.chain;
        if (aliasVal.symbol) mappedSymbol = aliasVal.symbol.toUpperCase();
      }

      const canonicalId = `token:${chain}:${normalizedContract}`;
      /** @type {TokenMentionEntity} */
      const entity = {
        canonicalId,
        chain,
        contract: normalizedContract,
        confidence: 1.0,
        ambiguous: false,
        rawMention: rawContract,
        mentionType: 'contract',
      };
      if (mappedSymbol) {
        entity.symbol = mappedSymbol;
      }
      addEntity(entity);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Solana Contract Addresses (Base58 32-44 characters)
  // -------------------------------------------------------------------------
  const solMatches = text.matchAll(SOLANA_ADDRESS_REGEX);
  for (const match of solMatches) {
    const candidate = match[1];
    // Exclude if it looks like an EVM prefix or fails base58 checks
    if (isValidSolanaAddress(candidate)) {
      // Check if aliasMap knows about this contract
      const aliasVal = aliasMap[candidate];
      let mappedSymbol = null;
      let chain = 'solana';

      if (typeof aliasVal === 'string') {
        mappedSymbol = aliasVal.toUpperCase();
      } else if (aliasVal && typeof aliasVal === 'object') {
        if (aliasVal.chain) chain = aliasVal.chain;
        if (aliasVal.symbol) mappedSymbol = aliasVal.symbol.toUpperCase();
      }

      // False positive guard:
      // High confidence (1.0) if token context or cashtag or alias confirmation exists.
      // Moderate confidence (0.7) if bare base58 in prose without context.
      const hasCashtagInText = /\$[a-zA-Z][a-zA-Z0-9]{1,9}\b/.test(text);
      const isConfidentContract = textContextPresent || hasCashtagInText || Boolean(aliasVal);

      if (requireSolanaContext && !isConfidentContract) {
        continue;
      }

      const canonicalId = `token:${chain}:${candidate}`;
      /** @type {TokenMentionEntity} */
      const entity = {
        canonicalId,
        chain,
        contract: candidate,
        confidence: isConfidentContract ? 1.0 : 0.7,
        ambiguous: false,
        rawMention: candidate,
        mentionType: 'contract',
      };
      if (mappedSymbol) {
        entity.symbol = mappedSymbol;
      }
      addEntity(entity);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Cashtag mentions ($TICKER)
  // -------------------------------------------------------------------------
  const cashtagMatches = text.matchAll(CASHTAG_REGEX);
  for (const match of cashtagMatches) {
    const rawTicker = match[1];
    // Must be at least 2 characters and not start with digit (guaranteed by regex)
    if (rawTicker && rawTicker.length >= 2) {
      const symbol = rawTicker.toUpperCase();
      const canonicalId = `token:sym:${symbol}`;
      
      /** @type {TokenMentionEntity} */
      const entity = {
        canonicalId,
        symbol,
        confidence: 0.8, // Always < 1 per AD-1
        ambiguous: true,
        rawMention: `$${rawTicker}`,
        mentionType: 'cashtag',
      };
      addEntity(entity);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Bare Name Mentions (via configurable aliasMap)
  // -------------------------------------------------------------------------
  if (aliasMap && typeof aliasMap === 'object') {
    // Sort alias keys by length descending to prioritize longest matches
    const aliasKeys = Object.keys(aliasMap).filter((k) => {
      // Do not treat pure contract addresses as bare names
      return !isValidEvmAddress(k) && !isValidSolanaAddress(k);
    }).sort((a, b) => b.length - a.length);

    for (const nameKey of aliasKeys) {
      if (!nameKey || nameKey.length < 2) continue;

      const matchedWord = matchWholeWord(text, nameKey);
      if (matchedWord) {
        const target = aliasMap[nameKey];
        if (typeof target === 'string') {
          const symbol = target.toUpperCase();
          const canonicalId = `token:sym:${symbol}`;
          addEntity({
            canonicalId,
            symbol,
            confidence: 0.6, // Bare name confidence < cashtag < 1
            ambiguous: true,
            rawMention: matchedWord,
            mentionType: 'name',
          });
        } else if (target && typeof target === 'object') {
          if (target.contract) {
            const chain = target.chain || (isValidSolanaAddress(target.contract) ? 'solana' : defaultEvmChain);
            const contractVal = chain === 'solana' ? target.contract : target.contract.toLowerCase();
            const canonicalId = `token:${chain}:${contractVal}`;
            addEntity({
              canonicalId,
              chain,
              contract: contractVal,
              symbol: target.symbol ? target.symbol.toUpperCase() : undefined,
              confidence: 0.8, // Contract via alias map < 1
              ambiguous: false,
              rawMention: matchedWord,
              mentionType: 'name',
            });
          } else if (target.symbol) {
            const symbol = target.symbol.toUpperCase();
            const canonicalId = `token:sym:${symbol}`;
            addEntity({
              canonicalId,
              symbol,
              confidence: 0.6,
              ambiguous: true,
              rawMention: matchedWord,
              mentionType: 'name',
            });
          }
        }
      }
    }
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Injectable Dexscreener Token Resolver
// ---------------------------------------------------------------------------

/**
 * Factory for creating an injectable Dexscreener token resolver.
 * Calls `scrape('dexscreener', 'token_lookup', { chainId, tokenAddress })`
 * and reads `res.data.pairs[]` flat fields (`liquidity_usd`, `volume_24h`, `base_symbol`).
 *
 * @param {Object} [deps={}] - Injectable dependencies.
 * @param {Function} [deps.scrape] - Scrape dispatcher function.
 * @param {Map|Object} [deps.cache] - Optional in-memory cache.
 * @returns {Function} Resolver function ({ chainId, tokenAddress }) => Promise<Object|null>
 */
export function createDexscreenerTokenResolver(deps = {}) {
  const scraperFn = deps.scrape;
  const cache = deps.cache;

  /**
   * @param {{ chainId?: string, chain?: string, tokenAddress?: string, contract?: string }} args
   * @returns {Promise<Record<string, any>|null>}
   */
  return async function resolveToken(args) {
    if (!args || !args.tokenAddress) {
      return null;
    }

    const chainId = args.chainId || args.chain || 'solana';
    const tokenAddress = args.tokenAddress || args.contract;
    const cacheKey = `${chainId}:${tokenAddress}`;

    if (cache && typeof cache.get === 'function') {
      const cached = cache.get(cacheKey);
      if (cached) return cached;
    }

    if (typeof scraperFn !== 'function') {
      throw new Error('createDexscreenerTokenResolver requires a scrape function in deps ({ scrape })');
    }

    try {
      const res = await scraperFn('dexscreener', 'token_lookup', {
        chainId,
        tokenAddress,
      });

      const pairs = res?.data?.pairs ?? res?.pairs ?? [];
      if (!Array.isArray(pairs) || pairs.length === 0) {
        return null;
      }

      // Liquidity anchor: pair with maximum liquidity_usd
      const best = pairs.reduce((bestPair, p) => {
        const pLiq = p?.liquidity_usd != null ? Number(p.liquidity_usd) : 0;
        const bestLiq = bestPair?.liquidity_usd != null ? Number(bestPair.liquidity_usd) : 0;
        return pLiq > bestLiq ? p : bestPair;
      }, pairs[0]);

      if (!best) return null;

      const result = {
        chainId,
        tokenAddress,
        baseSymbol: best.base_symbol != null ? String(best.base_symbol).toUpperCase() : null,
        baseName: best.base_name ?? null,
        priceUsd: best.price_usd != null ? Number(best.price_usd) : null,
        liquidityUsd: best.liquidity_usd != null ? Number(best.liquidity_usd) : null,
        volume24h: best.volume_24h != null ? Number(best.volume_24h) : null,
        pairAddress: best.pair_address ?? null,
        pairUrl: best.pair_url ?? null,
        dexId: best.dex_id ?? null,
        pairsCount: pairs.length,
      };

      if (cache && typeof cache.set === 'function') {
        cache.set(cacheKey, result);
      }

      return result;
    } catch {
      // Network or lookup error -> miss is valid, do not throw
      return null;
    }
  };
}

/**
 * Enrich extracted token entities using an injectable resolver function.
 * If resolver returns null or fails, the entity retains its original confidence and data.
 *
 * @param {TokenMentionEntity[]} entities - Entities to enrich.
 * @param {Function} resolver - Resolver function ({ chainId, tokenAddress }) => Promise<Object|null>
 * @returns {Promise<TokenMentionEntity[]>} Enriched entities.
 */
export async function enrichTokenEntities(entities, resolver) {
  if (!Array.isArray(entities) || entities.length === 0 || typeof resolver !== 'function') {
    return entities || [];
  }

  const enrichedList = [];
  for (const entity of entities) {
    const clone = { ...entity };
    if (clone.contract && clone.chain) {
      try {
        const info = await resolver({ chainId: clone.chain, tokenAddress: clone.contract });
        if (info) {
          if (info.baseSymbol && !clone.symbol) {
            clone.symbol = info.baseSymbol;
          }
          clone.dexscreener = info;
          clone.enriched = true;
        }
      } catch {
        // Resolver miss or failure leaves entity intact
      }
    }
    enrichedList.push(clone);
  }
  return enrichedList;
}

/**
 * High-level seam: Extract token entities from text and optionally enrich with a resolver.
 *
 * @param {string} text - Raw tweet or message text.
 * @param {ExtractTokenOptions & { resolver?: Function }} [options={}]
 * @returns {Promise<TokenMentionEntity[]>}
 */
export async function resolveWithEnrichment(text, options = {}) {
  const { resolver, ...extractOpts } = options;
  const entities = extractTokenEntities(text, extractOpts);
  if (typeof resolver === 'function') {
    return await enrichTokenEntities(entities, resolver);
  }
  return entities;
}

export default {
  extractTokenEntities,
  createDexscreenerTokenResolver,
  enrichTokenEntities,
  resolveWithEnrichment,
  isValidSolanaAddress,
  isValidEvmAddress,
};
