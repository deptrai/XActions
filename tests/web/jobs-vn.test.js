// by nichxbt — tests/web/jobs-vn.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const pageSrc = readFileSync(join(__dirname, '../../apps/web/app/jobs-vn/page.tsx'), 'utf8');
const explorerSrc = readFileSync(join(__dirname, '../../apps/web/app/explorer/page.tsx'), 'utf8');
const navSrc = readFileSync(join(__dirname, '../../apps/web/lib/nav.ts'), 'utf8');
const jobsFormatSrc = readFileSync(join(__dirname, '../../apps/web/lib/jobs-format.ts'), 'utf8');

describe('jobs-vn page architecture & constraints', () => {
  it('is a client component', () => {
    expect(pageSrc).toContain("'use client'");
  });

  it('imports api helper from @/lib/api', () => {
    expect(pageSrc).toContain("from '@/lib/api'");
  });

  it('has no raw fetch calls to backend or external apis', () => {
    expect(pageSrc).not.toContain('fetch(');
  });

  it('routes scrape requests through same-origin BFF /api/platform/${platform}/scrape', () => {
    expect(pageSrc).toContain('/api/platform/${platform}/scrape');
  });

  it('interacts with topcv, vietnamworks, and linkedin recruitment platforms', () => {
    expect(pageSrc).toContain("'topcv'");
    expect(pageSrc).toContain("'vietnamworks'");
    expect(pageSrc).toContain("'linkedin'");
  });

  it('calls search_jobs action on all platforms', () => {
    expect(pageSrc).toContain("'search_jobs'");
  });

  it('uses async lane (no forced sync mode) for recruitment scrapers', () => {
    // TopCV, VietnamWorks, and LinkedIn recruitment crawlers are NOT sync-eligible;
    // forcing mode: 'sync' returns HTTP 400 action not sync-eligible.
    expect(pageSrc).not.toContain("mode: 'sync'");
  });

  it('renders Job Card fields: title, companyName, companyLogo, location, rawSalary, skills, postUrl', () => {
    expect(pageSrc).toContain('title');
    expect(pageSrc).toContain('companyName');
    expect(pageSrc).toContain('companyLogo');
    expect(pageSrc).toContain('location');
    expect(pageSrc).toContain('rawSalary');
    expect(pageSrc).toContain('skills');
    expect(pageSrc).toContain('postUrl');
  });

  it('provides fallback initials avatar for company logo with referrerPolicy="no-referrer" and onError', () => {
    expect(pageSrc).toContain('referrerPolicy="no-referrer"');
    expect(pageSrc).toContain('onError');
    expect(pageSrc).toContain('CompanyAvatar');
  });

  it('displays emerald salary pill with formatted range or Thỏa thuận when isNegotiable', () => {
    expect(pageSrc).toContain('emerald');
    expect(pageSrc).toContain('Thỏa thuận');
    expect(pageSrc).toContain('isNegotiable');
    expect(pageSrc).toContain('formatSalary');
  });

  it('renders tech stack tags chips from skills metadata', () => {
    expect(pageSrc).toContain('job.skills');
    expect(pageSrc).toContain('skills.slice');
  });

  it('includes apply button linking to postUrl with external link', () => {
    expect(pageSrc).toContain('Ứng tuyển');
    expect(pageSrc).toContain('postUrl');
    expect(pageSrc).toContain('ExternalLink');
  });

  it('handles partial degradation on XACT_4030 with "Temporarily rate-limited" and Retry button', () => {
    expect(pageSrc).toContain('XACT_4030');
    expect(pageSrc).toContain('Temporarily rate-limited');
    expect(pageSrc).toContain('Retry');
  });

  it('provides skeleton loading matching card layout', () => {
    expect(pageSrc).toContain('JobSkeletonCard');
    expect(pageSrc).toContain('animate-pulse');
  });

  it('implements sticky filter bar with keyword, location, source, exp, work mode, and salary presets', () => {
    expect(pageSrc).toContain('sticky');
    expect(pageSrc).toContain('selectedLocation');
    expect(pageSrc).toContain('selectedPlatform');
    expect(pageSrc).toContain('selectedExp');
    expect(pageSrc).toContain('selectedWorkMode');
    expect(pageSrc).toContain('selectedSalaryPreset');
  });

  it('provides CSV export prepended with UTF-8 BOM for Microsoft Excel Vietnamese compatibility', () => {
    // BOM + generateJobsCsv now live in the pure lib module (so they are
    // executable-testable); the page wires the download handler.
    expect(jobsFormatSrc).toContain('﻿');
    expect(jobsFormatSrc).toContain('generateJobsCsv');
    expect(pageSrc).toContain('generateJobsCsv');
    expect(pageSrc).toContain('Export Job Leads (CSV)');
    expect(pageSrc).toContain('text/csv;charset=utf-8;');
  });
});

