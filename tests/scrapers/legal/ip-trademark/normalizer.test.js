import { describe, it, expect } from 'vitest';
import {
  extractGazetteArticles,
  extractWeeklyTableRows,
  extractYearlyDownloads,
  normalizeIpLegalResults,
} from '../../../../src/scrapers/legal/ip-trademark/normalizer.js';

describe('Story 22.3: Legal & Trademark Normalizer', () => {
  const sampleTableHtml = `
    <html>
      <body>
        <h1>DANH SÁCH ĐƠN NHÃN HIỆU CHUYỂN CÔNG BỐ TUẦN 14 NĂM 2026</h1>
        <table>
          <thead>
            <tr>
              <th>STT</th>
              <th>Số đơn</th>
              <th>Ngày nộp đơn</th>
              <th>Ngày chuyển công bố</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>4-2024-14654</td>
              <td>08/04/2024</td>
              <td>10/04/2026</td>
            </tr>
            <tr>
              <td>2</td>
              <td>4-2026-11740</td>
              <td>09/04/2026</td>
              <td>11/04/2026</td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  `;

  const sampleGazetteListHtml = `
    <div>
      <a href="/web/guest/-/danh-sach-don-nhan-hieu-chuyen-cong-bo-tuan-14">
        Danh sách đơn nhãn hiệu chuyển công bố tuần 14
      </a>
      <a href="/documents/NH_2026_updated_34.xlsx">
        Dữ liệu tổng hợp nhãn hiệu năm 2026 (.xlsx)
      </a>
      <a href="/documents/tong_hop_2026.pdf">
        Công báo tổng hợp 2026 (.pdf)
      </a>
    </div>
  `;

  describe('extractWeeklyTableRows', () => {
    it('extracts table rows into PostItem array', () => {
      const items = extractWeeklyTableRows(sampleTableHtml, {
        articleUrl: 'https://ipvietnam.gov.vn/web/guest/-/tuan-14',
        articleTitle: 'DANH SÁCH ĐƠN NHÃN HIỆU CHUYỂN CÔNG BỐ TUẦN 14 NĂM 2026',
      });

      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('ipvietnam:4-2024-14654');
      expect(items[0].platform).toBe('ipvietnam');
      expect(items[0].category).toBe('legal');
      expect(items[0].metadata.applicationNumber).toBe('4-2024-14654');
      expect(items[0].metadata.applicationDate).toBe('2024-04-08T00:00:00.000Z');
      expect(items[0].metadata.publicationDate).toBe('2026-04-10T00:00:00.000Z');
      expect(items[0].metadata.gazettePeriod).toBe('Tuần 14/2026');

      expect(items[1].id).toBe('ipvietnam:4-2026-11740');
      expect(items[1].metadata.applicationNumber).toBe('4-2026-11740');
    });

    it('returns empty array for invalid html or empty table', () => {
      expect(extractWeeklyTableRows(null)).toEqual([]);
      expect(extractWeeklyTableRows('<div>No table</div>')).toEqual([]);
    });
  });

  describe('extractGazetteArticles', () => {
    it('extracts gazette article links', () => {
      const articles = extractGazetteArticles(sampleGazetteListHtml);
      expect(articles.length).toBeGreaterThanOrEqual(1);
      expect(articles[0].url).toContain('danh-sach-don-nhan-hieu-chuyen-cong-bo-tuan-14');
    });
  });

  describe('extractYearlyDownloads', () => {
    it('extracts .xlsx and .pdf download links', () => {
      const downloads = extractYearlyDownloads(sampleGazetteListHtml);
      expect(downloads).toHaveLength(2);
      expect(downloads[0].fileType).toBe('xlsx');
      expect(downloads[0].url).toContain('NH_2026_updated_34.xlsx');
      expect(downloads[1].fileType).toBe('pdf');
    });
  });

  describe('normalizeIpLegalResults', () => {
    it('normalizes get_weekly_list kind', () => {
      const results = normalizeIpLegalResults(sampleTableHtml, 'get_weekly_list');
      expect(results).toHaveLength(2);
      expect(results[0].category).toBe('legal');
    });

    it('normalizes yearly_summary kind', () => {
      const results = normalizeIpLegalResults(sampleGazetteListHtml, 'yearly_summary');
      expect(results).toHaveLength(2);
      expect(results[0].metadata.fileType).toBe('xlsx');
    });

    it('normalizes detail kind with matching id', () => {
      const result = normalizeIpLegalResults(sampleTableHtml, 'detail', { id: '4-2026-11740' });
      expect(result).toBeDefined();
      expect(result.id).toBe('ipvietnam:4-2026-11740');
    });
  });
});
