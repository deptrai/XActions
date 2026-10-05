// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for tokenEntityExtractor.js — cashtag, contract & bare-name
 * extraction into canonical token ids.
 *
 * No mock frameworks — deterministic injected functions at the documented
 * seams (`resolveToken`, `scrape`) per spec AC.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  extractTokenEntities,
  createDexscreenerTokenResolver,
  enrichTokenEntities,
  resolveWithEnrichment,
  isValidSolanaAddress,
  isValidEvmAddress,
} from '../../src/analytics/tokenEntityExtractor.js';

// ============================================================================
// Fixtures
// ============================================================================

const SOL_CONTRACT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP'; // real BONK mint-style (41 chars, has letters)
const EVM_CONTRACT = '0x6982508145454Ce325dDbE47a25d4ec3d2311933'; // real PEPE
const SOL_NO_LETTERISH = '12345678901234567890123456789012'; // all digits — must reject

/**
 * Deterministic injected scrape — real `scrape(source, action, args)`
 * signature, backed by a fixture table.
 * @param {Map<string, object>} fixtures — `${action}:${chainId}:${tokenAddress}` -> res
 * @param {Array<{source:string, action:string, args:object}>} [calls] - call log
 * @returns {(source:string, action:string, args:object) => Promise<object>}
 */
function makeScrape(fixtures, calls = []) {
  return async (/** @type {string} */ source, /** @type {string} */ action, /** @type {object} */ args) => {
    calls.push({ source, action, args });
    const key = `${action}:${args.chainId}:${args.tokenAddress}`;
    return fixtures.get(key) ?? { data: { pairs: [] } };
  };
}

/**
 * Find an entity by canonicalId or throw — keeps tests free of
 * possibly-undefined dereferences.
 * @param {Array<{canonicalId:string}>} entities
 * @param {string} canonicalId
 * @returns {{canonicalId:string, chain?:string, contract?:string, symbol?:string,
 *   confidence:number, mentionType:string, rawMention:string, enriched?:boolean,
 *   dexscreener?:object}}
 */
function byId(entities, canonicalId) {
  const found = entities.find((e) => e.canonicalId === canonicalId);
  if (!found) throw new Error(`expected entity ${canonicalId} — got ${JSON.stringify(entities.map(e=>e.canonicalId))}`);
  return found;
}

const DEX_HIT = {
  data: {
    pairs: [
      {
        pair_address: 'PairLow1111111111111111111111111111111',
        base_symbol: 'LOW',
        liquidity_usd: 100,
        volume_24h: 10,
        chain_id: 'solana',
      },
      {
        pair_address: 'PairBest111111111111111111111111111111',
        base_symbol: 'BONK',
        liquidity_usd: 5000,
        volume_24h: 900,
        chain_id: 'solana',
      },
    ],
  },
};

// ============================================================================
// HAPPY_PATH
// ============================================================================

describe('HAPPY_PATH', () => {
  it('extracts cashtag + solana contract as two separate entities', () => {
    const text = `$BONK pumping, contract ${SOL_CONTRACT}`;
    const entities = extractTokenEntities(text);
    expect(entities).toHaveLength(2);

    const sym = byId(entities, 'token:sym:BONK');
    expect(sym.symbol).toBe('BONK');
    expect(sym.confidence).toBeLessThan(1);
    expect(sym.mentionType).toBe('cashtag');

    const contract = byId(entities, `token:solana:${SOL_CONTRACT}`);
    expect(contract.chain).toBe('solana');
    expect(contract.contract).toBe(SOL_CONTRACT);
    expect(contract.confidence).toBe(1); // 'contract' keyword within ±100 chars
  });

  it('EVM contract resolves with chain inferred + lowercase normalization', () => {
    const entities = extractTokenEntities(`ape into 0x6982508145454Ce325dDbE47a25d4ec3d2311933 ser`);
    expect(entities).toHaveLength(1);
    expect(entities[0].canonicalId).toBe('token:ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933');
    expect(entities[0].confidence).toBe(1);
  });
});

// ============================================================================
// MULTI_TOKEN
// ============================================================================

describe('MULTI_TOKEN', () => {
  it('extracts every mention with its own canonicalId', () => {
    const text = `$PEPE and $WIF both mooning, contract ${SOL_CONTRACT} and eth contract ${EVM_CONTRACT}`;
    const entities = extractTokenEntities(text);
    const ids = entities.map((e) => e.canonicalId);
    expect(ids).toContain('token:sym:PEPE');
    expect(ids).toContain('token:sym:WIF');
    expect(ids).toContain(`token:solana:${SOL_CONTRACT}`);
    expect(ids).toContain('token:ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933');
    expect(entities).toHaveLength(4);
  });
});