describe('explorer jobs tab live integration', () => {
  it('imports api helper from @/lib/api', () => {
    expect(explorerSrc).toContain("from '@/lib/api'");
  });

  it('routes explorer jobs scrape through async lane without mode: sync', () => {
    expect(explorerSrc).toContain('/api/platform/${platform}/scrape');
    expect(explorerSrc).not.toContain("mode: 'sync'");
  });

  it('calls search_jobs on topcv, vietnamworks, linkedin when activeCategory === "jobs"', () => {
    expect(explorerSrc).toContain("activeCategory !== 'jobs'");
    expect(explorerSrc).toContain("'topcv'");
    expect(explorerSrc).toContain("'vietnamworks'");
    expect(explorerSrc).toContain("'linkedin'");
    expect(explorerSrc).toContain("'search_jobs'");
  });

  it('maps PostItem metadata to ExplorerItem fields', () => {
    expect(explorerSrc).toContain('mapPostToExplorerItem');
    expect(explorerSrc).toContain('field1');
    expect(explorerSrc).toContain('field2');
    expect(explorerSrc).toContain('liveJobs');
  });

  it('replaces static mock identifiers j1, j2, j3, j4 in jobs items', () => {
    expect(explorerSrc).not.toContain("'j1'");
    expect(explorerSrc).not.toContain("'j2'");
    expect(explorerSrc).not.toContain("'j3'");
    expect(explorerSrc).not.toContain("'j4'");
  });
});

describe('platform suites navigation integration', () => {
  it('registers Platform Suites nav group in nav.ts with id platform-suites', () => {
    expect(navSrc).toContain('Platform Suites');
    expect(navSrc).toContain("'platform-suites'");
  });

  it('includes all 5 platform suites in Platform Suites group', () => {
    expect(navSrc).toContain('/dexscreener');
    expect(navSrc).toContain('/youtube');
    expect(navSrc).toContain('/fediverse');
    expect(navSrc).toContain('/enterprise-vn');
    expect(navSrc).toContain('/jobs-vn');
  });

  it('provides relevant keywords for /jobs-vn route', () => {
    expect(navSrc).toContain("'jobs'");
    expect(navSrc).toContain("'recruitment'");
    expect(navSrc).toContain("'topcv'");
    expect(navSrc).toContain("'vietnamworks'");
    expect(navSrc).toContain("'linkedin'");
  });
});

// --- Executable tests cho helper thuần (apps/web/lib/jobs-format.ts) ---------
// Verification-gap: các test source-assertion ở trên không thực thi được logic,
// nên các hàm định dạng được tách sang module thuần và test thật ở đây.
import { formatSalary, escapeCsv, generateJobsCsv } from '../../apps/web/lib/jobs-format.ts';

const mkJob = (over = {}) => ({
  id: 'topcv:job:1',
  platform: 'topcv',
  title: 'Senior React Developer',
  companyName: 'FPT Software',
  companyLogo: null,
  location: 'Hồ Chí Minh',
  rawSalary: '',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  isNegotiable: false,
  experienceYears: null,
  skills: ['TypeScript', 'Docker'],
  employmentType: 'Toàn thời gian',
  postUrl: 'https://topcv.vn/job/1',
  publishedAt: '2026-09-30',
  ...over,
});

