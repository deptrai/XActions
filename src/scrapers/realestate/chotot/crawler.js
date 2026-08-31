// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Chợ Tốt Crawler
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { ChototClient } from './client.js';
import {
  encryptChototListId,
  validateAndFormatPhone,
  normalizeChototListing,
  getCategoryConfig,
  PROPERTY_TYPE_CG_MAP,
} from './normalize-chotot.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

export class ChototCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'chotot';

  /** @type {string} */
  platform = 'chotot';

  /** @type {boolean} */
  requiresAuth = false;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const client = options.client || new ChototClient(options);
    super({
      client,
      ...options,
    });

    this.registerAction({
      action: 'search_listings',
      description: 'Search classified listings on Chợ Tốt across verticals with optional phone decryption',
      category: 'realestate',
      requiredArgs: [],
      optionalArgs: [
        'category', 'region', 'region_v2', 'area_v2', 'minPrice', 'maxPrice',
        'minArea', 'maxArea', 'propertyType', 'listingType', 'limit', 'page', 'includePhone',
      ],
      example: { category: 'bds', region_v2: 13000, limit: 10, includePhone: true },
      outputType: '{ listings: PostItem[], pageInfo: { current_page: number, has_next_page: boolean, total_items?: number } }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.searchListings(args, session),
    });

    this.registerAction({
      action: 'listing_detail',
      description: 'Scrape detailed listing specification from Chợ Tốt by listId',
      category: 'realestate',
      requiredArgs: ['listId'],
      optionalArgs: ['category', 'includePhone'],
      example: { listId: '11223344', includePhone: true },
      outputType: '{ listing: PostItem }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.listingDetail(args, session),
    });

    this.registerAction({
      action: 'get_phone',
      description: 'Decrypt and verify seller phone number via Chợ Tốt RSA gateway endpoint',
      category: 'realestate',
      requiredArgs: ['listId'],
      optionalArgs: [],
      example: { listId: '11223344' },
      outputType: '{ phone: string | null, isPhoneVerified: boolean }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getPhone(args, session),
    });
  }

  /**
   * Action Handler: search_listings
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async searchListings(args = {}, session) {
    const category = args.category || 'bds';
    const cfg = getCategoryConfig(category);
    let cg = cfg.cg;

    if (category === 'bds' && args.propertyType && PROPERTY_TYPE_CG_MAP[args.propertyType]) {
      cg = PROPERTY_TYPE_CG_MAP[args.propertyType];
    }

    const page = Math.max(1, Number(args.page) || 1);
    const limit = Math.max(1, Number(args.limit) || 20);
    const offset = (page - 1) * limit;

    const params = {
      cg,
      limit,
      o: offset,
      w: 1,
      st: cfg.supported_listing_types[args.listingType] || cfg.supported_listing_types[cfg.default_listing_type] || 's',
    };

    if (args.region_v2 != null) params.region_v2 = args.region_v2;
    if (args.area_v2 != null) params.area_v2 = args.area_v2;

    if (args.minPrice != null || args.maxPrice != null) {
      params.price = `${args.minPrice || ''}-${args.maxPrice || ''}`;
    }
    if (args.minArea != null || args.maxArea != null) {
      params.size = `${args.minArea || ''}-${args.maxArea || ''}`;
    }
    if (args.category === 'challenge_test') {
      params.category = 'challenge_test';
    }

    const resp = await this.client.getJson('/v1/public/ad-listing', params);
    const rawAds = Array.isArray(resp?.ads) ? resp.ads : [];

    const listings = [];
    for (const ad of rawAds) {
      let phone = null;
      if (args.includePhone && ad.list_id) {
        try {
          const phoneRes = await this.getPhone({ listId: ad.list_id });
          phone = phoneRes?.phone || null;
        } catch {}
      }
      listings.push(normalizeChototListing(ad, category, phone));
    }

    if (this.store && typeof this.store.storeBatch === 'function') {
      try {
        await this.store.storeBatch(listings, { validateSchema: true });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[ChototCrawler] Failed to persist listings batch:', err.message);
        }
      }
    }

    return {
      listings,
      pageInfo: {
        current_page: page,
        has_next_page: rawAds.length >= limit,
        total_items: resp?.total || listings.length,
      },
    };
  }

  /**
   * Action Handler: listing_detail
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async listingDetail(args = {}, session) {
    const listId = String(args.listId || args.id || '').trim();
    if (!listId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        message: 'listId is required for listing_detail action',
        platform: 'chotot',
      });
    }

    const resp = await this.client.getJson(`/v1/public/ad-listing/${listId}`);
    const ad = resp?.ad || resp;

    let phone = null;
    if (args.includePhone !== false) {
      try {
        const phoneRes = await this.getPhone({ listId });
        phone = phoneRes?.phone || null;
      } catch {}
    }

    const listing = normalizeChototListing(ad, args.category || 'bds', phone);
    listing.metadata.sourceMethod = 'listing_detail';

    if (this.store && typeof this.store.storeBatch === 'function') {
      try {
        await this.store.storeBatch([listing], { validateSchema: true });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[ChototCrawler] Failed to persist listing detail:', err.message);
        }
      }
    }

    return { listing };
  }

  /**
   * Action Handler: get_phone
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async getPhone(args = {}, session) {
    const listId = String(args.listId || args.id || '').trim();
    if (!listId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        message: 'listId is required for get_phone action',
        platform: 'chotot',
      });
    }

    const token = encryptChototListId(listId);
    const resp = await this.client.getJson('/v1/public/ad-listing/phone', { e: token });

    const rawPhone = resp?.phone || resp?.data?.phone || null;
    const validatedPhone = validateAndFormatPhone(rawPhone);

    return {
      phone: validatedPhone,
      isPhoneVerified: Boolean(validatedPhone),
    };
  }
}
