// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * B2BRegistryExtendedCrawler tests.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { B2BRegistryExtendedCrawler } from '../../../../src/scrapers/procurement/b2b-registry-extended/index.js';
import { B2BRegistryExtendedClient } from '../../../../src/scrapers/procurement/b2b-registry-extended/client.js';
import {
  scrape,
  getPlatform,
  createB2BRegistryExtendedCrawler,
  createB2BRegistryExtendedClient,
} from '../../../../src/scrapers/index.js';

const HOSOCONGTY_DETAIL_HTML = `
<!DOCTYPE html><html><body>
<div class="company-detail">
  <h1>Tên công ty: CÔNG TY TNHH ABC</h1>
  <p>Mã số thuế: 0123456789</p>
  <p>Người đại diện: Nguyễn Văn A</p>
  <p>Số điện thoại: 0909123456</p>
  <p>Ngành nghề: Dịch vụ tư vấn</p>
  <p>Vốn điều lệ: 10.000.000.000 VND</p>
  <p>Ngày thành lập: 15/03/2010</p>
  <p>Địa chỉ: 123 Lê Lợi, Hà Nội</p>
</div>
</body></html>
`;

const MUASAMCONG_SEARCH_HTML = `
<!DOCTYPE html><html><body>
<div class="content__body__left__item">
  <div class="content__body__left__item__infor">
    <p class="content__body__left__item__infor__code">Mã TBMT: IB2600511963-00</p>
    <span class="content__body__left__item__infor__notice--be">Chưa đóng thầu</span>
    <a href="#"><h5 class="content__body__left__item__infor__contract__name format__text__title">Cung cấp dịch vụ ăn, nghỉ</h5></a>
    <h6 class="format__text">Chủ đầu tư: <span>Cục Quản trị Văn phòng Quốc hội</span></h6>
    <h6>Ngày đăng tải thông báo: <span>07/09/2026 - 02:07</span></h6>
    <h6>Lĩnh vực: <span>Phi tư vấn</span></h6>
    <h6>Địa điểm: <span>Thành phố Hồ Chí Minh; Thành phố Hà Nội;</span></h6>
  </div>
  <div class="content__body__right__item__infor__contract">
    <p>Thời điểm đóng thầu</p>
    <h5>09:00</h5>
    <h5>21/09/2026</h5>
  </div>
</div>
</body></html>
`;

const MUASAMCONG_DETAIL_HTML = `
<!DOCTYPE html><html><body>
<div id="info-general">
  <p>Mã TBMT: IB2600511963</p>
  <p>Ngày đăng tải: 07/09/2026 02:07</p>
  <p>Mã KHLCNT: PL2600280844</p>
  <p>Tên gói thầu: Cung cấp dịch vụ ăn, nghỉ</p>
  <p>Chủ đầu tư: Cục Quản trị Văn phòng Quốc hội</p>
  <p>Bên mời thầu: Cục Quản trị Văn phòng Quốc hội</p>
  <p>Lĩnh vực: Phi tư vấn</p>
  <p>Hình thức lựa chọn nhà thầu: Đấu thầu rộng rãi</p>
  <p>Loại hợp đồng: Đơn giá cố định</p>
  <p>Thời gian thực hiện gói thầu: 12 tháng</p>
  <p>Thời điểm đóng thầu: 21/09/2026 09:00</p>
  <p>Thời điểm mở thầu: 21/09/2026 09:00</p>
  <p>Số tiền bảo đảm dự thầu: 133.000.000 VND</p>
  <p>Hình thức đảm bảo dự thầu: Thư bảo lãnh</p>
</div>
</body></html>
`;

let server;
let baseUrl;

beforeAll(() => new Promise((resolve) => {
  server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.includes('/tra-cuu/notfound') || url.pathname.includes('notfound')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><body><div>Không tìm thấy dữ liệu</div></body></html>');
      return;
    }
    if (url.pathname.includes('/tra-cuu/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HOSOCONGTY_DETAIL_HTML);
      return;
    }
    if (url.pathname.includes('/tim-kiem')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HOSOCONGTY_DETAIL_HTML);
      return;
    }
    if (url.pathname.includes('/web/guest/bc/-/search')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(MUASAMCONG_SEARCH_HTML);
      return;
    }
    if (url.pathname.includes('/web/guest/contractor-selection') && url.searchParams.get('render') === 'detail-v2') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(MUASAMCONG_DETAIL_HTML);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
    resolve();
  });
}));

