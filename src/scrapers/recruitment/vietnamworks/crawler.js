// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * VietnamWorks Crawler
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { VietnamWorksClient } from './client.js';
import {
  normalizeVietnamWorksJob,
  normalizeVietnamWorksCompany,
} from './normalize-job.js';
import { PlatformError, ErrorTypes } from '../../../core/error-envelope.js';

export class VietnamWorksCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'vietnamworks';

  /** @type {string} */
  platform = 'vietnamworks';

  /** @type {boolean} */
  requiresAuth = false;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const client = options.client || new VietnamWorksClient(options);
    super({
      client,
      ...options,
    });

    this.registerAction({
      action: 'search_jobs',
      description: 'Search mid & senior jobs on VietnamWorks by keyword, salary, location, and experience',
      category: 'recruitment',
      requiredArgs: ['keyword'],
      optionalArgs: ['city', 'locationId', 'salaryMin', 'salaryMax', 'exp', 'employmentType', 'page', 'limit'],
      example: { keyword: 'NodeJS Developer', locationId: 29, salaryMin: 20000000, limit: 20 },
      outputType: '{ jobs: PostItem[], pageInfo: { current_page: number, has_next_page: boolean, total_items?: number } }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.searchJobs(args, session),
    });

    this.registerAction({
      action: 'job_detail',
      description: 'Scrape detailed job specification from VietnamWorks by jobId',
      category: 'recruitment',
      requiredArgs: ['jobId'],
      optionalArgs: ['jobUrl', 'keyword'],
      example: { jobId: '1987654' },
      outputType: '{ job: PostItem }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.jobDetail(args, session),
    });

    this.registerAction({
      action: 'company_detail',
      description: 'Scrape company profile on VietnamWorks',
      category: 'recruitment',
      requiredArgs: ['companyId'],
      optionalArgs: ['companyName'],
      example: { companyId: 'vng-corporation', companyName: 'VNG Corporation' },
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

    const body = {
      keyword,
      page,
      hitsPerPage: limit,
    };

    if (args.locationId != null) body.locationId = Number(args.locationId);
    if (args.salaryMin != null) body.salaryMin = Number(args.salaryMin);
    if (args.salaryMax != null) body.salaryMax = Number(args.salaryMax);
    if (args.exp != null) body.yearsOfExperience = Number(args.exp);
    if (args.employmentType) {
      const typeMap = { full_time: 1, part_time: 2, contract: 3, intern: 4 };
      if (typeMap[args.employmentType]) body.typeWorkingId = typeMap[args.employmentType];
    }

    const resp = await this.client.postJson('/job-search/v1.0/search', body);
    const rawList = Array.isArray(resp?.data) ? resp.data : (Array.isArray(resp?.items) ? resp.items : []);
    const jobs = rawList.map((job) => normalizeVietnamWorksJob(job));

    if (this.store && typeof this.store.storeBatch === 'function') {
      try {
        await this.store.storeBatch(jobs, { validateSchema: true });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[VietnamWorksCrawler] Failed to persist jobs batch:', err.message);
        }
      }
    }

    const totalHits = resp?.meta?.totalHits || resp?.total || jobs.length;

    return {
      jobs,
      pageInfo: {
        current_page: page,
        has_next_page: jobs.length >= limit,
        total_items: totalHits,
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
    if (!jobId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'jobId is required for job_detail action',
        platform: 'vietnamworks',
      });
    }

    // VietnamWorks search endpoint returns full JD when queried directly
    const resp = await this.client.postJson('/job-search/v1.0/search', {
      keyword: args.keyword || jobId,
      page: 1,
      hitsPerPage: 10,
    });

    const rawList = Array.isArray(resp?.data) ? resp.data : [];
    const matched = rawList.find((j) => String(j.jobId) === jobId) || rawList[0];

    if (!matched) {
      throw new PlatformError({
        code: 'XACT_4041',
        type: ErrorTypes.NOT_FOUND,
        message: `Job ${jobId} not found on VietnamWorks`,
        platform: 'vietnamworks',
      });
    }

    const job = normalizeVietnamWorksJob(matched);
    job.metadata.sourceMethod = 'job_detail';

    if (this.store && typeof this.store.storeBatch === 'function') {
      try {
        await this.store.storeBatch([job], { validateSchema: true });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[VietnamWorksCrawler] Failed to persist job detail:', err.message);
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
    const companyName = String(args.companyName || args.name || companyId).trim();

    if (!companyId && !companyName) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'companyId or companyName is required for company_detail action',
        platform: 'vietnamworks',
      });
    }

    const company = normalizeVietnamWorksCompany({
      companyId: companyId || encodeURIComponent(companyName),
      companyName,
      companyUrl: args.companyUrl,
    });

    return { company };
  }
}
