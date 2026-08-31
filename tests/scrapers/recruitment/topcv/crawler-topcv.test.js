// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';

import { TopCvCrawler } from '../../../../src/scrapers/recruitment/topcv/crawler.js';
import { TopCvClient } from '../../../../src/scrapers/recruitment/topcv/client.js';
import { TopCvPlatformResponseValidator } from '../../../../src/scrapers/recruitment/topcv/validator.js';
import {
  normalizeKeywordToSlug,
  parseVietnameseSalary,
  parseExperienceYears,
  mapEmploymentType,
} from '../../../../src/scrapers/recruitment/topcv/normalize-job.js';
import { AbstractCrawler } from '../../../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../../../src/core/base-client.js';
import { PrismaStore } from '../../../../src/store/prisma-store.js';
import { prisma, cleanupTestDatabase } from '../../../store/test-prisma-client.js';

describe('Story 18.1 — TopCV Job & Company Scraper (TDD)', () => {
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

        // Search jobs HTML endpoint
        if (url.pathname.includes('/tim-viec-lam')) {
          if (url.searchParams.get('category') === 'challenge_test') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end('<html><head><title>Attention Required! | Cloudflare</title></head><body><div class="cf-browser-verification">cf</div></body></html>');
            return;
          }

          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <body>
                <div class="job-list-search-result">
                  <div class="job-item-search-result" data-job-id="123456" data-box="BoxSearchResult">
                    <h3 class="title">
                      <a href="/viec-lam/lap-trinh-vien-nodejs-sr/123456.html" target="_blank">
                        Senior Node.js Backend Developer
                      </a>
                    </h3>
                    <a class="company" href="/brand/techcorp-vn">TechCorp Vietnam</a>
                    <span class="salary">15 - 25 triệu</span>
                    <span class="location">Hà Nội</span>
                    <span class="exp">2 năm</span>
                    <div class="job-description">Xây dựng API microservices hiệu năng cao. Yêu cầu 2 năm kinh nghiệm Node.js, PostgreSQL.</div>
                  </div>
                </div>
              </body>
            </html>
          `);
          return;
        }

        // Job Detail HTML endpoint
        if (url.pathname.includes('/viec-lam/')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <body>
                <div class="job-detail">
                  <h1 class="job-title">Senior Node.js Backend Developer</h1>
                  <a class="company-name" href="/brand/techcorp-vn">TechCorp Vietnam</a>
                  <div class="job-salary">15 - 25 triệu</div>
                  <div class="job-location">Hà Nội: Tầng 5, Keangnam Landmark 72, Nam Từ Liêm</div>
                  <div class="job-deadline">Hạn nộp: 30/09/2026</div>
                  <div class="job-description">
                    <h2>Mô tả công việc</h2>
                    <p>- Phát triển RESTful API & GraphQL backend bằng Node.js</p>
                    <p>- Thiết kế và tối ưu database PostgreSQL</p>
                  </div>
                  <div class="job-requirements">
                    <h2>Yêu cầu ứng viên</h2>
                    <p>- Tối thiểu 2 năm kinh nghiệm với Node.js / TypeScript</p>
                    <p>- Thành thạo Redis, Docker</p>
                  </div>
                  <div class="job-benefits">
                    <h2>Quyền lợi</h2>
                    <p>- Lương tháng 13 + thưởng hiệu quả</p>
                    <p>- Bảo hiểm sức khỏe quốc tế</p>
                  </div>
                  <div class="job-tags">
                    <span class="tag">Node.js</span>
                    <span class="tag">PostgreSQL</span>
                    <span class="tag">Toàn thời gian</span>
                  </div>
                </div>
              </body>
            </html>
          `);
          return;
        }

        // Company Detail HTML endpoint
        if (url.pathname.includes('/brand/')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <body>
                <div class="company-detail">
                  <h1 class="company-name">TechCorp Vietnam</h1>
                  <div class="company-scale">100-499 nhân viên</div>
                  <div class="company-website"><a href="https://techcorp.vn">https://techcorp.vn</a></div>
                  <div class="company-address">Tầng 5, Keangnam Landmark 72, Hà Nội</div>
                  <div class="company-bio">Công ty công nghệ hàng đầu về nền tảng thương mại điện tử và fintech.</div>
                </div>
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
    const client = new TopCvClient({
      baseUrl: serverUrl,
      requiresProxy: false,
    });
    const crawler = new TopCvCrawler({
      client,
      store: createStore(),
      requiresProxy: false,
    });
    return { client, crawler };
  };

  it('AC-1: TopCvCrawler and TopCvClient inherit base contracts and register 3 actions', () => {
    const { client, crawler } = buildCrawler();
    expect(client).toBeInstanceOf(AbstractApiClient);
    expect(crawler).toBeInstanceOf(AbstractCrawler);
    expect(crawler.name).toBe('topcv');
    expect(crawler.platform).toBe('topcv');
    expect(crawler.requiresAuth).toBe(false);

    const actions = crawler.listActions();
    const searchJobs = actions.find((a) => a.action === 'search_jobs');
    const jobDetail = actions.find((a) => a.action === 'job_detail');
    const companyDetail = actions.find((a) => a.action === 'company_detail');

    expect(searchJobs).toBeTruthy();
    expect(searchJobs?.category).toBe('recruitment');
    expect(searchJobs?.requiredArgs).toEqual(['keyword']);
    expect(searchJobs?.optionalArgs).toContain('city');
    expect(searchJobs?.optionalArgs).toContain('salary');

    expect(jobDetail).toBeTruthy();
    expect(jobDetail?.category).toBe('recruitment');

    expect(companyDetail).toBeTruthy();
    expect(companyDetail?.category).toBe('recruitment');
  });

  it('AC-3: parseVietnameseSalary accurately parses salary variants', () => {
    expect(parseVietnameseSalary('Thương lượng')).toEqual({
      salaryMin: 0,
      salaryMax: 0,
      salaryCurrency: 'VND',
      isNegotiable: true,
    });

    expect(parseVietnameseSalary('Thỏa thuận')).toEqual({
      salaryMin: 0,
      salaryMax: 0,
      salaryCurrency: 'VND',
      isNegotiable: true,
    });

    expect(parseVietnameseSalary('15 - 25 triệu')).toEqual({
      salaryMin: 15000000,
      salaryMax: 25000000,
      salaryCurrency: 'VND',
      isNegotiable: false,
    });

    expect(parseVietnameseSalary('15-25tr')).toEqual({
      salaryMin: 15000000,
      salaryMax: 25000000,
      salaryCurrency: 'VND',
      isNegotiable: false,
    });

    expect(parseVietnameseSalary('Tới 40 triệu')).toEqual({
      salaryMin: 0,
      salaryMax: 40000000,
      salaryCurrency: 'VND',
      isNegotiable: false,
    });

    expect(parseVietnameseSalary('Dưới 15 triệu')).toEqual({
      salaryMin: 0,
      salaryMax: 15000000,
      salaryCurrency: 'VND',
      isNegotiable: false,
    });

    expect(parseVietnameseSalary('15 đến 25 triệu')).toEqual({
      salaryMin: 15000000,
      salaryMax: 25000000,
      salaryCurrency: 'VND',
      isNegotiable: false,
    });

    expect(parseVietnameseSalary('15,000,000 - 25,000,000 VND')).toEqual({
      salaryMin: 15000000,
      salaryMax: 25000000,
      salaryCurrency: 'VND',
      isNegotiable: false,
    });

    expect(parseVietnameseSalary('Từ 20 triệu')).toEqual({
      salaryMin: 20000000,
      salaryMax: null,
      salaryCurrency: 'VND',
      isNegotiable: false,
    });

    expect(parseVietnameseSalary('1,000 - 2,500 USD')).toEqual({
      salaryMin: 1000,
      salaryMax: 2500,
      salaryCurrency: 'USD',
      isNegotiable: false,
    });
  });

  it('AC-2 & AC-3: normalizeKeywordToSlug, parseExperienceYears, and mapEmploymentType work correctly', () => {
    expect(normalizeKeywordToSlug('Lập trình viên Node.js')).toBe('lap-trinh-vien-nodejs');
    expect(normalizeKeywordToSlug('Kế toán tổng hợp')).toBe('ke-toan-tong-hop');
    expect(parseExperienceYears('2 năm')).toBe(2);
    expect(parseExperienceYears('3+ years')).toBe(3);
    expect(mapEmploymentType('Toàn thời gian')).toBe('full_time');
    expect(mapEmploymentType('Part-time')).toBe('part_time');
    expect(mapEmploymentType('Thực tập')).toBe('intern');
  });

  it('AC-2: search_jobs fetches job postings and normalizes PostItem', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'search_jobs',
      args: { keyword: 'Node.js Developer', city: 'Hà Nội' },
    });

    expect(result).toHaveProperty('jobs');
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.id).toBe('topcv:job:123456');
    expect(job.platform).toBe('topcv');
    expect(job.category).toBe('recruitment');
    expect(job.content).toContain('Senior Node.js Backend Developer');
    expect(job.metadata).toMatchObject({
      jobId: '123456',
      title: 'Senior Node.js Backend Developer',
      companyName: 'TechCorp Vietnam',
      location: 'Hà Nội',
      salaryMin: 15000000,
      salaryMax: 25000000,
      salaryCurrency: 'VND',
      isNegotiable: false,
      experienceYears: 2,
    });
  });

  it('AC-4: job_detail fetches detailed JD and requirements', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'job_detail',
      args: { jobId: '123456', jobUrl: `${serverUrl}/viec-lam/lap-trinh-vien-nodejs-sr/123456.html` },
    });

    expect(result).toHaveProperty('job');
    const job = result.job;
    expect(job.id).toBe('topcv:job:123456');
    expect(job.metadata.title).toBe('Senior Node.js Backend Developer');
    expect(job.metadata.companyName).toBe('TechCorp Vietnam');
    expect(job.metadata.description).toContain('Phát triển RESTful API');
    expect(job.metadata.requirements).toContain('Tối thiểu 2 năm kinh nghiệm');
    expect(job.metadata.benefits).toContain('Lương tháng 13');
    expect(job.metadata.skills).toContain('Node.js');
    expect(job.metadata.skills).toContain('PostgreSQL');
  });

  it('AC-4: company_detail fetches company profile', async () => {
    const { crawler } = buildCrawler();
    const result = await crawler.start({
      action: 'company_detail',
      args: { companyId: 'techcorp-vn', companyUrl: `${serverUrl}/brand/techcorp-vn` },
    });

    expect(result).toHaveProperty('company');
    const company = result.company;
    expect(company.id).toBe('topcv:company:techcorp-vn');
    expect(company.platform).toBe('topcv');
    expect(company.name).toBe('TechCorp Vietnam');
    expect(company.metadata.scale).toBe('100-499 nhân viên');
    expect(company.metadata.website).toBe('https://techcorp.vn');
    expect(company.metadata.address).toContain('Keangnam Landmark 72');
    expect(company.bio).toContain('Công ty công nghệ hàng đầu');
  });

  it('AC-1: TopCvPlatformResponseValidator detects Cloudflare challenge', async () => {
    const { crawler } = buildCrawler();
    await expect(
      crawler.start({
        action: 'search_jobs',
        args: { keyword: 'challenge_test', category: 'challenge_test' },
      })
    ).rejects.toMatchObject({
      code: 'XACT_4030',
      statusCode: 403,
    });
  });

  it('AC-5: unified scrape("topcv", ...) dispatcher works end-to-end', async () => {
    const { scrape } = await import('../../../../src/scrapers/index.js');

    const result = await scrape('topcv', 'search_jobs', {
      baseUrl: serverUrl,
      keyword: 'NodeJS',
      store: createStore(),
      requiresProxy: false,
    });

    expect(result).toHaveProperty('jobs');
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(result.jobs.length).toBeGreaterThan(0);
    expect(result.jobs[0].platform).toBe('topcv');
    expect(result.jobs[0].category).toBe('recruitment');
  });

  it('AC-5: package.json exports include ./scrapers/recruitment/topcv', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    expect(pkg.exports['./scrapers/recruitment/topcv']).toBe('./src/scrapers/recruitment/topcv/index.js');
  });

  it('AC-5: scrapeTopCv convenience helper works end-to-end', async () => {
    const { scrapeTopCv } = await import('../../../../src/scrapers/recruitment/topcv/index.js');

    const result = await scrapeTopCv(
      'search_jobs',
      { keyword: 'Backend' },
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
    expect(result.jobs[0].platform).toBe('topcv');
  });
});
