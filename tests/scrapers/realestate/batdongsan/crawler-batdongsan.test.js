// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';

import { BatdongsanCrawler } from '../../../../src/scrapers/realestate/batdongsan/crawler.js';
import { BatdongsanClient } from '../../../../src/scrapers/realestate/batdongsan/client.js';
import { BatdongsanPlatformResponseValidator } from '../../../../src/scrapers/realestate/batdongsan/validator.js';
import {
  nibbleSwap,
  decodeBatdongsanPayload,
  encodeBatdongsanPayload,
  normalizeBatdongsanListing,
} from '../../../../src/scrapers/realestate/batdongsan/normalize-batdongsan.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';

describe('Story 17.2 — Batdongsan.com.vn Property Scraper (TDD)', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const createStore = () => new PrismaStore({ prisma });

  const sampleProducts = [
    {
      ProductId: 39821049,
      Title: 'Bán đất nền thổ cư KDC Nam Long Quận 9 sổ hồng riêng',
      Description: 'Đất đẹp vuông vức 5x20m full thổ cư, đường 12m trải nhựa.',
      Price: '4.5 tỷ',
      PriceCurrent: 4500000000,
      PriceUnit: 'đ',
      PriceM2: '45 triệu/m²',
      Area: 100,
      AreaUnit: 'm²',
      RoomNumber: null,
      CityCode: 'SG',
      DistrictId: 100,
      WardId: 200,
      Street: 'Đỗ Xuân Hợp',
      Address: 'Đỗ Xuân Hợp, Phường Phước Long B, Quận 9, TP.HCM',
      ContactName: 'Lê Hoàng BĐS',
      ContactPhone: '0912345678',
      Avatar: 'https://img.batdongsan.com.vn/crop/500x300/land1.jpg',
      Images: [
        'https://img.batdongsan.com.vn/crop/500x300/land1.jpg',
        'https://img.batdongsan.com.vn/crop/500x300/land2.jpg',
      ],
      StartDate: '2026-08-30T08:00:00Z',
      Latitude: 10.8231,
      Longitude: 106.7721,
      ProductType: 38,
      CateId: 40,
    },
  ];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let parsedBody = {};
        try {
          parsedBody = JSON.parse(body || '{}');
        } catch {}

        receivedRequests.push({
          method: req.method,
          path: url.pathname,
          search: url.search,
          query: Object.fromEntries(url.searchParams.entries()),
          body: parsedBody,
        });

        // Challenge endpoint
        if (parsedBody.city === 'challenge_test') {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Blocked by Cloudflare/WAF', code: 403 }));
          return;
        }

        // p_sync mobile endpoint
        if (url.pathname.includes('/api/p_sync')) {
          const responsePayload = {
            data: sampleProducts,
            m: null,
            totalHits: 150,
          };
          const encoded = encodeBatdongsanPayload(responsePayload);
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-encoding': 'gzip',
          });
          res.end(encoded);
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
  });

  const buildCrawler = () => {
    const client = new BatdongsanClient({
      baseUrl: serverUrl,
      requiresProxy: false,
    });
    const crawler = new BatdongsanCrawler({
      client,
      store: createStore(),
      requiresProxy: false,
    });
    return { client, crawler };
  };

  it('AC-1: BatdongsanCrawler and BatdongsanClient inherit base contracts and register 2 actions', () => {
    const { client, crawler } = buildCrawler();
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('batdongsan');
    expect(crawler.platform).toBe('batdongsan');
    expect(crawler.requiresAuth).toBe(false);

    const actions = crawler.listActions();
    const searchListings = actions.find((a) => a.action === 'search_listings');
    const listingDetail = actions.find((a) => a.action === 'listing_detail');

    expect(searchListings).toBeTruthy();
    expect(searchListings?.category).toBe('realestate');
    expect(searchListings?.optionalArgs).toContain('city');
    expect(searchListings?.optionalArgs).toContain('listingType');

    expect(listingDetail).toBeTruthy();
    expect(listingDetail?.category).toBe('realestate');
    expect(listingDetail?.requiredArgs).toEqual(['productId']);
  });

  it('AC-2: nibble-swap and decodeBatdongsanPayload restores obfuscated payload', () => {
    const original = { data: [{ ProductId: 12345, Title: 'Nhà phố Đỗ Xuân Hợp' }] };
    const encoded = encodeBatdongsanPayload(original);
    const decoded = decodeBatdongsanPayload(encoded);

    expect(decoded).toEqual(original);
  });

  it('AC-3: search_listings queries p_sync endpoint and normalizes PostItem', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'search_listings',
      args: { city: 'SG', category: 'dat-nen', limit: 10 },
    });

    expect(receivedRequests.length).toBeGreaterThan(0);
    const lastReq = receivedRequests[0];
    expect(lastReq.path).toContain('/api/p_sync');
    expect(lastReq.body).toMatchObject({
      city: 'SG',
    });

    expect(result).toHaveProperty('listings');
    expect(Array.isArray(result.listings)).toBe(true);
    expect(result.listings).toHaveLength(1);

    const item = result.listings[0];
    expect(item.id).toBe('batdongsan:listing:39821049');
    expect(item.platform).toBe('batdongsan');
    expect(item.category).toBe('realestate');
    expect(item.content).toContain('Bán đất nền thổ cư KDC Nam Long');
    expect(item.authorName).toBe('Lê Hoàng BĐS');
    expect(item.metadata).toMatchObject({
      productId: '39821049',
      title: 'Bán đất nền thổ cư KDC Nam Long Quận 9 sổ hồng riêng',
      price: 4500000000,
      priceM2: '45 triệu/m²',
      size: 100,
      cityCode: 'SG',
      address: 'Đỗ Xuân Hợp, Phường Phước Long B, Quận 9, TP.HCM',
      phone: '0912345678',
      sourceMethod: 'search_listings',
    });
  });

  it('AC-3: listing_detail extracts single listing by productId', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'listing_detail',
      args: { productId: '39821049' },
    });

    expect(result).toHaveProperty('listing');
    const listing = result.listing;
    expect(listing.id).toBe('batdongsan:listing:39821049');
    expect(listing.metadata.title).toContain('Bán đất nền thổ cư');
    expect(listing.metadata.price).toBe(4500000000);
    expect(listing.metadata.size).toBe(100);
  });

  it('AC-1: BatdongsanPlatformResponseValidator detects WAF / challenge responses', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'search_listings',
        args: { city: 'challenge_test' },
      })
    ).rejects.toMatchObject({
      code: 'XACT_4030',
      statusCode: 403,
    });
  });

  it('AC-4: unified scrape("batdongsan", ...) dispatcher works end-to-end', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');

    const result = await scrape('batdongsan', 'search_listings', {
      baseUrl: serverUrl,
      city: 'SG',
      store: createStore(),
      requiresProxy: false,
    });

    expect(result).toHaveProperty('listings');
    expect(Array.isArray(result.listings)).toBe(true);
    expect(result.listings.length).toBeGreaterThan(0);
    expect(result.listings[0].platform).toBe('batdongsan');
    expect(result.listings[0].category).toBe('realestate');
  });

  it('AC-4: package.json exports include ./scrapers/realestate/batdongsan', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    expect(pkg.exports['./scrapers/realestate/batdongsan']).toBe(
      './src/scrapers/realestate/batdongsan/index.js'
    );
  });

  it('AC-4: scrapeBatdongsan convenience helper works end-to-end', async () => {
    const { scrapeBatdongsan } = await import(
      '../../../../src/scrapers/realestate/batdongsan/index.js'
    );

    const result = await scrapeBatdongsan(
      'search_listings',
      { city: 'HN', limit: 5 },
      {
        baseUrl: serverUrl,
        store: createStore(),
        requiresProxy: false,
        autoClose: true,
      }
    );

    expect(result).toHaveProperty('listings');
    expect(Array.isArray(result.listings)).toBe(true);
    expect(result.listings.length).toBeGreaterThan(0);
    expect(result.listings[0].platform).toBe('batdongsan');
  });
});
