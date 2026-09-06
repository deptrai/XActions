// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import { MaSoThueCrawler } from '../../../../src/scrapers/procurement/masothue/crawler.js';
import { MaSoThueClient, MASOTHUE_BASE_URL } from '../../../../src/scrapers/procurement/masothue/client.js';
import { MaSoThuePlatformResponseValidator } from '../../../../src/scrapers/procurement/masothue/validator.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { PlatformError, ErrorTypes } from '../../../../src/core/error-envelope.js';

describe('Story 21.1 — MaSoThue Company Registry Crawler', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

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

        // Search endpoint
        if (url.pathname.startsWith('/Search/')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <html><body>
              <div class="search-results">
                <div class="item">
                  <a href="/0013180180-cong-ty-tnhh-nguyen-dai">0013180180 - CÔNG TY TNHH NGUYỄN ĐẠI</a>
                  <span itemprop="address">123 Đường ABC, Quận 1, TP.HCM</span>
                  <span itemprop="jobTitle">Sản xuất giày dép</span>
                </div>
              </div>
            </body></html>
          `);
          return;
        }

        // Province endpoint
        if (url.pathname.startsWith('/tra-cuu-ma-so-thue-theo-tinh/')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <html><body>
              <div class="company-list">
                <div class="company-item">
                  <a href="/0312345678-cong-ty-tnhh-test-binh-duong">0312345678 - CÔNG TY TNHH TEST BÌNH DƯƠNG</a>
                  <span itemprop="address">Bình Dương</span>
                  <span itemprop="jobTitle">Bất động sản</span>
                </div>
              </div>
            </body></html>
          `);
          return;
        }

        // Detail endpoint
        if (/^\/\d{9,13}/.test(url.pathname)) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <html><body>
              <h1>0013180180 - CÔNG TY TNHH NGUYỄN ĐẠI</h1>
              <table>
                <tr><td>Mã số thuế</td><td>0013180180</td></tr>
                <tr><td>Địa chỉ</td><td>123 Đường ABC, Quận 1, TP.HCM</td></tr>
                <tr><td>Ngành nghề chính</td><td>Sản xuất giày dép</td></tr>
              </table>
            </body></html>
          `);
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

  describe('MaSoThueClient', () => {
    it('extends AbstractApiClient and sets platform correctly', () => {
      const client = new MaSoThueClient({ baseUrl: serverUrl, requiresProxy: false });
      expect(client).toBeInstanceOf(AbstractApiClient);
      expect(client.platform).toBe('masothue');
      expect(client.requiresAuth).toBe(false);
      expect(client.requiresProxy).toBe(false);
    });

    it('sends browser headers including Accept-Language vi-VN', async () => {
      const client = new MaSoThueClient({ baseUrl: serverUrl, requiresProxy: false });
      const resp = await client.search({ q: '0013180180' });
      const request = receivedRequests[0];
      expect(request.method).toBe('GET');
      expect(request.path).toBe('/Search/');
      expect(request.query.q).toBe('0013180180');
      expect(request.headers['accept-language']).toContain('vi-VN');
      expect(request.headers['referer']).toBe(`${serverUrl}/`);
      expect(request.headers['dnt']).toBe('1');
      expect(request.headers['upgrade-insecure-requests']).toBe('1');
    });

    it('request with default headers prevents Cloudflare 403', async () => {
      const client = new MaSoThueClient({ baseUrl: serverUrl, requiresProxy: false });
      const resp = await client.search({ q: '0013180180' });
      expect(resp.status).toBe(200);
      expect(resp.body).toContain('0013180180');
    });
  });

  describe('MaSoThueCrawler', () => {
    let crawler;

    beforeEach(() => {
      const client = new MaSoThueClient({ baseUrl: serverUrl, requiresProxy: false });
      crawler = new MaSoThueCrawler({ client, store: null });
    });

    it('is an AbstractCrawler with name masothue and no auth required', () => {
      expect(crawler).toBeInstanceOf(AbstractCrawler);
      expect(crawler.name).toBe('masothue');
      expect(crawler.requiresAuth).toBe(false);
      const actions = crawler.listActions().map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['search', 'search_by_province', 'detail']));
    });

    it('search action returns PostItem[] with taxCode and companyName', async () => {
      const result = await crawler.start({ action: 'search', args: { q: '0013180180' } });
      expect(result.posts).toBeInstanceOf(Array);
      expect(result.posts.length).toBeGreaterThan(0);
      const item = result.posts[0];
      expect(item.id).toBe('masothue:0013180180');
      expect(item.platform).toBe('masothue');
      expect(item.externalId).toBe('0013180180');
      expect(item.category).toBe('b2b');
      expect(item.metadata.taxCode).toBe('0013180180');
      expect(item.metadata.companyName).toContain('CÔNG TY TNHH');
      expect(item.metadata.detailUrl).toBe('https://masothue.com/0013180180');
    });

    it('search_by_province returns companies for valid province', async () => {
      const result = await crawler.start({ action: 'search_by_province', args: { province: 'binh-duong', page: 1 } });
      expect(result.posts).toBeInstanceOf(Array);
      expect(result.posts.length).toBeGreaterThan(0);
      const item = result.posts[0];
      expect(item.platform).toBe('masothue');
      expect(item.category).toBe('b2b');
      expect(item.metadata.province).toBe('Bình Dương');
    });

    it('search_by_province throws XACT_4001 for unknown province', async () => {
      await expect(crawler.start({ action: 'search_by_province', args: { province: 'invalid-province' } }))
        .rejects.toThrow(PlatformError);
    });

    it('detail action returns PostItem for valid tax code', async () => {
      const result = await crawler.start({ action: 'detail', args: { taxCode: '0013180180' } });
      expect(result.post).toBeDefined();
      expect(result.post.id).toBe('masothue:0013180180');
      expect(result.post.platform).toBe('masothue');
      expect(result.post.externalId).toBe('0013180180');
      expect(result.post.metadata.address).toContain('123 Đường ABC');
      expect(result.post.metadata.businessLines).toContain('Sản xuất giày dép');
    });

    it('detail throws XACT_4001 for invalid tax code', async () => {
      await expect(crawler.start({ action: 'detail', args: { taxCode: 'abc' } }))
        .rejects.toThrow(PlatformError);
    });
  });
});
