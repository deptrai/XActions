// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';

import { TikTokShopCrawler } from '../../../../src/scrapers/ecom/tiktok-shop/crawler.js';
import { TikTokShopClient } from '../../../../src/scrapers/ecom/tiktok-shop/client.js';
import { TikTokShopPlatformResponseValidator } from '../../../../src/scrapers/ecom/tiktok-shop/validator.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';

/**
 * Story 16.2 — TikTok Shop Product & Sales Scraper
 * Red-phase acceptance test suite (TDD).
 */

describe('Story 16.2 — TikTok Shop Product & Sales Scraper', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const createStore = () => new PrismaStore({ prisma });

  beforeAll(async () => {
    process.env.TIKTOK_BROWSER_SIGN = 'false';
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

        // Top products endpoint
        if (url.pathname.includes('/api/v1/oec/affiliate/product/list')) {
          if (url.searchParams.get('category') === 'challenge_test') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ code: 3000, message: 'captcha challenge', data: {} }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            data: {
              products: [
                {
                  product_id: '172948291048',
                  product_name: 'Son môi cao cấp không chì',
                  sale_price: '149000',
                  original_price: '299000',
                  sold_count: 15200,
                  commission_rate: 15.5,
                  commission_amount: '23095',
                  product_rating: 4.7,
                  shop_id: '882233',
                  shop_name: 'BeautyShop VN',
                },
              ],
              has_more: false,
            },
          }));
          return;
        }

        // Product detail endpoint
        if (url.pathname.includes('/api/v1/shop/product/detail')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            data: {
              product: {
                product_id: '172948291048',
                product_name: 'Son môi cao cấp không chì',
                sale_price: '149000',
                original_price: '299000',
                sold_count: 15200,
                commission_rate: 15.5,
                commission_amount: '23095',
                product_rating: 4.7,
                shop_id: '882233',
                shop_name: 'BeautyShop VN',
              },
            },
          }));
          return;
        }

        // Search products endpoint
        if (url.pathname.includes('/api/v1/oec/affiliate/product/search')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            code: 0,
            data: {
              products: [
                {
                  product_id: '172948291049',
                  product_name: 'Kem chống nắng dưỡng da',
                  sale_price: '99000',
                  original_price: '199000',
                  sold_count: 8500,
                  commission_rate: 12.0,
                  commission_amount: '11880',
                  product_rating: 4.5,
                  shop_id: '882244',
                  shop_name: 'Skincare Official',
                },
              ],
              has_more: true,
              next_cursor: '20',
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
    delete process.env.TIKTOK_BROWSER_SIGN;
  });

  beforeEach(async () => {
    receivedRequests = [];
    await cleanupTestDatabase();
    vi.restoreAllMocks();
  });

  const buildCrawler = () => {
    const client = new TikTokShopClient({
      baseUrl: serverUrl,
      requiresProxy: false,
    });
    const crawler = new TikTokShopCrawler({
      client,
      store: createStore(),
      requiresProxy: false,
    });
    return { client, crawler };
  };

  it('TikTokShopClient and TikTokShopCrawler inherit base contracts', () => {
    const { client, crawler } = buildCrawler();
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('tiktokshop');
    expect(crawler.platform).toBe('tiktokshop');
    expect(crawler.requiresAuth).toBe(false);
  });

  it('registers top_products, product_detail, and search_products actions with correct descriptors', () => {
    const { crawler } = buildCrawler();
    const actions = crawler.listActions();

    const topProducts = actions.find((a) => a.action === 'top_products');
    const productDetail = actions.find((a) => a.action === 'product_detail');
    const searchProducts = actions.find((a) => a.action === 'search_products');

    expect(topProducts).toBeTruthy();
    expect(topProducts?.category).toBe('ecom');
    expect(topProducts?.requiredArgs).toEqual([]);
    expect(topProducts?.optionalArgs).toContain('category');
    expect(topProducts?.optionalArgs).toContain('limit');
    expect(topProducts?.optionalArgs).toContain('page');
    expect(topProducts?.requiresAuth).toBe(false);

    expect(productDetail).toBeTruthy();
    expect(productDetail?.category).toBe('ecom');
    expect(productDetail?.requiredArgs).toEqual(['productId']);
    expect(productDetail?.requiresAuth).toBe(false);

    expect(searchProducts).toBeTruthy();
    expect(searchProducts?.category).toBe('ecom');
    expect(searchProducts?.requiredArgs).toEqual(['keyword']);
    expect(searchProducts?.optionalArgs).toContain('limit');
    expect(searchProducts?.optionalArgs).toContain('page');
    expect(searchProducts?.optionalArgs).toContain('sortBy');
    expect(searchProducts?.requiresAuth).toBe(false);
  });

  it('top_products fetches products and normalizes PostItem with category ecom', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'top_products',
      args: { category: 'fashion', limit: 10 },
    });

    expect(result).toHaveProperty('products');
    expect(Array.isArray(result.products)).toBe(true);
    expect(result.products).toHaveLength(1);

    const product = result.products[0];
    expect(product.id).toBe('tiktokshop:172948291048');
    expect(product.platform).toBe('tiktokshop');
    expect(product.category).toBe('ecom');
    expect(product.content).toContain('Son môi cao cấp không chì');
    expect(product.metadata).toMatchObject({
      productId: '172948291048',
      shopId: '882233',
      shopName: 'BeautyShop VN',
      price: 149000,
      originalPrice: 299000,
      soldCount: 15200,
      commissionRate: 15.5,
      commissionAmount: 23095,
      rating: 4.7,
    });
    expect(product.authorId).toBe('tiktokshop:shop:882233');
    expect(product.authorName).toBe('BeautyShop VN');
  });

  it('product_detail fetches detailed product info', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'product_detail',
      args: { productId: '172948291048' },
    });

    expect(result).toHaveProperty('product');
    expect(result.product.id).toBe('tiktokshop:172948291048');
    expect(result.product.metadata.price).toBe(149000);
    expect(result.product.metadata.commissionRate).toBe(15.5);
    expect(result.product.content).toContain('Son môi cao cấp không chì');
  });

  it('search_products fetches products by keyword and provides pagination', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'search_products',
      args: { keyword: 'son moi', limit: 10, page: 0 },
    });

    expect(result).toHaveProperty('products');
    expect(result.products).toHaveLength(1);

    const product = result.products[0];
    expect(product.id).toBe('tiktokshop:172948291049');
    expect(product.category).toBe('ecom');
    expect(product.metadata.productId).toBe('172948291049');
    expect(product.metadata.shopName).toBe('Skincare Official');
    expect(result.pageInfo.has_next_page).toBe(true);
    expect(result.pageInfo.end_cursor).toBe('20');
  });

  it('TikTokShopPlatformResponseValidator detects anti-bot challenge when code !== 0', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'top_products',
        args: { category: 'challenge_test' },
      })
    ).rejects.toMatchObject({
      code: 'XACT_4030',
      statusCode: 403,
    });
  });

  it('unified scrape("tiktokshop", ...) dispatcher works end-to-end', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');

    const result = await scrape('tiktokshop', 'top_products', {
      baseUrl: serverUrl,
      category: 'fashion',
      limit: 5,
      store: createStore(),
      requiresProxy: false,
    });

    expect(result).toHaveProperty('products');
    expect(Array.isArray(result.products)).toBe(true);
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products[0].platform).toBe('tiktokshop');
    expect(result.products[0].category).toBe('ecom');
  });

  it('unified scrape("tiktok_shop", ...) alias works end-to-end', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');

    const result = await scrape('tiktok_shop', 'search_products', {
      baseUrl: serverUrl,
      keyword: 'kem chống nắng',
      limit: 5,
      store: createStore(),
      requiresProxy: false,
    });

    expect(result).toHaveProperty('products');
    expect(Array.isArray(result.products)).toBe(true);
    expect(result.products.length).toBeGreaterThan(0);
  });

  it('package.json exports include ./scrapers/ecom/tiktok-shop', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    expect(pkg.exports['./scrapers/ecom/tiktok-shop']).toBe('./src/scrapers/ecom/tiktok-shop/index.js');
  });

  it('scrapeTikTokShop convenience helper works end-to-end', async () => {
    process.env.TIKTOK_BROWSER_SIGN = 'false';
    const { scrapeTikTokShop } = await import('../../../../src/scrapers/ecom/tiktok-shop/index.js');

    const result = await scrapeTikTokShop(
      'top_products',
      { category: 'fashion', limit: 5 },
      {
        baseUrl: serverUrl,
        store: createStore(),
        requiresProxy: false,
        autoClose: true,
      }
    );

    expect(result).toHaveProperty('products');
    expect(Array.isArray(result.products)).toBe(true);
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products[0].platform).toBe('tiktokshop');
    expect(result.products[0].category).toBe('ecom');
  });
});
