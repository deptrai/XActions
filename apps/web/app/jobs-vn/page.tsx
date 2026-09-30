// by nichxbt
'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Briefcase, Search, MapPin, Building2, ExternalLink, RefreshCw,
  AlertTriangle, Download, Check, Filter, Banknote, Clock,
  Sparkles, X, ChevronDown, SlidersHorizontal, Layers, LayoutGrid, Columns3,
} from 'lucide-react';
import type { ApiResult } from '@xactions/api-client';
import { api } from '@/lib/api';
import { formatSalary, generateJobsCsv, escapeCsv } from '@/lib/jobs-format';
import type { NormalizedJob, PlatformName } from '@/lib/jobs-format';
import { isAsyncAccepted, pollOperation } from '@/lib/scrape-poll';
import type { AsyncAccepted } from '@/lib/scrape-poll';

// ---------------------------------------------------------------------------
// Types & Contracts matching Recruitment Scrapers (TopCV, VietnamWorks, LinkedIn)
// ---------------------------------------------------------------------------


export interface PlatformEnvelope<T> {
  ok: boolean;
  platform?: string;
  action?: string;
  result?: T;
  error?: string;
  code?: string;
}

interface PlatformState {
  loading: boolean;
  jobs: NormalizedJob[];
  error?: string | null;
  errorCode?: string | null;
  isRateLimited?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function scrape<T = unknown>(
  platform: PlatformName,
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

function normalizeJobItem(raw: unknown, defaultPlatform: PlatformName): NormalizedJob {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const meta = (item.metadata && typeof item.metadata === 'object' ? item.metadata : {}) as Record<string, unknown>;

  const platform = ((item.platform as string) || defaultPlatform) as PlatformName;
  const title = String(meta.title || item.title || item.content?.toString().split('\n')[0] || 'Vị trí công nghệ').trim();
  const companyName = String(meta.companyName || item.authorName || 'Doanh nghiệp').trim();
  const companyLogo = (typeof meta.companyLogo === 'string' && meta.companyLogo)
    ? meta.companyLogo
    : (typeof item.authorAvatar === 'string' && item.authorAvatar ? item.authorAvatar : null);
  const location = String(meta.location || 'Việt Nam').trim();
  const rawSalary = typeof meta.rawSalary === 'string' ? meta.rawSalary : undefined;
  const salaryMin = typeof meta.salaryMin === 'number' ? meta.salaryMin : null;
  const salaryMax = typeof meta.salaryMax === 'number' ? meta.salaryMax : null;
  const salaryCurrency = typeof meta.salaryCurrency === 'string' ? meta.salaryCurrency : null;
  const isNegotiable = Boolean(meta.isNegotiable || /thỏa thuận|thương lượng|negotiable/i.test(rawSalary || ''));
  const experienceYears = meta.experienceYears != null ? String(meta.experienceYears) : undefined;

  let skills: string[] = [];
  if (Array.isArray(meta.skills)) {
    skills = meta.skills.map((s) => String(s)).filter(Boolean);
  } else if (typeof meta.skills === 'string') {
    skills = meta.skills.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const employmentType = typeof meta.employmentType === 'string' ? meta.employmentType : undefined;
  const postUrl = String(meta.postUrl || item.postUrl || '#');
  const publishedAtRaw = item.publishedAt ? new Date(item.publishedAt as string) : null;
  const publishedAt = publishedAtRaw && !Number.isNaN(publishedAtRaw.getTime())
    ? publishedAtRaw.toISOString().slice(0, 10)
    : undefined;
  const id = String(item.id || meta.jobId || `${platform}-${Math.random().toString(36).slice(2, 9)}`);

  return {
    id,
    platform,
    title,
    companyName,
    companyLogo,
    location,
    rawSalary,
    salaryMin,
    salaryMax,
    salaryCurrency,
    isNegotiable,
    experienceYears,
    skills,
    employmentType,
    postUrl,
    publishedAt,
  };
}

// ---------------------------------------------------------------------------
// Components: CompanyAvatar, JobCard, JobSkeletonCard
// ---------------------------------------------------------------------------

function CompanyAvatar({ name, logo }: { name: string; logo?: string | null }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || 'C')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || 'C';

  if (!logo || failed) {
    return (
      <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 font-bold text-sm select-none shrink-0 shadow-sm">
        {initials}
      </div>
    );
  }

  return (
    <div className="w-12 h-12 rounded-xl overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0 p-1 flex items-center justify-center shadow-sm">
      <img
        src={logo}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-contain"
      />
    </div>
  );
}

function JobCard({ job }: { job: NormalizedJob }) {
  const salary = formatSalary(job);
  const platformLabel = job.platform === 'topcv' ? 'TopCV' : job.platform === 'vietnamworks' ? 'VietnamWorks' : 'LinkedIn';
  const platformBadgeClass =
    job.platform === 'topcv'
      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
      : job.platform === 'vietnamworks'
      ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
      : 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';

  return (
    <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4">
      <div className="space-y-3">
        {/* Top: Company Logo + Badges */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <CompanyAvatar name={job.companyName} logo={job.companyLogo} />
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white line-clamp-2 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                {job.title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium line-clamp-1 mt-0.5">
                {job.companyName}
              </p>
            </div>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${platformBadgeClass}`}>
            {platformLabel}
          </span>
        </div>

        {/* Pills: Salary + Location */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* Salary Pill (Emerald badge) */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <Banknote className="w-3.5 h-3.5" />
            <span>{salary.text}</span>
          </div>

          {/* Location Pill */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <MapPin className="w-3.5 h-3.5 text-slate-400" />
            <span className="truncate max-w-[150px]">{job.location}</span>
          </div>

          {job.experienceYears && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>{job.experienceYears} năm</span>
            </div>
          )}

          {job.employmentType && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <Briefcase className="w-3 h-3 text-slate-400" />
              <span>{job.employmentType}</span>
            </div>
          )}
        </div>

        {/* Tech Stack Tags */}
        {job.skills && job.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {job.skills.slice(0, 5).map((skill, sIdx) => (
              <span
                key={sIdx}
                className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60"
              >
                {skill}
              </span>
            ))}
            {job.skills.length > 5 && (
              <span className="px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500">
                +{job.skills.length - 5}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom: Date & Apply Button */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
        <span className="text-slate-400 font-mono">
          {job.publishedAt || 'Vừa cập nhật'}
        </span>
        <a
          href={job.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors shadow-sm"
        >
          <span>Ứng tuyển</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

function JobSkeletonCard() {
  return (
    <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm animate-pulse space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-slate-200 dark:bg-slate-800" />
          <div className="space-y-2">
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-40" />
            <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-24" />
          </div>
        </div>
        <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded-full w-16" />
      </div>
      <div className="flex gap-2">
        <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-full w-24" />
        <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-full w-28" />
      </div>
      <div className="flex gap-1.5">
        <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded w-16" />
        <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded w-20" />
        <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded w-14" />
      </div>
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-20" />
        <div className="h-7 bg-slate-200 dark:bg-slate-800 rounded-lg w-24" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Inner Component
// ---------------------------------------------------------------------------

function JobsVnInner() {
  const searchParams = useSearchParams();
  const [keyword, setKeyword] = useState<string>(searchParams.get('q') || searchParams.get('keyword') || 'React');
  const [selectedLocation, setSelectedLocation] = useState<string>('All');
  const [selectedPlatform, setSelectedPlatform] = useState<'All' | PlatformName>('All');
  const [selectedExp, setSelectedExp] = useState<string>('All');
  const [selectedWorkMode, setSelectedWorkMode] = useState<string>('All');
  const [selectedSalaryPreset, setSelectedSalaryPreset] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'grid' | 'columns'>('grid');
  const [exported, setExported] = useState(false);

  const [platformState, setPlatformState] = useState<Record<PlatformName, PlatformState>>({
    topcv: { loading: false, jobs: [] },
    vietnamworks: { loading: false, jobs: [] },
    linkedin: { loading: false, jobs: [] },
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchPlatform = useCallback(
    async (platform: PlatformName, searchKw: string, loc: string, signal?: AbortSignal) => {
      setPlatformState((prev) => ({
        ...prev,
        [platform]: { ...prev[platform], loading: true, error: null, errorCode: null, isRateLimited: false },
      }));

      try {
        const city = loc === 'All' ? undefined : loc;
        const linkedinLoc = loc === 'All' ? 'Vietnam' : `${loc}, Vietnam`;
        const args: Record<string, unknown> = {
          keyword: searchKw || 'developer',
          limit: 25,
        };
        if (platform === 'linkedin') {
          args.location = linkedinLoc;
        } else if (city) {
          args.city = city;
        }

        const res = await scrape<any>(platform, 'search_jobs', args, signal);
        if (res.ok && res.data) {
          const rawJobs = res.data.jobs || res.data.posts || (Array.isArray(res.data) ? res.data : []);
          const normalized = rawJobs.map((item: any) => normalizeJobItem(item, platform));
          setPlatformState((prev) => ({
            ...prev,
            [platform]: { loading: false, jobs: normalized, error: null, errorCode: null, isRateLimited: false },
          }));
        } else {
          // api() trả error dạng object { code?, message? } — không dùng String(res.error)
          // vì sẽ ra "[object Object]" và làm hỏng cả detection rate-limit lẫn thông báo.
          const errPayload = res.ok ? undefined : (res.error as { code?: string; message?: string } | undefined);
          const errCode = errPayload?.code;
          const errMsg = errPayload?.message ?? 'Không có dữ liệu trả về';
          const isRateLimited =
            errCode === 'XACT_4030' || errMsg.includes('XACT_4030') || errMsg.toLowerCase().includes('rate');
          setPlatformState((prev) => ({
            ...prev,
            [platform]: {
              loading: false,
              jobs: [],
              error: isRateLimited ? 'Temporarily rate-limited' : (errMsg || 'Lỗi khi tải dữ liệu'),
              errorCode: isRateLimited ? 'XACT_4030' : (errCode || 'ERROR'),
              isRateLimited: Boolean(isRateLimited),
            },
          }));
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        const errStr = String(err?.message || err);
        const isRateLimited = errStr.includes('XACT_4030') || errStr.toLowerCase().includes('rate');
        setPlatformState((prev) => ({
          ...prev,
          [platform]: {
            loading: false,
            jobs: [],
            error: isRateLimited ? 'Temporarily rate-limited' : (err?.message || 'Lỗi kết nối'),
            errorCode: isRateLimited ? 'XACT_4030' : 'ERROR',
            isRateLimited: Boolean(isRateLimited),
          },
        }));
      }
    },
    []
  );

  const fetchAllPlatforms = useCallback(
    (searchKw: string, loc: string) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Dispatch 3 platform search_jobs in parallel
      fetchPlatform('topcv', searchKw, loc, controller.signal);
      fetchPlatform('vietnamworks', searchKw, loc, controller.signal);
      fetchPlatform('linkedin', searchKw, loc, controller.signal);
    },
    [fetchPlatform]
  );

  // Initial load
  useEffect(() => {
    fetchAllPlatforms(keyword, selectedLocation);
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAllPlatforms(keyword, selectedLocation);
  };

  // Combine jobs from all platforms and apply client-side filters
  const allJobs = useMemo(() => {
    const list: NormalizedJob[] = [];
    if (selectedPlatform === 'All' || selectedPlatform === 'topcv') {
      list.push(...platformState.topcv.jobs);
    }
    if (selectedPlatform === 'All' || selectedPlatform === 'vietnamworks') {
      list.push(...platformState.vietnamworks.jobs);
    }
    if (selectedPlatform === 'All' || selectedPlatform === 'linkedin') {
      list.push(...platformState.linkedin.jobs);
    }
    return list;
  }, [platformState, selectedPlatform]);

  const filteredJobs = useMemo(() => {
    return allJobs.filter((job) => {
      // Location filter (if not 'All')
      if (selectedLocation !== 'All') {
        const locLower = (job.location ?? '').toLowerCase();
        // Alias: nguồn việc làm ghi "Hồ Chí Minh"/"TP. HCM" chứ không ghi "HCMC".
        const LOCATION_ALIASES: Record<string, string[]> = {
          hcmc: ['hồ chí minh', 'tp. hcm', 'tp hcm', 'hcm', 'hcmc'],
          'hà nội': ['hà nội', 'ha noi', 'hanoi'],
          'đà nẵng': ['đà nẵng', 'da nang', 'danang'],
          remote: ['remote', 'từ xa', 'tu xa', 'online', 'work from home', 'wfh'],
        };
        const selLower = selectedLocation.toLowerCase();
        const needles = LOCATION_ALIASES[selLower] ?? [selLower];
        if (!needles.some((n) => locLower.includes(n))) return false;
      }

      // Experience filter
      if (selectedExp !== 'All') {
        const expStr = String(job.experienceYears || '').toLowerCase();
        const titleLower = job.title.toLowerCase();
        if (selectedExp === 'intern') {
          if (!expStr.includes('0') && !titleLower.includes('intern') && !titleLower.includes('fresher')) return false;
        } else if (selectedExp === 'junior') {
          if (!expStr.includes('1') && !expStr.includes('2') && !titleLower.includes('junior')) return false;
        } else if (selectedExp === 'mid') {
          if (!expStr.includes('3') && !expStr.includes('4') && !titleLower.includes('middle') && !titleLower.includes('mid')) return false;
        } else if (selectedExp === 'senior') {
          if (!titleLower.includes('senior') && !titleLower.includes('lead') && !expStr.includes('5')) return false;
        }
      }

      // Work Mode filter
      if (selectedWorkMode !== 'All') {
        const textToSearch = `${job.title} ${job.location} ${job.employmentType || ''}`.toLowerCase();
        if (!textToSearch.includes(selectedWorkMode.toLowerCase())) return false;
      }

      // Salary Preset filter
      if (selectedSalaryPreset !== 'All') {
        if (selectedSalaryPreset === 'negotiable') {
          if (!job.isNegotiable) return false;
        } else if (selectedSalaryPreset === 'under-15m') {
          if (job.isNegotiable) return false;
          if (job.salaryMax && job.salaryMax > 15_000_000) return false;
        } else if (selectedSalaryPreset === '15m-30m') {
          if (job.isNegotiable) return false;
          if (job.salaryMin && job.salaryMin > 30_000_000) return false;
          if (job.salaryMax && job.salaryMax < 15_000_000) return false;
        } else if (selectedSalaryPreset === 'above-50m') {
          if (job.isNegotiable) return false;
          if (job.salaryMax && job.salaryMax < 50_000_000 && (job.salaryCurrency !== 'USD' || (job.salaryMax < 2000))) return false;
        }
      }

      return true;
    });
  }, [allJobs, selectedLocation, selectedExp, selectedWorkMode, selectedSalaryPreset]);

  const isAnyLoading = platformState.topcv.loading || platformState.vietnamworks.loading || platformState.linkedin.loading;

  const handleExportCsv = () => {
    const csvContent = generateJobsCsv(filteredJobs);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `xactions-jobs-vn-export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoke trễ: một số trình duyệt xử lý download bất đồng bộ, revoke ngay lập tức
    // sau click() có thể hủy blob trước khi file được ghi ra đĩa.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <Briefcase className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Cổng việc làm Công nghệ &amp; IT Việt Nam
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Tổng hợp tin tuyển dụng thời gian thực từ TopCV, VietnamWorks và LinkedIn qua async lane crawler.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fetchAllPlatforms(keyword, selectedLocation)}
            disabled={isAnyLoading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isAnyLoading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredJobs.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors shadow-sm disabled:opacity-50"
          >
            {exported ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
            <span>{exported ? 'Đã tải!' : 'Export Job Leads (CSV)'}</span>
          </button>
        </div>
      </div>

      {/* Sticky Filter Bar */}
      <div className="sticky top-2 z-20 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-md space-y-3">
        {/* Search input + Quick submit */}
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Nhập từ khóa công nghệ (vd: React, Golang, Node, AI Engineer, DevOps)..."
              className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={isAnyLoading}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors shadow-sm shrink-0 flex items-center justify-center gap-2"
          >
            <Search className="w-4 h-4" />
            <span>Tìm việc làm</span>
          </button>
        </form>

        {/* Filter Dropdowns / Selectors */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
          {/* Location */}
          <div>
            <label className="text-[11px] font-medium text-slate-400 block mb-1">Địa điểm</label>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="w-full py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
            >
              <option value="All">Tất cả địa điểm</option>
              <option value="Hà Nội">Hà Nội</option>
              <option value="HCMC">TP. Hồ Chí Minh</option>
              <option value="Đà Nẵng">Đà Nẵng</option>
              <option value="Remote">Từ xa (Remote)</option>
            </select>
          </div>

          {/* Source / Platform */}
          <div>
            <label className="text-[11px] font-medium text-slate-400 block mb-1">Nguồn tuyển dụng</label>
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value as any)}
              className="w-full py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
            >
              <option value="All">Tất cả nguồn (All)</option>
              <option value="topcv">TopCV</option>
              <option value="vietnamworks">VietnamWorks</option>
              <option value="linkedin">LinkedIn</option>
            </select>
          </div>

          {/* Experience Level */}
          <div>
            <label className="text-[11px] font-medium text-slate-400 block mb-1">Kinh nghiệm</label>
            <select
              value={selectedExp}
              onChange={(e) => setSelectedExp(e.target.value)}
              className="w-full py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
            >
              <option value="All">Tất cả kinh nghiệm</option>
              <option value="intern">Intern / Fresher</option>
              <option value="junior">Junior (1-2 năm)</option>
              <option value="mid">Mid-level (3-4 năm)</option>
              <option value="senior">Senior (5+ năm)</option>
            </select>
          </div>

          {/* Work Mode */}
          <div>
            <label className="text-[11px] font-medium text-slate-400 block mb-1">Hình thức</label>
            <select
              value={selectedWorkMode}
              onChange={(e) => setSelectedWorkMode(e.target.value)}
              className="w-full py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
            >
              <option value="All">Tất cả hình thức</option>
              <option value="Full-time">Toàn thời gian</option>
              <option value="Part-time">Bán thời gian</option>
              <option value="Remote">Làm từ xa (Remote)</option>
              <option value="Hybrid">Hybrid</option>
            </select>
          </div>

          {/* Salary Preset */}
          <div>
            <label className="text-[11px] font-medium text-slate-400 block mb-1">Mức lương</label>
            <select
              value={selectedSalaryPreset}
              onChange={(e) => setSelectedSalaryPreset(e.target.value)}
              className="w-full py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"
            >
              <option value="All">Tất cả mức lương</option>
              <option value="under-15m">Dưới 15 Triệu</option>
              <option value="15m-30m">15 - 30 Triệu</option>
              <option value="above-50m">Trên 50 Triệu</option>
              <option value="negotiable">Thỏa thuận</option>
            </select>
          </div>

          {/* View Mode */}
          <div>
            <label className="text-[11px] font-medium text-slate-400 block mb-1">Giao diện xem</label>
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-50 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`flex-1 py-1 rounded text-center font-medium transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                Hợp nhất
              </button>
              <button
                type="button"
                onClick={() => setViewMode('columns')}
                className={`flex-1 py-1 rounded text-center font-medium transition-colors ${
                  viewMode === 'columns'
                    ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-500'
                }`}
              >
                Cột nguồn
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Partial Degradation Banners (XACT_4030 or rate-limited per-platform) */}
      <div className="space-y-2">
        {(['topcv', 'vietnamworks', 'linkedin'] as PlatformName[]).map((pName) => {
          const st = platformState[pName];
          if (!st.isRateLimited && !st.error) return null;
          const label = pName === 'topcv' ? 'TopCV' : pName === 'vietnamworks' ? 'VietnamWorks' : 'LinkedIn';
          return (
            <div
              key={pName}
              className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300 shadow-xs"
            >
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong>{label}:</strong>{' '}
                  {st.isRateLimited
                    ? 'Temporarily rate-limited (XACT_4030) — Nền tảng đang áp dụng bảo vệ chống bot hoặc giới hạn tần suất'
                    : st.error}
                </span>
              </div>
              <button
                type="button"
                onClick={() => fetchPlatform(pName, keyword, selectedLocation)}
                className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold transition-colors flex items-center gap-1 shrink-0 ml-2"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Content Rendering based on ViewMode */}
      {viewMode === 'grid' ? (
        <div>
          {/* Results Summary */}
          <div className="flex items-center justify-between pb-2 text-xs text-slate-500">
            <span>
              Tìm thấy <strong className="text-slate-900 dark:text-white">{filteredJobs.length}</strong> việc làm
              {isAnyLoading && ' (Đang cập nhật thêm từ các nguồn...)'}
            </span>
          </div>

          {/* Cards Grid */}
          {isAnyLoading && filteredJobs.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, idx) => (
                <JobSkeletonCard key={idx} />
              ))}
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 space-y-3">
              <Briefcase className="w-8 h-8 text-slate-400 mx-auto" />
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Không tìm thấy việc làm phù hợp
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Hãy thử thay đổi từ khóa, mở rộng khu vực địa lý hoặc chọn mức lương khác để xem thêm cơ hội việc làm.
              </p>
              <button
                type="button"
                onClick={() => {
                  setKeyword('React');
                  setSelectedLocation('All');
                  setSelectedExp('All');
                  setSelectedWorkMode('All');
                  setSelectedSalaryPreset('All');
                  fetchAllPlatforms('React', 'All');
                }}
                className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold underline"
              >
                Đặt lại bộ lọc tìm kiếm
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Column View per Platform */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {(['topcv', 'vietnamworks', 'linkedin'] as PlatformName[]).map((pName) => {
            const st = platformState[pName];
            const pJobs = st.jobs;
            const pLabel = pName === 'topcv' ? 'TopCV' : pName === 'vietnamworks' ? 'VietnamWorks' : 'LinkedIn';

            return (
              <div key={pName} className="space-y-4 flex flex-col">
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-white">{pLabel}</span>
                    <span className="px-2 py-0.2 rounded-full text-[11px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                      {pJobs.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchPlatform(pName, keyword, selectedLocation)}
                    disabled={st.loading}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    title="Làm mới nguồn này"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${st.loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {st.loading && pJobs.length === 0 ? (
                  <div className="space-y-3">
                    <JobSkeletonCard />
                    <JobSkeletonCard />
                  </div>
                ) : st.isRateLimited || st.error ? (
                  <div className="p-6 rounded-2xl border border-dashed border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 text-center space-y-3">
                    <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto" />
                    <div>
                      <h4 className="font-semibold text-xs text-amber-800 dark:text-amber-300">
                        {st.isRateLimited ? 'Temporarily rate-limited' : 'Lỗi kết nối'}
                      </h4>
                      <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-1">
                        {st.error}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => fetchPlatform(pName, keyword, selectedLocation)}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  </div>
                ) : pJobs.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-xs">
                    Chưa có tin việc làm từ {pLabel}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pJobs.map((job) => (
                      <JobCard key={job.id} job={job} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function JobsVnPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Đang tải Cổng việc làm IT Việt Nam...</div>}>
      <JobsVnInner />
    </Suspense>
  );
}
