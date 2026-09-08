import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeHealthcareResults } from '../../../src/scrapers/healthcare/normalizer.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

describe('normalizeHealthcareResults', () => {
  it('should parse Medpro hospitals from __NEXT_DATA__', () => {
    const html = loadFixture('medpro-sample.html');
    const posts = normalizeHealthcareResults(html, 'search', { platform: 'medpro' });
    expect(posts).toHaveLength(2);
    expect(posts[0].platform).toBe('medpro');
    expect(posts[0].category).toBe('healthcare');
    expect(posts[0].metadata.facilityName).toBe('Bệnh viện Nhân Dân 115');
    expect(posts[0].metadata.city).toBe('Thành phố Hồ Chí Minh');
    expect(posts[0].metadata.businessType).toBe('hospital');
  });

  it('should parse Long Chau pharmacies from __NEXT_DATA__', () => {
    const html = loadFixture('longchau-sample.html');
    const posts = normalizeHealthcareResults(html, 'stores', { platform: 'nhathuoclongchau' });
    expect(posts).toHaveLength(1);
    expect(posts[0].platform).toBe('nhathuoclongchau');
    expect(posts[0].category).toBe('healthcare');
    expect(posts[0].metadata.facilityName).toContain('Long Châu');
    expect(posts[0].metadata.phone).toBe('0901234567');
    expect(posts[0].metadata.gpsLat).toBe(21.410897);
    expect(posts[0].metadata.businessType).toBe('pharmacy');
    expect(posts[0].metadata.license).toEqual({ documentNumber: '4517/DKKDD-PT' });
  });

  it('should parse YouMed doctor-card from SSR HTML', () => {
    const html = loadFixture('youmed-sample.html');
    const posts = normalizeHealthcareResults(html, 'search', { platform: 'youmed' });
    expect(posts).toHaveLength(1);
    expect(posts[0].platform).toBe('youmed');
    expect(posts[0].category).toBe('healthcare');
    expect(posts[0].metadata.doctorName).toContain('Trần Quang Nam');
    expect(posts[0].metadata.specialty).toBe('Nội tiết');
    expect(posts[0].metadata.businessType).toBe('doctor');
  });

  it('should return empty array for empty/invalid HTML', () => {
    expect(normalizeHealthcareResults('', 'search', { platform: 'medpro' })).toEqual([]);
    expect(normalizeHealthcareResults('<html><body>nothing</body></html>', 'search', { platform: 'medpro' })).toEqual([]);
  });
});
