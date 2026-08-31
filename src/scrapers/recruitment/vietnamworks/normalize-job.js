// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalization utilities for VietnamWorks Recruitment data
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

const TYPE_WORKING_MAP = {
  1: 'full_time',
  2: 'part_time',
  3: 'contract',
  4: 'intern',
};

/**
 * Coerce salary values to an integer or null.
 * @param {any} value
 * @returns {number | null}
 */
export function toInt(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Math.round(value);
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    const cleaned = text.replace(/,/g, '');
    if (cleaned.includes('.')) {
      const val = parseFloat(cleaned);
      return Number.isNaN(val) ? null : Math.round(val);
    }
    const val = parseInt(cleaned, 10);
    return Number.isNaN(val) ? null : val;
  }
  return null;
}

/**
 * Normalize VietnamWorks salary boundaries.
 * @param {any} minVal
 * @param {any} maxVal
 * @returns {{ salaryMin: number | null, salaryMax: number | null, isNegotiable: boolean }}
 */
export function normalizeVietnamWorksSalary(minVal, maxVal) {
  let min = toInt(minVal) || 0;
  let max = toInt(maxVal) || 0;

  if (min === 0 && max === 0) {
    return { salaryMin: 0, salaryMax: 0, isNegotiable: true };
  }
  if (min > 0 && max === 0) {
    return { salaryMin: min, salaryMax: null, isNegotiable: false };
  }
  if (min === 0 && max > 0) {
    return { salaryMin: 0, salaryMax: max, isNegotiable: false };
  }
  return { salaryMin: min, salaryMax: max, isNegotiable: false };
}

/**
 * Map working type ID to readable enum.
 * @param {number | null} typeId
 * @returns {string | null}
 */
export function mapWorkingType(typeId) {
  if (typeId === null || typeId === undefined) return null;
  return TYPE_WORKING_MAP[typeId] || null;
}

/**
 * Parse date to ISO date string (YYYY-MM-DD).
 * @param {any} value
 * @returns {string | null}
 */
export function parseVietnamWorksDate(value) {
  if (!value) return null;
  try {
    if (typeof value === 'number') {
      const ts = value > 1e12 ? value : value * 1000;
      return new Date(ts).toISOString().split('T')[0];
    }
    if (typeof value === 'string') {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Extract location from workingLocations array.
 * @param {Array<Record<string, any>>} [locations]
 * @returns {string}
 */
export function extractLocation(locations) {
  if (!Array.isArray(locations) || locations.length === 0) return '';
  const loc = locations[0];
  if (!loc || typeof loc !== 'object') return '';
  return loc.cityNameVI || loc.cityName || loc.address || '';
}

/**
 * Normalize raw VietnamWorks job into standardized PostItem.
 * @param {Record<string, any>} job
 * @returns {import('../../../core/types.js').PostItem}
 */
export function normalizeVietnamWorksJob(job = {}) {
  const jobId = String(job.jobId || job.id || 'unknown');
  const title = String(job.jobTitle || job.title || '').trim();
  const companyName = String(job.companyName || job.company || '').trim();
  const companyLogo = job.companyLogo || job.company_logo || undefined;
  const jobUrl = job.jobUrl || job.source_url || `https://www.vietnamworks.com/${jobId}-jv`;

  const workingLocations = job.workingLocations || [];
  const location = extractLocation(workingLocations) || (typeof job.location === 'string' ? job.location : '');

  const rawSalary = String(job.prettySalary || job.salary_raw || '').trim();
  const salaryInfo = normalizeVietnamWorksSalary(job.salaryMin ?? job.salary_min, job.salaryMax ?? job.salary_max);
  const salaryCurrency = job.salaryCurrency || job.salary_currency || (rawSalary.includes('$') || rawSalary.toLowerCase().includes('usd') ? 'USD' : 'VND');

  const employmentType = mapWorkingType(job.typeWorkingId) || job.employment_type || null;
  const experienceYears = toInt(job.yearsOfExperience ?? job.experience_years);

  const skills = Array.isArray(job.skills)
    ? job.skills.map((s) => (typeof s === 'object' && s !== null ? s.skillName || s.name : String(s))).filter(Boolean)
    : [];

  const benefits = Array.isArray(job.benefits)
    ? job.benefits.map((b) => (typeof b === 'object' && b !== null ? b.benefitName || b.name : String(b))).filter(Boolean)
    : [];

  const description = String(job.jobDescription || job.job_description || '').trim();
  const requirements = String(job.jobRequirement || job.job_requirement || '').trim();

  const postedAt = parseVietnamWorksDate(job.createdOn ?? job.posted_at);
  const deadline = parseVietnamWorksDate(job.expiredOn ?? job.expired_at);

  return {
    id: `vietnamworks:job:${jobId}`,
    platform: 'vietnamworks',
    externalId: jobId,
    category: 'recruitment',
    authorId: `vietnamworks:company:${encodeURIComponent(companyName)}`,
    authorName: companyName,
    authorAvatar: companyLogo,
    postUrl: jobUrl,
    content: `${title}\n\nCông ty: ${companyName}\nMức lương: ${rawSalary || 'Thương lượng'}\nĐịa điểm: ${location}\n${description}`.trim(),
    likesCount: 0,
    repostsCount: 0,
    repliesCount: 0,
    viewsCount: 0,
    publishedAt: postedAt ? new Date(postedAt).toISOString() : new Date().toISOString(),
    crawledAt: new Date(),
    metadata: {
      jobId,
      title,
      companyName,
      companyUrl: job.companyUrl || undefined,
      location,
      rawSalary,
      salaryMin: salaryInfo.salaryMin,
      salaryMax: salaryInfo.salaryMax,
      salaryCurrency,
      isNegotiable: salaryInfo.isNegotiable,
      employmentType,
      experienceYears,
      skills,
      benefits,
      description,
      requirements,
      deadline,
      sourceMethod: 'search_jobs',
    },
  };
}

/**
 * Normalize raw VietnamWorks company into standardized ProfileItem.
 * @param {Record<string, any>} company
 * @returns {import('../../../core/types.js').ProfileItem}
 */
export function normalizeVietnamWorksCompany(company = {}) {
  const companyId = String(company.companyId || company.id || company.companyName || 'unknown');
  const name = String(company.companyName || company.name || 'VietnamWorks Employer').trim();
  const profileUrl = company.companyUrl || (companyId !== 'unknown' ? `https://www.vietnamworks.com/nha-tuyen-dung/${companyId}` : '');

  return {
    id: `vietnamworks:company:${encodeURIComponent(companyId)}`,
    platform: 'vietnamworks',
    externalId: companyId,
    name,
    username: companyId,
    avatar: company.companyLogo || undefined,
    profileUrl,
    followersCount: 0,
    followingCount: 0,
    crawledAt: new Date(),
    metadata: {
      companyId,
      name,
      website: company.website || undefined,
      scale: company.scale || undefined,
      address: company.address || undefined,
      sourceMethod: 'company_detail',
    },
  };
}
