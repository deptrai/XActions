// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import { AutomotiveClient } from '../../../../src/scrapers/vehicles/automotive/client.js';
import { AutomotivePlatformResponseValidator } from '../../../../src/scrapers/vehicles/automotive/validator.js';

describe('AutomotiveClient', () => {
  it('uses platform name and no auth by default', () => {
    const client = new AutomotiveClient({ requiresProxy: false });
    expect(client.platform).toBe('oto_vn');
    expect(client.requiresAuth).toBe(false);
    expect(client.requiresProxy).toBe(false);
  });

  it('switches baseUrl for bonbanh', () => {
    const client = new AutomotiveClient({ targetPlatform: 'bonbanh', requiresProxy: false });
    expect(client.baseUrl).toBe('https://bonbanh.com');
  });

  it('uses ChototClient for chotot_xe', () => {
    const client = new AutomotiveClient({ targetPlatform: 'chotot_xe', requiresProxy: false });
    expect(client.chototClient).toBeTruthy();
  });

  it('validates bot challenge correctly', () => {
    const validator = new AutomotivePlatformResponseValidator();
    expect(validator.isBotChallenge({ status: 403, body: '<html><body>Access denied</body></html>' })).toBe(true);
    expect(validator.isBotChallenge({ status: 200, body: 'ok' })).toBe(false);
  });
});
