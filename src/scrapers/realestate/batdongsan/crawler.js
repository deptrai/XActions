// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Batdongsan.com.vn Crawler
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { BatdongsanClient } from './client.js';
import {
  decodeBatdongsanPayload,
  normalizeBatdongsanListing,
  CATE_CODES,
} from './normalize-batdongsan.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

const CITY_ALIAS_MAP = {
  'ho-chi-minh': 'SG', 'hcm': 'SG', 'tp-hcm': 'SG', 'sai-gon': 'SG', 'sg': 'SG',
  'ha-noi': 'HN', 'hanoi': 'HN', 'hn': 'HN',
  'da-nang': 'DN', 'danang': 'DN', 'dn': 'DN',
  'binh-duong': 'BD', 'bd': 'BD',
  'dong-nai': 'DDN', 'ddn': 'DDN',
  'khanh-hoa': 'KH', 'kh': 'KH',
  'hai-phong': 'HP', 'hp': 'HP',
  'can-tho': 'CT', 'ct': 'CT',
};

export class BatdongsanCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'batdongsan';

  /** @type {string} */
  platform = 'batdongsan';

  /** @type {boolean} */
  requiresAuth = false;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const client = options.client || new BatdongsanClient(options);
    super({
      client,
      ...options,
    });

    this.registerAction({
      action: 'search_listings',
      description: 'Search real estate listings on Batdongsan.com.vn via mobile p_sync API',
      category: 'realestate',
      requiredArgs: [],
      optionalArgs: ['city', 'category', 'listingType', 'minPrice', 'maxPrice', 'page', 'limit'],
      example: { city: 'SG', category: 'can-ho', limit: 20 },
      outputType: '{ listings: PostItem[], pageInfo: { current_page: number, has_next_page: boolean, total_items?: number } }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.searchListings(args, session),
    });

    this.registerAction({
      action: 'listing_detail',
      description: 'Scrape detailed listing specification from Batdongsan by productId',
      category: 'realestate',
      requiredArgs: ['productId'],
      optionalArgs: ['url', 'city'],
      example: { productId: '39821049' },
      outputType: '{ listing: PostItem }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.listingDetail(args, session),
    });
  }

  /**
   * Action Handler: search_listings
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async searchListings(args = {}, session) {
    const rawCity = String(args.city || 'SG').trim();
    const city = CITY_ALIAS_MAP[rawCity.toLowerCase()] || rawCity;
    const page = Math.max(1, Number(args.page) || 1);
    const limit = Math.max(1, Number(args.limit) || 20);

    const cateCode = (args.category && CATE_CODES[args.category] !== undefined)
      ? CATE_CODES[args.category]
      : (CATE_CODES[args.cate] || 0);

    const ptype = args.listingType === 'rent' || args.ptype === 49 ? 49 : 38;

    const payload = {
      ptype,
      cate: cateCode,
      city,
      p: page,
      ps: limit,
    };

    if (args.minPrice != null) payload.minPrice = Number(args.minPrice);
    if (args.maxPrice != null) payload.maxPrice = Number(args.maxPrice);

    const rawBuffer = await this.client.postSyncRaw('/api/p_sync', payload);
    const decoded = decodeBatdongsanPayload(rawBuffer);

    const rawList = Array.isArray(decoded?.data) ? decoded.data : (Array.isArray(decoded?.items) ? decoded.items : []);
    const listings = rawList.map((item) => normalizeBatdongsanListing(item));

    if (this.store && typeof this.store.storeBatch === 'function') {
      try {
        await this.store.storeBatch(listings, { validateSchema: true });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[BatdongsanCrawler] Failed to persist listings batch:', err.message);
        }
      }
    }

    if (this.store && typeof this.store.saveCheckpoint === 'function') {
      try {
        await this.store.saveCheckpoint({
          platform: 'batdongsan',
          targetType: 'listings',
          targetKey: `${city}:${cateCode}:${ptype}`,
          lastCursor: String(page),
          lastTimestamp: new Date(),
          lastCrawledAt: new Date(),
          status: rawList.length >= limit ? 'has_more' : 'completed',
        });
      } catch {}
    }

    const totalHits = decoded?.totalHits ?? decoded?.total ?? listings.length;

    return {
      listings,
      pageInfo: {
        current_page: page,
        has_next_page: rawList.length >= limit,
        total_items: totalHits,
      },
    };
  }

  /**
   * Action Handler: listing_detail
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async listingDetail(args = {}, session) {
    const productId = String(args.productId || args.id || '').trim();
    if (!productId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        message: 'productId is required for listing_detail action',
        platform: 'batdongsan',
      });
    }

    const rawCity = String(args.city || 'SG').trim();
    const city = CITY_ALIAS_MAP[rawCity.toLowerCase()] || rawCity.toUpperCase();
    const rawBuffer = await this.client.postSyncRaw('/api/p_sync', {
      ptype: 38,
      cate: 0,
      city,
      p: 1,
      ps: 20,
    });

    const decoded = decodeBatdongsanPayload(rawBuffer);
    const rawList = Array.isArray(decoded?.data) ? decoded.data : [];
    const matched = rawList.find((p) => p && String(p.ProductId || p.productId || p.id) === productId);

    if (!matched) {
      throw new PlatformError({
        code: 'XACT_4041',
        type: ErrorTypes.NOT_FOUND,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        message: `Listing ${productId} not found on Batdongsan`,
        platform: 'batdongsan',
      });
    }

    const listing = normalizeBatdongsanListing(matched);
    listing.metadata.sourceMethod = 'listing_detail';

    if (this.store && typeof this.store.storeBatch === 'function') {
      try {
        await this.store.storeBatch([listing], { validateSchema: true });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[BatdongsanCrawler] Failed to persist listing detail:', err.message);
        }
      }
    }

    return { listing };
  }
}
