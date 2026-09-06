// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { MaSoThueClient } from '../../../../src/scrapers/procurement/masothue/client.js';
import { MaSoThuePlatformResponseValidator } from '../../../../src/scrapers/procurement/masothue/validator.js';

describe('MaSoThueClient', () => {
  let server;
  let serverUrl;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>OK</body></html>');
    });
    await new Promise((resolve) => server.listen(0, resolve));
    serverUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('uses MASOTHUE_BASE_URL by default', () => {
    const client = new MaSoThueClient({ requiresProxy: false });
    expect(client.baseUrl).toBe('https://masothue.com');
  });

  it('overrides baseUrl when provided', () => {
    const client = new MaSoThueClient({ baseUrl: 'https://example.com', requiresProxy: false });
    expect(client.baseUrl).toBe('https://example.com');
  });

  it('validator flags Cloudflare challenge as bot challenge', () => {
    const validator = new MaSoThuePlatformResponseValidator();
    const challengeResp = { status: 403, data: '<html><body>Just a moment...</body></html>' };
    expect(validator.isBotChallenge(challengeResp)).toBe(true);
    expect(validator.isValidPayload(challengeResp)).toBe(false);
  });

  it('validator accepts valid HTML with company info', () => {
    const validator = new MaSoThuePlatformResponseValidator();
    const validResp = {
      status: 200,
      data: '<html><body><table><tr><td>Mã số thuế</td><td>0013180180</td></tr><tr><td>Địa chỉ</td><td>123 ABC</td></tr></table></body></html>',
    };
    expect(validator.isValidPayload(validResp)).toBe(true);
    expect(validator.isBotChallenge(validResp)).toBe(false);
    expect(validator.isRateLimit(validResp)).toBe(false);
  });
});