// ============================================================================
// FAKE_CASHTAG
// ============================================================================

describe('FAKE_CASHTAG', () => {
  it('does not extract "$100 to the moon" or single-char "$A"', () => {
    expect(extractTokenEntities('$100 to the moon')).toHaveLength(0);
    expect(extractTokenEntities('$A is too short')).toHaveLength(0);
  });
});

// ============================================================================
// SAME_SYMBOL_DIFF_CHAIN
// ============================================================================

describe('SAME_SYMBOL_DIFF_CHAIN', () => {
  it('symbol-only mention stays token:sym:* and never guesses a chain', () => {
    const aliasMap = {
      'pepe-eth': { symbol: 'PEPE', chain: 'ethereum', contract: EVM_CONTRACT },
      'pepe-sol': { symbol: 'PEPE', chain: 'solana', contract: SOL_CONTRACT },
    };
    const entities = extractTokenEntities('$PEPE going crazy', { aliasMap });
    const sym = byId(entities, 'token:sym:PEPE');
    expect(sym.chain).toBeUndefined();
    expect(sym.confidence).toBeLessThan(1);
  });
});

// ============================================================================
// CONTRACT_DISAMBIG
// ============================================================================

describe('CONTRACT_DISAMBIG', () => {
  it('contract + cashtag in same tweet stay separate entities', () => {
    const text = `$PEPE new contract ${EVM_CONTRACT} just dropped`;
    const entities = extractTokenEntities(text);
    const contract = byId(entities, 'token:ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933');
    expect(byId(entities, 'token:sym:PEPE').mentionType).toBe('cashtag');
    expect(contract.mentionType).toBe('contract');
  });

  it('contract-keyed alias attaches symbol to the contract entity', () => {
    const aliasMap = { [EVM_CONTRACT.toLowerCase()]: 'PEPE' };
    const entities = extractTokenEntities(`check ${EVM_CONTRACT}`, { aliasMap });
    const contract = byId(entities, 'token:ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933');
    expect(contract.symbol).toBe('PEPE');
  });
});

// ============================================================================
// INVALID_ADDR
// ============================================================================

describe('INVALID_ADDR', () => {
  it('skips wrong-length base58, forbidden chars, and bad EVM hex', () => {
    const text = 'id Abc123xYZ and contract 0x6982508145454Ce325dDbE47a25d4ec3d2311 and 0OIl1111111111111111111111111111111';
    const entities = extractTokenEntities(text);
    expect(entities.filter((e) => e.mentionType === 'contract')).toHaveLength(0);
  });

  it('rejects all-digit base58 candidates (tweet ids, numeric strings)', () => {
    expect(isValidSolanaAddress(SOL_NO_LETTERISH)).toBe(false);
    const text = `check this contract ${SOL_NO_LETTERISH} now`;
    const entities = extractTokenEntities(text);
    expect(entities.filter((e) => e.mentionType === 'contract')).toHaveLength(0);
  });
});

// ============================================================================
// BARE_NAME / BARE_NAME_NO_ALIAS
// ============================================================================

describe('BARE_NAME', () => {
  it('resolves bare name via alias map to token:sym:*', () => {
    const entities = extractTokenEntities('dogwifhat mooning', {
      aliasMap: { dogwifhat: 'WIF' },
    });
    expect(entities).toHaveLength(1);
    expect(entities[0].canonicalId).toBe('token:sym:WIF');
    expect(entities[0].confidence).toBeLessThan(0.8);
    expect(entities[0].mentionType).toBe('alias');
  });

  it('resolves bare name via alias map to contract identity when contract given', () => {
    const entities = extractTokenEntities('bonk is mooning', {
      aliasMap: { bonk: { symbol: 'BONK', chain: 'solana', contract: SOL_CONTRACT } },
    });
    expect(entities).toHaveLength(1);
    expect(entities[0].canonicalId).toBe(`token:solana:${SOL_CONTRACT}`);
    expect(entities[0].confidence).toBe(0.8);
    expect(entities[0].symbol).toBe('BONK');
  });

  it('degrades to symbol-only when alias contract is invalid', () => {
    const entities = extractTokenEntities('scamtoken rising', {
      aliasMap: { scamtoken: { symbol: 'SCAM', chain: 'solana', contract: 'not-an-address' } },
    });
    expect(entities).toHaveLength(1);
    expect(entities[0].canonicalId).toBe('token:sym:SCAM');
    expect(entities[0].contract).toBeUndefined();
  });
});

