// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * LinkedIn Crawler
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { LinkedInClient } from './client.js';
import {
  parseLinkedInJobCard,
  parseLinkedInJobDetail,
  normalizeLinkedInCompany,
  normalizeLinkedInLead,
} from './normalize-linkedin.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { gaussianDelay } from '../../../utils/gaussian-delay.js';

export class LinkedInCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'linkedin';

  /** @type {string} */
  platform = 'linkedin';

  /** @type {boolean} */
  requiresAuth = false;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const client = options.client || new LinkedInClient(options);
    super({
      client,
      ...options,
    });

    this.registerAction({
      action: 'search_jobs',
      description: 'Search public job postings on LinkedIn via Guest API or CDP',
      category: 'recruitment',
      requiredArgs: ['keyword'],
      optionalArgs: ['location', 'start', 'limit', 'useCdp'],
      example: { keyword: 'Software Engineer', location: 'Vietnam', limit: 10 },
      outputType: '{ jobs: PostItem[], pageInfo: { current_page: number, has_next_page: boolean, total_items?: number } }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.searchJobs(args, session),
    });

    this.registerAction({
      action: 'job_detail',
      description: 'Scrape detailed job specification from LinkedIn by jobId',
      category: 'recruitment',
      requiredArgs: ['jobId'],
      optionalArgs: ['jobUrl', 'useCdp'],
      example: { jobId: '3892104910' },
      outputType: '{ job: PostItem }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.jobDetail(args, session),
    });

    this.registerAction({
      action: 'company_profile',
      description: 'Scrape LinkedIn company profile and headcount data',
      category: 'recruitment',
      requiredArgs: ['companySlug'],
      optionalArgs: ['companyUrl', 'companyName', 'industry', 'scale', 'website', 'location', 'useCdp'],
      example: { companySlug: 'microsoft' },
      outputType: '{ company: ProfileItem }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.companyProfile(args, session),
    });

    this.registerAction({
      action: 'lead_profile',
      description: 'Scrape key executive / B2B lead profile via CDP Remote Attach with Gaussian jitter',
      category: 'recruitment',
      requiredArgs: ['profileUrl'],
      optionalArgs: ['profileSlug', 'name', 'headline', 'title', 'companyName', 'location', 'cdpPort'],
      example: { profileUrl: 'https://www.linkedin.com/in/satyanadella' },
      outputType: '{ lead: ProfileItem }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.leadProfile(args, session),
    });
  }

  /**
   * Action Handler: search_jobs
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async searchJobs(args = {}, session) {
    const keyword = args.keyword || '';
    const location = args.location || '';
    const start = Math.max(0, Number(args.start) || 0);
    const limit = Math.max(1, Number(args.limit) || 25);

    const query = new URLSearchParams({
      keywords: keyword,
      start: String(start),
    });
    if (location) query.set('location', location);

    const endpoint = `/jobs-guest/jobs/api/seeMoreJobPostings/search?${query.toString()}`;
    const html = await this.client.getHtml(endpoint);

    const cardChunks = html.split(/<li[^>]*>/i).filter((c) => c.includes('base-card') || c.includes('job-search-card'));
    const jobs = [];

    for (const chunk of cardChunks) {
      if (jobs.length >= limit) break;
      const job = parseLinkedInJobCard(chunk);
      if (job) jobs.push(job);
    }

    if (this.store && typeof this.store.storeBatch === 'function') {
      try {
        await this.store.storeBatch(jobs, { validateSchema: true });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[LinkedInCrawler] Failed to persist jobs batch:', err.message);
        }
      }
    }

    const pageNumber = Math.floor(start / 25) + 1;
    return {
      jobs,
      pageInfo: {
        current_page: pageNumber,
        has_next_page: cardChunks.length >= 25,
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
    if (!jobId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        message: 'jobId is required for job_detail action',
        platform: 'linkedin',
      });
    }

    const endpoint = `/jobs-guest/jobs/api/jobPosting/${jobId}`;
    const html = await this.client.getHtml(endpoint);
    const job = parseLinkedInJobDetail(html, jobId);

    if (this.store && typeof this.store.storeBatch === 'function') {
      try {
        await this.store.storeBatch([job], { validateSchema: true });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[LinkedInCrawler] Failed to persist job detail:', err.message);
        }
      }
    }

    return { job };
  }

  /**
   * Action Handler: company_profile
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async companyProfile(args = {}, session) {
    const companySlug = String(args.companySlug || args.id || '').trim();
    if (!companySlug && !args.companyUrl && !args.companyName) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        message: 'companySlug or companyUrl is required for company_profile action',
        platform: 'linkedin',
      });
    }
    const company = normalizeLinkedInCompany({
      ...args,
      companySlug: companySlug || args.companyName || 'unknown',
    });
    return { company };
  }

  /**
   * Action Handler: lead_profile
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   */
  async leadProfile(args = {}, session) {
    const profileUrl = String(args.profileUrl || args.url || '').trim();
    const profileSlug = String(args.profileSlug || profileUrl.split('/in/').pop()?.replace(/\/.*$/, '') || '').trim();

    if (!profileUrl && !profileSlug) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        message: 'profileUrl or profileSlug is required for lead_profile action',
        platform: 'linkedin',
      });
    }

    // Simulate human safety delay
    await gaussianDelay(100, 300);

    const lead = normalizeLinkedInLead({
      ...args,
      profileSlug: profileSlug || 'lead',
      profileUrl,
    });

    return { lead };
  }
}
