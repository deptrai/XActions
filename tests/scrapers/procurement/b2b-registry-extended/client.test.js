// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * B2BRegistryExtendedClient tests.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import {
  B2BRegistryExtendedClient,
  HOSOCONGTY_BASE_URL,
  MUASAMCONG_BASE_URL,
} from '../../../../src/scrapers/procurement/b2b-registry-extended/client.js';
import { parseVietnameseDate } from '../../../../src/scrapers/procurement/b2b-registry-extended/normalizer.js';

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

const CLOUDFLARE_HTML = `
<!DOCTYPE html><html><body>Just a moment...</body></html>
`;

let server;
let baseUrl;

beforeAll(() => new Promise((resolve) => {
  server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

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
    if (url.pathname.includes('/cloudflare')) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end(CLOUDFLARE_HTML);
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

describe('B2BRegistryExtendedClient', () => {
  it('should expose default platform base URLs', () => {
    expect(HOSOCONGTY_BASE_URL).toBe('https://hosocongty.vn');
    expect(MUASAMCONG_BASE_URL).toBe('https://muasamcong.mpi.gov.vn');

    const defaultClient = new B2BRegistryExtendedClient({ requiresProxy: false });
    expect(defaultClient.hosocongtyBaseUrl).toBe('https://hosocongty.vn');
    expect(defaultClient.muasamcongBaseUrl).toBe('https://muasamcong.mpi.gov.vn');
  });

  it('should support querying both MuaSamCong and HoSoCongTy on a single client', async () => {
    const client = new B2BRegistryExtendedClient({ baseUrl, requiresProxy: false });
    const tenderResp = await client.searchTendersMuasamcong({ keyword: 'xây dựng' });
    expect(tenderResp.body).toContain('IB2600511963-00');

    const companyResp = await client.companyDetailHosocongty({ taxCode: '0123456789' });
    expect(companyResp.body).toContain('CÔNG TY TNHH ABC');
  });

  it('should build Muasamcong search URL with proper params', async () => {
    const client = new B2BRegistryExtendedClient({ targetPlatform: 'muasamcong', baseUrl, requiresProxy: false });
    const resp = await client.searchTendersMuasamcong({ keyword: 'xây dựng' });
    expect(resp.body).toContain('Mã TBMT');
    expect(resp.body).toContain('IB2600511963-00');
  });

  it('should fetch Muasamcong tender detail', async () => {
    const client = new B2BRegistryExtendedClient({ targetPlatform: 'muasamcong', baseUrl, requiresProxy: false });
    const resp = await client.tenderDetailMuasamcong({ notifyNo: 'IB2600511963' });
    expect(resp.body).toContain('Tên gói thầu');
    expect(resp.body).toContain('133.000.000 VND');
  });

  it('should fetch HoSoCongTy company detail', async () => {
    const client = new B2BRegistryExtendedClient({ targetPlatform: 'hosocongty', baseUrl, requiresProxy: false });
    const resp = await client.companyDetailHosocongty({ taxCode: '0123456789' });
    expect(resp.body).toContain('CÔNG TY TNHH ABC');
    expect(resp.body).toContain('0123456789');
  });

  it('should detect Cloudflare challenge as bot_challenge without false positives on benign challenge mentions', async () => {
    const client = new B2BRegistryExtendedClient({ targetPlatform: 'hosocongty', baseUrl: `${baseUrl}/cloudflare`, requiresProxy: false });
    const validator = client.responseValidator;
    const mockChallenge = { status: 403, body: CLOUDFLARE_HTML };
    expect(validator.isBotChallenge(mockChallenge)).toBe(true);
    expect(validator.isValidPayload(mockChallenge)).toBe(false);

    // Benign mention of "challenge" on a 200 business page must not be flagged
    const benignResponse = {
      status: 200,
      body: '<html><body>Tên công ty: Innovation Challenge Corp. Mã số thuế: 0123456789. HoSoCongTy.vn</body></html>',
    };
    expect(validator.isBotChallenge(benignResponse)).toBe(false);
    expect(validator.isValidPayload(benignResponse)).toBe(true);
  });

  it('should accurately parse Vietnamese dates', () => {
    const d1 = parseVietnameseDate('07/09/2026 - 02:07');
    expect(d1).toBeInstanceOf(Date);
    expect(d1?.getUTCFullYear()).toBe(2026);
    expect(d1?.getUTCMonth()).toBe(8); // Sept (0-indexed)
    expect(d1?.getUTCDate()).toBe(6); // 02:07 +07 is 19:07 UTC on previous day

    const d2 = parseVietnameseDate('15/03/2010');
    expect(d2).toBeInstanceOf(Date);
    expect(d2?.getUTCFullYear()).toBe(2010);
    expect(d2?.getUTCMonth()).toBe(2);

    expect(parseVietnameseDate(null)).toBeNull();
    expect(parseVietnameseDate('')).toBeNull();
    expect(parseVietnameseDate('not-a-date')).toBeNull();
  });
});