describe('formatSalary (executable)', () => {
  it('returns Thỏa thuận when isNegotiable', () => {
    expect(formatSalary(mkJob({ isNegotiable: true })).text).toBe('Thỏa thuận');
  });

  it('detects negotiable phrasing inside rawSalary', () => {
    expect(formatSalary(mkJob({ rawSalary: 'Thỏa thuận' })).isNegotiable).toBe(true);
    expect(formatSalary(mkJob({ rawSalary: 'Negotiable' })).isNegotiable).toBe(true);
  });

  it('passes through a concrete rawSalary verbatim', () => {
    expect(formatSalary(mkJob({ rawSalary: '15 - 25 Triệu' })).text).toBe('15 - 25 Triệu');
  });

  it('formats a USD range', () => {
    const r = formatSalary(mkJob({ salaryMin: 2000, salaryMax: 3500, salaryCurrency: 'USD' }));
    expect(r.text).toBe('$2,000 - $3,500');
  });

  it('formats a VND range', () => {
    const r = formatSalary(mkJob({ salaryMin: 15000000, salaryMax: 25000000, salaryCurrency: 'VND' }));
    expect(r.text).toContain('VNĐ');
    expect(r.text).toContain('15,000,000');
  });

  // Blind-hunter finding: VietnamWorks normalizes "Lên tới 20tr" as salaryMin=0.
  it('treats salaryMin=0 as no lower bound and renders "Lên tới"', () => {
    const r = formatSalary(mkJob({ salaryMin: 0, salaryMax: 20000000, salaryCurrency: 'VND' }));
    expect(r.text).toBe('Lên tới 20,000,000 VNĐ');
    expect(r.text).not.toContain('0 -');
  });

  it('falls back to Thỏa thuận when no salary data at all', () => {
    expect(formatSalary(mkJob()).isNegotiable).toBe(true);
  });
});

