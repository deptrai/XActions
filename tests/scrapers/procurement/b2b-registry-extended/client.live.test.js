// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * B2BRegistryExtended live client & crawler integration tests.
 * Uses real node:http server serving captured live site fixtures.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { B2BRegistryExtendedClient } from '../../../../src/scrapers/procurement/b2b-registry-extended/client.js';
import { B2BRegistryExtendedCrawler } from '../../../../src/scrapers/procurement/b2b-registry-extended/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../../../../tests/fixtures/b2b-registry-extended');

async function loadFixture(name) {
  return readFile(join(fixturesDir, name), 'utf-8');
}

let server;
let baseUrl;
let hosocongtySearchHtml;
let hosocongtyDetailHtml;
let muasamcongSearchJson;
let muasamcongDetailJson;

beforeAll(async () => {
  hosocongtySearchHtml = await loadFixture('hosocongty-search.html');
  hosocongtyDetailHtml = await loadFixture('hosocongty-detail.html');
  muasamcongSearchJson = await loadFixture('muasamcong-search.json');
  muasamcongDetailJson = await loadFixture('muasamcong-detail.json');

  await new Promise((resolve) => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // HoSoCongTy live search route
      if (url.pathname === '/search') {
        const key = url.searchParams.get('key');
        const opt = url.searchParams.get('opt');
        const p = url.searchParams.get('p');
        const d = url.searchParams.get('d');

        if (key) {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=UTF-8',
            'X-Search-Params': `opt=${opt}&p=${p}&d=${d}`,
          });
          res.end(hosocongtySearchHtml);
          return;
        }
      }

      // HoSoCongTy live detail route — slug-based .htm from search results
      if (url.pathname.endsWith('.htm') && url.pathname.includes('cong-ty')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
        res.end(hosocongtyDetailHtml);
        return;
      }

      // Legacy fallback route /tra-cuu/{taxCode}
      if (url.pathname.startsWith('/tra-cuu/')) {
        const taxCode = url.pathname.replace('/tra-cuu/', '');
        if (taxCode === 'notfound') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          res.end('<html><body><div>Không tìm thấy dữ liệu</div></body></html>');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
        res.end(hosocongtyDetailHtml);
        return;
      }

      // MuaSamCong live smart search REST endpoint
      if (url.pathname === '/o/egp-portal-contractor-selection-v2/services/smart/search') {
        let bodyStr = '';
        req.on('data', (chunk) => { bodyStr += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(muasamcongSearchJson);
        });
        return;
      }

      // MuaSamCong live detail get-by-id REST endpoint
      if (url.pathname === '/o/egp-portal-contractor-selection-v2/services/expose/lcnt/bid-po-bido-notify-contractor-view/get-by-id') {
        let bodyStr = '';
        req.on('data', (chunk) => { bodyStr += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(muasamcongDetailJson);
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('B2BRegistryExtended live integration', () => {
  it('should search HoSoCongTy using live /search?key= route with default params', async () => {
    const client = new B2BRegistryExtendedClient({ baseUrl, requiresProxy: false });
    const resp = await client.searchHosocongty({ q: '0123456789' });

    expect(resp.status).toBe(200);
    expect(resp.headers['x-search-params']).toBe('opt=0&p=0&d=0');
    expect(resp.body).toContain('CÔNG TY TNHH ABC');
    expect(resp.body).toContain('0123456789');
  });

  it('should fetch HoSoCongTy company detail via slug extracted from search results', async () => {
    const client = new B2BRegistryExtendedClient({ baseUrl, requiresProxy: false });
    const resp = await client.companyDetailHosocongty({ taxCode: '1702372113' });

    expect(resp.status).toBe(200);
    expect(resp.body).toContain('1702372113');
    expect(resp.body).toContain('HUNG THINH PHAT C&amp;T CO,. LTD');
  });

  it('should fall back to /tra-cuu/ route when no slug is found in search results', async () => {
    const client = new B2BRegistryExtendedClient({ baseUrl, requiresProxy: false });
    const resp = await client.companyDetailHosocongty({ taxCode: '0123456789' });

    expect(resp.status).toBe(200);
    expect(resp.body).toContain('1702372113');
  });

  it('should search MuaSamCong tenders using live smart search REST endpoint', async () => {
    const client = new B2BRegistryExtendedClient({ targetPlatform: 'muasamcong', baseUrl, requiresProxy: false });
    const resp = await client.searchTendersMuasamcong({ keyword: 'cồng chiêng' });

    expect(resp.status).toBe(200);
    const data = JSON.parse(resp.body);
    expect(data.page.content.length).toBeGreaterThan(0);
    expect(data.page.content[0].notifyNo).toBe('IB2600512737');
  });

  it('should fetch MuaSamCong tender detail using live get-by-id REST endpoint', async () => {
    const client = new B2BRegistryExtendedClient({ targetPlatform: 'muasamcong', baseUrl, requiresProxy: false });
    const resp = await client.tenderDetailMuasamcong({ id: '14e6471c-cd8a-4f58-9126-929797f25555' });

    expect(resp.status).toBe(200);
    const data = JSON.parse(resp.body);
    expect(data.bidoNotifyContractorM.notifyNo).toBe('IB2600482481');
    expect(data.bidoNotifyContractorM.bidName).toBe('Gói số 01: Thi công xây dựng');
  });

  it('should resolve tender detail via notifyNo smart search when id is not known', async () => {
    const client = new B2BRegistryExtendedClient({ targetPlatform: 'muasamcong', baseUrl, requiresProxy: false });
    const resp = await client.tenderDetailMuasamcong({ notifyNo: 'IB2600512737' });

    expect(resp.status).toBe(200);
    const data = JSON.parse(resp.body);
    expect(data.bidoNotifyContractorM.notifyNo).toBe('IB2600482481');
  });

  it('should execute end-to-end HoSoCongTy crawler search and detail flow', async () => {
    const client = new B2BRegistryExtendedClient({ baseUrl, requiresProxy: false });
    const crawler = new B2BRegistryExtendedCrawler({ client, requiresProxy: false });

    const searchResult = await crawler.start({ action: 'search', args: { q: 'ABC' } });
    expect(searchResult.posts.length).toBe(2);
    expect(searchResult.posts[0].externalId).toBe('0123456789');
    expect(searchResult.posts[0].title).toBe('CÔNG TY TNHH ABC');

    const detailResult = await crawler.start({ action: 'detail', args: { id: '1702372113', platform: 'hosocongty' } });
    expect(detailResult.post).toBeDefined();
    expect(detailResult.post.externalId).toBe('1702372113');
    expect(detailResult.post.authorName).toBe('Lưu Trọng Nghĩa');
    expect(detailResult.post.authorId).toBe('hosocongty:1702372113');
    expect(detailResult.post.publishedAt).toBeInstanceOf(Date);
  });

  it('should execute end-to-end MuaSamCong crawler search_tenders and detail flow', async () => {
    const client = new B2BRegistryExtendedClient({ baseUrl, requiresProxy: false });
    const crawler = new B2BRegistryExtendedCrawler({ client, requiresProxy: false });

    const searchResult = await crawler.start({ action: 'search_tenders', args: { keyword: 'cồng chiêng' } });
    expect(searchResult.posts.length).toBeGreaterThan(0);
    const firstTender = searchResult.posts[0];
    expect(firstTender.platform).toBe('muasamcong');
    expect(firstTender.externalId).toBe('IB2600512737');
    expect(firstTender.authorName).toBe('Phòng Văn hoá - Xã hội xã Trà Linh');
    expect(firstTender.publishedAt).toBeInstanceOf(Date);

    const detailResult = await crawler.start({ action: 'detail', args: { id: '14e6471c-cd8a-4f58-9126-929797f25555', platform: 'muasamcong' } });
    expect(detailResult.post).toBeDefined();
    expect(detailResult.post.externalId).toBe('IB2600482481');
    expect(detailResult.post.title).toBe('Gói số 01: Thi công xây dựng');
    expect(detailResult.post.metadata.bidValue).toContain('325.171.000 VND');
  });
});
