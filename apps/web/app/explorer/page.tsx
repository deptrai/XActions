'use client';

import React, { useEffect, useState } from 'react';
import {
  Database,
  Search,
  Download,
  Filter,
  Briefcase,
  Home,
  Building2,
  Share2,
  ExternalLink,
  Table,
  Check,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import type { ApiResult } from '@medirus/api-client';
import { api } from '@/lib/api';
import { isAsyncAccepted, pollOperation } from '@/lib/scrape-poll';
import type { AsyncAccepted } from '@/lib/scrape-poll';

type Category = 'jobs' | 'real_estate' | 'enterprises' | 'social';

interface ExplorerItem {
  id: string;
  title: string;
  source: string;
  field1: string; // Salary / Price / TaxCode / Engagement
  field2: string; // Company / Area / Address / Platform
  date: string;
  url: string;
}

interface PlatformEnvelope<T> {
  ok: boolean;
  platform?: string;
  action?: string;
  result?: T;
  error?: string;
  code?: string;
}

async function scrape<T = unknown>(
  platform: 'topcv' | 'vietnamworks' | 'linkedin',
  action: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ApiResult<T>> {
  const res = await api<PlatformEnvelope<T> & AsyncAccepted>(
    'POST',
    `/api/platform/${platform}/scrape`,
    { body: { action, ...args }, signal }
  );
  if (res.ok && res.data && typeof res.data === 'object') {
    if (isAsyncAccepted(res.data)) {
      return pollOperation<T>(res.data.statusUrl as string, signal, res.data.retry_after_ms);
    }
    const env = res.data as PlatformEnvelope<T>;
    if ('result' in env) {
      return { ok: true as const, status: res.status, data: env.result as T };
    }
  }
  return res as unknown as ApiResult<T>;
}

function mapPostToExplorerItem(post: any, platformName: string): ExplorerItem {
  const meta = (post?.metadata && typeof post.metadata === 'object' ? post.metadata : {}) as Record<string, unknown>;
  const title = String(meta.title || post.title || post.content?.split('\n')[0] || 'Vị trí tuyển dụng').trim();

  // Field 1: Salary
  let salary = 'Thỏa thuận';
  if (meta.isNegotiable) {
    salary = 'Thỏa thuận';
  } else if (typeof meta.rawSalary === 'string' && meta.rawSalary.trim()) {
    salary = meta.rawSalary.trim();
  } else if (meta.salaryMin != null && meta.salaryMax != null) {
    const curr = meta.salaryCurrency === 'USD' ? '$' : '';
    const suffix = meta.salaryCurrency === 'VND' ? ' VNĐ' : '';
    salary = `${curr}${Number(meta.salaryMin).toLocaleString()} - ${curr}${Number(meta.salaryMax).toLocaleString()}${suffix}`;
  } else if (meta.salaryMin != null) {
    salary = `Từ ${Number(meta.salaryMin).toLocaleString()}`;
  }

  // Field 2: Company & Location
  const company = String(meta.companyName || post.authorName || 'Doanh nghiệp').trim();
  const location = String(meta.location || '').trim();
  const field2 = location ? `${company} • ${location}` : company;

  // Date
  let date = new Date().toISOString().slice(0, 10);
  if (post.publishedAt) {
    try {
      date = new Date(post.publishedAt).toISOString().slice(0, 10);
    } catch {}
  } else if (meta.postedAt) {
    date = String(meta.postedAt).slice(0, 10);
  }

  const url = String(meta.postUrl || post.postUrl || '#');
  const id = String(post.id || meta.jobId || `${platformName.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`);

  return {
    id,
    title,
    source: platformName,
    field1: salary,
    field2,
    date,
    url,
  };
}

const CATEGORY_DATA: Record<Category, { label: string; icon: any; col1: string; col2: string; items: ExplorerItem[] }> = {
  jobs: {
    label: 'Jobs & Hiring',
    icon: Briefcase,
    col1: 'Salary / Package',
    col2: 'Company & Location',
    items: [],
  },
  real_estate: {
    label: 'Real Estate',
    icon: Home,
    col1: 'Price / Rate',
    col2: 'Area & Location',
    items: [
      {
        id: 'r1',
        title: 'Căn hộ Masteri Centre Point 2PN view hồ bơi',
        source: 'Chợ Tốt',
        field1: '3.6 Tỷ VNĐ',
        field2: '72 m² • TP. Thủ Đức, HCMC',
        date: '2026-09-23',
        url: 'https://nha.chotot.com/masteri-centre-point',
      },
      {
        id: 'r2',
        title: 'Nhà phố thương mại Shophouse Vinhomes Smart City',
        source: 'Chợ Tốt',
        field1: '12.5 Tỷ VNĐ',
        field2: '120 m² • Nam Từ Liêm, Hà Nội',
        date: '2026-09-22',
        url: 'https://nha.chotot.com/vinhomes-smart-city',
      },
      {
        id: 'r3',
        title: 'Đất nền ven biển Mỹ Khê mặt tiền 8m',
        source: 'Batdongsan.com.vn',
        field1: '8.2 Tỷ VNĐ',
        field2: '100 m² • Sơn Trà, Đà Nẵng',
        date: '2026-09-20',
        url: 'https://batdongsan.com.vn/dat-nen-my-khe',
      },
    ],
  },
  enterprises: {
    label: 'Company Registry',
    icon: Building2,
    col1: 'Tax Code / Status',
    col2: 'Industry / Representative',
    items: [
      {
        id: 'e1',
        title: 'CÔNG TY CỔ PHẦN CÔNG NGHỆ TRÍ TUỆ NHÂN TẠO MEDIRUS',
        source: 'MaSoThue',
        field1: 'MST: 0317894562 • Active',
        field2: 'Software & Data Mining • Nguyễn Văn A',
        date: '2026-08-15',
        url: 'https://masothue.com/0317894562',
      },
      {
        id: 'e2',
        title: 'CÔNG TY TNHH GIẢI PHÁP ĐÁM MÂY CLOUDVIET',
        source: 'MaSoThue',
        field1: 'MST: 0108923411 • Active',
        field2: 'Cloud Services & DevOps • Trần Thị B',
        date: '2026-07-10',
        url: 'https://masothue.com/0108923411',
      },
    ],
  },
  social: {
    label: 'Social Intelligence',
    icon: Share2,
    col1: 'Engagement Metrics',
    col2: 'Platform & Author',
    items: [
      {
        id: 's1',
        title: 'Framework phân tích dữ liệu đa nền tảng không cần token API đắt đỏ',
        source: 'X (Twitter)',
        field1: '1.2K Likes • 450 Retweets',
        field2: 'X • @nichxbt',
        date: '2026-09-24',
        url: 'https://x.com/nichxbt/status/123456789',
      },
      {
        id: 's2',
        title: 'Why decentralized crawlers are replacing centralized proxies in 2026',
        source: 'Reddit',
        field1: '890 Upvotes • 120 Comments',
        field2: 'r/webscraping • u/dev_pilot',
        date: '2026-09-23',
        url: 'https://reddit.com/r/webscraping/comments/abc',
      },
    ],
  },
};

export default function UniversalExplorerPage() {
  const [activeCategory, setActiveCategory] = useState<Category>('jobs');
  const [search, setSearch] = useState('');
  const [exported, setExported] = useState(false);
  const [liveJobs, setLiveJobs] = useState<ExplorerItem[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobsRefreshKey, setJobsRefreshKey] = useState(0);
  // Debounce từ khóa: mỗi phím gõ nếu gọi thẳng sẽ bắn 3 request song song
  // (topcv/vietnamworks/linkedin) và nhanh chóng chạm rate limit upstream.
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (activeCategory !== 'jobs') return;

    const controller = new AbortController();
    let mounted = true;

    async function fetchLiveJobs() {
      setJobsLoading(true);
      setJobsError(null);

      try {
        const [topcvRes, vnwRes, linkedinRes] = await Promise.allSettled([
          scrape<any>('topcv', 'search_jobs', { keyword: debouncedSearch || 'engineer', limit: 10 }, controller.signal),
          scrape<any>('vietnamworks', 'search_jobs', { keyword: debouncedSearch || 'engineer', limit: 10 }, controller.signal),
          scrape<any>('linkedin', 'search_jobs', { keyword: debouncedSearch || 'engineer', location: 'Vietnam', limit: 10 }, controller.signal),
        ]);

        if (!mounted) return;

        const collected: ExplorerItem[] = [];
        if (topcvRes.status === 'fulfilled' && topcvRes.value.ok && topcvRes.value.data) {
          const list = topcvRes.value.data.jobs || topcvRes.value.data.posts || (Array.isArray(topcvRes.value.data) ? topcvRes.value.data : []);
          collected.push(...list.map((j: any) => mapPostToExplorerItem(j, 'TopCV')));
        }
        if (vnwRes.status === 'fulfilled' && vnwRes.value.ok && vnwRes.value.data) {
          const list = vnwRes.value.data.jobs || vnwRes.value.data.posts || (Array.isArray(vnwRes.value.data) ? vnwRes.value.data : []);
          collected.push(...list.map((j: any) => mapPostToExplorerItem(j, 'VietnamWorks')));
        }
        if (linkedinRes.status === 'fulfilled' && linkedinRes.value.ok && linkedinRes.value.data) {
          const list = linkedinRes.value.data.jobs || linkedinRes.value.data.posts || (Array.isArray(linkedinRes.value.data) ? linkedinRes.value.data : []);
          collected.push(...list.map((j: any) => mapPostToExplorerItem(j, 'LinkedIn')));
        }

        setLiveJobs(collected);
      } catch (err: any) {
        if (!mounted || err?.name === 'AbortError') return;
        setJobsError(err?.message || 'Không thể tải dữ liệu việc làm');
      } finally {
        if (mounted) setJobsLoading(false);
      }
    }

    fetchLiveJobs();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [activeCategory, debouncedSearch, jobsRefreshKey]);

  const currentConfig = CATEGORY_DATA[activeCategory];
  const sourceItems = activeCategory === 'jobs' ? liveJobs : currentConfig.items;
  const items = sourceItems.filter((item) =>
    item.title.toLowerCase().includes(search.toLowerCase()) ||
    item.field1.toLowerCase().includes(search.toLowerCase()) ||
    item.field2.toLowerCase().includes(search.toLowerCase()) ||
    item.source.toLowerCase().includes(search.toLowerCase())
  );

  const handleExportCSV = () => {
    const headers = ['ID', 'Title', 'Source', currentConfig.col1, currentConfig.col2, 'Date', 'URL'];
    const rows = items.map((i) => [
      `"${i.id}"`,
      `"${i.title.replace(/"/g, '""')}"`,
      `"${i.source}"`,
      `"${i.field1}"`,
      `"${i.field2.replace(/"/g, '""')}"`,
      `"${i.date}"`,
      `"${i.url}"`,
    ]);

    // Prepend UTF-8 BOM for clean Vietnamese character rendering in Excel
    const csvContent = '﻿' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `medirus-${activeCategory}-export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600">
              <Database className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Universal Data Explorer
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Query and export high-signal cross-industry intelligence from 25+ specialized scrapers.
          </p>
        </div>

        {/* Export Button */}
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors shadow-sm"
        >
          {exported ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
          <span>{exported ? 'Downloaded!' : 'Export CSV (UTF-8)'}</span>
        </button>
      </div>

      {/* Category Tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(Object.keys(CATEGORY_DATA) as Category[]).map((cat) => {
          const config = CATEGORY_DATA[cat];
          const Icon = config.icon;
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`p-4 rounded-xl border text-left transition-all flex items-center gap-3 ${
                isActive
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 shadow-sm'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div
                className={`p-2 rounded-lg shrink-0 ${
                  isActive ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs text-slate-400 block font-medium">Domain</span>
                <span className="text-sm font-bold text-slate-900 dark:text-white block">
                  {config.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Search Bar & Stats */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search in ${currentConfig.label.toLowerCase()}...`}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <span className="text-xs text-slate-500 font-medium">
          Showing {items.length} records • Real-time crawler feed
        </span>
      </div>

      {/* Data Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Title / Offering</th>
                <th className="py-3.5 px-4">Source</th>
                <th className="py-3.5 px-4">{currentConfig.col1}</th>
                <th className="py-3.5 px-4">{currentConfig.col2}</th>
                <th className="py-3.5 px-4">Date</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {jobsLoading && activeCategory === 'jobs' ? (
                Array.from({ length: 4 }).map((_, idx) => (
                  <tr key={`loading-${idx}`} className="animate-pulse">
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-3/4" /></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-16" /></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-24" /></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-32" /></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-20" /></td>
                    <td className="py-4 px-4 text-right"><div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-6 ml-auto" /></td>
                  </tr>
                ))
              ) : jobsError ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm">
                    <div className="inline-flex flex-col items-center gap-2">
                      <AlertTriangle className="w-6 h-6 text-amber-500" />
                      <span className="text-amber-700 dark:text-amber-400">{jobsError}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Nền tảng tuyển dụng có thể đang áp dụng xác thực chống bot. Vui lòng thử lại sau vài phút.
                      </span>
                      <button
                        type="button"
                        onClick={() => setJobsRefreshKey((k) => k + 1)}
                        className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Thử lại
                      </button>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    Không tìm thấy dữ liệu phù hợp với tìm kiếm.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 max-w-xs">
                      <span className="font-semibold text-slate-900 dark:text-white block line-clamp-1">
                        {item.title}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {item.source}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                      {item.field1}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400 text-xs max-w-xs truncate">
                      {item.field2}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 text-xs font-mono whitespace-nowrap">
                      {item.date}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-block"
                        title="View original listing"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
