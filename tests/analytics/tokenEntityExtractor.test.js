// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — TokenEntityExtractor Unit Tests (Story 54.1, Epic 54)
// by nichxbt

import { describe, it, expect } from 'vitest';
import {
  extractTokenEntities,
  createDexscreenerTokenResolver,
  enrichTokenEntities,
  resolveWithEnrichment,
  isValidSolanaAddress,
  isValidEvmAddress,
} from '../../src/analytics/tokenEntityExtractor.js';

describe('TokenEntityExtractor (Story 54.1)', () => {
  // -------------------------------------------------------------------------
  // Address Validators
  // -------------------------------------------------------------------------
  describe('Address Validators', () => {
    it('validates EVM addresses accurately (0x + 40 hex chars)', () => {
      expect(isValidEvmAddress('0x6982508145454Ce325dDbE47a25d4ec3d2311933')).toBe(true);
      expect(isValidEvmAddress('0x6982508145454ce325ddbe47a25d4ec3d2311933')).toBe(true);
      // Bad lengths
      expect(isValidEvmAddress('0x1234')).toBe(false);
      expect(isValidEvmAddress('0x6982508145454Ce325dDbE47a25d4ec3d2311933aa')).toBe(false);
      // Non-hex characters
      expect(isValidEvmAddress('0xZZZZ508145454Ce325dDbE47a25d4ec3d2311933')).toBe(false);
      // Non-strings
      expect(isValidEvmAddress(null)).toBe(false);
      expect(isValidEvmAddress(undefined)).toBe(false);
    });

    it('validates Solana Base58 addresses accurately (32-44 base58 chars, no 0, O, I, l)', () => {
      expect(isValidSolanaAddress('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP')).toBe(true);
      expect(isValidSolanaAddress('5b4n12eHotCTYxktAkKcD6xhakzoAnwZJJad8f8fpump')).toBe(true);

      // Forbidden ambiguous characters: 0, O, I, l
      expect(isValidSolanaAddress('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1p0')).toBe(false); // contains '0'
      expect(isValidSolanaAddress('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pO')).toBe(false); // contains 'O'
      expect(isValidSolanaAddress('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pI')).toBe(false); // contains 'I'
      expect(isValidSolanaAddress('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pl')).toBe(false); // contains 'l'

      // Out-of-bounds lengths
      expect(isValidSolanaAddress('Short123')).toBe(false);
      expect(isValidSolanaAddress('1111111111111111111111111111111111111111111111111')).toBe(false); // 49 chars

      // Non-strings
      expect(isValidSolanaAddress(null)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // I/O Matrix Scenarios
  // -------------------------------------------------------------------------
  describe('I/O Matrix Scenarios', () => {
    it('HAPPY_PATH: extracts cashtag with confidence < 1 and contract with confidence = 1', () => {
      const text = '$BONK pumping, contract DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP';
      const entities = extractTokenEntities(text);

      expect(entities).toHaveLength(2);

      const contractEntity = entities.find((e) => e.mentionType === 'contract');
      expect(contractEntity).toBeDefined();
      expect(contractEntity.canonicalId).toBe('token:solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP');
      expect(contractEntity.chain).toBe('solana');
      expect(contractEntity.contract).toBe('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP');
      expect(contractEntity.confidence).toBe(1.0);
      expect(contractEntity.ambiguous).toBe(false);

      const cashtagEntity = entities.find((e) => e.mentionType === 'cashtag');
      expect(cashtagEntity).toBeDefined();
      expect(cashtagEntity.canonicalId).toBe('token:sym:BONK');
      expect(cashtagEntity.symbol).toBe('BONK');
      expect(cashtagEntity.confidence).toBeLessThan(1.0);
      expect(cashtagEntity.ambiguous).toBe(true);
    });

    it('MULTI_TOKEN: extracts multiple cashtags and multiple contracts with distinct canonicalIds', () => {
      const text = 'Check $PEPE and $WIF now: 0x6982508145454Ce325dDbE47a25d4ec3d2311933 and DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP';
      const entities = extractTokenEntities(text);

      expect(entities).toHaveLength(4);

      const canonicalIds = entities.map((e) => e.canonicalId);
      expect(canonicalIds).toContain('token:ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933');
      expect(canonicalIds).toContain('token:solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP');
      expect(canonicalIds).toContain('token:sym:PEPE');
      expect(canonicalIds).toContain('token:sym:WIF');

      // Each has distinct canonicalId
      expect(new Set(canonicalIds).size).toBe(4);
    });

    it('FAKE_CASHTAG: does not extract $ + digits ($100) or single-letter ($A)', () => {
      expect(extractTokenEntities('$100 to the moon')).toEqual([]);
      expect(extractTokenEntities('$5000 profit')).toEqual([]);
      expect(extractTokenEntities('$A moon')).toEqual([]);
      expect(extractTokenEntities('$')).toEqual([]);
      expect(extractTokenEntities('$$$')).toEqual([]);
    });

    it('SAME_SYMBOL_DIFF_CHAIN: maintains ambiguous token:sym:SYMBOL without guessing chain', () => {
      const text = 'Holding my bag of $PEPE';
      const aliasMap = {
        pepe_eth: { symbol: 'PEPE', contract: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chain: 'ethereum' },
        pepe_sol: { symbol: 'PEPE', contract: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP', chain: 'solana' },
      };

      const entities = extractTokenEntities(text, { aliasMap });
      expect(entities).toHaveLength(1);
      expect(entities[0].canonicalId).toBe('token:sym:PEPE');
      expect(entities[0].symbol).toBe('PEPE');
      expect(entities[0].chain).toBeUndefined();
      expect(entities[0].confidence).toBeLessThan(1.0);
      expect(entities[0].ambiguous).toBe(true);
    });

    it('CONTRACT_DISAMBIG: maps symbol to contract entity if aliasMap provides mapping', () => {
      const text = 'Pepe contract 0x6982508145454Ce325dDbE47a25d4ec3d2311933 $PEPE';
      const aliasMap = {
        '0x6982508145454Ce325dDbE47a25d4ec3d2311933': 'PEPE',
      };

      const entities = extractTokenEntities(text, { aliasMap });
      expect(entities).toHaveLength(2);

      const contractEntity = entities.find((e) => e.mentionType === 'contract');
      expect(contractEntity).toBeDefined();
      expect(contractEntity.canonicalId).toBe('token:ethereum:0x6982508145454ce325ddbe47a25d4ec3d2311933');
      expect(contractEntity.symbol).toBe('PEPE');
      expect(contractEntity.confidence).toBe(1.0);

      const cashtagEntity = entities.find((e) => e.mentionType === 'cashtag');
      expect(cashtagEntity).toBeDefined();
      expect(cashtagEntity.canonicalId).toBe('token:sym:PEPE');
      expect(cashtagEntity.symbol).toBe('PEPE');
    });

    it('INVALID_ADDR: silently ignores corrupted or invalid address formats', () => {
      const badAddressesText =
        'Fake addr: 0x1234, 0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ, DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1p0';
      const entities = extractTokenEntities(badAddressesText);
      expect(entities).toEqual([]);
    });

    it('BARE_NAME: extracts bare name with aliasMap, confidence < 1', () => {
      const text = 'dogwifhat is trending today';
      const aliasMap = {
        dogwifhat: 'WIF',
      };

      const entities = extractTokenEntities(text, { aliasMap });
      expect(entities).toHaveLength(1);
      expect(entities[0].canonicalId).toBe('token:sym:WIF');
      expect(entities[0].symbol).toBe('WIF');
      expect(entities[0].confidence).toBeLessThan(1.0);
      expect(entities[0].mentionType).toBe('name');
      expect(entities[0].rawMention).toBe('dogwifhat');
    });

    it('BARE_NAME with contract in aliasMap resolves to canonicalId with contract', () => {
      const text = 'dogwifhat mooning';
      const aliasMap = {
        dogwifhat: {
          symbol: 'WIF',
          contract: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP',
          chain: 'solana',
        },
      };

      const entities = extractTokenEntities(text, { aliasMap });
      expect(entities).toHaveLength(1);
      expect(entities[0].canonicalId).toBe('token:solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP');
      expect(entities[0].contract).toBe('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP');
      expect(entities[0].symbol).toBe('WIF');
      expect(entities[0].confidence).toBeLessThan(1.0);
    });

    it('BARE_NAME_NO_ALIAS: ignores bare names in text when no alias map is provided', () => {
      const text = 'dogwifhat mooning and bitcoin surging';
      const entities = extractTokenEntities(text);
      expect(entities).toEqual([]);
    });

    it('EMPTY_INPUT: handles empty, whitespace, null, or undefined input gracefully', () => {
      expect(extractTokenEntities('')).toEqual([]);
      expect(extractTokenEntities('   ')).toEqual([]);
      expect(extractTokenEntities(null)).toEqual([]);
      expect(extractTokenEntities(undefined)).toEqual([]);
      expect(extractTokenEntities(12345)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Dexscreener Enrichment Tests
  // -------------------------------------------------------------------------
  describe('Dexscreener Enrichment Seam', () => {
    it('ENRICH_SUCCESS: enrichTokenEntities resolves symbol from max liquidity pair', async () => {
      // Deterministic real scraper function adhering to dexscreener normalizer flat shape
      const realScrapeFn = async (platform, action, args) => {
        expect(platform).toBe('dexscreener');
        expect(action).toBe('token_lookup');

        if (args.tokenAddress === 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP') {
          return {
            platform: 'dexscreener',
            type: 'token_lookup',
            data: {
              chain_id: 'solana',
              token_address: args.tokenAddress,
              pairs: [
                {
                  base_symbol: 'BONK',
                  base_name: 'Bonk Coin',
                  liquidity_usd: 500,
                  pair_address: 'low_liq_pair',
                },
                {
                  base_symbol: 'BONK',
                  base_name: 'Bonk Coin',
                  liquidity_usd: 12500000,
                  volume_24h: 3400000,
                  pair_address: 'raydium_main_pair',
                  pair_url: 'https://dexscreener.com/solana/raydium_main_pair',
                  dex_id: 'raydium',
                },
              ],
            },
          };
        }
        return { data: { pairs: [] } };
      };

      const cache = new Map();
      const resolver = createDexscreenerTokenResolver({ scrape: realScrapeFn, cache });

      const entities = extractTokenEntities(
        'Solana token contract DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP'
      );
      expect(entities).toHaveLength(1);
      expect(entities[0].symbol).toBeUndefined();

      const enriched = await enrichTokenEntities(entities, resolver);
      expect(enriched).toHaveLength(1);
      expect(enriched[0].symbol).toBe('BONK');
      expect(enriched[0].enriched).toBe(true);
      expect(enriched[0].dexscreener).toBeDefined();
      expect(enriched[0].dexscreener.liquidityUsd).toBe(12500000);
      expect(enriched[0].dexscreener.pairAddress).toBe('raydium_main_pair');

      // Cache hit test
      expect(cache.size).toBe(1);
      const cachedResult = await resolver({
        chainId: 'solana',
        tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP',
      });
      expect(cachedResult.pairAddress).toBe('raydium_main_pair');
    });

    it('ENRICH_MISS: retains original entity confidence and data when resolver returns empty/null', async () => {
      const realMissScrapeFn = async () => ({
        platform: 'dexscreener',
        type: 'token_lookup',
        data: { pairs: [] },
      });

      const resolver = createDexscreenerTokenResolver({ scrape: realMissScrapeFn });

      const entities = extractTokenEntities(
        'contract 0x6982508145454Ce325dDbE47a25d4ec3d2311933'
      );
      expect(entities).toHaveLength(1);
      const originalConfidence = entities[0].confidence;

      const enriched = await enrichTokenEntities(entities, resolver);
      expect(enriched).toHaveLength(1);
      expect(enriched[0].confidence).toBe(originalConfidence);
      expect(enriched[0].enriched).toBeUndefined();
      expect(enriched[0].symbol).toBeUndefined();
    });

    it('resolveWithEnrichment convenience function combines extraction and enrichment', async () => {
      const scrapeFn = async (p, a, args) => ({
        data: {
          pairs: [
            {
              base_symbol: 'TEST',
              liquidity_usd: 100000,
            },
          ],
        },
      });

      const resolver = createDexscreenerTokenResolver({ scrape: scrapeFn });
      const text = 'Token 0x6982508145454Ce325dDbE47a25d4ec3d2311933 and $TEST';
      const results = await resolveWithEnrichment(text, { resolver });

      expect(results).toHaveLength(2);
      const contractEnt = results.find((e) => e.mentionType === 'contract');
      expect(contractEnt.symbol).toBe('TEST');
      expect(contractEnt.enriched).toBe(true);

      const cashtagEnt = results.find((e) => e.mentionType === 'cashtag');
      expect(cashtagEnt.symbol).toBe('TEST');
      expect(cashtagEnt.canonicalId).toBe('token:sym:TEST');
    });
  });
});
