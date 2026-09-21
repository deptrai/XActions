// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 37.1 — Engine telemetry metadata injection.
 * Verifies that AbstractCrawler.start() injects `_metadata` with
 * `engineUsed`, `durationMs`, `platform`, and `action` into every result,
 * and that the `got-jsdom` adapter is registered in the adapter registry.
 */

import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { scrape, DESCRIPTORS } from '../../src/scrapers/index.js';
import { getAdapter } from '../../src/scrapers/adapters/index.js';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { AbstractApiClient } from '../../src/core/base-client.js';

// ---------------------------------------------------------------------------
// Lightweight test crawler — uses AbstractApiClient (no browser)
// ---------------------------------------------------------------------------

class TestHttpClient extends AbstractApiClient {
  constructor(options = {}) {
    super({
      ...options,
      platform: 'test-http',
      client: 'got',
      requiresAuth: false,
      requiresProxy: false,
    });
    this.name = 'test-http';
  }
}

class TestHttpCrawler extends AbstractCrawler {
  constructor(deps = {}) {
    const client = deps.client || new TestHttpClient(deps);
    super({ client, ...deps, requiresAuth: false });
    this.name = 'test-http';
    this.registerAction({
      action: 'fetch',
      description: 'Test fetch action',
      category: 'test',
      requiresAuth: false,
      handler: async () => ({ posts: [{ id: '1', platform: 'test-http' }] }),
    });
  }
}

// ---------------------------------------------------------------------------
// Simulated browser crawler — uses a client with requiresBrowser = true
// ---------------------------------------------------------------------------

class TestBrowserClient extends AbstractApiClient {
  constructor(options = {}) {
    super({
      ...options,
      platform: 'test-browser',
      client: 'got',
      requiresAuth: false,
      requiresProxy: false,
    });
    this.name = 'test-browser';
    this.requiresBrowser = true;
  }
}

class TestBrowserCrawler extends AbstractCrawler {
  constructor(deps = {}) {
    const client = deps.client || new TestBrowserClient(deps);
    super({ client, ...deps, requiresAuth: false });
    this.name = 'test-browser';
    this.registerAction({
      action: 'fetch',
      description: 'Test browser fetch action',
      category: 'test',
      requiresAuth: false,
      handler: async () => ({ posts: [{ id: '1', platform: 'test-browser' }] }),
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Story 37.1 — Engine Telemetry Metadata', () => {
  it('injects _metadata.engineUsed=http for AbstractApiClient-based crawlers', async () => {
    const crawler = new TestHttpCrawler();
    const result = await crawler.start({ action: 'fetch' });

    assert.ok(result._metadata, '_metadata should exist');
    assert.equal(result._metadata.engineUsed, 'http');
    assert.equal(result._metadata.platform, 'test-http');
    assert.equal(result._metadata.action, 'fetch');
    assert.ok(typeof result._metadata.durationMs === 'number');
    assert.ok(result._metadata.durationMs >= 0);
  });

  it('injects _metadata.engineUsed=browser for browser-based crawlers', async () => {
    const crawler = new TestBrowserCrawler();
    const result = await crawler.start({ action: 'fetch' });

    assert.ok(result._metadata, '_metadata should exist');
    assert.equal(result._metadata.engineUsed, 'browser');
    assert.equal(result._metadata.platform, 'test-browser');
  });

  it('does not inject _metadata into array results', async () => {
    class ArrayCrawler extends AbstractCrawler {
      constructor(deps = {}) {
        const client = deps.client || new TestHttpClient(deps);
        super({ client, ...deps, requiresAuth: false });
        this.name = 'test-array';
        this.registerAction({
          action: 'list',
          description: 'Returns array',
          category: 'test',
          requiresAuth: false,
          handler: async () => [{ id: '1' }],
        });
      }
    }
    const crawler = new ArrayCrawler();
    const result = await crawler.start({ action: 'list' });
    assert.ok(Array.isArray(result));
    assert.ok(!result._metadata, 'arrays should not get _metadata');
  });

  it('got-jsdom adapter is registered and instantiable', async () => {
    const adapter = await getAdapter('got-jsdom');
    assert.ok(adapter, 'got-jsdom adapter should be instantiable');
    assert.equal(adapter.name, 'got-jsdom');
    assert.equal(adapter.requiresBrowser, false);
  });

  it('real HTTP-first subclass (MaSoThueClient, no manual requiresBrowser) reports engineUsed=http', async () => {
    // Regression for the Story 37.1 fix: MaSoThueClient extends AbstractApiClient
    // without ever assigning requiresBrowser — the field must default to false on
    // the base class so engineUsed is 'http', not 'browser'.
    const { MaSoThueClient } = await import('../../src/scrapers/procurement/masothue/client.js');
    const client = new MaSoThueClient({});
    assert.equal(client.requiresBrowser, false, 'AbstractApiClient must default requiresBrowser=false');

    class MasothueCrawler extends AbstractCrawler {
      constructor() {
        super({ client, requiresAuth: false });
        this.name = 'masothue';
        this.registerAction({
          action: 'fetch',
          description: 'Test',
          category: 'test',
          requiresAuth: false,
          handler: async () => ({ posts: [{ id: '1', platform: 'masothue' }] }),
        });
      }
    }
    const result = await new MasothueCrawler().start({ action: 'fetch' });
    assert.equal(result._metadata.engineUsed, 'http');
  });

  it('engineUsed guard is fail-safe: non-AbstractApiClient client without the flag still classifies', async () => {
    // A duck-typed client object that is NOT an AbstractApiClient and carries no
    // requiresBrowser flag must be classified 'browser' (fail-safe), not 'http'.
    class DuckClient { /* no requiresBrowser field */ }
    class DuckCrawler extends AbstractCrawler {
      constructor() {
        super({ client: new DuckClient(), requiresAuth: false });
        this.name = 'duck';
        this.registerAction({
          action: 'fetch',
          description: 'Test',
          category: 'test',
          requiresAuth: false,
          handler: async () => ({ posts: [{ id: '1' }] }),
        });
      }
    }
    const result = await new DuckCrawler().start({ action: 'fetch' });
    assert.equal(result._metadata.engineUsed, 'browser');
  });

  it('constructor options.requiresBrowser overrides the default', async () => {
    const client = new TestHttpClient({ requiresBrowser: true });
    assert.equal(client.requiresBrowser, true);
  });
});
