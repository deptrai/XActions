// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FnbMerchantCrawler — unit tests.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FnbMerchantCrawler } from '../../../../src/scrapers/fnb/merchant/crawler.js';
import { FnbMerchantClient } from '../../../../src/scrapers/fnb/merchant/client.js';
import { isValidCategory } from '../../../../src/core/types.js';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

describe('fnb_merchant category', () => {
  it('should accept fnb_merchant as valid category', () => {
    expect(isValidCategory('fnb_merchant')).toBe(true);
  });
});

describe('FnbMerchantCrawler', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      const pathname = url.pathname;
      let body = '';
      let status = 200;

      if (pathname.includes('pasgo') && pathname.includes('nha-hang')) {
        body = loadFixture('pasgo-search.html');
      } else if (pathname.includes('foody') && pathname.includes('nha-hang')) {
        body = loadFixture('foody-search.html');
      } else if (pathname.includes('riviu') && pathname.includes('nha-hang')) {
        body = loadFixture('riviu-search.html');
      } else if (pathname.includes('detail')) {
        body = loadFixture('pasgo-detail.html');
      } else if (pathname.includes('challenge')) {
        status = 403;
        body = '<html><body>Just a moment...</body></html>';
      } else {
        status = 404;
        body = '<html><body>Not found</body></html>';
      }

      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });

    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('should create crawler with default client', () => {
    const crawler = new FnbMerchantCrawler();
    expect(crawler.name).toBe('fnb');
    expect(crawler.requiresAuth).toBe(false);
  });

  it('should have registered actions', () => {
    const crawler = new FnbMerchantCrawler();
    const actions = crawler.listActions();
    const actionNames = actions.map((a) => a.action);
    expect(actionNames).toContain('search_restaurants');
    expect(actionNames).toContain('newly_opened');
    expect(actionNames).toContain('search_by_district');
    expect(actionNames).toContain('detail');
  });
});
