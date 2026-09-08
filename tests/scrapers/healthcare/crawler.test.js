import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HealthcareCrawler } from '../../../src/scrapers/healthcare/crawler.js';
import { HealthcareClient } from '../../../src/scrapers/healthcare/client.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

function makeHttpClient() {
  return async (opts) => {
    const url = opts.url;
    let body = '';
    if (url.includes('medpro.vn')) {
      body = loadFixture('medpro-sample.html');
    } else if (url.includes('nhathuoclongchau.com.vn')) {
      body = loadFixture('longchau-sample.html');
    } else if (url.includes('youmed.vn')) {
      body = loadFixture('youmed-sample.html');
    } else {
      body = '<html><body>Not found</body></html>';
    }
    return {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body,
      data: undefined,
    };
  };
}

describe('HealthcareCrawler', () => {
  it('should initialize with correct metadata and registered actions', () => {
    const crawler = new HealthcareCrawler();
    expect(crawler.name).toBe('healthcare');
    expect(crawler.requiresAuth).toBe(false);
    const actionNames = crawler.listActions().map((a) => a.action);
    expect(actionNames).toContain('search_clinics');
    expect(actionNames).toContain('get_stores');
    expect(actionNames).toContain('pharmacy_catalog');
    expect(actionNames).toContain('detail');
  });

  it('should execute search_clinics on Medpro', async () => {
    const httpClient = makeHttpClient();
    const client = new HealthcareClient({ targetPlatform: 'medpro', httpClient });
    const crawler = new HealthcareCrawler({ client });
    const result = await crawler.start({ action: 'search_clinics', args: { platform: 'medpro' } });
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].platform).toBe('medpro');
    expect(result.posts[0].category).toBe('healthcare');
  });

  it('should execute get_stores on Long Chau', async () => {
    const httpClient = makeHttpClient();
    const client = new HealthcareClient({ targetPlatform: 'nhathuoclongchau', httpClient });
    const crawler = new HealthcareCrawler({ client });
    const result = await crawler.start({ action: 'get_stores', args: { platform: 'nhathuoclongchau' } });
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].platform).toBe('nhathuoclongchau');
  });

  it('should reject pharmacy_catalog with auth error', async () => {
    const crawler = new HealthcareCrawler();
    await expect(crawler.start({ action: 'pharmacy_catalog', args: { platform: 'thuocsi' } }))
      .rejects.toThrow(/auth/i);
  });
});
