// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FnbMerchantClient — unit tests.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { FnbMerchantClient } from '../../../../src/scrapers/fnb/merchant/client.js';
import { normalizeCitySlug, normalizeDistrictSlug } from '../../../../src/scrapers/fnb/merchant/schema.js';

function makeHttpClient() {
  let captured = { url: '', headers: {} };
  const client = async (opts) => {
    captured = { url: opts.url, headers: opts.headers };
    return {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html><body>PasGo</body></html>',
      data: undefined,
    };
  };
  return [client, () => captured];
}

describe('FnbMerchantClient', () => {
  it('should create client with default settings', () => {
    const client = new FnbMerchantClient({ requiresProxy: false });
    expect(client.name).toBe('fnb');
    expect(client.requiresAuth).toBe(false);
    expect(client.requiresProxy).toBe(true);
  });

  it('should normalize city slug', () => {
    const client = new FnbMerchantClient({ requiresProxy: false });
    expect(client.baseUrl).toBeDefined();
    expect(normalizeCitySlug('Hà Nội')).toBe('ha-noi');
    expect(normalizeCitySlug('TP.HCM', 'foody')).toBe('ho-chi-minh');
  });

  it('should build search URL for PasGo and send request', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new FnbMerchantClient({ targetPlatform: 'pasgo', requiresProxy: false, httpClient });
    const resp = await client.searchRestaurants({ city: 'ha-noi' });
    expect(getCaptured().url).toContain('/ha-noi/nha-hang');
    expect(getCaptured().url).toContain('page=1');
    expect(resp.body).toBe('<html><body>PasGo</body></html>');
  });

  it('should build search URL for Foody with dynamic base', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new FnbMerchantClient({ targetPlatform: 'foody', requiresProxy: false, httpClient });
    await client.searchRestaurants({ city: 'ho-chi-minh', page: 2 });
    expect(getCaptured().url).toContain('/ho-chi-minh/nha-hang');
    expect(getCaptured().url).toContain('page=2');
  });

  it('should build search URL for Riviu with dynamic base', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new FnbMerchantClient({ targetPlatform: 'riviu', requiresProxy: false, httpClient });
    await client.searchRestaurants({ city: 'ha-noi', page: 3 });
    expect(getCaptured().url).toContain('/ha-noi');
    expect(getCaptured().url).toContain('page=3');
  });

  it('should require slug for Foody detail', async () => {
    const client = new FnbMerchantClient({ targetPlatform: 'foody', requiresProxy: false });
    await expect(client.detail({ id: '123', city: 'ha-noi' })).rejects.toThrow(/Slug is required/);
  });

  it('should build Foody detail URL with slug', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new FnbMerchantClient({ targetPlatform: 'foody', requiresProxy: false, httpClient });
    await client.detail({ id: '123', slug: 'quan-an-xyz', city: 'ho-chi-minh' });
    expect(getCaptured().url).toContain('/quan-an-xyz');
  });

  it('should build district search URL', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new FnbMerchantClient({ targetPlatform: 'pasgo', requiresProxy: false, httpClient });
    await client.searchByDistrict({ city: 'ha-noi', district: 'dong-da' });
    expect(getCaptured().url).toContain('/ha-noi/nha-hang/dong-da');
  });
});
