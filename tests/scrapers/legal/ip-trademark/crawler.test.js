import { describe, it, expect, vi } from 'vitest';
import { IpLegalCrawler } from '../../../../src/scrapers/legal/ip-trademark/crawler.js';

describe('Story 22.3: IpLegalCrawler', () => {
  const sampleTableHtml = `
    <html>
      <body>
        <h1>DANH SÁCH ĐƠN NHÃN HIỆU TUẦN 14</h1>
        <table>
          <tr><td>1</td><td>4-2024-14654</td><td>08/04/2024</td><td>10/04/2026</td></tr>
          <tr><td>2</td><td>4-2026-11740</td><td>09/04/2026</td><td>11/04/2026</td></tr>
        </table>
      </body>
    </html>
  `;

  const sampleGazetteHtml = `
    <html>
      <body>
        <h1>Danh sách đơn chuyển công bố hàng tuần</h1>
        <a href="/web/guest/-/tuan-14">Danh sách đơn nhãn hiệu tuần 14</a>
        <a href="/documents/NH_2026_updated_34.xlsx">Dữ liệu tổng hợp (.xlsx)</a>
      </body>
    </html>
  `;

  function createMockClient() {
    return {
      requiresAuth: false,
      requiresProxy: false,
      platform: 'ipvietnam',
      getGazetteList: vi.fn().mockResolvedValue({ status: 200, body: sampleGazetteHtml }),
      getArticleContent: vi.fn().mockResolvedValue({ status: 200, body: sampleTableHtml }),
      getYearlySummary: vi.fn().mockResolvedValue({ status: 200, body: sampleGazetteHtml }),
      detail: vi.fn().mockResolvedValue({ status: 200, body: sampleTableHtml }),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('inherits from AbstractCrawler and sets correct properties', () => {
    const crawler = new IpLegalCrawler();
    expect(crawler.name).toBe('ipvietnam');
    expect(crawler.platform).toBe('ipvietnam');
    expect(crawler.category).toBe('legal');
    expect(crawler.requiresAuth).toBe(false);
  });

  it('implements init and cleanup lifecycle methods', async () => {
    const mockClient = createMockClient();
    const crawler = new IpLegalCrawler({ client: mockClient });
    await expect(crawler.init()).resolves.toBeUndefined();
    await crawler.cleanup();
    expect(mockClient.cleanup).toHaveBeenCalledTimes(1);
  });

  it('executes search_gazette and returns normalized posts', async () => {
    const mockClient = createMockClient();
    const store = { storeBatch: vi.fn().mockResolvedValue(undefined) };
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };

    const crawler = new IpLegalCrawler({ client: mockClient, store, publisher });
    const res = await crawler.searchGazette({ page: 1, limit: 10 });

    expect(res.posts).toBeDefined();
    expect(res.posts.length).toBeGreaterThanOrEqual(1);
    expect(res.posts[0].category).toBe('legal');
    expect(res.pageInfo.page).toBe(1);

    expect(store.storeBatch).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalled();
  });

  it('executes search action as alias for search_gazette', async () => {
    const mockClient = createMockClient();
    const crawler = new IpLegalCrawler({ client: mockClient });
    const res = await crawler.start({ action: 'search', args: { page: 1 } });
    expect(res.posts).toBeDefined();
  });

  it('executes get_weekly_list and parses application table rows', async () => {
    const mockClient = createMockClient();
    const crawler = new IpLegalCrawler({ client: mockClient });
    const res = await crawler.getWeeklyList({ articleUrl: '/web/guest/-/tuan-14' });

    expect(res.posts).toHaveLength(2);
    expect(res.posts[0].id).toBe('ipvietnam:4-2024-14654');
    expect(res.posts[0].metadata.applicationNumber).toBe('4-2024-14654');
    expect(res.posts[1].id).toBe('ipvietnam:4-2026-11740');
  });

  it('throws INVALID_ARGS when get_weekly_list misses articleUrl', async () => {
    const mockClient = createMockClient();
    const crawler = new IpLegalCrawler({ client: mockClient });
    await expect(crawler.getWeeklyList({})).rejects.toThrow(/articleUrl is required/);
  });

  it('executes yearly_summary and returns download link items', async () => {
    const mockClient = createMockClient();
    const crawler = new IpLegalCrawler({ client: mockClient });
    const res = await crawler.getYearlySummary({ year: 2026 });

    expect(res.posts).toBeDefined();
    expect(res.posts[0].metadata.fileType).toBe('xlsx');
  });

  it('executes detail and returns matching single application PostItem', async () => {
    const mockClient = createMockClient();
    const crawler = new IpLegalCrawler({ client: mockClient });
    const res = await crawler.detail({ id: '4-2026-11740' });

    expect(res.post).toBeDefined();
    expect(res.post.id).toBe('ipvietnam:4-2026-11740');
    expect(res.post.metadata.applicationNumber).toBe('4-2026-11740');
  });

  it('throws NOT_FOUND when detail query cannot match an application', async () => {
    const mockClient = createMockClient();
    mockClient.detail.mockResolvedValue({ status: 200, body: '<html><body>No data</body></html>' });
    const crawler = new IpLegalCrawler({ client: mockClient });
    await expect(crawler.detail({ id: '9-9999-99999' })).rejects.toThrow(/not found/i);
  });
});