describe('BARE_NAME_NO_ALIAS', () => {
  it('does not extract bare names without an alias map', () => {
    expect(extractTokenEntities('dogwifhat mooning')).toHaveLength(0);
  });
});

// ============================================================================
// EMPTY_INPUT
// ============================================================================

describe('EMPTY_INPUT', () => {
  it('returns [] for empty, null, undefined and non-string input', () => {
    expect(extractTokenEntities('')).toEqual([]);
    expect(extractTokenEntities(null)).toEqual([]);
    expect(extractTokenEntities(undefined)).toEqual([]);
    expect(extractTokenEntities(42)).toEqual([]);
  });

  it('tolerates options=null like undefined', () => {
    expect(extractTokenEntities('$BONK', null)).toHaveLength(1);
  });
});

// ============================================================================
// ENRICH_MISS / enrichment seam
// ============================================================================

describe('ENRICH_MISS', () => {
  it('keeps original entity when resolver returns null', async () => {
    const entities = extractTokenEntities(`contract ${SOL_CONTRACT}`);
    const missResolver = async () => null;
    const enriched = await enrichTokenEntities(entities, missResolver);
    expect(enriched).toHaveLength(1);
    expect(enriched[0].confidence).toBe(1);
    expect(enriched[0].enriched).toBeUndefined();
    expect(enriched[0].dexscreener).toBeUndefined();
  });

  it('returns [] for non-array input', async () => {
    expect(await enrichTokenEntities(null, async () => null)).toEqual([]);
    expect(await enrichTokenEntities('nope')).toEqual([]);
    expect(await enrichTokenEntities(undefined, async () => null)).toEqual([]);
  });
});

describe('enrichment hit', () => {
  it('attaches dexscreener result, enriched flag and symbol on hit', async () => {
    const entities = extractTokenEntities(`contract ${SOL_CONTRACT}`);
    const scrape = makeScrape(new Map([[`token_lookup:solana:${SOL_CONTRACT}`, DEX_HIT]]));
    const resolver = createDexscreenerTokenResolver({ scrape });
    const enriched = await enrichTokenEntities(entities, resolver);
    expect(enriched).toHaveLength(1);
    const e = enriched[0];
    expect(e.enriched).toBe(true);
    expect(e.symbol).toBe('BONK'); // max-liquidity anchor pair
    expect(e.dexscreener.liquidityUsd).toBe(5000);
    expect(e.dexscreener.volume24h).toBe(900);
    expect(e.dexscreener.pairAddress).toBe('PairBest111111111111111111111111111111');
  });
});

// ============================================================================
// Resolver factory — settled decisions
// ============================================================================

