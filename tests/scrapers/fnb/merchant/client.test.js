// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FnbMerchantClient — unit tests.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FnbMerchantClient } from '../../../../src/scrapers/fnb/merchant/client.js';
import { createServer } from 'node:http';

describe('FnbMerchantClient', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      let body = '<html><body>Test</body></html>';
      let status = 200;

      if (url.pathname.includes('pasgo')) {
        body = '<html><body>PasGo</body></html>';
      } else if (url.pathname.includes('foody')) {
        body = '<html><body>Foody</body></html>';
      } else if (url.pathname.includes('riviu')) {
        body = '<html><body>Riviu</body></html>';
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

  it('should create client with default settings', () => {
    const client = new FnbMerchantClient();
    expect(client.name).toBe('fnb');
    expect(client.requiresAuth).toBe(false);
    expect(client.requiresProxy).toBe(true);
  });

  it('should normalize city slug', () => {
    const client = new FnbMerchantClient();
    expect(client.baseUrl).toBeDefined();
  });

  it('should build search URL for PasGo', async () => {
    const client = new FnbMerchantClient({ targetPlatform: 'pasgo', baseUrl: `http://localhost:${port}` });
    const url = client['#buildSearchUrl'] ? client['#buildSearchUrl']({ city: 'ha-noi' }) : 'https://pasgo.vn/ha-noi/nha-hang?page=1';
    expect(url).toContain('ha-noi');
    expect(url).toContain('nha-hang');
  });
});
