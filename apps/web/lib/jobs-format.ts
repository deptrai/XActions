// by nichxbt — pure formatting helpers for /jobs-vn (no React, no 'use client')
// Tách riêng khỏi page.tsx để test thực thi được trong môi trường Node (vitest node env).

export type PlatformName = 'topcv' | 'vietnamworks' | 'linkedin';

export interface NormalizedJob {
  id: string;
  platform: PlatformName;
  title: string;
  companyName: string;
  companyLogo?: string | null;
  location: string;
  rawSalary?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  isNegotiable?: boolean;
  experienceYears?: number | string | null;
  skills: string[];
  employmentType?: string;
  postUrl: string;
  publishedAt?: string;
}

const PLATFORM_LABELS: Record<PlatformName, string> = {
  topcv: 'TopCV',
  vietnamworks: 'VietnamWorks',
  linkedin: 'LinkedIn',
};

export function platformLabel(platform: PlatformName): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

/**
 * Định dạng mức lương cho job card + CSV.
 * Lưu ý: normalizer của VietnamWorks dùng salaryMin = 0 để biểu thị
 * "không có cận dưới" (ví dụ "Lên tới 20 triệu"). Vì vậy 0 phải được coi
 * là vô hạn dưới, không phải mức lương 0 — tránh hiển thị "0 - 20,000,000".
 */
export function formatSalary(job: NormalizedJob): { text: string; isNegotiable: boolean } {
  if (job.isNegotiable) {
    return { text: 'Thỏa thuận', isNegotiable: true };
  }
  if (job.rawSalary && job.rawSalary.trim()) {
    const raw = job.rawSalary.trim();
    if (/thỏa thuận|thương lượng|negotiable/i.test(raw)) {
      return { text: 'Thỏa thuận', isNegotiable: true };
    }
    return { text: raw, isNegotiable: false };
  }

  const hasMin = job.salaryMin != null && job.salaryMin > 0;
  const hasMax = job.salaryMax != null && job.salaryMax > 0;
  const curr = job.salaryCurrency === 'USD' ? '$' : '';
  const suffix = job.salaryCurrency === 'VND' ? ' VNĐ' : '';

  if (hasMin && hasMax) {
    return {
      text: `${curr}${(job.salaryMin as number).toLocaleString()} - ${curr}${(job.salaryMax as number).toLocaleString()}${suffix}`,
      isNegotiable: false,
    };
  }
  if (hasMin) {
    return { text: `Từ ${curr}${(job.salaryMin as number).toLocaleString()}${suffix}`, isNegotiable: false };
  }
  if (hasMax) {
    return { text: `Lên tới ${curr}${(job.salaryMax as number).toLocaleString()}${suffix}`, isNegotiable: false };
  }
  return { text: 'Thỏa thuận', isNegotiable: true };
}

/**
 * Escape một ô CSV theo RFC 4180 + chống CSV formula injection.
 * Excel/Calc diễn giải ô bắt đầu bằng =, +, -, @ hoặc ký tự điều khiển
 * (tab/CR) như công thức; tiền tố `'` vô hại với người đọc.
 */
export function escapeCsv(value: unknown): string {
  if (value == null) return '""';
  let str = String(value).replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str}"`;
}

const CSV_HEADERS = [
  'ID',
  'Tiêu đề (Job Title)',
  'Công ty (Company)',
  'Nền tảng (Platform)',
  'Mức lương (Salary)',
  'Địa điểm (Location)',
  'Kinh nghiệm (Experience)',
  'Kỹ năng (Skills)',
  'Hình thức (Employment Type)',
  'Ngày đăng (Published Date)',
  'Link ứng tuyển (Job URL)',
];

/** Sinh CSV (UTF-8 BOM) cho danh sách job đã lọc. */
export function generateJobsCsv(jobs: NormalizedJob[]): string {
  const BOM = '﻿';
  const rows = jobs.map((j) => {
    const salary = formatSalary(j);
    return [
      escapeCsv(j.id),
      escapeCsv(j.title),
      escapeCsv(j.companyName),
      escapeCsv(platformLabel(j.platform)),
      escapeCsv(salary.text),
      escapeCsv(j.location),
      escapeCsv(j.experienceYears ? `${j.experienceYears} năm` : 'Không yêu cầu'),
      escapeCsv(j.skills.join('; ')),
      escapeCsv(j.employmentType || 'Toàn thời gian'),
      escapeCsv(j.publishedAt || ''),
      escapeCsv(j.postUrl),
    ].join(',');
  });
  return BOM + [CSV_HEADERS.join(','), ...rows].join('\r\n');
}
