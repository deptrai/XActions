// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TopCV Crawler
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { TopCvClient } from './client.js';
import {
  normalizeKeywordToSlug,
  parseVietnameseSalary,
  parseExperienceYears,
  mapEmploymentType,
  stripHtml,
} from './normalize-job.js';
import { PlatformError, ErrorTypes } from '../../../core/error-envelope.js';

export class TopCvCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'topcv';

  /** @type {string} */
  platform = 'topcv';

  /** @type {boolean} */
  requiresAuth = false;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const client = options.client || new TopCvClient(options);
    super({
      client,
      ...options,
    });

    this.registerAction({
      action: 'search_jobs',
      description: 'Search job postings on TopCV by keyword, location, salary, experience',
      category: 'recruitment',
      requiredArgs: ['keyword'],
      optionalArgs: ['city', 'salary', 'exp', 'page', 'limit'],
      example: { keyword: 'NodeJS Developer', city: 'hanoi', limit: 20 },
      outputType: '{ jobs: PostItem[], pageInfo: { current_page: number, has_next_page: boolean, total_items?: number } }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.searchJobs(args, session),
    });

    this.registerAction({
      action: 'job_detail',
      description: 'Scrape detailed JD, requirements, and benefits from TopCV job page',
      category: 'recruitment',
      requiredArgs: ['jobId'],
      optionalArgs: ['jobUrl'],
      example: { jobId: '123456', jobUrl: 'https://www.topcv.vn/viec-lam/lap-trinh-vien-nodejs/123456.html' },
      outputType: '{ job: PostItem }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.jobDetail(args, session),
    });

    this.registerAction({
      action: 'company_detail',
      description: 'Scrape company profile, address, website, and scale from TopCV brand page',
      category: 'recruitment',
      requiredArgs: ['companyId'],
      optionalArgs: ['companyUrl'],
      example: { companyId: 'techcorp-vn', companyUrl: 'https://www.topcv.vn/brand/techcorp-vn' },
      outputType: '{ company: ProfileItem }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.companyDetail(args, session),
    });
  }

  /**
   * Action Handler: search_jobs
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async searchJobs(args = {}, session) {
    const keyword = args.keyword || '';
    const page = Math.max(1, Number(args.page) || 1);
    const limit = Math.max(1, Number(args.limit) || 20);

    const slug = normalizeKeywordToSlug(keyword);
    let searchUrl = `/tim-viec-lam-${slug}`;
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page));
    if (args.city) params.set('city', String(args.city));
    if (args.category) params.set('category', String(args.category));

    const qs = params.toString();
    if (qs) searchUrl += `?${qs}`;

    const html = await this.client.getHtml(searchUrl);
    const jobs = this.#parseJobListHtml(html).slice(0, limit);

    if (this.store && typeof this.store.storeBatch === 'function') {
      try {
        await this.store.storeBatch(jobs, { validateSchema: true });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[TopCvCrawler] Failed to persist jobs batch:', err.message);
        }
      }
    }

    return {
      jobs,
      pageInfo: {
        current_page: page,
        has_next_page: jobs.length >= limit,
        total_items: jobs.length,
      },
    };
  }

  /**
   * Action Handler: job_detail
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async jobDetail(args = {}, session) {
    const jobId = String(args.jobId || args.id || '').trim();
    let jobUrl = args.jobUrl || args.url || '';

    if (!jobUrl && jobId) {
      jobUrl = `/viec-lam/${jobId}.html`;
    }

    if (!jobUrl) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'jobId or jobUrl is required for job_detail action',
        platform: 'topcv',
      });
    }

    const html = await this.client.getHtml(jobUrl);
    const job = this.#parseJobDetailHtml(html, jobId, jobUrl);

    if (this.store && typeof this.store.storeBatch === 'function') {
      try {
        await this.store.storeBatch([job], { validateSchema: true });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[TopCvCrawler] Failed to persist job detail:', err.message);
        }
      }
    }

    return { job };
  }

  /**
   * Action Handler: company_detail
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async companyDetail(args = {}, session) {
    const companyId = String(args.companyId || args.id || '').trim();
    let companyUrl = args.companyUrl || args.url || '';

    if (!companyUrl && companyId) {
      companyUrl = `/brand/${companyId}`;
    }

    if (!companyUrl) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'companyId or companyUrl is required for company_detail action',
        platform: 'topcv',
      });
    }

    const html = await this.client.getHtml(companyUrl);
    const company = this.#parseCompanyDetailHtml(html, companyId, companyUrl);

    return { company };
  }

  /**
   * Parse Search Result HTML into PostItem[]
   * @param {string} html
   * @returns {import('../../../core/types.js').PostItem[]}
   */
  #parseJobListHtml(html) {
    const items = [];
    const itemRegex = /<div[^>]*class="[^"]*job-item-search-result[^"]*"[^>]*data-job-id="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let match;

    while ((match = itemRegex.exec(html)) !== null) {
      const jobId = match[1];
      const chunk = match[2];

      const titleMatch = chunk.match(/<h3[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const title = titleMatch ? stripHtml(titleMatch[2]) : '';
      const jobUrl = titleMatch ? titleMatch[1] : '';

      const companyMatch = chunk.match(/<a[^>]*class="[^"]*company[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const companyName = companyMatch ? stripHtml(companyMatch[2]) : '';
      const companyUrl = companyMatch ? companyMatch[1] : '';

      const salaryMatch = chunk.match(/<span[^>]*class="[^"]*salary[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      const rawSalary = salaryMatch ? stripHtml(salaryMatch[1]) : '';
      const salaryInfo = parseVietnameseSalary(rawSalary);

      const locationMatch = chunk.match(/<span[^>]*class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      const location = locationMatch ? stripHtml(locationMatch[1]) : '';

      const expMatch = chunk.match(/<span[^>]*class="[^"]*exp[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      const rawExp = expMatch ? stripHtml(expMatch[1]) : '';
      const experienceYears = parseExperienceYears(rawExp);

      const descMatch = chunk.match(/<div[^>]*class="[^"]*job-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const description = descMatch ? stripHtml(descMatch[1]) : '';

      items.push({
        id: `topcv:job:${jobId}`,
        platform: 'topcv',
        externalId: jobId,
        category: 'recruitment',
        authorId: `topcv:company:${companyUrl.split('/').pop() || companyName}`,
        authorName: companyName,
        postUrl: jobUrl.startsWith('http') ? jobUrl : `https://www.topcv.vn${jobUrl}`,
        content: `${title}\n\nCông ty: ${companyName}\nMức lương: ${rawSalary}\nĐịa điểm: ${location}\n${description}`.trim(),
        likesCount: 0,
        repostsCount: 0,
        repliesCount: 0,
        viewsCount: 0,
        publishedAt: new Date().toISOString(),
        crawledAt: new Date(),
        metadata: {
          jobId,
          title,
          companyName,
          companyUrl,
          location,
          rawSalary,
          salaryMin: salaryInfo.salaryMin,
          salaryMax: salaryInfo.salaryMax,
          salaryCurrency: salaryInfo.salaryCurrency,
          isNegotiable: salaryInfo.isNegotiable,
          experienceYears,
          sourceMethod: 'search_jobs',
        },
      });
    }

    return items;
  }

  /**
   * Parse Job Detail HTML into PostItem
   * @param {string} html
   * @param {string} jobId
   * @param {string} jobUrl
   * @returns {import('../../../core/types.js').PostItem}
   */
  #parseJobDetailHtml(html, jobId, jobUrl) {
    const titleMatch = html.match(/<h1[^>]*class="[^"]*job-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]) : '';

    const companyMatch = html.match(/<a[^>]*class="[^"]*company-name[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const companyName = companyMatch ? stripHtml(companyMatch[2]) : '';
    const companyUrl = companyMatch ? companyMatch[1] : '';

    const salaryMatch = html.match(/<div[^>]*class="[^"]*job-salary[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const rawSalary = salaryMatch ? stripHtml(salaryMatch[1]) : '';
    const salaryInfo = parseVietnameseSalary(rawSalary);

    const locationMatch = html.match(/<div[^>]*class="[^"]*job-location[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const location = locationMatch ? stripHtml(locationMatch[1]) : '';

    const deadlineMatch = html.match(/<div[^>]*class="[^"]*job-deadline[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const deadline = deadlineMatch ? stripHtml(deadlineMatch[1]).replace(/Hạn nộp:\s*/i, '') : null;

    const descMatch = html.match(/<div[^>]*class="[^"]*job-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const description = descMatch ? stripHtml(descMatch[1]) : '';

    const reqMatch = html.match(/<div[^>]*class="[^"]*job-requirements[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const requirements = reqMatch ? stripHtml(reqMatch[1]) : '';

    const benMatch = html.match(/<div[^>]*class="[^"]*job-benefits[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const benefits = benMatch ? stripHtml(benMatch[1]) : '';

    const skills = [];
    const tagMatches = html.matchAll(/<span[^>]*class="[^"]*tag[^"]*"[^>]*>([\s\S]*?)<\/span>/gi);
    for (const tm of tagMatches) {
      const tag = stripHtml(tm[1]);
      if (tag && !tag.includes('Toàn thời gian') && !tag.includes('Bán thời gian')) {
        skills.push(tag);
      }
    }

    const employmentType = mapEmploymentType(html);
    const parsedJobId = jobId || jobUrl.match(/\/(\d+)\.html/)?.[1] || 'unknown';

    return {
      id: `topcv:job:${parsedJobId}`,
      platform: 'topcv',
      externalId: parsedJobId,
      category: 'recruitment',
      authorId: `topcv:company:${companyUrl.split('/').pop() || companyName}`,
      authorName: companyName,
      postUrl: jobUrl.startsWith('http') ? jobUrl : `https://www.topcv.vn${jobUrl}`,
      content: `${title}\n\n${description}\n\n${requirements}\n\n${benefits}`.trim(),
      likesCount: 0,
      repostsCount: 0,
      repliesCount: 0,
      viewsCount: 0,
      publishedAt: new Date().toISOString(),
      crawledAt: new Date(),
      metadata: {
        jobId: parsedJobId,
        title,
        companyName,
        companyUrl,
        location,
        rawSalary,
        salaryMin: salaryInfo.salaryMin,
        salaryMax: salaryInfo.salaryMax,
        salaryCurrency: salaryInfo.salaryCurrency,
        isNegotiable: salaryInfo.isNegotiable,
        employmentType,
        skills,
        description,
        requirements,
        benefits,
        deadline,
        sourceMethod: 'job_detail',
      },
    };
  }

  /**
   * Parse Company Detail HTML into ProfileItem
   * @param {string} html
   * @param {string} companyId
   * @param {string} companyUrl
   * @returns {import('../../../core/types.js').ProfileItem}
   */
  #parseCompanyDetailHtml(html, companyId, companyUrl) {
    const nameMatch = html.match(/<h1[^>]*class="[^"]*company-name[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
    const name = nameMatch ? stripHtml(nameMatch[1]) : '';

    const scaleMatch = html.match(/<div[^>]*class="[^"]*company-scale[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const scale = scaleMatch ? stripHtml(scaleMatch[1]) : '';

    const webMatch = html.match(/<div[^>]*class="[^"]*company-website[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>/i);
    const website = webMatch ? webMatch[1] : '';

    const addrMatch = html.match(/<div[^>]*class="[^"]*company-address[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const address = addrMatch ? stripHtml(addrMatch[1]) : '';

    const bioMatch = html.match(/<div[^>]*class="[^"]*company-bio[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const bio = bioMatch ? stripHtml(bioMatch[1]) : '';

    const parsedCompanyId = companyId || companyUrl.split('/').pop() || 'unknown';

    return {
      id: `topcv:company:${parsedCompanyId}`,
      platform: 'topcv',
      externalId: parsedCompanyId,
      name,
      username: parsedCompanyId,
      bio,
      profileUrl: companyUrl.startsWith('http') ? companyUrl : `https://www.topcv.vn${companyUrl}`,
      followersCount: 0,
      followingCount: 0,
      crawledAt: new Date(),
      metadata: {
        companyId: parsedCompanyId,
        name,
        scale,
        website,
        address,
        sourceMethod: 'company_detail',
      },
    };
  }
}
