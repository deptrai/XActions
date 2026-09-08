import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { IpLegalClient } from '../../../../src/scrapers/legal/ip-trademark/client.js';

describe('Story 22.3: IpLegalClient (Integration with Mock Server)', () => {
  let server;
  let baseUrl;
  let lastRequest = null;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
      };

      if (req.url.includes('danh-sach-don-chuyen-cong-bo-hang-tuan')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`
          <html>
            <body>
              <div class="journal-content-article">
                <h1>Danh sách đơn chuyển công bố hàng tuần</h1>
                <a href="/web/guest/-/tuan-14">Danh sách đơn nhãn hiệu chuyển công bố tuần 14</a>
                <a href="/documents/NH_2026_updated_34.xlsx">Dữ liệu tổng hợp nhãn hiệu (.xlsx)</a>
              </div>
            </body>
          </html>
        `);
        return;
      }

      if (req.url.includes('tuan-14')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
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

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('instantiates with expected default properties', () => {
    const client = new IpLegalClient();
    expect(client.requiresAuth).toBe(false);
    expect(client.requiresProxy).toBe(false);
    expect(client.platform).toBe('ipvietnam');
  });

  it('fetches weekly gazette list with pagination', async () => {
    const client = new IpLegalClient({ baseUrl });
    const resp = await client.getGazetteList({ page: 2 });
    expect(resp.status).toBe(200);
    expect(lastRequest.url).toContain('page=2');
    expect(resp.body).toContain('Danh sách đơn chuyển công bố hàng tuần');
  });

  it('fetches article content for a specific weekly link', async () => {
    const client = new IpLegalClient({ baseUrl });
    const resp = await client.getArticleContent('/web/guest/-/tuan-14');
    expect(resp.status).toBe(200);
    expect(resp.body).toContain('4-2024-14654');
  });

  it('fetches yearly summary', async () => {
    const client = new IpLegalClient({ baseUrl });
    const resp = await client.getYearlySummary({ year: 2026 });
    expect(resp.status).toBe(200);
    expect(resp.body).toContain('.xlsx');
  });

  it('validates required id on detail call', async () => {
    const client = new IpLegalClient({ baseUrl });
    await expect(client.detail({})).rejects.toThrow(/id \(applicationNumber\) is required/);
  });
});
