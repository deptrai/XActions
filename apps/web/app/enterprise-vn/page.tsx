// by nichxbt
'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Building2, Search, Copy, Check, RefreshCw, AlertTriangle,
  FileSpreadsheet, FileCode, ExternalLink, ShieldCheck,
  Calendar, MapPin, User, Briefcase, Phone, ArrowRight,
  Sparkles, X, Award, Info,
} from 'lucide-react';
import type { ApiResult } from '@medirus/api-client';
import { api } from '@/lib/api';
import { isAsyncAccepted, pollOperation } from '@/lib/scrape-poll';
import type { AsyncAccepted } from '@/lib/scrape-poll';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlatformEnvelope<T> {
  ok: boolean;
  platform?: string;
  action?: string;
  result?: T;
  error?: string;
  code?: string;
}

export interface EnterpriseDossier {
  companyName: string;
  internationalName?: string;
  shortName?: string;
  taxCode: string;
  status: string;
  representativeName?: string;
  address?: string;
  businessLines?: string;
  establishedDate?: string;
  phone?: string;
  charterCapital?: string;
  legalForm?: string;
  province?: string;
  detailUrl?: string;
}

export interface TrademarkItem {
  applicationNumber: string;
  applicationDate?: string | null;
  publicationDate?: string | null;
  rawApplicationDate?: string;
  rawPublicationDate?: string;
  gazettePeriod?: string;
  status?: string;
  classes?: string[];
  postUrl?: string;
}

export type InputDetectionType = 'tax_code_10' | 'tax_code_13' | 'company_name';

