// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';

import { VietnamWorksCrawler } from '../../../../src/scrapers/recruitment/vietnamworks/crawler.js';
import { VietnamWorksClient } from '../../../../src/scrapers/recruitment/vietnamworks/client.js';
import { VietnamWorksPlatformResponseValidator } from '../../../../src/scrapers/recruitment/vietnamworks/validator.js';
import {
  normalizeVietnamWorksSalary,
  mapWorkingType,
  parseVietnamWorksDate,
} from '../../../../src/scrapers/recruitment/vietnamworks/normalize-job.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';

describe('Story 18.2 — VietnamWorks Job Scraper (TDD)', () => {
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
        let parsedBody = {};
        try {
          parsedBody = JSON.parse(body || '{}');
        } catch {}

        receivedRequests.push({
          method: req.method,
          path: url.pathname,
          search: url.search,
          query: Object.fromEntries(url.searchParams.entries()),
          body: parsedBody,
        });

        // Search Jobs JSON API endpoint
        if (url.pathname.includes('/job-search/v1.0/search')) {
          if (parsedBody.keyword === 'challenge_test') {
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Blocked by Cloudflare/WAF', code: 403 }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            data: [
              {
                jobId: 1987654,
                jobTitle: 'Principal Node.js & Cloud Architect',
                companyName: 'VNG Corporation',
                companyLogo: 'https://images.vietnamworks.com/company/vng.png',
                jobUrl: 'https://www.vietnamworks.com/principal-nodejs-cloud-architect-1987654-jv',
                workingLocations: [
                  {
                    cityNameVI: 'Hồ Chí Minh',
                    cityName: 'Ho Chi Minh',
                    address: 'Z06 Đường số 13, Phường Tân Thuận Đông, Quận 7',
                  },
                ],
                salaryMin: 3000,
                salaryMax: 5000,
                salaryCurrency: 'USD',
                prettySalary: '$3,000 - $5,000',
                typeWorkingId: 1,
                yearsOfExperience: 5,
                jobDescription: 'Architecting scalable cloud microservices handling 100M+ DAU.',
                jobRequirement: 'Expert in Node.js, TypeScript, Kubernetes, Kafka, AWS.',
                benefits: [
                  { benefitName: '13th month salary & performance bonus' },
                  { benefitName: 'Premium Healthcare Insurance' },
                ],
                skills: [
                  { skillName: 'Node.js' },
                  { skillName: 'TypeScript' },
                  { skillName: 'Cloud Architecture' },
                ],
                createdOn: '2026-08-30T08:00:00Z',
                approvedOn: '2026-08-30T09:00:00Z',
                expiredOn: '2026-09-30T23:59:59Z',
                isActive: true,
              },
            ],
            meta: {
              page: parsedBody.page || 1,
              hitsPerPage: parsedBody.hitsPerPage || 20,
              totalHits: 45,
            },
          }));
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
    const client = new VietnamWorksClient({
      baseUrl: serverUrl,
      requiresProxy: false,
    });
    const crawler = new VietnamWorksCrawler({
      client,
      store: createStore(),
      requiresProxy: false,
    });
    return { client, crawler };
  };

  it('AC-1: VietnamWorksCrawler and VietnamWorksClient inherit base contracts and register 3 actions', () => {
    const { client, crawler } = buildCrawler();
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('vietnamworks');
    expect(crawler.platform).toBe('vietnamworks');
    expect(crawler.requiresAuth).toBe(false);

    const actions = crawler.listActions();
    const searchJobs = actions.find((a) => a.action === 'search_jobs');
    const jobDetail = actions.find((a) => a.action === 'job_detail');
    const companyDetail = actions.find((a) => a.action === 'company_detail');

    expect(searchJobs).toBeTruthy();
    expect(searchJobs?.category).toBe('recruitment');
    expect(searchJobs?.requiredArgs).toEqual(['keyword']);
    expect(searchJobs?.optionalArgs).toContain('city');
    expect(searchJobs?.optionalArgs).toContain('salaryMin');

    expect(jobDetail).toBeTruthy();
    expect(jobDetail?.category).toBe('recruitment');

    expect(companyDetail).toBeTruthy();
    expect(companyDetail?.category).toBe('recruitment');
  });

  it('AC-3: normalizeVietnamWorksSalary accurately normalizes salary boundaries', () => {
    expect(normalizeVietnamWorksSalary(0, 0)).toEqual({
      salaryMin: 0,
      salaryMax: 0,
      isNegotiable: true,
    });

    expect(normalizeVietnamWorksSalary(15000000, 0)).toEqual({
      salaryMin: 15000000,
      salaryMax: null,
      isNegotiable: false,
    });

    expect(normalizeVietnamWorksSalary(0, 30000000)).toEqual({
      salaryMin: 0,
      salaryMax: 30000000,
      isNegotiable: false,
    });

    expect(normalizeVietnamWorksSalary(15000000, 25000000)).toEqual({
      salaryMin: 15000000,
      salaryMax: 25000000,
      isNegotiable: false,
    });

    expect(normalizeVietnamWorksSalary('15,000,000', '25,000,000')).toEqual({
      salaryMin: 15000000,
      salaryMax: 25000000,
      isNegotiable: false,
    });
  });

  it('AC-3: mapWorkingType and parseVietnamWorksDate handle standard field formats', () => {
    expect(mapWorkingType(1)).toBe('full_time');
    expect(mapWorkingType(2)).toBe('part_time');
    expect(mapWorkingType(3)).toBe('contract');
    expect(mapWorkingType(4)).toBe('intern');
    expect(mapWorkingType(null)).toBeNull();

    expect(parseVietnamWorksDate('2026-08-30T08:00:00Z')).toBe('2026-08-30');
    expect(parseVietnamWorksDate(1788158400000)).toBeDefined();
    expect(parseVietnamWorksDate(null)).toBeNull();
  });

  it('AC-2: search_jobs queries VietnamWorks search endpoint and produces PostItem', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'search_jobs',
      args: { keyword: 'NodeJS', salaryMin: 3000, limit: 10 },
    });

    expect(receivedRequests.length).toBeGreaterThan(0);
    const lastReq = receivedRequests[0];
    expect(lastReq.path).toContain('/job-search/v1.0/search');
    expect(lastReq.body).toMatchObject({
      keyword: 'NodeJS',
      salaryMin: 3000,
    });

    expect(result).toHaveProperty('jobs');
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.id).toBe('vietnamworks:job:1987654');
    expect(job.platform).toBe('vietnamworks');
    expect(job.category).toBe('recruitment');
    expect(job.authorName).toBe('VNG Corporation');
    expect(job.content).toContain('Principal Node.js & Cloud Architect');
    expect(job.metadata).toMatchObject({
      jobId: '1987654',
      title: 'Principal Node.js & Cloud Architect',
      companyName: 'VNG Corporation',
      location: 'Hồ Chí Minh',
      salaryMin: 3000,
      salaryMax: 5000,
      salaryCurrency: 'USD',
      isNegotiable: false,
      experienceYears: 5,
      employmentType: 'full_time',
      skills: ['Node.js', 'TypeScript', 'Cloud Architecture'],
      benefits: ['13th month salary & performance bonus', 'Premium Healthcare Insurance'],
    });
  });

  it('AC-4: job_detail extracts structured job detail', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'job_detail',
      args: { jobId: '1987654', keyword: 'Principal Node.js' },
    });

    expect(result).toHaveProperty('job');
    const job = result.job;
    expect(job.id).toBe('vietnamworks:job:1987654');
    expect(job.metadata.title).toBe('Principal Node.js & Cloud Architect');
    expect(job.metadata.companyName).toBe('VNG Corporation');
    expect(job.metadata.description).toContain('Architecting scalable cloud microservices');
    expect(job.metadata.requirements).toContain('Expert in Node.js');
    expect(job.metadata.skills).toContain('Node.js');
  });

  it('AC-4: company_detail extracts company profile', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'company_detail',
      args: { companyId: 'vng-corporation', companyName: 'VNG Corporation' },
    });

    expect(result).toHaveProperty('company');
    const company = result.company;
    expect(company.id).toBe('vietnamworks:company:vng-corporation');
    expect(company.platform).toBe('vietnamworks');
    expect(company.name).toBe('VNG Corporation');
  });

  it('AC-1: VietnamWorksPlatformResponseValidator detects WAF block', async () => {
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

  it('AC-5: unified scrape("vietnamworks", ...) dispatcher works end-to-end', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');

    const result = await scrape('vietnamworks', 'search_jobs', {
      baseUrl: serverUrl,
      keyword: 'NodeJS',
      store: createStore(),
      requiresProxy: false,
    });

    expect(result).toHaveProperty('jobs');
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(result.jobs.length).toBeGreaterThan(0);
    expect(result.jobs[0].platform).toBe('vietnamworks');
    expect(result.jobs[0].category).toBe('recruitment');
  });

  it('AC-5: package.json exports include ./scrapers/recruitment/vietnamworks', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    expect(pkg.exports['./scrapers/recruitment/vietnamworks']).toBe(
      './src/scrapers/recruitment/vietnamworks/index.js'
    );
  });

  it('AC-5: scrapeVietnamWorks convenience helper works end-to-end', async () => {
    const { scrapeVietnamWorks } = await import(
      '../../../../src/scrapers/recruitment/vietnamworks/index.js'
    );

    const result = await scrapeVietnamWorks(
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
    expect(result.jobs[0].platform).toBe('vietnamworks');
  });
});
