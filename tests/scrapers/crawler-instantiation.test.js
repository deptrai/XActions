// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for crawler instantiation across platforms (Story 20.1).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

describe('crawler instantiation', () => {
  it('instantiates B2BRegistryExtendedCrawler via procurement/b2b-registry-extended/index.js', async () => {
    const { B2BRegistryExtendedCrawler } = await import('../../src/scrapers/procurement/b2b-registry-extended/index.js');
    assert.equal(typeof B2BRegistryExtendedCrawler, 'function');
    const crawler = new B2BRegistryExtendedCrawler();
    assert.ok(crawler);
    assert.equal(crawler.name, 'b2b_registry_extended');
    assert.ok(Array.isArray(crawler.listActions()));
    assert.ok(crawler.listActions().length > 0);
  });

  it('instantiates ChototCrawler via realestate/chotot/crawler.js', async () => {
    const { ChototCrawler } = await import('../../src/scrapers/realestate/chotot/crawler.js');
    const crawler = new ChototCrawler();
    assert.ok(crawler);
    assert.equal(crawler.platform, 'chotot');
    assert.ok(crawler.listActions().length > 0);
  });

  it('instantiates MaSoThueCrawler via procurement/masothue/crawler.js', async () => {
    const { MaSoThueCrawler } = await import('../../src/scrapers/procurement/masothue/crawler.js');
    const crawler = new MaSoThueCrawler();
    assert.ok(crawler);
    assert.equal(crawler.name, 'masothue');
    assert.ok(crawler.listActions().length > 0);
  });
});