// Quick search suggestions for popular enterprises in Vietnam
const QUICK_SUGGESTIONS = [
  { label: 'VNPT', taxCode: '0013180180' },
  { label: 'Viettel', taxCode: '0100109106' },
  { label: 'VNG Corp', taxCode: '0303493756' },
  { label: 'FPT', taxCode: '0101248141' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function scrape<T = unknown>(
  platform: 'masothue' | 'b2b_registry_extended' | 'ipvietnam',
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

function detectInputType(query: string): InputDetectionType {
  const clean = query.trim().replace(/[-\s]/g, '');
  if (/^\d{10}$/.test(clean)) {
    return 'tax_code_10';
  }
  if (/^\d{13}$/.test(clean)) {
    return 'tax_code_13';
  }
  return 'company_name';
}

function getStatusBadgeConfig(statusRaw?: string): {
  variant: 'emerald' | 'rose' | 'amber' | 'slate';
  badgeClass: string;
  dotClass: string;
  label: string;
} {
  const status = (statusRaw || '').trim().toLowerCase();
  if (
    status.includes('đang hoạt động') ||
    status.includes('active') ||
    status.includes('đã được cấp gcn đkt')
  ) {
    return {
      variant: 'emerald',
      badgeClass: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60',
      dotClass: 'bg-emerald-500',
      label: statusRaw || 'Đang hoạt động',
    };
  }
  if (
    status.includes('ngừng hoạt động') ||
    status.includes('đóng mã số thuế') ||
    status.includes('đã giải thể') ||
    status.includes('stopped') ||
    status.includes('dissolved')
  ) {
    return {
      variant: 'rose',
      badgeClass: 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/60',
      dotClass: 'bg-rose-500',
      label: statusRaw || 'Ngừng hoạt động',
    };
  }
  if (
    status.includes('tạm ngừng') ||
    status.includes('tạm nghỉ') ||
    status.includes('paused') ||
    status.includes('suspended')
  ) {
    return {
      variant: 'amber',
      badgeClass: 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/60',
      dotClass: 'bg-amber-500',
      label: statusRaw || 'Tạm ngừng hoạt động',
    };
  }
  return {
    variant: 'slate',
    badgeClass: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    dotClass: 'bg-slate-400',
    label: statusRaw || 'Chưa xác định',
  };
}

function mapError(err: unknown): { kind: 'warn' | 'error'; code?: string; msg: string } {
  if (typeof err === 'string') {
    if (err.includes('404') || err.includes('Not Found')) {
      return { kind: 'warn', msg: 'Không tìm thấy thông tin doanh nghiệp.' };
    }
    return { kind: 'error', msg: err };
  }
  const e = err as { code?: string; message?: string; error?: string } | undefined;
  const code = e?.code || '';
  const msg = e?.message || e?.error || 'Yêu cầu tra cứu thất bại';
  if (code === 'XACT_4004' || code === 'XACT_4040' || msg.includes('404') || msg.includes('Not Found')) {
    return { kind: 'warn', code, msg: 'Không tìm thấy doanh nghiệp phù hợp với thông tin tra cứu.' };
  }
  if (code === 'XACT_4030' || msg.includes('403') || msg.includes('challenge')) {
    return {
      kind: 'warn',
      code: 'XACT_4030',
      msg: 'Nền tảng đang áp dụng xác thực chống bot. Vui lòng thử lại sau vài phút hoặc sử dụng proxy cao cấp.',
    };
  }
  if (code === 'XACT_4029' || code === 'XACT_429' || msg.includes('429')) {
    return {
      kind: 'warn',
      code,
      msg: 'Bị giới hạn tần suất yêu cầu (Rate limited). Vui lòng thử lại sau giây lát.',
    };
  }
  return { kind: 'error', code, msg };
}

function unwrapDossierItem(item: unknown): EnterpriseDossier | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const post = (obj.post && typeof obj.post === 'object' ? obj.post : obj) as Record<string, unknown>;
  const meta = (post.metadata && typeof post.metadata === 'object' ? post.metadata : {}) as Record<string, unknown>;

  const rawTax = String(meta.taxCode || post.externalId || post.authorId || '').replace(/^(?:masothue|hosocongty):/, '');
  const taxCode = rawTax.trim();
  const companyName = String(meta.companyName || post.title || post.authorName || '').trim();
  if (!companyName && !taxCode) return null;

  return {
    companyName: companyName || `Doanh nghiệp ${taxCode}`,
    internationalName: typeof meta.internationalName === 'string' ? meta.internationalName : undefined,
    shortName: typeof meta.shortName === 'string' ? meta.shortName : undefined,
    taxCode,
    status: String(meta.status || 'Đang hoạt động'),
    representativeName: typeof meta.representativeName === 'string' ? meta.representativeName : undefined,
    address: typeof meta.address === 'string' ? meta.address : undefined,
    businessLines: typeof meta.businessLines === 'string' ? meta.businessLines : undefined,
    establishedDate: typeof meta.establishedDate === 'string' ? meta.establishedDate : undefined,
    phone: typeof meta.phone === 'string' ? meta.phone : undefined,
    charterCapital: typeof meta.charterCapital === 'string' ? meta.charterCapital : undefined,
    legalForm: typeof meta.legalForm === 'string' ? meta.legalForm : undefined,
    province: typeof meta.province === 'string' ? meta.province : undefined,
    detailUrl: typeof meta.detailUrl === 'string' ? meta.detailUrl : undefined,
  };
}

function unwrapDossierList(resData: unknown): EnterpriseDossier[] {
  if (!resData || typeof resData !== 'object') return [];
  const obj = resData as Record<string, unknown>;
  const rawList = Array.isArray(obj)
    ? obj
    : Array.isArray(obj.posts)
    ? obj.posts
    : Array.isArray(obj.data)
    ? obj.data
    : obj.post
    ? [obj.post]
    : [];
  return rawList
    .map(unwrapDossierItem)
    .filter((d): d is EnterpriseDossier => d !== null && Boolean(d.taxCode || d.companyName));
}

function unwrapTrademarkList(resData: unknown): TrademarkItem[] {
  if (!resData || typeof resData !== 'object') return [];
  const obj = resData as Record<string, unknown>;
  const rawList = Array.isArray(obj)
    ? obj
    : Array.isArray(obj.posts)
    ? obj.posts
    : Array.isArray(obj.data)
    ? obj.data
    : [];

  const items: TrademarkItem[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const post = item as Record<string, unknown>;
    const meta = (post.metadata && typeof post.metadata === 'object' ? post.metadata : {}) as Record<string, unknown>;
    const applicationNumber = String(meta.applicationNumber || post.externalId || '').replace(/^ipvietnam:/, '');
    if (!applicationNumber) continue;

    items.push({
      applicationNumber,
      applicationDate: typeof meta.applicationDate === 'string' ? meta.applicationDate : null,
      publicationDate: typeof meta.publicationDate === 'string' ? meta.publicationDate : null,
      rawApplicationDate: typeof meta.rawApplicationDate === 'string' ? meta.rawApplicationDate : undefined,
      rawPublicationDate: typeof meta.rawPublicationDate === 'string' ? meta.rawPublicationDate : undefined,
      gazettePeriod: typeof meta.gazettePeriod === 'string' ? meta.gazettePeriod : undefined,
      status: typeof meta.status === 'string' ? meta.status : 'chuyển công bố (hợp lệ)',
      classes: Array.isArray(meta.classes) ? (meta.classes as string[]) : [],
      postUrl: typeof post.postUrl === 'string' ? post.postUrl : undefined,
    });
  }
  return items;
}

function escapeCsv(val: string | number | null | undefined): string {
  if (val == null) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

function generateCsv(dossier: EnterpriseDossier, trademarks: TrademarkItem[]): string {
  // UTF-8 Byte Order Mark for Microsoft Excel Vietnamese compatibility
  const BOM = '﻿';
  const lines: string[] = [];

  lines.push('HỒ SƠ DOANH NGHIỆP VIỆT NAM (ENTERPRISE DOSSIER)');
  lines.push(`Tên công ty,${escapeCsv(dossier.companyName)}`);
  lines.push(`Tên quốc tế / Viết tắt,${escapeCsv(dossier.internationalName || dossier.shortName || '')}`);
  lines.push(`Mã số thuế,${escapeCsv(dossier.taxCode)}`);
  lines.push(`Trạng thái,${escapeCsv(dossier.status)}`);
  lines.push(`Người đại diện pháp luật,${escapeCsv(dossier.representativeName || '')}`);
  lines.push(`Địa chỉ đăng ký,${escapeCsv(dossier.address || '')}`);
  lines.push(`Ngành nghề chính,${escapeCsv(dossier.businessLines || '')}`);
  lines.push(`Ngày thành lập,${escapeCsv(dossier.establishedDate || '')}`);
  lines.push(`Điện thoại,${escapeCsv(dossier.phone || '')}`);
  lines.push(`Loại hình pháp lý,${escapeCsv(dossier.legalForm || '')}`);
  lines.push(`Tỉnh / Thành phố,${escapeCsv(dossier.province || '')}`);
  lines.push('');
  lines.push('DANH MỤC NHÃN HIỆU & SỞ HỮU TRÍ TUỆ (IP VIETNAM)');
  lines.push('Số đơn,Nhóm ngành (Nice),Ngày nộp đơn,Ngày công bố,Trạng thái,Kỳ công báo');

  for (const tm of trademarks) {
    lines.push([
      escapeCsv(tm.applicationNumber),
      escapeCsv(tm.classes && tm.classes.length > 0 ? tm.classes.join('; ') : ''),
      escapeCsv(tm.rawApplicationDate || tm.applicationDate || ''),
      escapeCsv(tm.rawPublicationDate || tm.publicationDate || ''),
      escapeCsv(tm.status || ''),
      escapeCsv(tm.gazettePeriod || ''),
    ].join(','));
  }

  return BOM + lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function CopyTaxCodeButton({ taxCode }: { taxCode: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(taxCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Safe fallback if clipboard API fails
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Sao chép mã số thuế: ${taxCode}`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      <span>{copied ? 'Đã sao chép' : 'Sao chép MST'}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Inner Component
// ---------------------------------------------------------------------------

function EnterpriseVnInner() {
  const params = useSearchParams();
  const router = useRouter();

  // Search input state
  const [searchInput, setSearchInput] = useState(
    params.get('taxCode') || params.get('mst') || params.get('q') || ''
  );

  // Active view tab in Dossier view: 'dossier' | 'trademarks'
  const [activeTab, setActiveTab] = useState<'dossier' | 'trademarks'>('dossier');

  // Selected dossier & candidate search results
  const [selectedDossier, setSelectedDossier] = useState<EnterpriseDossier | null>(null);
  const [searchResults, setSearchResults] = useState<EnterpriseDossier[]>([]);

  // Trademarks state
  const [trademarks, setTrademarks] = useState<TrademarkItem[]>([]);
  const [trademarksLoading, setTrademarksLoading] = useState(false);
  const [trademarksError, setTrademarksError] = useState<{ kind: 'warn' | 'error'; code?: string; msg: string } | null>(null);

  // Global loading & error states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ kind: 'warn' | 'error'; code?: string; msg: string } | null>(null);

  // Detect input type for user feedback
  const detectedType = useMemo(() => detectInputType(searchInput), [searchInput]);

  // Fetch Trademarks from IP Vietnam
  const fetchTrademarks = useCallback(async () => {
    setTrademarksLoading(true);
    setTrademarksError(null);
    try {
      // Query IP Vietnam weekly publication gazette / trademark list
      const res = await scrape<unknown>('ipvietnam', 'search_gazette', {
        limit: 50,
      });
      if (res.ok && res.data) {
        const list = unwrapTrademarkList(res.data);
        setTrademarks(list);
      } else {
        // Fallback to alias 'search' if search_gazette is rejected
        const fallbackRes = await scrape<unknown>('ipvietnam', 'search', {
          limit: 50,
        });
        if (fallbackRes.ok && fallbackRes.data) {
          setTrademarks(unwrapTrademarkList(fallbackRes.data));
        } else {
          setTrademarksError(mapError(!fallbackRes.ok && 'error' in fallbackRes ? fallbackRes.error : undefined));
        }
      }
    } catch (err) {
      setTrademarksError(mapError(err));
    } finally {
      setTrademarksLoading(false);
    }
  }, []);

  // Main search / lookup execution
  const executeSearch = useCallback(
    async (queryOverride?: string) => {
      const q = (queryOverride ?? searchInput).trim();
      if (!q) return;

      setLoading(true);
      setError(null);
      setSearchResults([]);
      setSelectedDossier(null);

      const inputKind = detectInputType(q);

      try {
        if (inputKind === 'tax_code_10' || inputKind === 'tax_code_13') {
          const cleanTaxCode = q.replace(/[-\s]/g, '');

          // Concurrent query across masothue and b2b_registry_extended
          const [mstRes, b2bRes] = await Promise.allSettled([
            scrape<unknown>('masothue', 'detail', { taxCode: cleanTaxCode }),
            scrape<unknown>('b2b_registry_extended', 'search', {
              q: cleanTaxCode,
              taxCode: cleanTaxCode,
              platform: 'hosocongty',
              }),
          ]);

          let foundDossier: EnterpriseDossier | null = null;

          if (mstRes.status === 'fulfilled' && mstRes.value.ok && mstRes.value.data) {
            foundDossier = unwrapDossierItem(mstRes.value.data);
          }

          if (!foundDossier) {
            // Try fallback masothue:search with tax code
            const searchFallback = await scrape<unknown>('masothue', 'search', {
              q: cleanTaxCode,
              limit: 5,
              });
            if (searchFallback.ok && searchFallback.data) {
              const list = unwrapDossierList(searchFallback.data);
              if (list.length > 0) foundDossier = list[0];
            }
          }

          if (!foundDossier && b2bRes.status === 'fulfilled' && b2bRes.value.ok && b2bRes.value.data) {
            const list = unwrapDossierList(b2bRes.value.data);
            if (list.length > 0) foundDossier = list[0];
          }

          if (foundDossier) {
            setSelectedDossier(foundDossier);
            // Auto fetch trademarks in background
            fetchTrademarks();
          } else {
            // Check for bot challenge error in settled promises
            const mstErr = mstRes.status === 'fulfilled' ? (!mstRes.value.ok ? mstRes.value.error : undefined) : mstRes.reason;
            const b2bErr = b2bRes.status === 'fulfilled' ? (!b2bRes.value.ok ? b2bRes.value.error : undefined) : b2bRes.reason;
            const rejectedErr = mstErr || b2bErr;
            setError(mapError(rejectedErr || 'Không tìm thấy doanh nghiệp với mã số thuế này.'));
          }
        } else {
          // Company name search across both registry databases
          const [mstSearch, b2bSearch] = await Promise.allSettled([
            scrape<unknown>('masothue', 'search', { q, limit: 10 }),
            scrape<unknown>('b2b_registry_extended', 'search', {
              q,
              platform: 'hosocongty',
              limit: 10,
              }),
          ]);

          const combinedResults: EnterpriseDossier[] = [];
          const seenTax = new Set<string>();

          if (mstSearch.status === 'fulfilled' && mstSearch.value.ok && mstSearch.value.data) {
            const items = unwrapDossierList(mstSearch.value.data);
            for (const it of items) {
              if (it.taxCode && !seenTax.has(it.taxCode)) {
                seenTax.add(it.taxCode);
                combinedResults.push(it);
              }
            }
          }

          if (b2bSearch.status === 'fulfilled' && b2bSearch.value.ok && b2bSearch.value.data) {
            const items = unwrapDossierList(b2bSearch.value.data);
            for (const it of items) {
              if (it.taxCode && !seenTax.has(it.taxCode)) {
                seenTax.add(it.taxCode);
                combinedResults.push(it);
              }
            }
          }

          if (combinedResults.length === 1) {
            setSelectedDossier(combinedResults[0]);
            fetchTrademarks();
          } else if (combinedResults.length > 1) {
            setSearchResults(combinedResults);
          } else {
            const rejectedErr =
              (mstSearch.status === 'fulfilled' && !mstSearch.value.ok ? mstSearch.value.error : undefined) ||
              (b2bSearch.status === 'fulfilled' && !b2bSearch.value.ok ? b2bSearch.value.error : undefined);
            setError(mapError(rejectedErr || 'Không tìm thấy doanh nghiệp phù hợp với tên đã nhập.'));
          }
        }
      } catch (err) {
        setError(mapError(err));
      } finally {
        setLoading(false);
      }
    },
    [searchInput, fetchTrademarks]
  );

  // URL-only effect from app/dexscreener/page.tsx
  const executeSearchRef = useRef(executeSearch);
  executeSearchRef.current = executeSearch;
  useEffect(() => {
    const qParam = params.get('taxCode') || params.get('mst') || params.get('q');
    if (qParam && qParam.trim().length > 0) {
      executeSearchRef.current(qParam.trim());
    }
  }, [params]);

  // Handle selecting a company from candidate search results
  const handleSelectCompany = (dossier: EnterpriseDossier) => {
    setSelectedDossier(dossier);
    setSearchResults([]);
    router.replace(`/enterprise-vn?taxCode=${dossier.taxCode}`, { scroll: false });
    fetchTrademarks();
  };

  // Export handlers
  const handleExportCsv = () => {
    if (!selectedDossier) return;
    const content = generateCsv(selectedDossier, trademarks);
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `enterprise_${selectedDossier.taxCode || 'dossier'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    if (!selectedDossier) return;
    const payload = {
      dossier: selectedDossier,
      trademarks,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `enterprise_${selectedDossier.taxCode || 'dossier'}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRetry = () => {
    executeSearch();
  };

  const handleClear = () => {
    setSearchInput('');
    setSelectedDossier(null);
    setSearchResults([]);
    setError(null);
    setTrademarks([]);
    router.replace('/enterprise-vn', { scroll: false });
  };

  const activeBadge = selectedDossier ? getStatusBadgeConfig(selectedDossier.status) : null;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 text-xl leading-none">
              <Building2 className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Cổng thẩm định Doanh nghiệp Việt Nam
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Xác minh mã số thuế, tình trạng pháp lý và danh mục nhãn hiệu sở hữu trí tuệ chính thống.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedDossier && (
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" /> Tra cứu mới
            </button>
          )}
          <button
            type="button"
            onClick={handleRetry}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Smart Search Bar */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeSearch();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nhập mã số thuế (10 hoặc 13 số) hoặc tên công ty (e.g. 0013180180, Viettel)..."
              className="w-full pl-10 pr-28 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white font-sans focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {searchInput.trim() && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                {detectedType === 'tax_code_10'
                  ? 'MST 10 số'
                  : detectedType === 'tax_code_13'
                  ? 'MST 13 số'
                  : 'Tên công ty'}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={!searchInput.trim() || loading}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Tra cứu</span>
          </button>
        </form>

        {/* Quick Suggestion Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <span className="text-slate-400">Gợi ý tra cứu nhanh:</span>
          {QUICK_SUGGESTIONS.map((item) => (
            <button
              key={item.taxCode}
              type="button"
              onClick={() => {
                setSearchInput(item.taxCode);
                executeSearch(item.taxCode);
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium transition-colors"
            >
              {item.label} ({item.taxCode})
            </button>
          ))}
        </div>
      </div>

      {/* Upstream Error Banner with Retry */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            <div>
              <span className="text-sm font-medium text-red-700 dark:text-red-400 block">
                {error.msg}
              </span>
              {error.code === 'XACT_4030' && (
                <span className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5 block">
                  Cloudflare bot challenge phát hiện. Hệ thống đang bảo vệ cổng thông tin chính phủ.
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Search Candidates List (When query matches multiple companies) */}
      {searchResults.length > 0 && !selectedDossier && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              <span>Kết quả tìm kiếm ({searchResults.length} doanh nghiệp)</span>
            </h2>
            <span className="text-xs text-slate-400">Chọn doanh nghiệp để xem hồ sơ đầy đủ</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {searchResults.map((dossier, idx) => {
              const badge = getStatusBadgeConfig(dossier.status);
              return (
                <div
                  key={dossier.taxCode || idx}
                  className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white line-clamp-2">
                        {dossier.companyName}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border shrink-0 font-medium ${badge.badgeClass}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClass}`} />
                        <span>{badge.label}</span>
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                          MST: {dossier.taxCode}
                        </span>
                        {dossier.province && (
                          <span className="text-slate-400">· {dossier.province}</span>
                        )}
                      </div>
                      {dossier.address && (
                        <p className="line-clamp-2 text-slate-600 dark:text-slate-400">
                          {dossier.address}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleSelectCompany(dossier)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                    >
                      <span>Xem hồ sơ thẩm định</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="space-y-4">
          <div className="h-48 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          <div className="h-64 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
        </div>
      )}

      {/* ===================================================================== */}
      {/* ENTERPRISE DOSSIER VIEW                                                */}
      {/* ===================================================================== */}
      {selectedDossier && !loading && (
        <div className="space-y-6">
          {/* Export Toolbar & View Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
            {/* View Navigation Tabs */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('dossier')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'dossier'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Hồ sơ pháp lý</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('trademarks')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'trademarks'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                <span>Nhãn hiệu &amp; Sở hữu trí tuệ</span>
                {trademarks.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {trademarks.length}
                  </span>
                )}
              </button>
            </div>

            {/* Export Toolbar */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                title="Xuất file CSV tương thích Microsoft Excel tiếng Việt (UTF-8 BOM)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Xuất CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                title="Xuất dữ liệu hồ sơ ra file JSON"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <FileCode className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Xuất JSON</span>
              </button>
            </div>
          </div>

          {/* TAB 1: Enterprise Dossier */}
          {activeTab === 'dossier' && (
            <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-6 shadow-sm">
              {/* Dossier Header */}
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                      {selectedDossier.companyName}
                    </h2>
                    {activeBadge && (
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-semibold ${activeBadge.badgeClass}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${activeBadge.dotClass}`} />
                        <span>{activeBadge.label}</span>
                      </span>
                    )}
                  </div>

                  {(selectedDossier.internationalName || selectedDossier.shortName) && (
                    <p className="text-xs text-slate-500 font-medium">
                      Tên giao dịch / Viết tắt: {selectedDossier.internationalName || selectedDossier.shortName}
                    </p>
                  )}

                  <div className="flex items-center gap-3 pt-1">
                    <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                      MST: {selectedDossier.taxCode}
                    </span>
                    <CopyTaxCodeButton taxCode={selectedDossier.taxCode} />
                  </div>
                </div>

                {selectedDossier.detailUrl && (
                  <a
                    href={selectedDossier.detailUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium"
                  >
                    <span>Cổng thông tin nguồn</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {/* Dossier Grid Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                {/* Legal Representative */}
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block font-medium">Người đại diện pháp luật</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedDossier.representativeName || 'Chưa cập nhật'}
                    </span>
                  </div>
                </div>

                {/* Registered Address */}
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block font-medium">Địa chỉ đăng ký</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedDossier.address || 'Chưa cập nhật'}
                    </span>
                  </div>
                </div>

                {/* Established Date */}
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block font-medium">Ngày thành lập / Cấp phép</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedDossier.establishedDate || 'Chưa cập nhật'}
                    </span>
                  </div>
                </div>

                {/* Phone */}
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                    <Phone className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block font-medium">Số điện thoại liên hệ</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedDossier.phone || 'Chưa cập nhật'}
                    </span>
                  </div>
                </div>

                {/* Legal Form / Charter Capital */}
                {(selectedDossier.legalForm || selectedDossier.charterCapital) && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block font-medium">Loại hình / Vốn điều lệ</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {[selectedDossier.legalForm, selectedDossier.charterCapital].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  </div>
                )}

                {/* Province / City */}
                {selectedDossier.province && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block font-medium">Tỉnh / Thành phố quản lý</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedDossier.province}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Business Lines (Full Width) */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <span className="text-xs text-slate-400 block font-medium">Ngành nghề kinh doanh chính</span>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-0.5 leading-relaxed">
                      {selectedDossier.businessLines || 'Chưa có thông tin ngành nghề chi tiết'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: IP Vietnam Trademarks */}
          {activeTab === 'trademarks' && (
            <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Award className="w-4 h-4 text-emerald-500" />
                    <span>Danh mục nhãn hiệu đăng ký sở hữu trí tuệ</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Dữ liệu công báo chính thức từ Cục Sở hữu Trí tuệ Việt Nam (ipvietnam.gov.vn)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchTrademarks}
                  disabled={trademarksLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${trademarksLoading ? 'animate-spin' : ''}`} />
                  <span>Cập nhật nhãn hiệu</span>
                </button>
              </div>

              {/* Trademarks error banner */}
              {trademarksError && (
                <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-700 dark:text-amber-400 flex items-center justify-between">
                  <span>{trademarksError.msg}</span>
                  <button
                    type="button"
                    onClick={fetchTrademarks}
                    className="underline font-semibold ml-2 hover:text-amber-800"
                  >
                    Thử lại
                  </button>
                </div>
              )}

              {/* Trademarks table */}
              {trademarksLoading ? (
                <div className="space-y-2 py-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : trademarks.length === 0 ? (
                <div className="p-8 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <Info className="w-6 h-6 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-500">
                    Chưa có đơn nhãn hiệu hoặc đang cập nhật từ Cục Sở hữu Trí tuệ.
                  </p>
                  <button
                    type="button"
                    onClick={fetchTrademarks}
                    className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold underline"
                  >
                    Tải dữ liệu công báo gần nhất
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">STT</th>
                        <th className="py-2.5 px-3">Số đơn</th>
                        <th className="py-2.5 px-3">Nhóm ngành</th>
                        <th className="py-2.5 px-3">Ngày nộp đơn</th>
                        <th className="py-2.5 px-3">Ngày công bố</th>
                        <th className="py-2.5 px-3">Trạng thái</th>
                        <th className="py-2.5 px-3">Kỳ công báo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {trademarks.map((tm, idx) => (
                        <tr key={`${tm.applicationNumber}-${idx}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 text-slate-400">{idx + 1}</td>
                          <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 dark:text-white">
                            {tm.applicationNumber}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                            {tm.classes && tm.classes.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {tm.classes.map((c, ci) => (
                                  <span key={ci} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-400">
                                    {c}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                            {tm.rawApplicationDate || tm.applicationDate || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                            {tm.rawPublicationDate || tm.publicationDate || '—'}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                              {tm.status || 'Chuyển công bố'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-500">
                            {tm.gazettePeriod || 'Công bố định kỳ'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Initial Empty View */}
      {!selectedDossier && searchResults.length === 0 && !loading && !error && (
        <div className="p-12 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              Sẵn sàng tra cứu pháp nhân doanh nghiệp
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Nhập mã số thuế (10 hoặc 13 số) hoặc tên công ty để tra cứu dữ liệu pháp nhân, người đại diện và danh mục nhãn hiệu bản quyền.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EnterpriseVnPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Đang tải Cổng thẩm định doanh nghiệp...</div>}>
      <EnterpriseVnInner />
    </Suspense>
  );
}
