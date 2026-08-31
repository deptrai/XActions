// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// E2E spec for LinkedIn Recruiter & B2B Lead Scraping (Story 18.3).
// by nichxbt
import { describe, it, expect } from 'vitest';
import { scrape } from '../../src/scrapers/index.js';
import { scrapeLinkedIn } from '../../src/scrapers/recruitment/linkedin/index.js';

describe('Story 18.3 — LinkedIn Public Guest & B2B Leads E2E', () => {
  it('should search real public jobs on LinkedIn without credentials', async () => {
    const result = await scrape('linkedin', 'search_jobs', {
      keyword: 'Software Engineer',
      location: 'Vietnam',
      limit: 3,
      requiresProxy: false,
      autoClose: true,
    });

    expect(result).toHaveProperty('jobs');
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(result.jobs.length).toBeGreaterThan(0);

    const firstJob = result.jobs[0];
    expect(firstJob.id).toMatch(/^linkedin:job:\d+/);
    expect(firstJob.platform).toBe('linkedin');
    expect(firstJob.category).toBe('recruitment');
    expect(firstJob.metadata.title).toBeTruthy();
    expect(firstJob.metadata.companyName).toBeTruthy();
    expect(firstJob.metadata.jobId).toBeTruthy();
  });

  it('should fetch and extract structured job detail using real job ID', async () => {
    // 1. Search for a live job ID
    const searchResult = await scrapeLinkedIn('search_jobs', {
      keyword: 'NodeJS',
      location: 'Vietnam',
      limit: 1,
      requiresProxy: false,
      autoClose: true,
    });

    expect(searchResult.jobs.length).toBeGreaterThan(0);
    const targetJobId = searchResult.jobs[0].metadata.jobId;
    expect(targetJobId).toBeTruthy();

    // 2. Query job_detail
    const detailResult = await scrape('linkedin', 'job_detail', {
      jobId: targetJobId,
      requiresProxy: false,
      autoClose: true,
    });

    expect(detailResult).toHaveProperty('job');
    const job = detailResult.job;
    expect(job.id).toBe(`linkedin:job:${targetJobId}`);
    expect(job.metadata.jobId).toBe(targetJobId);
    expect(job.metadata.companyName).toBeTruthy();
    expect(Array.isArray(job.metadata.skills)).toBe(true);
  });

  it('should normalize company and lead profile data structures for B2B intelligence', async () => {
    // Company profile
    const compResult = await scrape('linkedin', 'company_profile', {
      companySlug: 'microsoft',
      companyName: 'Microsoft Corporation',
      industry: 'Software Development',
      scale: '10,001+ employees',
      website: 'https://www.microsoft.com',
      location: 'Redmond, WA',
      autoClose: true,
    });

    expect(compResult).toHaveProperty('company');
    expect(compResult.company.id).toBe('linkedin:company:microsoft');
    expect(compResult.company.name).toBe('Microsoft Corporation');
    expect(compResult.company.metadata.website).toBe('https://www.microsoft.com');

    // Lead profile
    const leadResult = await scrape('linkedin', 'lead_profile', {
      profileSlug: 'satyanadella',
      name: 'Satya Nadella',
      headline: 'Chairman and CEO at Microsoft',
      companyName: 'Microsoft',
      location: 'Redmond, WA',
      autoClose: true,
    });

    expect(leadResult).toHaveProperty('lead');
    expect(leadResult.lead.id).toBe('linkedin:lead:satyanadella');
    expect(leadResult.lead.name).toBe('Satya Nadella');
    expect(leadResult.lead.bio).toBe('Chairman and CEO at Microsoft');
  });

  it('should throw validation error when required arguments are missing', async () => {
    await expect(scrape('linkedin', 'job_detail', {})).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
    });

    await expect(scrape('linkedin', 'company_profile', {})).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
    });

    await expect(scrape('linkedin', 'lead_profile', {})).rejects.toMatchObject({
      code: 'XACT_4001',
      statusCode: 400,
    });
  });
});
