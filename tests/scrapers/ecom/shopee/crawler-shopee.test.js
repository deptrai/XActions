// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import { ShopeeCrawler } from '../../../../src/scrapers/ecom/shopee/crawler.js';
import { ShopeeClient } from '../../../../src/scrapers/ecom/shopee/client.js';
import { ShopeePlatformResponseValidator } from '../../../../src/scrapers/ecom/shopee/validator.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';

/**
 * Story 16.1 — Shopee Search, Product & Review Scraper with TLS Spoofing
 * Red-phase acceptance test suite (TDD).
 */

describe('Story 16.1 — Shopee Search, Product & Review Scraper', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const createStore = () => new PrismaStore({ prisma });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          path: url.pathname,
          search: url.search,
          query: Object.fromEntries(url.searchParams.entries()),
          body,
        });

        // Search items endpoint: /api/v4/search/search_items
        if (url.pathname.includes('/api/v4/search/search_items')) {
          if (url.searchParams.get('keyword') === 'challenge_test') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 90309999, error_msg: 'Bot challenge captcha triggered' }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            items: [
              {
                item_basic: {
                  itemid: 111222,
                  shopid: 333444,
                  name: 'Áo thun cotton cao cấp form rộng',
                  price: 15000000000, // 150,000 VND
                  price_before_discount: 20000000000, // 200,000 VND
                  historical_sold: 520,
                  item_rating: { rating_star: 4.85 },
                  stock: 99,
                  image: 'vn-11134207-7qukw-lj12345678',
                  discount: '25%',
                  shop_location: 'TP. Hồ Chí Minh',
                },
              },
            ],
            total_count: 1,
            nomore: true,
          }));
          return;
        }

        // Product reviews endpoint: /api/v4/item/get_ratings
        if (url.pathname.includes('/api/v4/item/get_ratings')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              ratings: [
                {
                  cmtid: 999111,
                  itemid: 111222,
                  userid: 555666,
                  author_username: 'nguyenvana',
                  comment: 'Áo đẹp, vải mềm mịn, giao hàng nhanh!',
                  rating_star: 5,
                  mtime: 1725000000,
                  images: ['vn-11134207-review-image-1'],
                },
              ],
            },
          }));
          return;
        }

        // Product detail endpoint: /api/v4/item/get
        if (url.pathname.includes('/api/v4/item/get')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: {
              itemid: 111222,
              shopid: 333444,
              name: 'Áo thun cotton cao cấp form rộng',
              description: 'Chất vải 100% cotton thoáng mát.',
              price: 15000000000,
              price_before_discount: 20000000000,
              historical_sold: 520,
              item_rating: { rating_star: 4.85, rating_count: [100, 1, 2, 5, 20, 72] },
              stock: 99,
              images: ['vn-11134207-7qukw-lj12345678', 'vn-11134207-7qukw-lj87654321'],
              tier_variations: [],
            },
          }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    serverUrl = `http://${address.address}:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(async () => {
    receivedRequests = [];
    await cleanupTestDatabase();
    vi.restoreAllMocks();
  });

  const buildCrawler = () => {
    const client = new ShopeeClient({
      baseUrl: serverUrl,
      requiresProxy: false,
    });
    const crawler = new ShopeeCrawler({
      client,
      store: createStore(),
      requiresProxy: false,
    });
    return { client, crawler };
  };

  it('ShopeeCrawler and ShopeeClient inherit base contracts', () => {
    const { client, crawler } = buildCrawler();
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('shopee');
    expect(crawler.platform).toBe('shopee');
    expect(crawler.requiresAuth).toBe(false);
  });

  it('registers search_products, product_detail, and product_reviews actions with correct descriptors', () => {
    const { crawler } = buildCrawler();
    const actions = crawler.listActions();

    const searchAction = actions.find((a) => a.action === 'search_products');
    const detailAction = actions.find((a) => a.action === 'product_detail');
    const reviewsAction = actions.find((a) => a.action === 'product_reviews');

    expect(searchAction).toBeTruthy();
    expect(searchAction?.category).toBe('ecom');
    expect(searchAction?.requiredArgs).toEqual(['keyword']);
    expect(searchAction?.requiresAuth).toBe(false);

    expect(detailAction).toBeTruthy();
    expect(detailAction?.category).toBe('ecom');
    expect(detailAction?.requiredArgs).toEqual(['itemId', 'shopId']);
    expect(detailAction?.requiresAuth).toBe(false);

    expect(reviewsAction).toBeTruthy();
    expect(reviewsAction?.category).toBe('ecom');
    expect(reviewsAction?.requiredArgs).toEqual(['itemId', 'shopId']);
    expect(reviewsAction?.requiresAuth).toBe(false);
  });

  it('search_products fetches products and normalizes PostItem with category ecom', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'search_products',
      args: { keyword: 'ao thun', limit: 10 },
    });

    expect(result).toHaveProperty('products');
    expect(Array.isArray(result.products)).toBe(true);
    expect(result.products).toHaveLength(1);

    const product = result.products[0];
    expect(product.id).toBe('shopee:111222');
    expect(product.platform).toBe('shopee');
    expect(product.category).toBe('ecom');
    expect(product.content).toContain('Áo thun cotton cao cấp form rộng');
    expect(product.metadata).toMatchObject({
      itemId: '111222',
      shopId: '333444',
      price: 150000,
      originalPrice: 200000,
      soldCount: 520,
      rating: 4.85,
      stock: 99,
      discountPercent: '25%',
      location: 'TP. Hồ Chí Minh',
    });
    expect(product.mediaUrls).toHaveLength(1);
    expect(product.mediaUrls[0]).toContain('https://down-vn.img.susercontent.com/file/vn-11134207-7qukw-lj12345678');
  });

  it('product_detail fetches detailed product info', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'product_detail',
      args: { itemId: '111222', shopId: '333444' },
    });

    expect(result).toHaveProperty('product');
    expect(result.product.id).toBe('shopee:111222');
    expect(result.product.metadata.price).toBe(150000);
    expect(result.product.content).toContain('Chất vải 100% cotton thoáng mát');
  });

  it('product_reviews fetches reviews and normalizes CommentItems', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'product_reviews',
      args: { itemId: '111222', shopId: '333444', limit: 5 },
    });

    expect(result).toHaveProperty('reviews');
    expect(Array.isArray(result.reviews)).toBe(true);
    expect(result.reviews).toHaveLength(1);

    const review = result.reviews[0];
    expect(review.id).toBe('shopee:review:999111');
    expect(review.postId).toBe('shopee:111222');
    expect(review.authorName).toBe('nguyenvana');
    expect(review.content).toBe('Áo đẹp, vải mềm mịn, giao hàng nhanh!');
    expect(review.metadata.rating).toBe(5);
  });

  it('ShopeePlatformResponseValidator detects anti-bot captcha code 90309999', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'search_products',
        args: { keyword: 'challenge_test' },
      })
    ).rejects.toMatchObject({
      code: 'XACT_4030',
      statusCode: 403,
    });
  });

  it('unified scrape("shopee", ...) dispatcher works end-to-end', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');
    const result = await scrape('shopee', 'search_products', {
      keyword: 'ao thun',
      baseUrl: serverUrl,
      requiresProxy: false,
    });

    expect(result).toHaveProperty('products');
    expect(result.products[0].id).toBe('shopee:111222');
  });

  it('package.json exports include ./scrapers/ecom/shopee', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    expect(pkg.exports['./scrapers/ecom/shopee']).toBe('./src/scrapers/ecom/shopee/index.js');
  });
});