describe('escapeCsv (executable)', () => {
  it('wraps plain values in quotes', () => {
    expect(escapeCsv('abc')).toBe('"abc"');
  });

  it('doubles internal quotes per RFC 4180', () => {
    expect(escapeCsv('a"b')).toBe('"a""b"');
  });

  it('emits empty quoted cell for null/undefined', () => {
    expect(escapeCsv(null)).toBe('""');
    expect(escapeCsv(undefined)).toBe('""');
  });

  // Blind-hunter finding: CSV formula injection.
  it('neutralises leading formula characters', () => {
    expect(escapeCsv('=1+1')).toBe('"\'=1+1"');
    expect(escapeCsv('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(escapeCsv('-2+3')).toBe('"\'-2+3"');
  });

  it('leaves non-leading = untouched', () => {
    expect(escapeCsv('a=b')).toBe('"a=b"');
  });
});

describe('generateJobsCsv (executable)', () => {
  it('starts with the UTF-8 BOM so Excel renders Vietnamese diacritics', () => {
    const csv = generateJobsCsv([mkJob()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('emits an 11-column header row', () => {
    const csv = generateJobsCsv([]);
    expect(csv).toBe('﻿ID,Tiêu đề (Job Title),Công ty (Company),Nền tảng (Platform),Mức lương (Salary),Địa điểm (Location),Kinh nghiệm (Experience),Kỹ năng (Skills),Hình thức (Employment Type),Ngày đăng (Published Date),Link ứng tuyển (Job URL)');
  });

  it('produces one data row per job', () => {
    const csv = generateJobsCsv([mkJob(), mkJob({ id: 'vietnamworks:job:2', platform: 'vietnamworks' })]);
    // BOM + header + 2 rows
    expect(csv.split('\r\n').length).toBe(3);
  });

  it('maps platform to its human label', () => {
    expect(generateJobsCsv([mkJob()])).toContain('"TopCV"');
    expect(generateJobsCsv([mkJob({ platform: 'vietnamworks' })])).toContain('"VietnamWorks"');
    expect(generateJobsCsv([mkJob({ platform: 'linkedin' })])).toContain('"LinkedIn"');
  });

  it('joins skills with a semicolon separator', () => {
    expect(generateJobsCsv([mkJob()])).toContain('"TypeScript; Docker"');
  });

  it('falls back to Toàn thời gian when employmentType is missing', () => {
    expect(generateJobsCsv([mkJob({ employmentType: undefined })])).toContain('"Toàn thời gian"');
  });
});

// --- Executable tests cho nav resolution (apps/web/lib/nav-resolve.ts) -------
// Verification-gap: nav.ts chứa React icons nên không import được trong node
// env; logic resolve đã tách ra module thuần để test hành vi thật.
import { findGroupForPath, findItemForPath, normalizePath } from '../../apps/web/lib/nav-resolve.ts';

// Mirror cấu trúc group thật trong nav.ts (chỉ phần id/label/href cần cho logic).
const GROUPS = [
  {
    id: 'platform-suites', label: 'Platform Suites', items: [
      { label: 'Dexscreener', href: '/dexscreener' },
      { label: 'YouTube', href: '/youtube' },
      { label: 'Fediverse', href: '/fediverse' },
      { label: 'Enterprise VN', href: '/enterprise-vn' },
      { label: 'Jobs VN', href: '/jobs-vn' },
    ],
  },
  { id: 'automation', label: 'Automation', items: [{ label: 'Workflows', href: '/workflows' }] },
];

describe('normalizePath (executable)', () => {
  it('strips a single trailing slash', () => {
    expect(normalizePath('/jobs-vn/')).toBe('/jobs-vn');
  });

  it('strips multiple trailing slashes', () => {
    expect(normalizePath('/jobs-vn///')).toBe('/jobs-vn');
  });

  it('leaves an already-clean path untouched', () => {
    expect(normalizePath('/jobs-vn')).toBe('/jobs-vn');
  });
});

describe('findGroupForPath (executable)', () => {
  it('resolves /jobs-vn to the Platform Suites group', () => {
    expect(findGroupForPath(GROUPS, '/jobs-vn')?.id).toBe('platform-suites');
  });

  it('resolves every sibling suite route to Platform Suites', () => {
    for (const href of ['/dexscreener', '/youtube', '/fediverse', '/enterprise-vn']) {
      expect(findGroupForPath(GROUPS, href)?.id).toBe('platform-suites');
    }
  });

  it('is trailing-slash tolerant', () => {
    expect(findGroupForPath(GROUPS, '/jobs-vn/')?.id).toBe('platform-suites');
  });

  it('returns the first group for the root path', () => {
    expect(findGroupForPath(GROUPS, '/')?.id).toBe('platform-suites');
  });

  it('returns undefined for an unknown path', () => {
    expect(findGroupForPath(GROUPS, '/khong-ton-tai')).toBeUndefined();
  });
});

describe('findItemForPath (executable)', () => {
  it('returns the Jobs VN item for /jobs-vn', () => {
    expect(findItemForPath(GROUPS, '/jobs-vn')?.label).toBe('Jobs VN');
  });

  it('returns the Enterprise VN item for /enterprise-vn', () => {
    expect(findItemForPath(GROUPS, '/enterprise-vn')?.label).toBe('Enterprise VN');
  });

  it('is trailing-slash tolerant', () => {
    expect(findItemForPath(GROUPS, '/jobs-vn/')?.label).toBe('Jobs VN');
  });

  it('searches across groups', () => {
    expect(findItemForPath(GROUPS, '/workflows')?.label).toBe('Workflows');
  });

  it('returns undefined for an unknown path', () => {
    expect(findItemForPath(GROUPS, '/khong-ton-tai')).toBeUndefined();
  });
});

// Consistency check: nav.ts must actually declare the 5 routes the spec requires.
describe('nav.ts declares the Platform Suites routes (parse-level)', () => {
  const block = navSrc.slice(
    navSrc.indexOf("id: 'platform-suites'"),
    navSrc.indexOf("id: 'platform-suites'") + 900,
  );

  it('declares all five suite hrefs inside the group block', () => {
    for (const href of ['/dexscreener', '/youtube', '/fediverse', '/enterprise-vn', '/jobs-vn']) {
      expect(block).toContain(`href: '${href}'`);
    }
  });

  it('assigns the platform-suites id and Platform Suites label', () => {
    expect(navSrc).toContain("id: 'platform-suites'");
    expect(navSrc).toContain("label: 'Platform Suites'");
  });
});
