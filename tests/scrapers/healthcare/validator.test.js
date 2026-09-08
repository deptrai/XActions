import { describe, it, expect } from 'vitest';
import { HealthcarePlatformResponseValidator } from '../../../src/scrapers/healthcare/validator.js';

describe('HealthcarePlatformResponseValidator', () => {
  const validator = new HealthcarePlatformResponseValidator();

  it('should validate Medpro __NEXT_DATA__ payload', () => {
    const html = '<html><head><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialHospitals":{"0":{"name":"BV 115"}}}}}</script></head></html>';
    expect(validator.isValidPayload(html)).toBe(true);
  });

  it('should validate YouMed doctor-card payload', () => {
    const html = '<html><body><div class="doctor-card"><a href="/bac-si/nguyen-van-a">BS Nguyen Van A</a></div></body></html>';
    expect(validator.isValidPayload(html)).toBe(true);
  });

  it('should validate YouMed WP REST specialities payload', () => {
    const json = JSON.stringify({ code: 200, data: { specialities: [{ name: 'Nhi khoa' }] } });
    expect(validator.isValidPayload(json)).toBe(true);
  });

  it('should validate Long Chau pharmacy payload', () => {
    const html = '<html><head><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialPharmacyRecommended":{"items":[]}}}}</script></head></html>';
    expect(validator.isValidPayload(html)).toBe(true);
  });

  it('should reject challenge / bot block pages', () => {
    const challenge = '<html><head><title>Just a moment...</title></head><body>cf-browser-verification</body></html>';
    expect(validator.isValidPayload(challenge)).toBe(false);
    expect(validator.isBotChallenge({ status: 403, body: challenge })).toBe(true);
  });

  it('should reject empty or invalid payload', () => {
    expect(validator.isValidPayload('')).toBe(false);
    expect(validator.isValidPayload(null)).toBe(false);
    expect(validator.isValidPayload('<html><body>404 Not Found</body></html>')).toBe(false);
  });
});
