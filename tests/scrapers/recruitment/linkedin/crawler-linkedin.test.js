// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';

import { LinkedInCrawler } from '../../../../src/scrapers/recruitment/linkedin/crawler.js';
import { LinkedInClient } from '../../../../src/scrapers/recruitment/linkedin/client.js';
import { LinkedInPlatformResponseValidator } from '../../../../src/scrapers/recruitment/linkedin/validator.js';
import {
  parseLinkedInJobCard,
  parseLinkedInJobDetail,
  normalizeLinkedInCompany,
  normalizeLinkedInLead,
} from '../../../../src/scrapers/recruitment/linkedin/normalize-linkedin.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';

describe('Story 18.3 — LinkedIn B2B Lead & Job Scraper (TDD)', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];

  const createStore = () => new PrismaStore({ prisma });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          path: url.pathname,
          search: url.search,
          query: Object.fromEntries(url.searchParams.entries()),
          body,
        });

        // Challenge check
        if (url.searchParams.get('keywords') === 'challenge_test') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<html><body><div id="checkpoint_challenge">Security Verification</div></body></html>');
          return;
        }

        // Guest Jobs Search endpoint
        if (url.pathname.includes('/jobs-guest/jobs/api/seeMoreJobPostings/search')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <body>
                <li>
                  <div class="base-card" data-entity-urn="urn:li:jobPosting:3892104910">
                    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/senior-fullstack-engineer-at-microsoft-3892104910">
                      <span class="sr-only">Senior Fullstack Engineer</span>
                    </a>
                    <h3 class="base-search-card__title">Senior Fullstack Engineer</h3>
                    <h4 class="base-search-card__subtitle">
                      <a class="hidden-nested-link" href="https://www.linkedin.com/company/microsoft">Microsoft</a>
                    </h4>
                    <div class="base-search-card__metadata">
                      <span class="job-search-card__location">Hanoi, Vietnam</span>
                      <time class="job-search-card__listdate" datetime="2026-08-30">2 days ago</time>
                    </div>
                  </div>
                </li>
              </body>
            </html>
          `);
          return;
        }

        // Guest Job Detail endpoint
        if (url.pathname.includes('/jobs-guest/jobs/api/jobPosting/')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <body>
                <section class="top-card-layout">
                  <h1 class="top-card-layout__title">Senior Fullstack Engineer</h1>
                  <a class="topcard__org-name-link" href="https://www.linkedin.com/company/microsoft">Microsoft</a>
                  <span class="topcard__flavor topcard__flavor--bullet">Hanoi, Vietnam</span>
                </section>
                <div class="show-more-less-html__markup">
                  <p>We are looking for a Senior Fullstack Engineer proficient in React, Node.js, and Azure Cloud.</p>
                  <p>Requirements: 5+ years experience, solid understanding of distributed systems.</p>
                </div>
                <ul class="description__job-criteria-list">
                  <li>
                    <h3 class="description__job-criteria-subheader">Employment type</h3>
                    <span class="description__job-criteria-text description__job-criteria-text--criteria">Full-time</span>
                  </li>
                  <li>
                    <h3 class="description__job-criteria-subheader">Seniority level</h3>
                    <span class="description__job-criteria-text description__job-criteria-text--criteria">Mid-Senior level</span>
                  </li>
                </ul>
              </body>
            </html>
          `);
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    serverUrl = `http://${address.address}:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(async () => {
    receivedRequests = [];
    await cleanupTestDatabase();
  });

  const buildCrawler = () => {
    const client = new LinkedInClient({
      baseUrl: serverUrl,
      requiresProxy: false,
    });
    const crawler = new LinkedInCrawler({
      client,
      store: createStore(),
      requiresProxy: false,
    });
    return { client, crawler };
  };

  it('AC-1: LinkedInCrawler and LinkedInClient inherit base contracts and register 4 actions', () => {
    const { client, crawler } = buildCrawler();
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('linkedin');
    expect(crawler.platform).toBe('linkedin');
    expect(crawler.requiresAuth).toBe(false);

    const actions = crawler.listActions();
    const searchJobs = actions.find((a) => a.action === 'search_jobs');
    const jobDetail = actions.find((a) => a.action === 'job_detail');
    const companyProfile = actions.find((a) => a.action === 'company_profile');
    const leadProfile = actions.find((a) => a.action === 'lead_profile');

    expect(searchJobs).toBeTruthy();
    expect(searchJobs?.category).toBe('recruitment');
    expect(searchJobs?.requiredArgs).toEqual(['keyword']);

    expect(jobDetail).toBeTruthy();
    expect(jobDetail?.category).toBe('recruitment');

    expect(companyProfile).toBeTruthy();
    expect(companyProfile?.category).toBe('recruitment');

    expect(leadProfile).toBeTruthy();
    expect(leadProfile?.category).toBe('recruitment');
  });

  it('AC-2: search_jobs queries LinkedIn public guest jobs and normalizes PostItem', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'search_jobs',
      args: { keyword: 'Fullstack Engineer', location: 'Vietnam', limit: 10 },
    });

    expect(receivedRequests.length).toBeGreaterThan(0);
    const lastReq = receivedRequests[0];
    expect(lastReq.path).toContain('/jobs-guest/jobs/api/seeMoreJobPostings/search');
    expect(lastReq.query.keywords).toBe('Fullstack Engineer');

    expect(result).toHaveProperty('jobs');
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.id).toBe('linkedin:job:3892104910');
    expect(job.platform).toBe('linkedin');
    expect(job.category).toBe('recruitment');
    expect(job.authorName).toBe('Microsoft');
    expect(job.content).toContain('Senior Fullstack Engineer');
    expect(job.metadata).toMatchObject({
      jobId: '3892104910',
      title: 'Senior Fullstack Engineer',
      companyName: 'Microsoft',
      location: 'Hanoi, Vietnam',
      sourceMethod: 'search_jobs',
    });
  });

  it('AC-3: job_detail extracts structured job description and criteria', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'job_detail',
      args: { jobId: '3892104910' },
    });

    expect(result).toHaveProperty('job');
    const job = result.job;
    expect(job.id).toBe('linkedin:job:3892104910');
    expect(job.metadata.title).toBe('Senior Fullstack Engineer');
    expect(job.metadata.companyName).toBe('Microsoft');
    expect(job.metadata.description).toContain('We are looking for a Senior Fullstack Engineer');
    expect(job.metadata.employmentType).toBe('full_time');
    expect(job.metadata.seniorityLevel).toBe('Mid-Senior level');
    expect(job.metadata.skills).toContain('React');
    expect(job.metadata.skills).toContain('Node.js');
  });

  it('AC-4: company_profile & lead_profile normalizes ProfileItem objects', async () => {
    const { crawler } = buildCrawler();
    const compResult = await crawler.start({
      action: 'company_profile',
      args: { companySlug: 'microsoft', companyName: 'Microsoft Corporation', industry: 'Software Development' },
    });

    expect(compResult).toHaveProperty('company');
    expect(compResult.company.id).toBe('linkedin:company:microsoft');
    expect(compResult.company.platform).toBe('linkedin');
    expect(compResult.company.name).toBe('Microsoft Corporation');

    const leadResult = await crawler.start({
      action: 'lead_profile',
      args: {
        profileSlug: 'satyanadella',
        name: 'Satya Nadella',
        headline: 'Chairman and CEO at Microsoft',
        companyName: 'Microsoft',
        location: 'Redmond, WA',
      },
    });

    expect(leadResult).toHaveProperty('lead');
    expect(leadResult.lead.id).toBe('linkedin:lead:satyanadella');
    expect(leadResult.lead.name).toBe('Satya Nadella');
    expect(leadResult.lead.bio).toContain('Chairman and CEO');
  });

  it('AC-1: LinkedInPlatformResponseValidator detects challenge screens', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'search_jobs',
        args: { keyword: 'challenge_test' },
      })
    ).rejects.toMatchObject({
      code: 'XACT_4030',
      statusCode: 403,
    });
  });

  it('AC-5: unified scrape("linkedin", ...) dispatcher works end-to-end', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');

    const result = await scrape('linkedin', 'search_jobs', {
      baseUrl: serverUrl,
      keyword: 'Software Engineer',
      store: createStore(),
      requiresProxy: false,
    });

    expect(result).toHaveProperty('jobs');
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(result.jobs.length).toBeGreaterThan(0);
    expect(result.jobs[0].platform).toBe('linkedin');
    expect(result.jobs[0].category).toBe('recruitment');
  });

  it('AC-5: package.json exports include ./scrapers/recruitment/linkedin', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    expect(pkg.exports['./scrapers/recruitment/linkedin']).toBe(
      './src/scrapers/recruitment/linkedin/index.js'
    );
  });

  it('AC-5: scrapeLinkedIn convenience helper works end-to-end', async () => {
    const { scrapeLinkedIn } = await import(
      '../../../../src/scrapers/recruitment/linkedin/index.js'
    );

    const result = await scrapeLinkedIn(
      'search_jobs',
      { keyword: 'Cloud Architect' },
      {
        baseUrl: serverUrl,
        store: createStore(),
        requiresProxy: false,
        autoClose: true,
      }
    );

    expect(result).toHaveProperty('jobs');
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(result.jobs.length).toBeGreaterThan(0);
    expect(result.jobs[0].platform).toBe('linkedin');
  });
});
