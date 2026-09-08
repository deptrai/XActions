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

  it('should build correct Medpro URL with city, specialty, and page', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new HealthcareClient({ targetPlatform: 'medpro', httpClient });
    await client.searchClinics({ city: 'ho-chi-minh', specialty: 'Nhi khoa', page: 2 });
    expect(getCaptured().url).toContain('medpro.vn/co-so-y-te');
    expect(getCaptured().url).toContain('city=ho-chi-minh');
    expect(getCaptured().url).toContain('specialty=nhi-khoa');
    expect(getCaptured().url).toContain('page=2');
  });

  it('should build correct YouMed URL with specialty, city, and page', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new HealthcareClient({ targetPlatform: 'youmed', httpClient });
    await client.searchClinics({ city: 'ha-noi', specialty: 'Nội tiết', page: 3 });
    expect(getCaptured().url).toContain('youmed.vn/dat-kham/bac-si');
    expect(getCaptured().url).toContain('speciality=noi-tiet');
    expect(getCaptured().url).toContain('city=ha-noi');
    expect(getCaptured().url).toContain('page=3');
  });

  it('should build correct Long Chau stores URL with province and page', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new HealthcareClient({ targetPlatform: 'nhathuoclongchau', httpClient });
    await client.getStores({ city: 'Hà Nội', page: 2 });
    expect(getCaptured().url).toContain('nhathuoclongchau.com.vn/he-thong-cua-hang');
    expect(getCaptured().url).toContain('province=ha-noi');
    expect(getCaptured().url).toContain('page=2');
  });

  it('should build correct detail URLs for each platform', async () => {
    const [httpClient, getCaptured] = makeHttpClient();
    const client = new HealthcareClient({ targetPlatform: 'youmed', httpClient });

    await client.detail({ platform: 'youmed', slug: 'bs-tran-quang-nam' });
    expect(getCaptured().url).toBe('https://youmed.vn/dat-kham/bac-si/bs-tran-quang-nam');

    await client.detail({ platform: 'medpro', slug: 'bvnd115' });
    expect(getCaptured().url).toBe('https://medpro.vn/co-so-y-te/bvnd115');

    await client.detail({ platform: 'nhathuoclongchau', slug: 'thon-cau-tre' });
    expect(getCaptured().url).toBe('https://nhathuoclongchau.com.vn/he-thong-cua-hang/thon-cau-tre');
  });

  it('should throw for Thuocsi catalog due to auth-gating', async () => {
    const client = new HealthcareClient({ targetPlatform: 'thuocsi' });
    await expect(client.getPharmacyCatalog()).rejects.toThrow(/auth/i);
  });
});
