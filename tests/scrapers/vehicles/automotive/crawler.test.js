// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { AutomotiveCrawler } from '../../../../src/scrapers/vehicles/automotive/crawler.js';
import { AutomotiveClient } from '../../../../src/scrapers/vehicles/automotive/client.js';
import { AutomotivePlatformResponseValidator } from '../../../../src/scrapers/vehicles/automotive/validator.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { PlatformError } from '../../../../src/core/error-envelope.js';

describe('Story 21.2 — Automotive Vehicles Market Crawler', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const BONBANH_LISTING_HTML = `
    <html><body>
      <div itemscope itemtype="http://schema.org/Car">
        <h1 itemprop="name">VinFast VF8 Plus AWD - 2023</h1>
        <span itemprop="price">795 Triệu</span>
        <span itemprop="vehicleEngine">Electric</span>
        <span itemprop="mileageFromOdometer">25.000 km</span>
        <span itemprop="vehicleTransmission">Số tự động</span>
        <span itemprop="fuelType">Điện</span>
        <a href="/oto/xe-vinfast-vf8-plus-awd-2023-6917077">Chi tiết</a>
      </div>
    </body></html>
  `;

  const BONBANH_DETAIL_HTML = `
    <html><body>
      <link rel="canonical" href="https://bonbanh.com/oto/xe-vinfast-vf8-plus-awd-2023-6917077" />
      <div itemscope itemtype="http://schema.org/Car">
        <h1 itemprop="name">VinFast VF8 Plus AWD - 2023</h1>
        <span itemprop="price">795 Triệu</span>
        <span itemprop="vehicleEngine">Electric</span>
        <span itemprop="mileageFromOdometer">25.000 km</span>
        <span itemprop="vehicleTransmission">Số tự động</span>
        <span itemprop="fuelType">Điện</span>
        <a href="tel:0901234567">0901 234 567</a>
        <div class="salon">Salon Ô tô ABC</div>
      </div>
    </body></html>
  `;

  const OTO_VN_LISTING_HTML = `
    <html><body>
      <div data-item-id="123456">
        <h2 class="title"><a href="/mua-ban-xe-toyota-vios-2020-123456">Toyota Vios 1.5G CVT 2020</a></h2>
        <span class="price">385 Triệu</span>
        <span class="spec">45.000 km - Số tự động - Xăng</span>
        <span class="type">Cá nhân</span>
        <img src="https://img.oto.com.vn/toyota-vios.jpg" />
      </div>
    </body></html>
  `;

  const OTO_VN_DETAIL_HTML = `
    <html><body>
      <link rel="canonical" href="https://www.oto.com.vn/mua-ban-xe-toyota-vios-2020-123456" />
      <h1>Toyota Vios 1.5G CVT 2020</h1>
      <span class="price">385 Triệu</span>
      <div class="specs">45.000 km - Số tự động - Xăng - 2020</div>
      <a href="tel:0987654321">0987 654 321</a>
      <span class="type">Cá nhân</span>
    </body></html>
  `;

  const CHOTOT_XE_JSON = JSON.stringify({
    adlist: [
      {
        ad_id: '987654',
        subject: 'Honda SH 150i 2022',
        price: 105000000,
        price_string: '105 Triệu',
        area_name: 'Quận 1',
        region_name: 'TP. Hồ Chí Minh',
        account_name: 'Nguyễn Văn A',
        account_oid: 'user123',
        phone: '0901234567',
        list_time: '2026-09-01T10:00:00Z',
        images: ['https://img.chotot.com/honda-sh.jpg'],
      },
    ],
  });

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
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
          ),
          body,
        });

        // BonBanh listing
        if (url.pathname === '/oto/page,1') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(BONBANH_LISTING_HTML);
          return;
        }

        // BonBanh detail
        if (url.pathname === '/oto/6917077' || url.pathname.includes('6917077')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(BONBANH_DETAIL_HTML);
          return;
        }

        // Oto.com.vn listing
        if (url.pathname.startsWith('/mua-ban-xe') && url.pathname.includes('/page/1')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(OTO_VN_LISTING_HTML);
          return;
        }

        // Oto.com.vn detail
        if (url.pathname === '/123456.html' || url.pathname.includes('123456')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(OTO_VN_DETAIL_HTML);
          return;
        }

        // Chotot gateway
        if (url.pathname === '/wg/cg/2010') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(CHOTOT_XE_JSON);
          return;
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
      });
    });

    await new Promise((resolve) => {
      server.listen(0, () => {
        const { port } = server.address();
        serverUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  describe('AutomotiveClient', () => {
    it('extends AbstractApiClient and sets platform correctly', () => {
      const client = new AutomotiveClient({ baseUrl: serverUrl, requiresProxy: false });
      expect(client).toBeInstanceOf(AbstractApiClient);
      expect(client.requiresAuth).toBe(false);
      expect(client.requiresProxy).toBe(false);
    });

    it('sends browser headers including Accept-Language vi-VN', async () => {
      const client = new AutomotiveClient({ targetPlatform: 'bonbanh', baseUrl: serverUrl, requiresProxy: false });
      await client.search({ platform: 'bonbanh', page: 1 });
      const request = receivedRequests[0];
      expect(request.headers['accept-language']).toContain('vi-VN');
      expect(request.headers['referer']).toBe(`${serverUrl}/`);
    });
  });

  describe('AutomotiveCrawler', () => {
    let crawler;

    beforeEach(() => {
      crawler = new AutomotiveCrawler({
        client: new AutomotiveClient({ baseUrl: serverUrl, requiresProxy: false }),
        store: null,
      });
    });

    it('is an AbstractCrawler with name automotive and no auth required', () => {
      expect(crawler).toBeInstanceOf(AbstractCrawler);
      expect(crawler.name).toBe('automotive');
      expect(crawler.requiresAuth).toBe(false);
      const actions = crawler.listActions().map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['search', 'list', 'detail']));
    });

    it('search action returns PostItem[] for bonbanh', async () => {
      const result = await crawler.start({ action: 'search', args: { platform: 'bonbanh', page: 1 } });
      expect(result.posts).toBeInstanceOf(Array);
      expect(result.posts.length).toBeGreaterThan(0);
      const item = result.posts[0];
      expect(item.platform).toBe('bonbanh');
      expect(item.category).toBe('automotive');
      expect(item.metadata.priceFormatted).toContain('795');
      expect(item.metadata.mileageFormatted).toContain('25');
    });

    it('search action returns PostItem[] for oto_vn', async () => {
      const result = await crawler.start({ action: 'search', args: { platform: 'oto_vn', brand: 'toyota', city: 'hanoi', page: 1 } });
      expect(result.posts).toBeInstanceOf(Array);
      expect(result.posts.length).toBeGreaterThan(0);
      const item = result.posts[0];
      expect(item.platform).toBe('oto_vn');
      expect(item.category).toBe('automotive');
      expect(item.metadata.sellerType).toBe('chinh-chu');
    });

    it('list action returns PostItem[] for bonbanh', async () => {
      const result = await crawler.start({ action: 'list', args: { platform: 'bonbanh', page: 1 } });
      expect(result.posts).toBeInstanceOf(Array);
      expect(result.posts.length).toBeGreaterThan(0);
      expect(result.pageInfo.has_next_page).toBeDefined();
    });

    it('detail action returns PostItem for bonbanh', async () => {
      const result = await crawler.start({ action: 'detail', args: { platform: 'bonbanh', id: '6917077' } });
      expect(result.post).toBeDefined();
      expect(result.post.platform).toBe('bonbanh');
      expect(result.post.metadata.phone).toBe('0901234567');
      expect(result.post.metadata.sellerType).toBe('salon');
    });

    it('detail action returns PostItem for oto_vn', async () => {
      const result = await crawler.start({ action: 'detail', args: { platform: 'oto_vn', id: '123456' } });
      expect(result.post).toBeDefined();
      expect(result.post.platform).toBe('oto_vn');
      expect(result.post.metadata.phone).toBe('0987654321');
      expect(result.post.metadata.sellerType).toBe('chinh-chu');
    });

    it('search throws XACT_4001 for invalid platform', async () => {
      await expect(crawler.start({ action: 'search', args: { platform: 'invalid' } }))
        .rejects.toThrow(PlatformError);
    });

    it('detail throws XACT_4001 for missing id', async () => {
      await expect(crawler.start({ action: 'detail', args: { platform: 'bonbanh' } }))
        .rejects.toThrow(PlatformError);
    });
  });
});
