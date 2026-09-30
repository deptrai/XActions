// by nichxbt — tests/web/enterprise-vn.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const pageSrc = readFileSync(join(__dirname, '../../apps/web/app/enterprise-vn/page.tsx'), 'utf8');
const navSrc = readFileSync(join(__dirname, '../../apps/web/lib/nav.ts'), 'utf8');

describe('enterprise-vn page architecture & constraints', () => {
  it('is a client component', () => {
    expect(pageSrc).toContain("'use client'");
  });

  it('imports api helper from @/lib/api', () => {
    expect(pageSrc).toContain("from '@/lib/api'");
  });

  it('has no raw fetch calls to backend or external apis', () => {
    expect(pageSrc).not.toContain('fetch(');
  });

  it('routes scrape requests through same-origin BFF /api/platform/{platform}/scrape', () => {
    expect(pageSrc).toContain('/api/platform/${platform}/scrape');
  });

  it('interacts with masothue, b2b_registry_extended, and ipvietnam platforms', () => {
    expect(pageSrc).toContain("'masothue'");
    expect(pageSrc).toContain("'b2b_registry_extended'");
    expect(pageSrc).toContain("'ipvietnam'");
  });

  it('calls masothue detail and search actions', () => {
    expect(pageSrc).toContain("'detail'");
    expect(pageSrc).toContain("'search'");
  });

  it('uses async lane (no forced sync mode) for procurement/legal scrapers', () => {
    // masothue, b2b_registry_extended, ipvietnam are NOT sync-eligible —
    // forcing mode:'sync' makes scrapeDispatch return HTTP 400 XACT_4001
    // 'action not sync-eligible'. Omit mode so the gateway resolves to
    // the async lane (isAsyncAccepted + pollOperation).
    expect(pageSrc).not.toContain("mode: 'sync'");
  });

  it('calls ipvietnam search_gazette or search action for trademark diligence', () => {
    expect(pageSrc).toContain("'search_gazette'");
  });

  it('detects input formats for 10-digit enterprise MST, 13-digit branch MST, and company name', () => {
    expect(pageSrc).toContain('tax_code_10');
    expect(pageSrc).toContain('tax_code_13');
    expect(pageSrc).toContain('company_name');
  });

  it('categorizes operational status with Emerald, Rose, and Amber badge styles', () => {
    expect(pageSrc).toContain('emerald');
    expect(pageSrc).toContain('rose');
    expect(pageSrc).toContain('amber');
    expect(pageSrc).toContain('Đang hoạt động');
    expect(pageSrc).toContain('Ngừng hoạt động');
    expect(pageSrc).toContain('Tạm ngừng');
  });

  it('includes an IP / Trademarks tab for intellectual property records', () => {
    expect(pageSrc).toContain('trademarks');
    expect(pageSrc).toContain('applicationNumber');
    expect(pageSrc).toContain('gazettePeriod');
  });

  it('displays Nice classification classes for trademark applications', () => {
    expect(pageSrc).toContain('classes');
    expect(pageSrc).toContain('Nhóm ngành');
  });

  it('copies tax code (MST) to clipboard with temporary confirmation state', () => {
    expect(pageSrc).toContain('clipboard.writeText');
    expect(pageSrc).toContain('1500');
    expect(pageSrc).toContain('Sao chép MST');
  });

  it('provides CSV export prepended with UTF-8 BOM for Microsoft Excel Vietnamese compatibility', () => {
    expect(pageSrc).toContain('﻿');
    expect(pageSrc).toContain('generateCsv');
    expect(pageSrc).toContain('text/csv;charset=utf-8;');
    expect(pageSrc).toContain('Xuất CSV');
  });

  it('provides JSON export for complete dossier data', () => {
    expect(pageSrc).toContain('handleExportJson');
    expect(pageSrc).toContain('application/json;charset=utf-8;');
    expect(pageSrc).toContain('Xuất JSON');
  });

  it('gracefully degrades on Cloudflare bot challenge XACT_4030 with a Retry button', () => {
    expect(pageSrc).toContain('XACT_4030');
    expect(pageSrc).toContain('Retry');
  });

  it('mirrors the URL-only effect using useRef to prevent unnecessary network re-triggers', () => {
    expect(pageSrc).toContain('executeSearchRef');
    expect(pageSrc).toContain('useRef(executeSearch)');
  });
});

describe('enterprise-vn navigation integration', () => {
  it('registers /enterprise-vn under Intelligence nav group in nav.ts with required keywords', () => {
    expect(navSrc).toContain('/enterprise-vn');
    expect(navSrc).toContain('Enterprise VN');
    expect(navSrc).toContain("'tax'");
    expect(navSrc).toContain("'mst'");
    expect(navSrc).toContain("'trademark'");
    expect(navSrc).toContain("'doanh nghiệp'");
  });
});