describe('createDexscreenerTokenResolver', () => {
  it('throws immediately when deps.scrape is missing (fail-fast)', () => {
    expect(() => createDexscreenerTokenResolver({})).toThrow();
    expect(() => createDexscreenerTokenResolver()).toThrow();
    expect(() => createDexscreenerTokenResolver({ scrape: 'nope' })).toThrow();
  });

  it('resolves with {contract}-only args (tokenAddress alias)', async () => {
    const calls = [];
    const scrape = makeScrape(
      new Map([[`token_lookup:solana:${SOL_CONTRACT}`, DEX_HIT]]),
      calls
    );
    const resolver = createDexscreenerTokenResolver({ scrape });
    const result = await resolver({ contract: SOL_CONTRACT, chain: 'solana' });
    expect(result).not.toBeNull();
    expect(result.symbol).toBe('BONK');
    expect(calls[0].args.tokenAddress).toBe(SOL_CONTRACT);
    expect(calls[0].args.chainId).toBe('solana');
  });

  it('returns null on resolver/scrape throw — never propagates', async () => {
    const resolver = createDexscreenerTokenResolver({
      scrape: async () => {
        throw new Error('network down');
      },
    });
    expect(await resolver({ tokenAddress: SOL_CONTRACT, chainId: 'solana' })).toBeNull();
  });

  it('returns null for empty pairs and does not cache misses', async () => {
    const cache = new Map();
    const scrape = makeScrape(new Map()); // everything misses
    const resolver = createDexscreenerTokenResolver({ scrape, cache });
    expect(await resolver({ tokenAddress: SOL_CONTRACT, chainId: 'solana' })).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('caches hits via injectable cache', async () => {
    const cache = new Map();
    const calls = [];
    const scrape = makeScrape(
      new Map([[`token_lookup:solana:${SOL_CONTRACT}`, DEX_HIT]]),
      calls
    );
    const resolver = createDexscreenerTokenResolver({ scrape, cache });
    const a = await resolver({ tokenAddress: SOL_CONTRACT, chainId: 'solana' });
    const b = await resolver({ tokenAddress: SOL_CONTRACT, chainId: 'solana' });
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
  });

  it('withSocials opt-in calls token_socials and merges socials', async () => {
    const calls = [];
    const scrape = makeScrape(
      new Map([
        [`token_lookup:solana:${SOL_CONTRACT}`, DEX_HIT],
        [`token_socials:solana:${SOL_CONTRACT}`, { data: { socials: [{ type: 'twitter', url: 'https://x.com/bonk' }] } }],
      ]),
      calls
    );
    const resolver = createDexscreenerTokenResolver({ scrape, withSocials: true });
    const result = await resolver({ tokenAddress: SOL_CONTRACT, chainId: 'solana' });
    expect(result.socials).toBeDefined();
    expect(calls.map((c) => c.action)).toEqual(['token_lookup', 'token_socials']);
  });

  it('withSocials defaults off — no token_socials call', async () => {
    const calls = [];
    const scrape = makeScrape(
      new Map([[`token_lookup:solana:${SOL_CONTRACT}`, DEX_HIT]]),
      calls
    );
    const resolver = createDexscreenerTokenResolver({ scrape });
    await resolver({ tokenAddress: SOL_CONTRACT, chainId: 'solana' });
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe('token_lookup');
  });
});

describe('resolveWithEnrichment', () => {
  it('extracts then enriches via injected resolver function', async () => {
    const resolver = async () => ({ symbol: 'BONK', chainId: 'solana', liquidityUsd: 1 });
    const out = await resolveWithEnrichment(`contract ${SOL_CONTRACT}`, { resolver });
    expect(out[0].enriched).toBe(true);
    expect(out[0].symbol).toBe('BONK');
  });

  it('tolerates options=null', async () => {
    const out = await resolveWithEnrichment('$BONK', null);
    expect(out).toHaveLength(1);
    expect(out[0].canonicalId).toBe('token:sym:BONK');
  });

  it('builds a dexscreener resolver from the { scrape } shorthand', async () => {
    const scrape = makeScrape(new Map([[`token_lookup:solana:${SOL_CONTRACT}`, DEX_HIT]]));
    const out = await resolveWithEnrichment(`contract ${SOL_CONTRACT}`, { scrape });
    expect(out[0].enriched).toBe(true);
    expect(out[0].symbol).toBe('BONK');
  });

  it('treats a throwing injected resolver as a miss — never propagates', async () => {
    const entities = extractTokenEntities(`contract ${SOL_CONTRACT}`);
    const throwing = async () => { throw new Error('boom'); };
    const out = await enrichTokenEntities(entities, throwing);
    expect(out[0].enriched).toBeUndefined();
    expect(out[0].contract).toBe(SOL_CONTRACT);
  });
});

describe('pass-2 review patches', () => {
  it('does not extract a Solana contract out of a malformed 0x<41+hex> run', () => {
    const text = `ape 0x6982508145454Ce325dDbE47a25d4ec3d2311933aa now`;
    const entities = extractTokenEntities(text);
    expect(entities.filter((e) => e.mentionType === 'contract')).toHaveLength(0);
  });

  it('zero-liquidity pairs still resolve to first pair, not a miss', async () => {
    const zeroHit = { data: { pairs: [{ base_symbol: 'BONK', chain_id: 'solana', liquidity_usd: 0, pair_address: 'p1' }] } };
    const scrape = makeScrape(new Map([[`token_lookup:solana:${SOL_CONTRACT}`, zeroHit]]));
    const resolver = createDexscreenerTokenResolver({ scrape });
    const result = await resolver({ tokenAddress: SOL_CONTRACT, chainId: 'solana' });
    expect(result).not.toBeNull();
    expect(result.symbol).toBe('BONK');
  });

  it('empty-string alias key is ignored instead of flooding entities', () => {
    const entities = extractTokenEntities('nothing here', { aliasMap: { '': 'BOOM' } });
    expect(entities).toHaveLength(0);
  });

  it('non-object elements pass through enrichTokenEntities untouched', async () => {
    const resolver = async () => ({ symbol: 'X' });
    const out = await enrichTokenEntities([null, 'str', 7], resolver);
    expect(out).toEqual([null, 'str', 7]);
  });

  it('non-string alias symbol is coerced, not TypeError', () => {
    const entities = extractTokenEntities('bonk time', { aliasMap: { bonk: { symbol: 123 } } });
    expect(entities[0].canonicalId).toBe('token:sym:123');
  });
});

// ============================================================================
// Settled-decision coverage (#15)
// ============================================================================

describe('settled decisions', () => {
  it('bare base58 without adjacent context → confidence 0.7', () => {
    // No token-context keyword and no cashtag within ±100 chars.
    const text = `random hash ${SOL_CONTRACT} stored in the database record for later use here`;
    const entities = extractTokenEntities(text);
    expect(entities).toHaveLength(1);
    expect(entities[0].confidence).toBe(0.7);
  });

  it('context boost is positional — distant cashtag does not boost', () => {
    const gap = '-'.repeat(150);
    const text = `$BONK ${gap}${SOL_CONTRACT}${gap}`;
    const entities = extractTokenEntities(text);
    const contract = byId(entities, `token:solana:${SOL_CONTRACT}`);
    expect(contract.confidence).toBe(0.7);
  });

  it('requireSolanaContext:true skips no-context candidates', () => {
    const text = `random hash ${SOL_CONTRACT} stored in the database record for later use here`;
    expect(extractTokenEntities(text, { requireSolanaContext: true })).toHaveLength(0);
    const withCtx = extractTokenEntities(`contract ${SOL_CONTRACT}`, {
      requireSolanaContext: true,
    });
    expect(withCtx).toHaveLength(1);
    expect(withCtx[0].confidence).toBe(1);
  });

  it('$PEPE_ARMY is not a cashtag (underscore boundary)', () => {
    expect(extractTokenEntities('$PEPE_ARMY to the moon')).toHaveLength(0);
    // and foo$BAR is not a cashtag either (weak-regex helper must not exist)
    expect(extractTokenEntities('foo$BAR mentioned')).toHaveLength(0);
  });

  it('accepts 0X uppercase prefix, normalizes to 0x lowercase', () => {
    const text = 'new contract 0X6982508145454CE325DDBE47A25D4EC3D2311933 live';
    const entities = extractTokenEntities(text);
    expect(entities).toHaveLength(1);
    expect(entities[0].contract).toBe('0x6982508145454ce325ddbe47a25d4ec3d2311933');
    expect(isValidEvmAddress('0X6982508145454CE325DDBE47A25D4EC3D2311933')).toBe(true);
  });

  it('infers EVM chain from context keywords (bsc)', () => {
    const text = `bsc contract ${EVM_CONTRACT} just launched`;
    const entities = extractTokenEntities(text);
    expect(entities[0].canonicalId).toBe('token:bsc:0x6982508145454ce325ddbe47a25d4ec3d2311933');
    expect(entities[0].chain).toBe('bsc');
  });

  it('falls back to defaultEvmChain when no chain keyword nearby', () => {
    const text = `interesting ${EVM_CONTRACT}`;
    const entities = extractTokenEntities(text, { defaultEvmChain: 'base' });
    expect(entities[0].chain).toBe('base');
  });

  it('contract-keyed aliasMap lookup is case-insensitive for EVM', () => {
    // aliasMap key lowercased, text contract checksummed — still resolves symbol
    const aliasMap = { ['0x6982508145454ce325ddbe47a25d4ec3d2311933']: 'PEPE' };
    const entities = extractTokenEntities(`check ${EVM_CONTRACT} now`, { aliasMap });
    expect(entities[0].symbol).toBe('PEPE');
  });

  it('dedup merges fields instead of dropping later mention data', () => {
    // bare-name alias → contract identity, plus the literal contract in text:
    // two mentions, one canonicalId → single entity with merged fields.
    const aliasMap = {
      bonk: { symbol: 'BONK', chain: 'solana', contract: SOL_CONTRACT },
    };
    const text = `bonk is mooning, contract ${SOL_CONTRACT} grab it`;
    const entities = extractTokenEntities(text, { aliasMap });
    const contractEntities = entities.filter((e) => e.contract === SOL_CONTRACT);
    expect(contractEntities).toHaveLength(1);
    const e = contractEntities[0];
    expect(e.symbol).toBe('BONK');       // filled from alias mention
    expect(e.chain).toBe('solana');
    expect(e.confidence).toBe(1);        // upgraded by context-boosted contract
  });

  it('alias keys match longest-first and whole-word only', () => {
    const aliasMap = { wif: 'WIF', dogwifhat: 'WIF2' };
    const entities = extractTokenEntities('dogwifhat mooning', { aliasMap });
    // 'dogwifhat' matches as a whole word; inner 'wif' must not double-fire
    expect(entities).toHaveLength(1);
    expect(entities[0].canonicalId).toBe('token:sym:WIF2');
    // substring inside another word does not match
    expect(extractTokenEntities('dogwifhatxyz mooning', { aliasMap })).toHaveLength(0);
  });
});
