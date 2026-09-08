import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { scrape, platforms } from '../../../../src/scrapers/index.js';
import { scrapeIpLegal, IpLegalCrawler, IpLegalClient } from '../../../../src/scrapers/legal/ip-trademark/index.js';

describe('Story 22.3: Legal & Trademark Dispatch Integration', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (req.url.includes('tuan-14')) {
        res.end(`
          <html>
            <body>
              <h1>ĐƠN NHÃN HIỆU TUẦN 14</h1>
              <table>
                <tr><td>1</td><td>4-2024-14654</td><td>08/04/2024</td><td>10/04/2026</td></tr>
              </table>
            </body>
          </html>
        `);
        return;
      }

      res.end(`
        <html>
          <body>
            <h1>Danh sách đơn chuyển công bố hàng tuần</h1>
            <a href="/web/guest/-/tuan-14">Danh sách đơn nhãn hiệu chuyển công bố tuần 14</a>
            <a href="/documents/NH_2026_updated_34.xlsx">Dữ liệu tổng hợp (.xlsx)</a>
          </body>
        </html>
      `);
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('registers ipvietnam, ip_legal, and legal in platforms registry', () => {
    expect(platforms.ipvietnam).toBeDefined();
    expect(platforms.ip_legal).toBeDefined();
    expect(platforms.legal).toBeDefined();
    expect(platforms.ipvietnam).toBe(platforms.legal);
  });

  it('dispatches search_gazette via scrape("ipvietnam")', async () => {
    const res = await scrape('ipvietnam', 'search_gazette', { baseUrl, limit: 5 });
    expect(res.posts).toBeDefined();
    expect(res.posts.length).toBeGreaterThanOrEqual(1);
    expect(res.posts[0].category).toBe('legal');
  });

  it('dispatches search_gazette via scrape("legal") and scrape("ip_legal")', async () => {
    const res1 = await scrape('legal', 'search_gazette', { baseUrl, limit: 5 });
    expect(res1.posts).toBeDefined();

    const res2 = await scrape('ip_legal', 'search', { baseUrl, limit: 5 });
    expect(res2.posts).toBeDefined();
  });

  it('dispatches get_weekly_list via scrape()', async () => {
    const res = await scrape('ipvietnam', 'get_weekly_list', {
      baseUrl,
      articleUrl: `${baseUrl}/web/guest/-/tuan-14`,
    });
    expect(res.posts).toHaveLength(1);
    expect(res.posts[0].id).toBe('ipvietnam:4-2024-14654');
  });

  it('dispatches yearly_summary via scrape()', async () => {
    const res = await scrape('ipvietnam', 'yearly_summary', { baseUrl });
    expect(res.posts).toBeDefined();
    expect(res.posts[0].metadata.fileType).toBe('xlsx');
  });

  it('dispatches detail via scrape()', async () => {
    const res = await scrape('ipvietnam', 'detail', {
      baseUrl,
      id: '4-2024-14654',
      articleUrl: `${baseUrl}/web/guest/-/tuan-14`,
    });
    expect(res.post).toBeDefined();
    expect(res.post.id).toBe('ipvietnam:4-2024-14654');
  });

  it('executes scrapeIpLegal convenience helper', async () => {
    const res = await scrapeIpLegal('search_gazette', { baseUrl, limit: 5 });
    expect(res.posts).toBeDefined();
  });

  it('exports IpLegalCrawler and IpLegalClient', () => {
    expect(IpLegalCrawler).toBeDefined();
    expect(IpLegalClient).toBeDefined();
  });
});