afterAll(() => new Promise((resolve) => server.close(resolve)));

function createTestClient(platform) {
  return new B2BRegistryExtendedClient({
    targetPlatform: platform,
    baseUrl,
    requiresProxy: false,
  });
}

describe('B2BRegistryExtendedCrawler', () => {
  it('should search Muasamcong tenders and normalize PostItems with valid publishedAt', async () => {
    const client = createTestClient('muasamcong');
    const crawler = new B2BRegistryExtendedCrawler({ client, requiresProxy: false });
    const result = await crawler.start({ action: 'search_tenders', args: { keyword: 'xây dựng' } });

    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThan(0);
    const post = result.posts[0];
    expect(post.platform).toBe('muasamcong');
    expect(post.category).toBe('b2b');
    expect(post.externalId).toBe('IB2600511963-00');
    expect(post.title).toContain('Cung cấp dịch vụ');
    expect(post.metadata.tenderNo).toBe('IB2600511963-00');
    expect(post.publishedAt).toBeInstanceOf(Date);
  });

  it('should delegate search action to search_tenders when platform is muasamcong', async () => {
    const client = createTestClient('muasamcong');
    const crawler = new B2BRegistryExtendedCrawler({ client, requiresProxy: false });
    const result = await crawler.start({
      action: 'search',
      args: { q: 'xây dựng', platform: 'muasamcong' },
    });

    expect(Array.isArray(result.posts)).toBe(true);
    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.posts[0].platform).toBe('muasamcong');
  });

  it('should get Muasamcong tender detail', async () => {
    const client = createTestClient('muasamcong');
    const crawler = new B2BRegistryExtendedCrawler({ client, requiresProxy: false });
    const result = await crawler.start({ action: 'detail', args: { id: 'IB2600511963', platform: 'muasamcong' } });

    expect(result.post).toBeTruthy();
    expect(result.post.platform).toBe('muasamcong');
    expect(result.post.externalId).toBe('IB2600511963');
    expect(result.post.metadata.bidValue).toBe('133.000.000 VND');
    expect(result.post.publishedAt).toBeInstanceOf(Date);
  });

  it('should get HoSoCongTy company detail', async () => {
    const client = createTestClient('hosocongty');
    const crawler = new B2BRegistryExtendedCrawler({ client, requiresProxy: false });
    const result = await crawler.start({ action: 'detail', args: { id: '0123456789' } });

    expect(result.post).toBeTruthy();
    expect(result.post.platform).toBe('hosocongty');
    expect(result.post.externalId).toBe('0123456789');
    expect(result.post.metadata.companyName).toContain('CÔNG TY TNHH ABC');
    expect(result.post.publishedAt).toBeInstanceOf(Date);
  });

  it('should throw NOT_FOUND error when detail record cannot be resolved', async () => {
    const client = createTestClient('hosocongty');
    const crawler = new B2BRegistryExtendedCrawler({ client, requiresProxy: false });
    await expect(crawler.start({ action: 'detail', args: { id: 'notfound' } }))
      .rejects.toThrow(/not found/i);
  });

  it('should list actions', () => {
    const crawler = new B2BRegistryExtendedCrawler({});
    const actions = crawler.listActions();
    const names = actions.map((a) => a.action);
    expect(names).toContain('search');
    expect(names).toContain('search_tenders');
    expect(names).toContain('detail');
  });

  it('should dispatch via unified scrape() interface for muasamcong and hosocongty', async () => {
    const searchRes = await scrape('muasamcong', 'search', {
      keyword: 'xây dựng',
      baseUrl,
      requiresProxy: false,
    });
    expect(searchRes.posts.length).toBeGreaterThan(0);
    expect(searchRes.posts[0].platform).toBe('muasamcong');

    const detailRes = await scrape('muasamcong', 'tender_detail', {
      notifyNo: 'IB2600511963',
      baseUrl,
      requiresProxy: false,
    });
    expect(detailRes.post).toBeTruthy();
    expect(detailRes.post.platform).toBe('muasamcong');

    const companyRes = await scrape('hosocongty', 'company', {
      taxCode: '0123456789',
      baseUrl,
      requiresProxy: false,
    });
    expect(companyRes.post).toBeTruthy();
    expect(companyRes.post.platform).toBe('hosocongty');
  });

  it('should return valid adapter and factory instances for B2B extended scraper', () => {
    const hscPlatform = getPlatform('hosocongty');
    expect(hscPlatform).toBeTruthy();
    expect(hscPlatform.B2BRegistryExtendedCrawler).toBe(B2BRegistryExtendedCrawler);
    expect(hscPlatform.B2BRegistryExtendedClient).toBe(B2BRegistryExtendedClient);

    const mscPlatform = getPlatform('muasamcong');
    expect(mscPlatform).toBeTruthy();
    expect(mscPlatform.B2BRegistryExtendedCrawler).toBe(B2BRegistryExtendedCrawler);
    expect(mscPlatform.B2BRegistryExtendedClient).toBe(B2BRegistryExtendedClient);

    const client = createB2BRegistryExtendedClient({ requiresProxy: false });
    expect(client).toBeInstanceOf(B2BRegistryExtendedClient);

    const crawlerFromClient = createB2BRegistryExtendedCrawler(client);
    expect(crawlerFromClient).toBeInstanceOf(B2BRegistryExtendedCrawler);
    expect(crawlerFromClient.client).toBe(client);

    const crawlerFromOptions = createB2BRegistryExtendedCrawler({ requiresProxy: false });
    expect(crawlerFromOptions).toBeInstanceOf(B2BRegistryExtendedCrawler);
  });

  it('should extract clean bidStatus and stable authorId without CSS class modifiers', async () => {
    const client = createTestClient('muasamcong');
    const crawler = new B2BRegistryExtendedCrawler({ client, requiresProxy: false });
    const result = await crawler.start({ action: 'search_tenders', args: { keyword: 'xây dựng' } });

    const post = result.posts[0];
    expect(post.metadata.bidStatus).toBe('Chưa đóng thầu');
    expect(post.authorId).toBe('Cục Quản trị Văn phòng Quốc hội');

    const hscClient = createTestClient('hosocongty');
    const hscCrawler = new B2BRegistryExtendedCrawler({ client: hscClient, requiresProxy: false });
    const hscResult = await hscCrawler.start({ action: 'detail', args: { id: '0123456789' } });
    expect(hscResult.post.authorId).toBe('hosocongty:0123456789');
  });

  it('should persist batch items to store and emit ThinEvents to publisher', async () => {
    const client = createTestClient('muasamcong');
    const store = {
      stored: [],
      async storeBatch(items) {
        this.stored.push(...items);
      },
    };
    const publisher = {
      published: [],
      async publish(event) {
        this.published.push(event);
      },
    };

    const crawler = new B2BRegistryExtendedCrawler({ client, store, publisher, requiresProxy: false });
    const result = await crawler.start({ action: 'search_tenders', args: { keyword: 'xây dựng' } });

    expect(store.stored.length).toBe(result.posts.length);
    expect(publisher.published.length).toBe(result.posts.length);

    const firstEvent = publisher.published[0];
    expect(firstEvent).toMatchObject({
      id: result.posts[0].id,
      platform: 'muasamcong',
      externalId: 'IB2600511963-00',
      category: 'b2b',
      authorId: 'Cục Quản trị Văn phòng Quốc hội',
      storageRef: result.posts[0].id,
    });
    expect(firstEvent.crawledAt).toBeInstanceOf(Date);
  });

  it('should reject missing required arguments with PlatformError', async () => {
    const crawler = new B2BRegistryExtendedCrawler({ requiresProxy: false });

    await expect(crawler.start({ action: 'search', args: {} })).rejects.toThrow(
      /Missing required argument: q/i,
    );

    await expect(crawler.start({ action: 'search_tenders', args: {} })).rejects.toThrow(
      /Missing required argument: keyword/i,
    );

    await expect(crawler.start({ action: 'detail', args: {} })).rejects.toThrow(
      /Missing required argument: id/i,
    );
  });
});
