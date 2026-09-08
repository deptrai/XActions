import { describe, it, expect } from 'vitest';
import {
  HEALTHCARE_PLATFORMS,
  HEALTHCARE_BASE_URLS,
  normalizeCitySlug,
  normalizeSpecialtySlug,
  parseVnPhone,
} from '../../../src/scrapers/healthcare/schema.js';

describe('Healthcare schema', () => {
  it('should define supported platforms and base URLs', () => {
    expect(HEALTHCARE_PLATFORMS).toContain('medpro');
    expect(HEALTHCARE_PLATFORMS).toContain('youmed');
    expect(HEALTHCARE_PLATFORMS).toContain('nhathuoclongchau');
    expect(HEALTHCARE_PLATFORMS).toContain('thuocsi');
    expect(HEALTHCARE_BASE_URLS.medpro).toBe('https://medpro.vn');
    expect(HEALTHCARE_BASE_URLS.youmed).toBe('https://youmed.vn');
    expect(HEALTHCARE_BASE_URLS.nhathuoclongchau).toBe('https://nhathuoclongchau.com.vn');
  });

  it('should normalize city slug', () => {
    expect(normalizeCitySlug('Hà Nội')).toBe('ha-noi');
    expect(normalizeCitySlug('TP. Hồ Chí Minh')).toBe('ho-chi-minh');
    expect(normalizeCitySlug('tp-hcm')).toBe('ho-chi-minh');
  });

  it('should normalize specialty slug', () => {
    expect(normalizeSpecialtySlug('Nhi khoa')).toBe('nhi-khoa');
    expect(normalizeSpecialtySlug('Tai Mũi Họng')).toBe('tai-mui-hong');
  });

  it('should parse Vietnamese phone', () => {
    expect(parseVnPhone('0901234567')).toEqual({ phone: '0901234567', phoneMasked: false });
    expect(parseVnPhone('+84901234567')).toEqual({ phone: '0901234567', phoneMasked: false });
    expect(parseVnPhone('090***4567')).toEqual({ phone: null, phoneMasked: true });
    expect(parseVnPhone('')).toEqual({ phone: null, phoneMasked: false });
  });
});
