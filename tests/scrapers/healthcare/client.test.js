import { describe, it, expect } from 'vitest';
import { HealthcareClient } from '../../../src/scrapers/healthcare/client.js';

function makeHttpClient() {
  let captured = { url: '', headers: {} };
  const client = async (opts) => {
    captured = { url: opts.url, headers: opts.headers };
    return {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html><body>Mock</body></html>',
      data: undefined,
    };
  };
  return [client, () => captured];
}

describe('HealthcareClient', () => {
  it('should initialize with direct connection defaults', () => {
    const client = new HealthcareClient();
    expect(client.name).toBe('healthcare');
    expect(client.requiresAuth).toBe(false);
    expect(client.requiresProxy).toBe(false);
  });

  it('should build correct Medpro URL', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new HealthcareClient({ targetPlatform: 'medpro', httpClient });
    await client.searchClinics({ city: 'ho-chi-minh' });
    expect(getCaptured().url).toContain('medpro.vn/co-so-y-te');
  });

  it('should build correct Long Chau stores URL', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new HealthcareClient({ targetPlatform: 'nhathuoclongchau', httpClient });
    await client.getStores({ city: 'ha-noi' });
    expect(getCaptured().url).toContain('nhathuoclongchau.com.vn/he-thong-cua-hang');
  });

  it('should throw for Thuocsi catalog due to auth-gating', async () => {
    const client = new HealthcareClient({ targetPlatform: 'thuocsi' });
    await expect(client.getPharmacyCatalog()).rejects.toThrow(/auth/i);
  });
});
